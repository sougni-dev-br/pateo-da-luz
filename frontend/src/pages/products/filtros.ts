import type { ProductFacets } from "../../api/client";

export const NATUREZA_CURTA: Record<string, string> = {
  INSUMO: "Insumo",
  EMBALAGEM: "Embalagem",
  CONSUMO: "Consumo",
  DURAVEL: "Durável",
  SERVICO: "Serviço"
};

export const PENDENCIAS = [
  { chave: "sem-subcategoria", rotulo: "Sem subcategoria" },
  { chave: "sem-setor", rotulo: "Sem setor" },
  { chave: "sem-categoria", rotulo: "Sem categoria" },
  { chave: "sem-natureza", rotulo: "Sem natureza" },
  { chave: "sem-dre", rotulo: "Sem categoria DRE" }
] as const;

/** "ESTOQUE (226)": o número que a opção teria com os outros filtros; sem número ainda, só o nome. */
export function comContagem(nome: string, contagens: Map<string, number> | undefined): string {
  if (!contagens) return nome;
  return `${nome} (${contagens.get(nome) ?? 0})`;
}

export function contagemPorNome(itens: Array<{ nome: string; count: number }> | undefined): Map<string, number> | undefined {
  return itens ? new Map(itens.map((item) => [item.nome, item.count])) : undefined;
}

export function contagemPorNatureza(itens: ProductFacets["naturezas"] | undefined): Map<string, number> | undefined {
  return itens ? new Map(itens.map((item) => [item.valor, item.count])) : undefined;
}

export function pendenciasMarcadas(csv: string): Set<string> {
  return new Set(csv.split(",").map((p) => p.trim()).filter(Boolean));
}

/** Liga ou desliga uma pendência; várias valem juntas. */
export function alternarPendencia(csv: string, chave: string): string {
  const marcadas = pendenciasMarcadas(csv);
  if (marcadas.has(chave)) marcadas.delete(chave);
  else marcadas.add(chave);
  return PENDENCIAS.map((p) => p.chave).filter((c) => marcadas.has(c)).join(",");
}

export type OrdemDaLista = { campo: string | null; dir: "asc" | "desc" };

/** Clicar no título: crescente, depois decrescente, depois volta ao padrão (nome). */
export function proximaOrdem(atual: OrdemDaLista, campo: string): OrdemDaLista {
  if (atual.campo !== campo) return { campo, dir: "asc" };
  if (atual.dir === "asc") return { campo, dir: "desc" };
  return { campo: null, dir: "asc" };
}

export function ariaSort(atual: OrdemDaLista, campo: string): "ascending" | "descending" | "none" {
  if (atual.campo !== campo) return "none";
  return atual.dir === "asc" ? "ascending" : "descending";
}
