import { useEffect, useMemo, useRef, useState } from "react";
import type { PeriodoFerias } from "../../../api/client";
import { Alert, Button, TextField } from "../../../design-system";
import { diasEntre } from "./eixoDoTempo";
import { dataBr, fimEVolta, plural, ultimoDiaParaComecar } from "./feriasFormato";
import { type Feriados, dataValida, motivoInicioVedado, nomeDoDia, repousosPorExtenso } from "./regrasFerias";

const DIAS_ABONO = 10;
const MAX_DIAS = 30;

export type DadosDoPedido = { inicio: string; dias: number; diasAbono: number; observacao?: string };

type Props = {
  nome: string;
  periodo: PeriodoFerias;
  regras?: { hoje: string; feriados: Feriados; repousos: number[]; repousoPelaEscala: boolean };
  /** Quem já estará fora em parte desse período (sem a própria pessoa), com os colegas do mesmo setor à parte. */
  conflitos?: (inicio: string, dias: number) => { mesmoSetor: string[]; outros: string[]; setor: string | null };
  salvando: boolean;
  erro: string | null;
  onSalvar: (pedido: DadosDoPedido) => void;
  /** Só existe quando já há um pedido gravado. */
  onRetirar?: () => void;
  /** Abre a programação já com estas datas: a empresa atende o pedido. */
  onAtender: (pedido: DadosDoPedido) => void;
  /** Avisa as datas válidas que estão digitadas, para a linha do tempo desenhá-las; null quando inválidas. */
  onPrevia?: (previa: { inicio: string; dias: number } | null) => void;
  onCancelar: () => void;
};

/**
 * O que o colaborador pediu para este período. Não bloqueia por dia vedado nem por colegas: é só o pedido, e os avisos
 * mostram o que a empresa vai encontrar ao programar (dia vedado, prazo, quem já estará fora).
 */
export function PedidoDoColaborador({ nome, periodo, regras, conflitos, salvando, erro, onSalvar, onRetirar, onAtender, onPrevia, onCancelar }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const atual = periodo.solicitacao;
  const [inicio, setInicio] = useState(atual?.inicio ?? "");
  const [vendeAbono, setVendeAbono] = useState((atual?.diasAbono ?? 0) > 0);
  const diasDoAbono = vendeAbono ? DIAS_ABONO : 0;
  const [dias, setDias] = useState(String(atual?.dias ?? Math.min(MAX_DIAS, Math.max(1, (periodo.diasPendentes || MAX_DIAS) - diasDoAbono))));
  const [observacao, setObservacao] = useState(atual?.observacao ?? "");
  const [tentou, setTentou] = useState(false);

  useEffect(() => {
    const reduzido = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    formRef.current?.scrollIntoView?.({ block: "nearest", behavior: reduzido ? "auto" : "smooth" });
    formRef.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }, []);

  const diasNum = Number(dias);
  const diasInteiros = dias !== "" && Number.isInteger(diasNum);
  const datas = useMemo(() => (dataValida(inicio) ? fimEVolta(inicio, diasNum) : null), [inicio, diasNum]);

  const erroInicio = inicio === "" ? "Informe a data que o colaborador pediu."
    : !dataValida(inicio) ? "Data inválida."
      : inicio <= periodo.aquisitivoFim ? "Só depois do fim do período aquisitivo." : undefined;
  let erroDias: string | undefined;
  if (!diasInteiros || diasNum < 1 || diasNum > MAX_DIAS) erroDias = `Use de 1 a ${MAX_DIAS} dias.`;
  else if (diasNum + diasDoAbono > MAX_DIAS) erroDias = `Com o abono de ${DIAS_ABONO} dias, o pedido passa de ${MAX_DIAS}.`;
  const mostraErroInicio = tentou || (inicio !== "" && erroInicio !== undefined) ? erroInicio : undefined;
  const mostraErroDias = tentou || (dias !== "" && erroDias !== undefined) ? erroDias : undefined;
  const valido = datas !== null && !erroInicio && !erroDias;
  const desenhavel = datas !== null && !erroDias && inicio > periodo.aquisitivoFim;

  useEffect(() => { onPrevia?.(desenhavel ? { inicio, dias: diasNum } : null); }, [desenhavel, inicio, diasNum, onPrevia]);
  useEffect(() => () => onPrevia?.(null), [onPrevia]);

  // O que a empresa vai encontrar ao programar estas datas.
  const vedado = valido && regras ? motivoInicioVedado(inicio, regras.feriados, regras.repousos) : null;
  const passaDoPrazo = valido && datas.fim > periodo.fimConcessivo;
  const passaDoSaldo = valido && periodo.diasPendentes > 0 && diasNum + diasDoAbono > periodo.diasPendentes;
  const colegas = valido && conflitos ? conflitos(inicio, diasNum) : null;
  const diasAteOInicio = valido && regras ? diasEntre(regras.hoje, inicio) : null;
  const dadosValidos = (): DadosDoPedido => ({ inicio, dias: diasNum, diasAbono: diasDoAbono, observacao: observacao.trim() || undefined });

  const salvar = () => {
    if (salvando) return;
    if (!valido) {
      setTentou(true);
      setTimeout(() => formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus(), 0);
      return;
    }
    onSalvar(dadosValidos());
  };
  const atender = () => {
    if (salvando) return;
    if (!valido) { setTentou(true); return; }
    onAtender(dadosValidos());
  };

  return (
    <form ref={formRef} className="fe-form fe-form--pedido" noValidate aria-label={`Pedido de férias de ${nome}`}
      onSubmit={(e) => { e.preventDefault(); salvar(); }}
      onKeyDown={(e) => { if (e.key === "Escape" && !e.defaultPrevented && !salvando) onCancelar(); }}>
      <p className="fe-form-explica">
        <strong>Pedido do colaborador:</strong> o que {nome} pediu. A empresa decide depois, ao programar; o pedido fica ao lado para comparar.
      </p>
      <div className="fe-form-campos">
        <TextField label="Início pedido" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} required error={mostraErroInicio}
          hint={`Prazo limite: começar até ${dataBr(ultimoDiaParaComecar(periodo.fimConcessivo, Math.max(1, periodo.diasPendentes || MAX_DIAS)))}${regras ? `. Repouso considerado: ${repousosPorExtenso(regras.repousos)}` : ""}`} />
        <TextField label="Dias pedidos" type="number" inputMode="numeric" min={1} max={MAX_DIAS} value={dias} onChange={(e) => setDias(e.target.value)} required
          error={mostraErroDias} hint={periodo.diasPendentes > 0 ? `Restam ${periodo.diasPendentes} ${plural(periodo.diasPendentes, "dia", "dias")} a programar` : "Este período já está todo programado"} />
        {periodo.diasPendentes > DIAS_ABONO || vendeAbono ? (
          <label className="fe-abono">
            <input type="checkbox" checked={vendeAbono} onChange={(e) => setVendeAbono(e.target.checked)} />
            <span><strong>Pediu para vender {DIAS_ABONO} dias (abono)</strong><small>Recebe esses dias em dinheiro e tira o resto.</small></span>
          </label>
        ) : null}
        <TextField label="Observação (opcional)" value={observacao} maxLength={300} onChange={(e) => setObservacao(e.target.value)}
          hint="O motivo ou o combinado. Evite dados de saúde." />
      </div>

      <div aria-live="polite" aria-atomic="true" className="fe-previa-area">
        {datas && !erroInicio && !erroDias && (
          <p className="fe-previa">
            O pedido vai de <strong>{dataBr(inicio)}</strong> a <strong>{dataBr(datas.fim)}</strong> e a volta seria em <strong>{dataBr(datas.volta)}</strong>.
          </p>
        )}
      </div>
      {vedado && (
        <Alert tone="warning" role={undefined}>
          A empresa não vai poder programar começando em {nomeDoDia(inicio)}, {dataBr(inicio)}: {vedado} (CLT, art. 134, § 3º). Combine com o colaborador outro dia.
        </Alert>
      )}
      {passaDoPrazo && (
        <Alert tone="warning" role={undefined}>Esse pedido termina depois do fim do prazo ({dataBr(periodo.fimConcessivo)}): atendido assim, o período vence e as férias são pagas em dobro.</Alert>
      )}
      {passaDoSaldo && (
        <Alert tone="info" role={undefined}>O pedido soma {diasNum + diasDoAbono} dias e só restam {periodo.diasPendentes} a programar neste período.</Alert>
      )}
      {colegas && colegas.mesmoSetor.length > 0 && (
        <Alert tone="warning" role={undefined}>
          Do mesmo setor ({colegas.setor}) {plural(colegas.mesmoSetor.length, "já estará fora", "já estarão fora")} nessas datas: {colegas.mesmoSetor.join(", ")}.
        </Alert>
      )}
      {colegas && colegas.outros.length > 0 && (
        <Alert tone="info" role={undefined}>
          Nessas datas {plural(colegas.outros.length, "já estará fora", "já estarão fora")}{colegas.mesmoSetor.length > 0 ? " (outros setores)" : ""}: {colegas.outros.join(", ")}.
        </Alert>
      )}
      {diasAteOInicio !== null && diasAteOInicio < 30 && (
        <Alert tone="info" role={undefined}>
          {diasAteOInicio < 0 ? "Esse início já passou." : `Faltam só ${diasAteOInicio} ${plural(diasAteOInicio, "dia", "dias")} para o início.`} O aviso por escrito pede 30 dias de antecedência (CLT, art. 135).
        </Alert>
      )}
      {erro && <Alert tone="error" role="alert">{erro}</Alert>}

      <div className="fe-form-acoes">
        <Button type="submit" size="sm" aria-disabled={salvando}>{salvando ? "Salvando…" : atual ? "Salvar pedido" : "Registrar pedido"}</Button>
        <Button type="button" variant="secondary" size="sm" aria-disabled={salvando} onClick={atender}>Atender: programar estas datas</Button>
        {onRetirar && <Button type="button" variant="secondary" size="sm" aria-disabled={salvando} onClick={() => { if (!salvando) onRetirar(); }}>Retirar pedido</Button>}
        <Button type="button" variant="secondary" size="sm" aria-disabled={salvando} onClick={() => { if (!salvando) onCancelar(); }}>Cancelar (Esc)</Button>
      </div>
    </form>
  );
}
