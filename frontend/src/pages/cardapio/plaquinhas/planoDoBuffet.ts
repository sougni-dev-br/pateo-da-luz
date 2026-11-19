// Planejamento do próximo buffet: quanto produzir de cada prato para N pessoas, a partir de quanto cada pessoa
// consumiu nos dias pesados (gramas por pessoa) mais uma folga de segurança.
import type { BuffetAnalysisItem } from "../../../api/client";

/** Mesmo mínimo do servidor: abaixo disso o consumo por pessoa do prato ainda não é um padrão. */
export const MIN_DIAS_PARA_PLANEJAR = 3;
export const FOLGA_PADRAO_PCT = 10;
export const MAX_FOLGA_PCT = 100;
export const MAX_PESSOAS = 5000;

export type LinhaDoPlano = {
  itemId: string;
  name: string;
  gPerPerson: number;
  kg: number;
  /** Quanto custa produzir essa quantidade (R$); nulo sem custo conhecido ou sem permissão. */
  cost: number | null;
  /** Sobra quase nula nos dias pesados: o consumo medido pode estar cortado porque o prato acabou. */
  canFallShort: boolean;
};

export type Plano = {
  rows: LinhaDoPlano[];
  totalKg: number;
  /** Soma só dos pratos com custo. */
  totalCost: number | null;
  withCost: number;
  /** Pratos sem histórico suficiente (ou sem pessoas no PDV): ficam de fora do plano. */
  left: Array<{ itemId: string; name: string }>;
};

const arredondar = (v: number, casas: number) => { const f = 10 ** casas; return Math.round(v * f) / f; };

/** "12,5" ou "12.5" → 12,5; vazio, negativo ou texto → null. */
export function lerNumero(texto: string): number | null {
  const limpo = texto.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(limpo)) return null;
  return Number(limpo);
}

export function planejarBuffet(itens: BuffetAnalysisItem[], pessoas: number, folgaPct: number): Plano {
  const fator = 1 + Math.max(0, folgaPct) / 100;
  const rows: LinhaDoPlano[] = [];
  const left: Plano["left"] = [];
  for (const i of itens) {
    if (i.daysForPerPerson < MIN_DIAS_PARA_PLANEJAR || i.gPerPerson === null || i.gPerPerson <= 0) { left.push({ itemId: i.itemId, name: i.name }); continue; }
    const kg = (i.gPerPerson * pessoas * fator) / 1000;
    rows.push({
      itemId: i.itemId, name: i.name, gPerPerson: i.gPerPerson, kg: arredondar(kg, 1),
      cost: i.costPerKg === null ? null : arredondar(kg * i.costPerKg, 2),
      canFallShort: i.signals.includes("PODE_FALTAR"),
    });
  }
  rows.sort((a, b) => b.kg - a.kg);
  const comCusto = rows.filter((r) => r.cost !== null);
  return {
    rows,
    totalKg: arredondar(rows.reduce((a, r) => a + r.kg, 0), 1),
    totalCost: comCusto.length ? arredondar(comCusto.reduce((a, r) => a + (r.cost ?? 0), 0), 2) : null,
    withCost: comCusto.length,
    left,
  };
}
