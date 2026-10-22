// Cobertura do faturamento por canal: o que já entrou, até que dia e de onde veio.
//
// Existe porque os quatro canais (Salão, 99Food, iFood, Keeta) caem na mesma tabela
// (RevenueEntry) por caminhos diferentes — integração, importação do portal, lançamento
// manual — e nada dizia se um deles tinha parado. Conta pura, sem banco, para poder ser testada.

import { PLATAFORMA_SEM_ORIGEM, REVENUE_CHANNEL_SALON, normalizePlatform } from "./revenue-channels.js";

export const CANAIS_DE_COBERTURA = [REVENUE_CHANNEL_SALON, "99Food", "iFood", "Keeta"] as const;
export type CanalDeCobertura = (typeof CANAIS_DE_COBERTURA)[number];

export type LinhaDeReceita = {
  /** Dia de calendário, YYYY-MM-DD. */
  date: string;
  channel: string;
  sourcePlatform: string | null;
};

export type OrigemDoDado = { origem: string; dias: number; ultimoDia: string };

export type SituacaoDoCanal = "EM_DIA" | "ATRASADO" | "SEM_DADOS";

export type CoberturaDoCanal = {
  canal: CanalDeCobertura;
  situacao: SituacaoDoCanal;
  ultimoDia: string | null;
  diasDesdeUltimo: number | null;
  diasNoPeriodo: number;
  diasComDado: number;
  diasSemLancamento: string[];
  /** Lançamentos com data depois de hoje (ex.: importação mensal gravada no último dia do mês). Não contam como cobertura. */
  lancamentosFuturos: string[];
  origens: OrigemDoDado[];
};

export type EntradaDaCobertura = {
  from: string;
  to: string;
  /** Hoje, YYYY-MM-DD. Dia de hoje ainda não é cobrado: o dia só fecha à noite. */
  today: string;
  rows: LinhaDeReceita[];
  /** Último dia com dado em todo o histórico, por canal (a janela pode não alcançá-lo). */
  ultimoDiaGeral: Partial<Record<CanalDeCobertura, string | null>>;
};

/** Atraso máximo, em dias, para o canal ainda contar como em dia (ontem). */
const MAX_DIAS_EM_DIA = 1;
const DIA_EM_MS = 86_400_000;

const toMs = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function diasEntre(inicio: string, fim: string): number {
  return Math.round((toMs(fim) - toMs(inicio)) / DIA_EM_MS);
}

function listarDias(inicio: string, fim: string): string[] {
  const dias: string[] = [];
  for (let ms = toMs(inicio); ms <= toMs(fim); ms += DIA_EM_MS) dias.push(fromMs(ms));
  return dias;
}

/** Rótulos EXATOS gravados pelas integrações. A planilha grava "iFood"/"99Food": comparar sem diferenciar maiúsculas confundiria as duas origens. Manual não grava nada. */
const INTEGRACOES: Record<string, string> = {
  AGILE_PDV: "Integração (Agile PDV)",
  IFOOD: "Integração (iFood)",
  NOVENTA_NOVE: "Integração (99Food)"
};

function rotuloDeOrigem(sourcePlatform: string | null): string {
  const bruto = (sourcePlatform ?? "").trim();
  if (!bruto) return "Lançamento manual";
  return INTEGRACOES[bruto] ?? "Importação (planilha/portal)";
}

export function canalDaLinha(linha: LinhaDeReceita): CanalDeCobertura | null {
  if (linha.channel === REVENUE_CHANNEL_SALON) return REVENUE_CHANNEL_SALON;
  const plataforma = normalizePlatform(linha.sourcePlatform);
  if (plataforma === PLATAFORMA_SEM_ORIGEM) return null;
  return (CANAIS_DE_COBERTURA as readonly string[]).includes(plataforma) ? (plataforma as CanalDeCobertura) : null;
}

function situacaoDe(diasDesdeUltimo: number | null): SituacaoDoCanal {
  if (diasDesdeUltimo === null) return "SEM_DADOS";
  return diasDesdeUltimo <= MAX_DIAS_EM_DIA ? "EM_DIA" : "ATRASADO";
}

export function calcularCobertura(entrada: EntradaDaCobertura): CoberturaDoCanal[] {
  const ontem = fromMs(toMs(entrada.today) - DIA_EM_MS);
  const fimEfetivo = entrada.to < ontem ? entrada.to : ontem;
  const diasDaJanela = entrada.from <= fimEfetivo ? listarDias(entrada.from, fimEfetivo) : [];
  const naJanela = new Set(diasDaJanela);

  const diasPorCanal = new Map<CanalDeCobertura, Set<string>>();
  const futurosPorCanal = new Map<CanalDeCobertura, Set<string>>();
  const origensPorCanal = new Map<CanalDeCobertura, Map<string, { dias: Set<string>; ultimoDia: string }>>();

  for (const linha of entrada.rows) {
    const canal = canalDaLinha(linha);
    if (!canal) continue;
    // Data depois de hoje não prova que o canal está em dia: com ela, "último dia" ficava no
    // futuro, o atraso dava negativo e o canal aparecia "Em dia" sem ter lançado nada no mês.
    if (linha.date > entrada.today) {
      futurosPorCanal.set(canal, (futurosPorCanal.get(canal) ?? new Set<string>()).add(linha.date));
      continue;
    }
    if (!diasPorCanal.has(canal)) diasPorCanal.set(canal, new Set());
    if (naJanela.has(linha.date)) diasPorCanal.get(canal)!.add(linha.date);

    const origem = rotuloDeOrigem(linha.sourcePlatform);
    const origens = origensPorCanal.get(canal) ?? new Map();
    const atual = origens.get(origem) ?? { dias: new Set<string>(), ultimoDia: linha.date };
    atual.dias.add(linha.date);
    if (linha.date > atual.ultimoDia) atual.ultimoDia = linha.date;
    origens.set(origem, atual);
    origensPorCanal.set(canal, origens);
  }

  return CANAIS_DE_COBERTURA.map((canal) => {
    const comDado = diasPorCanal.get(canal) ?? new Set<string>();
    const historico = entrada.ultimoDiaGeral[canal] ?? null;
    const ultimoDoHistorico = historico !== null && historico <= entrada.today ? historico : null;
    const ultimoDaJanela = [...comDado].sort().at(-1) ?? null;
    const ultimoDia = [ultimoDoHistorico, ultimoDaJanela].filter((d): d is string => Boolean(d)).sort().at(-1) ?? null;
    const diasDesdeUltimo = ultimoDia ? diasEntre(ultimoDia, entrada.today) : null;
    const origens = [...(origensPorCanal.get(canal)?.entries() ?? [])]
      .map(([origem, v]) => ({ origem, dias: v.dias.size, ultimoDia: v.ultimoDia }))
      .sort((a, b) => b.dias - a.dias || a.origem.localeCompare(b.origem));
    return {
      canal,
      situacao: situacaoDe(diasDesdeUltimo),
      ultimoDia,
      diasDesdeUltimo,
      diasNoPeriodo: diasDaJanela.length,
      diasComDado: comDado.size,
      diasSemLancamento: diasDaJanela.filter((d) => !comDado.has(d)),
      lancamentosFuturos: [...(futurosPorCanal.get(canal) ?? [])].sort(),
      origens
    };
  });
}

export type ResumoDeAtrasos = { count: number; description: string };

/** Canais que pararam de lançar, em texto para o dashboard; null quando todos estão em dia. */
export function resumoDeAtrasos(canais: CoberturaDoCanal[]): ResumoDeAtrasos | null {
  const atrasados = canais.filter((c) => c.situacao !== "EM_DIA");
  if (atrasados.length === 0) return null;
  const rotulo = (c: CoberturaDoCanal): string => {
    if (c.situacao === "SEM_DADOS") return `${c.canal} (sem dados)`;
    if (c.diasComDado === 0) return `${c.canal} (sem lançamento no mês)`;
    return `${c.canal} (há ${c.diasDesdeUltimo} dias)`;
  };
  return {
    count: atrasados.length,
    description: `Faturamento atrasado em ${atrasados.map(rotulo).join(", ")}. O líquido do mês pode estar incompleto.`
  };
}
