import type { DRECategory } from "../api/client";

export const DRE_GROUPS = [
  { value: "CMV_COMPRAS",           label: "CMV / Compras sem NF" },
  { value: "PESSOAL",               label: "Pessoal" },
  { value: "VALE_TRANSPORTE",       label: "Vale-Transporte" },
  { value: "LOCACAO",               label: "Ocupação e Locação" },
  { value: "TARIFAS_BANCARIAS",     label: "Tarifas Bancárias" },
  { value: "TARIFAS_PUBLICAS",      label: "Tarifas Públicas" },
  { value: "IMPOSTOS",              label: "Impostos" },
  { value: "DESPESAS_GERAIS",       label: "Despesas Gerais" },
  { value: "PLANEJAMENTO",          label: "Planejamento" },
  { value: "DESPESAS_OPERACIONAIS", label: "Despesas Diversas" },
  { value: "DEDUCOES",              label: "Deduções de Receita" },
];

export function dreGroupLabel(groupKey: string): string {
  return DRE_GROUPS.find((g) => g.value === groupKey)?.label ?? groupKey;
}

/**
 * <optgroup> por grupo DRE (na ordem gerencial), categorias em ordem
 * alfabética dentro de cada grupo. Usar dentro de um <select>.
 */
export function DRECategoryOptions({ categories }: { categories: DRECategory[] }) {
  const groupOrder = new Map(DRE_GROUPS.map((g, i) => [g.value, i]));
  const grouped = new Map<string, DRECategory[]>();

  for (const cat of categories) {
    if (!grouped.has(cat.dreGroup)) grouped.set(cat.dreGroup, []);
    grouped.get(cat.dreGroup)!.push(cat);
  }

  const sortedGroups = [...grouped.entries()].sort(
    ([a], [b]) => (groupOrder.get(a) ?? 99) - (groupOrder.get(b) ?? 99)
  );

  return (
    <>
      {sortedGroups.map(([groupKey, cats]) => (
        <optgroup key={groupKey} label={dreGroupLabel(groupKey)}>
          {[...cats]
            .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
            .map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
        </optgroup>
      ))}
    </>
  );
}
