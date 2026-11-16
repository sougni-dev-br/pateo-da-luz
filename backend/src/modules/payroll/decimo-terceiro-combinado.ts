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
