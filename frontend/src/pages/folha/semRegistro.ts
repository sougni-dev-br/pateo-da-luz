// Contagens dos botões da Folha para quem não tem registro. O adiantamento do dia 20 e a 1ª
// quinzena do dia 15 são os dois ADIANTAMENTO; a marca details.primeiraQuinzena separa um do outro.
import type { PayrollComputedItem } from "../../api/client";

const marca = (i: PayrollComputedItem, chave: string) => (i.details as Record<string, unknown> | null)?.[chave] === true;
const ehQuinzena = (i: PayrollComputedItem) => i.type === "ADIANTAMENTO" && marca(i, "primeiraQuinzena");

/** Adiantamento do dia 20 dos sem registro ainda não lançado. */
export function adiantamentosSrAGerar(itens: PayrollComputedItem[]): number {
  return itens.filter((i) => !i.exists && i.type === "ADIANTAMENTO" && marca(i, "semRegistro") && !ehQuinzena(i)).length;
}

/** 1ª quinzena: as que faltam lançar e as lançadas sem baixa com valor desatualizado (gerar atualiza). */
export function quinzenasSrAGerar(itens: PayrollComputedItem[]): { novas: number; desatualizadas: number } {
  const quinzenas = itens.filter(ehQuinzena);
  return { novas: quinzenas.filter((i) => !i.exists).length, desatualizadas: quinzenas.filter((i) => i.exists && i.desatualizado).length };
}

/** Título da Folha que tem recibo de pagamento: 1ª quinzena ou adiantamento de quem não tem registro (CLT: holerite da contabilidade). */
export function reciboDoLancamento(i: { type: string; details?: unknown }): "QUINZENA" | "ADIANTAMENTO" | null {
  const d = i.details as Record<string, unknown> | null | undefined;
  if (i.type !== "ADIANTAMENTO" || d?.semRegistro !== true) return null;
  return d.primeiraQuinzena === true ? "QUINZENA" : "ADIANTAMENTO";
}

/** Título de quem não tem registro (marca `details.semRegistro`). */
export const ehDeSemRegistro = (i: { details?: Record<string, unknown> | null }) => i.details?.semRegistro === true;

/**
 * Itens da prévia da folha (adiantamento + salário). O "Gerar folha" nunca cria o de quem é sem registro
 * (o adiantamento dele e a 1ª quinzena têm tela própria), então a prévia também não o mostra nem soma:
 * o botão promete exatamente o que o servidor vai criar.
 */
export function itensDaPreviaDaFolha<T extends { type: string; exists: boolean; details?: Record<string, unknown> | null }>(
  itens: T[],
): { daFolha: T[]; semRegistroFora: number } {
  const folha = itens.filter((i) => i.type === "ADIANTAMENTO" || i.type === "SALARIO");
  return {
    daFolha: folha.filter((i) => !ehDeSemRegistro(i)),
    semRegistroFora: folha.filter((i) => ehDeSemRegistro(i) && !i.exists).length,
  };
}
