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
