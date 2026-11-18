// Resumo do dia de pesagem do buffet: por prato, quanto foi para o buffet (produção + reposições), quanto voltou
// (sobra) e quanto foi consumido. Função pura, sem banco.

export type WeighingRow = { itemId: string; phase: "PRODUCAO" | "SOBRA"; netG: number };

export type ItemSummary = {
  itemId: string;
  producedG: number;
  leftoverG: number;
  /** Produzido − sobra. Nulo quando não há produção pesada (só sobra): não dá para saber o consumo. */
  consumedG: number | null;
  /** Sobra maior que a produção: pesagem errada ou reposição não anotada. */
  inconsistent: boolean;
};

export type DaySummary = { items: ItemSummary[]; producedG: number; leftoverG: number; consumedG: number };

export function summarizeDay(rows: WeighingRow[]): DaySummary {
  const byItem = new Map<string, { producedG: number; leftoverG: number }>();
  for (const r of rows) {
    const acc = byItem.get(r.itemId) ?? { producedG: 0, leftoverG: 0 };
    if (r.phase === "PRODUCAO") acc.producedG += r.netG;
    else acc.leftoverG += r.netG;
    byItem.set(r.itemId, acc);
  }
  const items: ItemSummary[] = [...byItem].map(([itemId, a]) => ({
    itemId, producedG: a.producedG, leftoverG: a.leftoverG,
    consumedG: a.producedG > 0 ? Math.max(0, a.producedG - a.leftoverG) : null,
    inconsistent: a.leftoverG > a.producedG,
  }));
  // O total do dia só soma pratos com produção pesada: sobra sem produção não tem como virar consumo.
  const comProducao = items.filter((i) => i.consumedG !== null);
  return {
    items,
    producedG: items.reduce((a, i) => a + i.producedG, 0),
    leftoverG: items.reduce((a, i) => a + i.leftoverG, 0),
    consumedG: comProducao.reduce((a, i) => a + (i.consumedG ?? 0), 0),
  };
}
