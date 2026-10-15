// Programação de férias: períodos aquisitivos, prazo para gozar e alertas.
//
// Regra (CLT, a mesma do relatório "Programação de Férias" da contabilidade):
//   - o direito nasce a cada 12 meses de casa (período aquisitivo) e vale 30 dias;
//   - a empresa tem os 12 meses seguintes (concessivo) para conceder; o "limite para gozo"
//     é o último dia em que as férias de 30 dias ainda podem COMEÇAR sem passar do concessivo;
//   - passou do limite sem gozar: férias vencidas (pagas em dobro).
// Tudo em datas "AAAA-MM-DD" (UTC), sem hora — o fuso não pode mudar o dia.

export const DIAS_DIREITO = 30;
export const DIAS_ABONO = 10;
// Só entram os períodos que terminaram há no máximo este tempo: o que é mais antigo já foi
// resolvido pela contabilidade (o relatório dela lista só o que está em aberto) e a tela não
// tem como saber, então não pode acusar "vencida" por um período antigo que foi gozado.
// Quem tem um período recente já gozado marca "Já gozou" na tela.
export const MESES_DE_HISTORICO = 12;
export const DIAS_URGENTE = 30;
export const DIAS_ATENCAO = 90;
const TOLERANCIA_HISTORICO_DIAS = 31;

export type SituacaoPeriodo = "EM_AQUISICAO" | "DISPONIVEL" | "A_VENCER" | "VENCIDA" | "PROGRAMADA" | "GOZADA";
export type NivelAlerta = "ok" | "atencao" | "perigo";

export type Programacao = {
  id: string;
  aquisitivoInicio: string;
  gozoInicio: string | null;
  dias: number;
  diasAbono: number;
  status: "PROGRAMADA" | "GOZADA";
  observacao: string | null;
};
export type HistoricoFerias = {
  aquisitivoInicio: string;
  gozoInicio: string | null;
  gozoFim: string | null;
  abonoInicio?: string | null;
  abonoFim?: string | null;
};

export type ProgramacaoNoPeriodo = Programacao & { gozoFim: string | null; passouDaData: boolean };

export type PeriodoFerias = {
  aquisitivoInicio: string;
  aquisitivoFim: string;
  /** Último dia para o que falta tirar (30 dias, ou o saldo) começar sem estourar o concessivo. */
  limiteInicioGozo: string;
  /** Último dia do concessivo: as férias (inteiras) têm de terminar até aqui. */
  fimConcessivo: string;
  diasDireito: number;
  diasGozados: number;
  diasProgramados: number;
  diasAbono: number;
  diasPendentes: number;
  situacao: SituacaoPeriodo;
  nivel: NivelAlerta;
  /** Dias até o limite (negativo = já passou). Só existe com dias pendentes. */
  diasParaLimite: number | null;
  /** Dias até o direito nascer (só para EM_AQUISICAO). */
  diasParaCompletar: number | null;
  foraDoPrazo: boolean;
  doHistorico: boolean;
  programacoes: ProgramacaoNoPeriodo[];
};

const DIA_MS = 86_400_000;
/** Dias de um intervalo fechado [inicio, fim]; 0 quando falta uma das pontas. */
const diasDoIntervalo = (inicio: string | null, fim: string | null) =>
  (inicio && fim && fim >= inicio ? Math.round((Date.parse(`${fim}T00:00:00.000Z`) - Date.parse(`${inicio}T00:00:00.000Z`)) / 86_400_000) + 1 : 0);
const paraMs = (iso: string) => Date.parse(`${iso}T00:00:00.000Z`);
const paraIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const somarDias = (iso: string, dias: number) => paraIso(paraMs(iso) + dias * DIA_MS);
export const diasEntre = (de: string, ate: string) => Math.round((paraMs(ate) - paraMs(de)) / DIA_MS);

/** Soma meses sem atravessar o fim do mês (29/02 + 12 meses = 28/02). */
export function somarMeses(iso: string, meses: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return paraIso(alvo.getTime());
}

/** "AAAA-MM-DD" de verdade (31/02 não vale). */
export const diaValido = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && paraIso(paraMs(v)) === v;

function situacaoDoPendente(diasParaLimite: number): { situacao: SituacaoPeriodo; nivel: NivelAlerta } {
  if (diasParaLimite < 0) return { situacao: "VENCIDA", nivel: "perigo" };
  if (diasParaLimite <= DIAS_URGENTE) return { situacao: "A_VENCER", nivel: "perigo" };
  if (diasParaLimite <= DIAS_ATENCAO) return { situacao: "A_VENCER", nivel: "atencao" };
  return { situacao: "DISPONIVEL", nivel: "ok" };
}

export type EntradaPeriodos = {
  admissao: string;
  hoje: string;
  programacoes: Programacao[];
  historico: HistoricoFerias[];
};

export function periodosDeFerias({ admissao, hoje, programacoes, historico }: EntradaPeriodos): PeriodoFerias[] {
  const periodos: PeriodoFerias[] = [];
  const corte = somarMeses(hoje, -MESES_DE_HISTORICO);
  for (let n = 0; ; n++) {
    const inicio = somarMeses(admissao, 12 * n);
    if (inicio > hoje) break;
    const fim = somarDias(somarMeses(admissao, 12 * (n + 1)), -1);
    if (fim < corte) continue;
    const fimConcessivo = somarDias(somarMeses(inicio, 24), -1);
    const emAquisicao = fim >= hoje;

    const doPeriodo = programacoes.filter((p) => p.aquisitivoInicio === inicio);
    // A ficha da contabilidade só quita o que ela registra: linha sem datas de gozo não conta,
    // e gozo parcial (férias fracionadas) abate só os dias que ela traz.
    const daFicha = historico.filter((h) => Math.abs(diasEntre(h.aquisitivoInicio, inicio)) <= TOLERANCIA_HISTORICO_DIAS);
    const diasFicha = daFicha.reduce((s, h) => s + diasDoIntervalo(h.gozoInicio, h.gozoFim), 0);
    const abonoFicha = daFicha.reduce((s, h) => s + diasDoIntervalo(h.abonoInicio ?? null, h.abonoFim ?? null), 0);
    const gozados = doPeriodo.filter((p) => p.status === "GOZADA").reduce((s, p) => s + p.dias, 0) + diasFicha;
    const programados = doPeriodo.filter((p) => p.status === "PROGRAMADA").reduce((s, p) => s + p.dias, 0);
    const abono = doPeriodo.reduce((s, p) => s + p.diasAbono, 0) + abonoFicha;
    const pendentes = Math.max(0, DIAS_DIREITO - gozados - programados - abono);
    const doHistorico = diasFicha + abonoFicha >= DIAS_DIREITO;
    // Quem ainda tem menos de 30 dias a tirar pode começar mais tarde e ainda terminar no concessivo.
    const limite = somarDias(fimConcessivo, -(Math.min(pendentes > 0 && !emAquisicao ? pendentes : DIAS_DIREITO, DIAS_DIREITO) - 1));
    // Uma parte menor pode começar depois do "limite" e ainda terminar no concessivo.
    const foraDoPrazo = doPeriodo.some((p) => p.status === "PROGRAMADA" && p.gozoInicio !== null && somarDias(p.gozoInicio, p.dias - 1) > fimConcessivo);

    const diasParaLimite = !emAquisicao && pendentes > 0 ? diasEntre(hoje, limite) : null;
    let situacao: SituacaoPeriodo;
    let nivel: NivelAlerta = "ok";
    if (emAquisicao) situacao = "EM_AQUISICAO";
    else if (pendentes > 0) ({ situacao, nivel } = situacaoDoPendente(diasParaLimite as number));
    else situacao = programados > 0 ? "PROGRAMADA" : "GOZADA";
    if (!emAquisicao && foraDoPrazo) nivel = "perigo";

    periodos.push({
      aquisitivoInicio: inicio,
      aquisitivoFim: fim,
      limiteInicioGozo: limite,
      fimConcessivo,
      diasDireito: DIAS_DIREITO,
      diasGozados: gozados,
      diasProgramados: programados,
      diasAbono: abono,
      diasPendentes: emAquisicao ? DIAS_DIREITO : pendentes,
      situacao,
      nivel,
      diasParaLimite,
      diasParaCompletar: emAquisicao ? diasEntre(hoje, somarDias(fim, 1)) : null,
      foraDoPrazo,
      doHistorico,
      programacoes: doPeriodo.map((p) => ({
        ...p,
        gozoFim: p.gozoInicio ? somarDias(p.gozoInicio, p.dias - 1) : null,
        passouDaData: p.status === "PROGRAMADA" && p.gozoInicio !== null && p.gozoInicio <= hoje,
      })),
    });
  }
  return periodos;
}

const PESO: Record<NivelAlerta, number> = { perigo: 2, atencao: 1, ok: 0 };
/** O pior alerta entre os períodos da pessoa (para ordenar a lista). */
export const piorNivel = (periodos: PeriodoFerias[]): NivelAlerta =>
  periodos.reduce<NivelAlerta>((pior, p) => (PESO[p.nivel] > PESO[pior] ? p.nivel : pior), "ok");
