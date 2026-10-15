import { useEffect, useMemo, useRef, useState } from "react";
import type { PedidoFerias, PeriodoFerias, ProgramacaoFerias } from "../../../api/client";
import { Alert, Button, TextField } from "../../../design-system";
import { dataBr, fimEVolta, plural, ultimoDiaParaComecar } from "./feriasFormato";

// Espelham as regras do servidor (ferias.routes.ts), que é quem decide; aqui só evitam a ida e volta.
const DIAS_ABONO = 10;
const MIN_DIAS_GOZO = 5;
const MAX_DIAS = 30;

type Props = {
  nome: string;
  periodo: PeriodoFerias;
  /** Presente ao editar uma programação já gravada. */
  inicial?: ProgramacaoFerias;
  salvando: boolean;
  erro: string | null;
  onSalvar: (pedido: PedidoFerias) => void;
  onCancelar: () => void;
};

export function FormularioFerias({ nome, periodo, inicial, salvando, erro, onSalvar, onCancelar }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  // Ao editar, os dias da própria programação voltam para o saldo.
  const saldo = periodo.diasPendentes + (inicial ? inicial.dias + inicial.diasAbono : 0);
  const abonoJaVendido = periodo.diasAbono - (inicial?.diasAbono ?? 0);
  const podeVender = saldo > DIAS_ABONO && abonoJaVendido === 0;
  const [inicio, setInicio] = useState(inicial?.gozoInicio ?? "");
  const [vendeAbono, setVendeAbono] = useState((inicial?.diasAbono ?? 0) > 0);
  const diasDoAbono = vendeAbono ? DIAS_ABONO : 0;
  const [dias, setDias] = useState(String(inicial?.dias ?? Math.min(MAX_DIAS, Math.max(1, saldo - diasDoAbono))));
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

  const erroInicio = inicio === "" ? "Informe a data de início." : inicio <= periodo.aquisitivoFim ? "Só depois do fim do período aquisitivo." : undefined;
  let erroDias: string | undefined;
  if (!diasInteiros || diasNum < 1 || diasNum > MAX_DIAS) erroDias = `Use de 1 a ${MAX_DIAS} dias.`;
  else if (resto < 0) erroDias = `Só restam ${Math.max(0, saldo - diasDoAbono)} ${plural(saldo - diasDoAbono, "dia", "dias")}.`;
  else if (diasNum < MIN_DIAS_GOZO && resto !== 0) erroDias = `Cada parte tem no mínimo ${MIN_DIAS_GOZO} dias, a não ser que seja tudo o que sobra.`;
  else if (resto > 0 && resto < MIN_DIAS_GOZO) erroDias = `Sobrariam ${resto} ${plural(resto, "dia", "dias")}: use tudo ou deixe ao menos ${MIN_DIAS_GOZO}.`;
  const mostraErroInicio = tentou || (inicio !== "" && erroInicio !== undefined) ? erroInicio : undefined;
  const mostraErroDias = tentou || (dias !== "" && erroDias !== undefined) ? erroDias : undefined;
  const depoisDoLimite = datas !== null && !erroDias && datas.fim > periodo.fimConcessivo;

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
          hint={`Último dia para começar sem vencer: ${dataBr(ultimoDiaParaComecar(periodo.fimConcessivo, saldo))}`} />
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
      <div aria-live="polite" aria-atomic="true" className="fe-previa-area">
        {datas && !erroInicio && !erroDias && (
          <p className="fe-previa">
            Vai de <strong>{dataBr(inicio)}</strong> a <strong>{dataBr(datas.fim)}</strong> e volta ao trabalho em <strong>{dataBr(datas.volta)}</strong>.
          </p>
        )}
      </div>
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
