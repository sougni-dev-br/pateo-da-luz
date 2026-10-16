import { useEffect, useMemo, useRef, useState } from "react";
import type { PedidoFerias, PeriodoFerias, ProgramacaoFerias } from "../../../api/client";
import { Alert, Button, TextField } from "../../../design-system";
import { dataBr, fimEVolta, plural, ultimoDiaParaComecar } from "./feriasFormato";
import { DIAS_DE_AVISO, type Feriados, MAX_PARTES, dataValida, MIN_DIAS_PARTE_MAIOR, motivoInicioVedado, nomeDoDia, prazoParaPagar, proximoInicioValido, repousosPorExtenso } from "./regrasFerias";
import { diasEntre } from "./eixoDoTempo";

// Espelham as regras do servidor (ferias.routes.ts), que é quem decide; aqui só evitam a ida e volta.
const DIAS_ABONO = 10;
const MIN_DIAS_GOZO = 5;
const MAX_DIAS = 30;

type Props = {
  nome: string;
  periodo: PeriodoFerias;
  /** Presente ao editar uma programação já gravada. */
  inicial?: ProgramacaoFerias;
  /** Datas já escolhidas na linha do tempo (arrasto, clique ou sugestão); o formulário só confirma. */
  sugestao?: { inicio: string; dias: number; /** Data que a pessoa escolheu antes do ajuste para um dia permitido. */ ajustadoDe?: string };
  /** Hoje e os feriados: a data de início não pode cair em dia vedado e a lei pede aviso com 30 dias. */
  regras?: { hoje: string; feriados: Feriados; repousos: number[]; repousoPelaEscala: boolean };
  /** Quem já estará fora em parte desse período (sem a própria pessoa), com os colegas do mesmo setor à parte. */
  conflitos?: (inicio: string, dias: number) => { mesmoSetor: string[]; outros: string[]; setor: string | null };
  /** Avisa as datas válidas que estão digitadas, para a linha do tempo desenhá-las; null quando inválidas. */
  onPrevia?: (previa: { inicio: string; dias: number } | null) => void;
  salvando: boolean;
  erro: string | null;
  onSalvar: (pedido: PedidoFerias) => void;
  onCancelar: () => void;
};

export function FormularioFerias({ nome, periodo, inicial, sugestao, regras, conflitos, onPrevia, salvando, erro, onSalvar, onCancelar }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  // Ao editar, os dias da própria programação voltam para o saldo.
  const saldo = periodo.diasPendentes + (inicial ? inicial.dias + inicial.diasAbono : 0);
  const abonoJaVendido = periodo.diasAbono - (inicial?.diasAbono ?? 0);
  const podeVender = saldo > DIAS_ABONO && abonoJaVendido === 0;
  const [inicio, setInicio] = useState(sugestao?.inicio ?? inicial?.gozoInicio ?? "");
  const [vendeAbono, setVendeAbono] = useState((inicial?.diasAbono ?? 0) > 0);
  const diasDoAbono = vendeAbono ? DIAS_ABONO : 0;
  const maximoSemAbono = Math.min(MAX_DIAS, Math.max(1, saldo - diasDoAbono));
  const [dias, setDias] = useState(String(sugestao ? Math.min(sugestao.dias, maximoSemAbono) : inicial?.dias ?? maximoSemAbono));
  const [observacao, setObservacao] = useState(inicial?.observacao ?? "");
  const [tentou, setTentou] = useState(false);

  // Conteúdo revelado fora da tela rola e foca sozinho (padrão do ERP), sem animação se o usuário pediu.
  useEffect(() => {
    const reduzido = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    formRef.current?.scrollIntoView?.({ block: "nearest", behavior: reduzido ? "auto" : "smooth" });
    formRef.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }, []);

  const diasNum = Number(dias);
  const diasInteiros = dias !== "" && Number.isInteger(diasNum);
  const resto = saldo - diasNum - diasDoAbono;
  const datas = useMemo(() => fimEVolta(inicio, diasNum), [inicio, diasNum]);

  // Editar só as outras informações de férias que já estão combinadas não pode travar numa data antiga.
  const dataMudou = !inicial || inicial.gozoInicio !== inicio;
  const vedado = regras && dataValida(inicio) && inicio > periodo.aquisitivoFim && dataMudou ? motivoInicioVedado(inicio, regras.feriados, regras.repousos) : null;
  const erroInicio = inicio === "" ? "Informe a data de início."
    : !dataValida(inicio) ? "Data inválida."
    : inicio <= periodo.aquisitivoFim ? "Só depois do fim do período aquisitivo."
      : vedado ? `Não pode começar em ${nomeDoDia(inicio)}, ${dataBr(inicio)}: ${vedado} (CLT, art. 134, § 3º).` : undefined;
  const proximoValido = vedado && regras ? proximoInicioValido(inicio, regras.feriados, regras.repousos) : null;
  let erroDias: string | undefined;
  if (!diasInteiros || diasNum < 1 || diasNum > MAX_DIAS) erroDias = `Use de 1 a ${MAX_DIAS} dias.`;
  else if (resto < 0) erroDias = `Só restam ${Math.max(0, saldo - diasDoAbono)} ${plural(saldo - diasDoAbono, "dia", "dias")}.`;
  else if (diasNum < MIN_DIAS_GOZO && resto !== 0) erroDias = `Cada parte tem no mínimo ${MIN_DIAS_GOZO} dias, a não ser que seja tudo o que sobra.`;
  else if (resto > 0 && resto < MIN_DIAS_GOZO) erroDias = `Sobrariam ${resto} ${plural(resto, "dia", "dias")}: use tudo ou deixe ao menos ${MIN_DIAS_GOZO}.`;
  const mostraErroInicio = tentou || (inicio !== "" && erroInicio !== undefined) ? erroInicio : undefined;
  const mostraErroDias = tentou || (dias !== "" && erroDias !== undefined) ? erroDias : undefined;
  const depoisDoLimite = datas !== null && !erroDias && datas.fim > periodo.fimConcessivo;
  const valido = datas !== null && !erroInicio && !erroDias;
  const desenhavel = datas !== null && !erroDias && inicio > periodo.aquisitivoFim;
  const colegas = valido && conflitos ? conflitos(inicio, diasNum) : null;
  const avisoDias = regras && valido ? diasEntre(regras.hoje, inicio) : null;

  // Divisão: o servidor só recusa o que já fechou a conta; aqui avisa antes de a conta fechar mal.
  const outrasPartes = periodo.programacoes.filter((g) => g.id !== inicial?.id && g.gozoInicio);
  const maiorParte = Math.max(diasNum, ...outrasPartes.map((g) => g.dias));
  const semParteLonga = !erroDias && resto > 0 && maiorParte < MIN_DIAS_PARTE_MAIOR && resto < MIN_DIAS_PARTE_MAIOR && !periodo.doHistorico;
  const partesDemais = !erroDias && outrasPartes.length + 1 > MAX_PARTES;

  // A linha do tempo desenha o que está digitado; ao fechar o formulário a prévia some.
  useEffect(() => {
    onPrevia?.(desenhavel ? { inicio, dias: diasNum } : null);
  }, [desenhavel, inicio, diasNum, onPrevia]);
  useEffect(() => () => onPrevia?.(null), [onPrevia]);

  const alternarAbono = (marcado: boolean) => {
    setVendeAbono(marcado);
    if (!inicial) setDias(String(Math.min(MAX_DIAS, Math.max(1, saldo - (marcado ? DIAS_ABONO : 0)))));
  };

  const salvar = () => {
    if (salvando) return;
    if (erroInicio || erroDias) {
      setTentou(true);
      // Foca o primeiro campo com problema depois que o React marcar aria-invalid.
      setTimeout(() => formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus(), 0);
      return;
    }
    onSalvar({
      aquisitivoInicio: periodo.aquisitivoInicio, gozoInicio: inicio, dias: diasNum, diasAbono: diasDoAbono,
      observacao: observacao.trim() || undefined,
    });
  };

  return (
    <form ref={formRef} className="fe-form" noValidate aria-label={`${inicial ? "Editar" : "Programar"} férias de ${nome}`}
      onSubmit={(e) => { e.preventDefault(); salvar(); }}
      onKeyDown={(e) => { if (e.key === "Escape" && !e.defaultPrevented && !salvando) onCancelar(); }}>
      <div className="fe-form-campos">
        <TextField label="Início das férias" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} required
          error={mostraErroInicio}
          hint={`Último dia para começar sem vencer: ${dataBr(ultimoDiaParaComecar(periodo.fimConcessivo, saldo))}${regras ? `. Repouso considerado: ${repousosPorExtenso(regras.repousos)} (${regras.repousoPelaEscala ? "pela escala" : "padrão, sem folgas na escala"})` : ""}`} />
        <TextField label="Dias de férias" type="number" inputMode="numeric" min={1} max={MAX_DIAS} value={dias} onChange={(e) => setDias(e.target.value)} required
          error={mostraErroDias} hint={`Restam ${saldo} ${plural(saldo, "dia", "dias")} neste período`} />
        {podeVender || vendeAbono ? (
          <label className="fe-abono">
            <input type="checkbox" checked={vendeAbono} onChange={(e) => alternarAbono(e.target.checked)} />
            <span><strong>Vender {DIAS_ABONO} dias (abono)</strong><small>A pessoa tira {saldo - DIAS_ABONO} dias e recebe os outros {DIAS_ABONO} em dinheiro.</small></span>
          </label>
        ) : (
          <p className="fe-abono fe-abono--indisponivel">
            {abonoJaVendido > 0 ? `Esse período já vendeu ${abonoJaVendido} dias de abono.` : `Abono indisponível: restam só ${saldo} dias.`}
          </p>
        )}
        <TextField label="Observação (opcional)" value={observacao} maxLength={300} onChange={(e) => setObservacao(e.target.value)}
          hint="Evite dados de saúde ou motivos pessoais." />
      </div>

      {/* Região sempre montada (e visível ao leitor de tela) para anunciar a prévia quando ela muda. */}
      {proximoValido && proximoValido !== inicio && (
        <p className="fe-sugerir">
          Próximo dia permitido: <strong>{nomeDoDia(proximoValido)}, {dataBr(proximoValido)}</strong>{" "}
          <Button type="button" size="sm" variant="secondary" onClick={() => setInicio(proximoValido)}>Usar esse dia</Button>
        </p>
      )}
      <div aria-live="polite" aria-atomic="true" className="fe-previa-area">
        {datas && !erroInicio && !erroDias && (
          <p className="fe-previa">
            Vai de <strong>{dataBr(inicio)}</strong> a <strong>{dataBr(datas.fim)}</strong> e volta ao trabalho em <strong>{dataBr(datas.volta)}</strong>.
            {regras && <> Pagar as férias até <strong>{dataBr(prazoParaPagar(inicio))}</strong> (CLT, art. 145).</>}
          </p>
        )}
      </div>
      {sugestao?.ajustadoDe && sugestao.ajustadoDe !== inicio && (
        <Alert tone="info" role={undefined}>
          Mudei o início de {dataBr(sugestao.ajustadoDe)} para {dataBr(inicio)}: férias não podem começar em dia de repouso, feriado nem nos 2 dias antes.
        </Alert>
      )}
      {colegas && colegas.mesmoSetor.length > 0 && (
        <Alert tone="warning" role={undefined}>
          Do mesmo setor ({colegas.setor}) {plural(colegas.mesmoSetor.length, "já estará fora", "já estarão fora")} nesse período: {colegas.mesmoSetor.join(", ")}.
        </Alert>
      )}
      {colegas && colegas.outros.length > 0 && (
        <Alert tone="info" role={undefined}>
          Nesse período {plural(colegas.outros.length, "já estará fora", "já estarão fora")}{colegas.mesmoSetor.length > 0 ? " (outros setores)" : ""}: {colegas.outros.join(", ")}.
        </Alert>
      )}
      {avisoDias !== null && avisoDias < DIAS_DE_AVISO && (
        <Alert tone="warning" role={undefined}>
          {avisoDias < 0 ? "Esse início já passou." : `Faltam só ${avisoDias} ${plural(avisoDias, "dia", "dias")} para o início.`} A lei pede aviso por escrito à pessoa com {DIAS_DE_AVISO} dias de antecedência (CLT, art. 135): combine só se ela já concordou.
        </Alert>
      )}
      {semParteLonga && (
        <Alert tone="warning" role={undefined}>
          Nenhuma parte chegaria a {MIN_DIAS_PARTE_MAIOR} dias (esta tem {diasNum} e sobrariam {resto}). Quando as férias são divididas, uma das partes precisa ter ao menos {MIN_DIAS_PARTE_MAIOR} dias (CLT, art. 134, § 1º).
        </Alert>
      )}
      {partesDemais && (
        <Alert tone="warning" role={undefined}>As férias de um período podem ser divididas em no máximo {MAX_PARTES} partes.</Alert>
      )}
      {depoisDoLimite && (
        <Alert tone="warning" role={undefined}>Essas férias terminariam depois do fim do prazo ({dataBr(periodo.fimConcessivo)}): o período fica vencido e as férias são pagas em dobro.</Alert>
      )}
      {erro && <Alert tone="error" role="alert">{erro}</Alert>}

      <div className="fe-form-acoes">
        <Button type="submit" size="sm" aria-disabled={salvando}>{salvando ? "Salvando…" : inicial ? "Salvar alteração" : "Programar"}</Button>
        <Button type="button" variant="secondary" size="sm" aria-disabled={salvando} onClick={() => { if (!salvando) onCancelar(); }}>Cancelar (Esc)</Button>
      </div>
    </form>
  );
}
