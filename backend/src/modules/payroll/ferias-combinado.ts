// Férias de quem tem salário combinado — regras puras (sem banco).
//
// Regra do Eli (18/11/2026): quem tem combinado recebe, por lei, a carteira + gorjeta; o que passa da
// carteira entra como "combinado" (a empresa não paga imposto sobre a diferença). Nas férias vale o mesmo
// sentido: remuneração = (combinado vigente + média da gorjeta integral dos últimos 12 meses) + 1/3, sem
// IR/INSS descontados do funcionário. O recibo da contabilidade só cobre a carteira (+ gorjeta declarada),
// então o título FERIAS recebe a diferença: ((combinado + média) × 4/3) − líquido do recibo.

const round2 = (v: number) => Math.round(v * 100) / 100;
const reais = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Mês comercial: a gorjeta e o salário sem registro já contam 30 dias (tip-rateio). Mesmo critério aqui. */
export const DIAS_BASE_MES = 30;
export const MESES_DA_MEDIA = 12;
export const ORIGEM_FERIAS_COMBINADO = "FERIAS_COMBINADO";
export const DESCRICAO_FERIAS_COMBINADO = "diferença do salário combinado e da gorjeta integral";

// ── Salário proporcional (B) ────────────────────────────────────────────────────────────
export type CombinadoProporcional = { valor: number; diasPagos: number; diasDeFerias: number; proporcional: boolean };

/** Combinado do mês descontados os dias de férias (diária = combinado ÷ 30, arredondada a centavos). */
export function combinadoProporcional(a: { combinado: number; diasDeFerias: number; diasNoMes: number }): CombinadoProporcional {
  const dias = Math.min(Math.max(0, Math.trunc(a.diasDeFerias)), a.diasNoMes);
  if (dias === 0) return { valor: round2(a.combinado), diasPagos: DIAS_BASE_MES, diasDeFerias: 0, proporcional: false };
  if (dias >= a.diasNoMes) return { valor: 0, diasPagos: 0, diasDeFerias: dias, proporcional: true };
  const diasPagos = Math.max(0, DIAS_BASE_MES - dias);
  return { valor: round2(round2(a.combinado / DIAS_BASE_MES) * diasPagos), diasPagos, diasDeFerias: dias, proporcional: true };
}

// ── Média da gorjeta (A) ────────────────────────────────────────────────────────────────
export type MesDaJanela = { ano: number; mes: number; chave: string };
export type OrigemDoMes = "APURACAO" | "INFORMADA" | "AUSENTE";
export type MesDaGorjeta = { chave: string; valor: number | null; origem: OrigemDoMes };
export type MediaDaGorjeta = { media: number; mesesContados: number; mesesAusentes: string[] };

export const chaveDoMes = (ano: number, mes: number) => `${ano}-${String(mes).padStart(2, "0")}`;

/** As 12 competências ANTERIORES ao mês do início do gozo (o mês do gozo ainda não fechou), da mais antiga à mais recente. */
export function janelaDeMeses(anoGozo: number, mesGozo: number, n: number = MESES_DA_MEDIA): MesDaJanela[] {
  const base = anoGozo * 12 + (mesGozo - 1);
  return Array.from({ length: n }, (_, i) => {
    const t = base - n + i;
    const ano = Math.floor(t / 12), mes = (t % 12) + 1;
    return { ano, mes, chave: chaveDoMes(ano, mes) };
  });
}

/** Média dos meses com valor (apurado ou informado). Mês sem nada não entra na conta: é listado para conferência. */
export function mediaDaGorjeta(meses: ReadonlyArray<MesDaGorjeta>): MediaDaGorjeta {
  const comValor = meses.filter((x) => x.valor != null);
  const soma = comValor.reduce((s, x) => s + (x.valor as number), 0);
  return {
    media: comValor.length === 0 ? 0 : round2(soma / comValor.length),
    mesesContados: comValor.length,
    mesesAusentes: meses.filter((x) => x.valor == null).map((x) => x.chave),
  };
}

// ── Complemento (A) ─────────────────────────────────────────────────────────────────────
export type ComplementoDeFerias = { remuneracao: number; complemento: number; negativo: boolean };

/**
 * remuneração = (combinado + média da gorjeta) × 4/3, proporcional aos dias de gozo do recibo (30 dias = valor cheio;
 * férias fracionadas pagam só os dias do recibo); complemento = remuneração − líquido do recibo (nunca negativo).
 */
export function complementoDeFerias(a: { combinado: number; mediaGorjeta: number; liquidoRecibo: number; dias?: number }): ComplementoDeFerias {
  const dias = a.dias != null && a.dias > 0 && a.dias < DIAS_BASE_MES ? a.dias : DIAS_BASE_MES;
  const remuneracao = round2((((a.combinado + a.mediaGorjeta) * 4) / 3) * (dias / DIAS_BASE_MES));
  const bruto = round2(remuneracao - a.liquidoRecibo);
  return { remuneracao, complemento: Math.max(0, bruto), negativo: bruto < 0 };
}

// ── Detalhes gravados no título (molde do 13º com combinado) ────────────────────────────
export type DetalhesFeriasCombinado = {
  liquidoExtrato: number; complemento: number; complementoDescricao: string; composicao: string; origemValor: typeof ORIGEM_FERIAS_COMBINADO;
  feriasCombinado: {
    combinado: number; mediaGorjeta: number; mesesContados: number; mesesAusentes: string[]; remuneracao: number;
    formula: string; meses: ReadonlyArray<MesDaGorjeta>;
  };
};

const CHAVES_DO_FERIAS_COMBINADO = ["liquidoExtrato", "complemento", "complementoDescricao", "composicao", "origemValor", "feriasCombinado"];

export function valorFeriasComCombinado(a: {
  liquidoRecibo: number; calc: ComplementoDeFerias; combinado: number; media: MediaDaGorjeta; meses: ReadonlyArray<MesDaGorjeta>; dias?: number;
}): { valor: number; detalhes: DetalhesFeriasCombinado } {
  const liquido = round2(a.liquidoRecibo), extra = round2(a.calc.complemento), valor = round2(liquido + extra);
  const formula = `(combinado ${reais(a.combinado)} + média da gorjeta integral ${reais(a.media.media)} em ${a.media.mesesContados} mês(es)) × 4/3${a.dias != null && a.dias < DIAS_BASE_MES ? ` × ${a.dias}/30 dias de gozo` : ""} = ${reais(a.calc.remuneracao)}; `
    + `menos o líquido do recibo ${reais(liquido)} = ${reais(extra)}`;
  return {
    valor,
    detalhes: {
      liquidoExtrato: liquido, complemento: extra, complementoDescricao: DESCRICAO_FERIAS_COMBINADO, origemValor: ORIGEM_FERIAS_COMBINADO,
      composicao: `${reais(valor)} = líquido do recibo ${reais(liquido)} + ${DESCRICAO_FERIAS_COMBINADO} ${reais(extra)} — ${formula}`,
      feriasCombinado: {
        combinado: round2(a.combinado), mediaGorjeta: a.media.media, mesesContados: a.media.mesesContados, mesesAusentes: a.media.mesesAusentes,
        remuneracao: a.calc.remuneracao, formula, meses: a.meses,
      },
    },
  };
}

const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const numero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const foiSomadoAFerias = (details: unknown): boolean => objeto(details).origemValor === ORIGEM_FERIAS_COMBINADO;
export const complementoSomadoAFerias = (details: unknown): number | null => (foiSomadoAFerias(details) ? numero(objeto(details).complemento) : null);

export function semMarcasDoFeriasCombinado(details: unknown): Record<string, unknown> {
  return Object.fromEntries(Object.entries(objeto(details)).filter(([k]) => !CHAVES_DO_FERIAS_COMBINADO.includes(k)));
}

/** Dias de gozo que o recibo cobre (30 quando não constar). */
export function diasDoRecibo(details: unknown): number {
  const d = numero(objeto(objeto(details).recibo).dias);
  return d != null && d > 0 ? d : DIAS_BASE_MES;
}

/** Líquido do recibo da contabilidade (o título nasce com esse valor; a soma não o apaga dos detalhes). */
export function liquidoDoRecibo(details: unknown): number | null {
  return numero(objeto(objeto(details).recibo).liquido);
}

/** Meses informados à mão guardados antes (para recalcular sem pedir tudo de novo). */
export function informadasGuardadas(details: unknown): Record<string, number> {
  const meses = objeto(objeto(details).feriasCombinado).meses;
  if (!Array.isArray(meses)) return {};
  const out: Record<string, number> = {};
  for (const x of meses as Array<Partial<MesDaGorjeta>>) {
    if (x?.origem === "INFORMADA" && typeof x.chave === "string" && numero(x.valor) != null) out[x.chave] = x.valor as number;
  }
  return out;
}
