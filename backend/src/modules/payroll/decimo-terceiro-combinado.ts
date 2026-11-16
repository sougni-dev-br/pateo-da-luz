// 13º da diferença do salário combinado — regras puras (sem banco).
//
// Quem é CLT e ganha um salário combinado acima do registrado recebe o 13º do registrado pelo
// extrato da contabilidade. A DIFERENÇA (combinado − base) é calculada aqui, com a mesma regra
// dos sem registro (avos, 1ª parcela e acerto), mas sem média de variáveis: a gorjeta e a hora
// extra já entram na média do extrato (decisão do Eli, 16/11/2026).
import type { LinhaHistorico } from "./cadastro-historico.js";

// Diferença vigente em 20/12 (a mesma data de referência do salário no 13º). null = sem diferença a pagar.
export function diferencaDoCombinado(baseSalary: unknown, salarioCombinado: unknown): number | null {
  if (baseSalary == null || salarioCombinado == null) return null;
  const base = Number(baseSalary), combinado = Number(salarioCombinado);
  if (!Number.isFinite(base) || !Number.isFinite(combinado)) return null;
  const diferenca = Math.round((combinado - base) * 100) / 100;
  return diferenca > 0 ? diferenca : null;
}

// Desde quando o combinado vale, sem interrupção: a vigência da última vez em que ele nasceu do
// zero (de vazio para um valor). Sem essa linha no histórico, o combinado vale desde sempre e o
// chamador usa a admissão. Reajustes (valor → outro valor) não mudam o início.
export function inicioDoCombinado(linhas: ReadonlyArray<LinhaHistorico>): Date | null {
  const nasceu = linhas
    .filter((l) => l.campo === "salarioCombinado" && l.valorAnterior == null && l.valorNovo != null)
    .sort((a, b) => a.vigenteDesde.getTime() - b.vigenteDesde.getTime() || a.createdAt.getTime() - b.createdAt.getTime());
  return nasceu.length > 0 ? nasceu[nasceu.length - 1].vigenteDesde : null;
}

// ── Soma ao título do extrato (1ª parcela) ──────────────────────────────────────────────
// Como no salário combinado: o Contas a Pagar tem UM título da pessoa, com o valor integral
// (líquido do extrato + diferença do combinado). O líquido do extrato fica nos detalhes.
const round2 = (v: number) => Math.round(v * 100) / 100;
const reais = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const ORIGEM_DECIMO_COMBINADO = "DECIMO_COMBINADO";
const CHAVES_DO_DECIMO_COMBINADO = ["liquidoExtrato", "complemento", "composicao", "origemValor"];

export type DetalhesDecimoCombinado = { liquidoExtrato: number; complemento: number; composicao: string; origemValor: typeof ORIGEM_DECIMO_COMBINADO };

const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const numero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// O líquido que o extrato trouxe, mesmo depois de a soma ter mudado o valor do título.
export function liquidoDoExtrato(details: unknown): number | null {
  const d = objeto(details);
  return numero(d.liquidoExtrato) ?? numero(d.liquido);
}

export function foiSomado(details: unknown): boolean {
  return objeto(details).origemValor === ORIGEM_DECIMO_COMBINADO;
}

export function complementoSomado(details: unknown): number | null {
  return foiSomado(details) ? numero(objeto(details).complemento) : null;
}

export function valorComCombinado(liquidoExtrato: number, complemento: number): { valor: number; detalhes: DetalhesDecimoCombinado } {
  const liquido = round2(liquidoExtrato), extra = round2(complemento), valor = round2(liquido + extra);
  return {
    valor,
    detalhes: {
      liquidoExtrato: liquido, complemento: extra, origemValor: ORIGEM_DECIMO_COMBINADO,
      composicao: `${reais(valor)} = líquido do extrato ${reais(liquido)} + diferença do salário combinado ${reais(extra)}`,
    },
  };
}

// Detalhes do título sem as marcas da soma (o combinado pode ter sido tirado ou o valor mudado).
export function semMarcasDoCombinado(details: unknown): Record<string, unknown> {
  return Object.fromEntries(Object.entries(objeto(details)).filter(([k]) => !CHAVES_DO_DECIMO_COMBINADO.includes(k)));
}
