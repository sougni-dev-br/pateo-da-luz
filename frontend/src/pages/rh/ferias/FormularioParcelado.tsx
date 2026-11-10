import { Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PeriodoFerias } from "../../../api/client";
import { Alert, Button, TextField } from "../../../design-system";
import { dataBr, fimEVolta, plural } from "./feriasFormato";
import { MIN_DIAS_PARA_PARCELAR, type ParteEmEdicao, partesIniciais, validarPartes } from "./parcelamento";
import { diasEntre } from "./eixoDoTempo";
import { DIAS_DE_AVISO, type Feriados, MAX_PARTES, dataValida, motivoInicioVedado, nomeDoDia } from "./regrasFerias";

const DIAS_ABONO = 10;

export type DadosParcelados = { partes: Array<{ gozoInicio: string; dias: number }>; diasAbono: number; observacao?: string };

type Props = {
  nome: string;
  periodo: PeriodoFerias;
  regras?: { hoje: string; feriados: Feriados; repousos: number[]; repousoPelaEscala: boolean };
  /** Data (e abono) já escolhidos na linha do tempo ou vindos do pedido do colaborador: pré-preenchem a 1ª parte. */
  sugestao?: { inicio: string; diasAbono?: number };
  /** Foca o primeiro campo ao montar. Desligado quando o formulário já nasce escondido atrás da pergunta Integral/Parcelada. */
  autoFoco?: boolean;
  /** A linha do tempo desenha a primeira parte válida enquanto se digita. */
  onPrevia?: (previa: { inicio: string; dias: number } | null) => void;
  salvando: boolean;
  erro: string | null;
  onSalvar: (dados: DadosParcelados) => void;
  onCancelar: () => void;
};

export function FormularioParcelado({ nome, periodo, regras, sugestao, autoFoco = true, onPrevia, salvando, erro, onSalvar, onCancelar }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const saldo = periodo.diasPendentes;
  const podeVender = saldo - DIAS_ABONO >= MIN_DIAS_PARA_PARCELAR && periodo.diasAbono === 0;
  const [vendeAbono, setVendeAbono] = useState(() => podeVender && (sugestao?.diasAbono ?? 0) > 0);
  const total = saldo - (vendeAbono ? DIAS_ABONO : 0);
  const [partes, setPartes] = useState<ParteEmEdicao[]>(() => {
    const iniciais = partesIniciais(saldo - (podeVender && (sugestao?.diasAbono ?? 0) > 0 ? DIAS_ABONO : 0));
    return sugestao ? iniciais.map((p, i) => (i === 0 ? { ...p, inicio: sugestao.inicio } : p)) : iniciais;
  });
  const [observacao, setObservacao] = useState("");
  const [tentou, setTentou] = useState(false);

  useEffect(() => {
    const reduzido = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!autoFoco) return;
    formRef.current?.scrollIntoView?.({ block: "nearest", behavior: reduzido ? "auto" : "smooth" });
    formRef.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resultado = useMemo(() => {
    const vedado = (inicio: string) => {
      const motivo = regras ? motivoInicioVedado(inicio, regras.feriados, regras.repousos) : null;
      return motivo ? `Não pode começar em ${nomeDoDia(inicio)}, ${dataBr(inicio)}: ${motivo} (CLT, art. 134, § 3º).` : null;
    };
    return validarPartes(partes, total, periodo.aquisitivoFim, vedado);
  }, [partes, total, periodo.aquisitivoFim, regras]);
  const soma = partes.reduce((s, p) => s + (Number.isInteger(Number(p.dias)) ? Number(p.dias) : 0), 0);

  const primeira = partes[0];
  const diasDaPrimeira = Number(primeira?.dias);
  const previaInicio = primeira && dataValida(primeira.inicio) && primeira.inicio > periodo.aquisitivoFim && Number.isInteger(diasDaPrimeira) && diasDaPrimeira >= 1 ? primeira.inicio : null;
  useEffect(() => {
    onPrevia?.(previaInicio ? { inicio: previaInicio, dias: diasDaPrimeira } : null);
  }, [previaInicio, diasDaPrimeira, onPrevia]);
  useEffect(() => () => onPrevia?.(null), [onPrevia]);

  const mudar = (i: number, campo: keyof ParteEmEdicao, valor: string) => setPartes((atual) => atual.map((p, j) => (j === i ? { ...p, [campo]: valor } : p)));
  const salvar = () => {
    if (salvando) return;
    if (!resultado.valido) {
      setTentou(true);
      setTimeout(() => formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus(), 0);
      return;
    }
    onSalvar({
      partes: partes.map((p) => ({ gozoInicio: p.inicio, dias: Number(p.dias) })),
      diasAbono: vendeAbono ? DIAS_ABONO : 0,
      observacao: observacao.trim() || undefined,
    });
  };

  return (
    <form ref={formRef} className="fe-form" noValidate aria-label={`Programar férias parceladas de ${nome}`}
      onSubmit={(e) => { e.preventDefault(); salvar(); }}
      onKeyDown={(e) => { if (e.key === "Escape" && !e.defaultPrevented && !salvando) onCancelar(); }}>
      <ol className="fe-partes" aria-label="Partes das férias">
        {partes.map((p, i) => {
          const dias = Number(p.dias);
          const datas = dataValida(p.inicio) && Number.isInteger(dias) && dias >= 1 ? fimEVolta(p.inicio, dias) : null;
          const erros = resultado.porParte[i];
          const passaDoPrazo = datas !== null && datas.fim > periodo.fimConcessivo;
          return (
            <li key={i} className="fe-parte">
              <span className="fe-parte-num" aria-hidden="true">{i + 1}ª</span>
              <TextField label={`Início da ${i + 1}ª parte`} type="date" value={p.inicio} onChange={(e) => mudar(i, "inicio", e.target.value)} required
                error={tentou || p.inicio !== "" ? erros?.inicio : undefined} />
              <TextField label={`Dias da ${i + 1}ª parte`} type="number" inputMode="numeric" min={5} max={30} value={p.dias} onChange={(e) => mudar(i, "dias", e.target.value)} required
                error={tentou || p.dias !== "" ? erros?.dias : undefined} />
              {partes.length > 2 ? (
                <Button type="button" size="sm" variant="icon" className="fe-parte-remover" aria-label={`Remover a ${i + 1}ª parte`} onClick={() => { setPartes((a) => a.filter((_, j) => j !== i)); setTimeout(() => formRef.current?.querySelector<HTMLInputElement>("input")?.focus(), 0); }}><X size={14} /></Button>
              ) : <span />}
              {datas && !erros?.inicio && (
                <p className="fe-parte-previa">
                  De <strong>{dataBr(p.inicio)}</strong> a <strong>{dataBr(datas.fim)}</strong>, volta em <strong>{dataBr(datas.volta)}</strong>.
                  {passaDoPrazo && <> Termina depois do prazo ({dataBr(periodo.fimConcessivo)}): fica vencida e paga em dobro.</>}
                  {regras && diasEntre(regras.hoje, p.inicio) < DIAS_DE_AVISO && <> {diasEntre(regras.hoje, p.inicio) < 0 ? "Esse início já passou." : `Faltam só ${diasEntre(regras.hoje, p.inicio)} dias para o início.`} A lei pede aviso por escrito com {DIAS_DE_AVISO} dias de antecedência (CLT, art. 135).</>}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <p className={`fe-soma${soma !== total ? " fe-soma--erro" : ""}`} role="status">
        Soma das partes: <strong>{soma}</strong> de <strong>{total}</strong> {plural(total, "dia", "dias")}{soma === total ? " ✓" : ""}
      </p>
      <div className="fe-form-campos">
        {partes.length < MAX_PARTES && (
          <Button type="button" size="sm" variant="secondary" leadingIcon={<Plus size={14} />} onClick={() => setPartes((a) => [...a, { inicio: "", dias: "" }])}>Adicionar parte</Button>
        )}
        {podeVender && (
          <label className="fe-abono">
            <input type="checkbox" checked={vendeAbono} onChange={(e) => {
              // Redistribui os dias, mas mantém as datas já digitadas.
              const novas = partesIniciais(saldo - (e.target.checked ? DIAS_ABONO : 0));
              setVendeAbono(e.target.checked);
              setPartes((atual) => novas.map((p, i) => ({ ...p, inicio: atual[i]?.inicio ?? "" })));
            }} />
            <span><strong>Vender {DIAS_ABONO} dias (abono)</strong><small>As partes somam {saldo - DIAS_ABONO} dias; os outros {DIAS_ABONO} são pagos em dinheiro.</small></span>
          </label>
        )}
        <TextField label="Observação (opcional)" value={observacao} maxLength={300} onChange={(e) => setObservacao(e.target.value)} hint="Evite dados de saúde ou motivos pessoais." />
      </div>
      {(tentou || partes.every((p) => p.inicio !== "")) && resultado.geral.map((m) => <Alert key={m} tone="warning" role={tentou ? "alert" : undefined}>{m}</Alert>)}
      {erro && <Alert tone="error" role="alert">{erro}</Alert>}
      <div className="fe-form-acoes">
        <Button type="submit" size="sm" aria-disabled={salvando}>{salvando ? "Salvando…" : `Programar em ${partes.length} partes`}</Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancelar}>Cancelar (Esc)</Button>
      </div>
    </form>
  );
}
