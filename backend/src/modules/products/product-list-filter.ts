import { Prisma } from "@prisma/client";
import { normalizeText } from "../../shared/utils/normalize-text.js";
import { PRODUCT_NATURES } from "./product-nature.js";

/** Pendências de cadastro que a lista sabe filtrar (e contar). Podem ser combinadas. */
export const PENDENCIAS_DA_LISTA: Array<{ chave: string; where: Prisma.ProductWhereInput }> = [
  { chave: "sem-setor", where: { inventorySectorId: null } },
  { chave: "sem-categoria", where: { categoryId: null } },
  { chave: "sem-subcategoria", where: { subcategoryId: null } },
  { chave: "sem-dre", where: { dreCategoryId: null } },
  { chave: "sem-natureza", where: { nature: null } }
];

export type CriterioDoFiltro = "category" | "subcategory" | "nature" | "sector" | "pendencia";

/**
 * Filtro da listagem, compartilhado entre a lista, o resumo e as contagens das opções.
 *
 * `omitir` tira um critério do filtro: para contar quantos produtos cada categoria teria, a conta ignora o
 * filtro de categoria, senão só a categoria já escolhida apareceria com número.
 */
export function productListWhere(query: Record<string, unknown>, opcoes: { omitir?: CriterioDoFiltro[] } = {}): Prisma.ProductWhereInput {
  const omitir = new Set(opcoes.omitir ?? []);
  const rawSearch = query.search ? String(query.search) : undefined;
  const search = rawSearch ? normalizeText(rawSearch) : undefined;
  const category = query.category && !omitir.has("category") ? String(query.category) : undefined;
  const sector = query.sector && !omitir.has("sector") ? String(query.sector) : undefined;
  const controlsStock = query.controlsStock ? String(query.controlsStock) === "true" : undefined;
  const isActive = query.isActive == null ? undefined : String(query.isActive) === "true";
  const semDreCategoria = query.semDreCategoria === "true";

  // A subcategoria só existe dentro de uma categoria: sem o filtro de categoria, ela também sai.
  const subcategory = query.subcategory && !omitir.has("subcategory") && !omitir.has("category") ? String(query.subcategory) : undefined;
  const nature = omitir.has("nature") ? undefined : PRODUCT_NATURES.find((valor) => valor === query.nature);
  // Lista de trabalho: mostra o que falta preencher, em vez de caçar produto
  // a produto. "sem-apelido" ficou de fora de proposito — 816 dos 831 produtos
  // se encaixariam, entao nao ajuda a priorizar nada.
  // Pode vir mais de uma, separadas por vírgula: valem juntas.
  const pendencias = query.pendencia && !omitir.has("pendencia") ? String(query.pendencia).split(",").map((p) => p.trim()) : [];
  const porPendencia = Object.fromEntries(PENDENCIAS_DA_LISTA.map(({ chave, where }) => [chave, where]));

  return {
    ...(search && rawSearch
      ? {
          OR: [
            { externalCode: { contains: rawSearch, mode: "insensitive" } },
            { normalizedName: { contains: search, mode: "insensitive" } },
            { name: { contains: rawSearch, mode: "insensitive" } },
            // O apelido e justamente o nome pelo qual o fornecedor chama o
            // produto: quem procura por ele espera achar.
            { aliases: { some: { normalizedAlias: { contains: search, mode: "insensitive" } } } }
          ]
        }
      : {}),
    ...(category ? { category: { name: category } } : {}),
    ...(subcategory ? { subcategory: { name: subcategory } } : {}),
    ...(sector ? { inventorySector: { name: sector } } : {}),
    ...(nature ? { nature } : {}),
    ...(controlsStock === undefined ? {} : { controlsStock }),
    ...(isActive === undefined ? {} : { isActive }),
    ...(semDreCategoria ? { dreCategoryId: null } : {}),
    ...Object.assign({}, ...pendencias.filter((p) => Object.hasOwn(porPendencia, p)).map((p) => porPendencia[p]))
  };
}

const CAMPOS_DE_ORDEM: Record<string, (direcao: Prisma.SortOrder) => Prisma.ProductOrderByWithRelationInput> = {
  name: (dir) => ({ name: dir }),
  nature: (dir) => ({ nature: dir }),
  category: (dir) => ({ category: { name: dir } }),
  sector: (dir) => ({ inventorySector: { name: dir } }),
  stock: (dir) => ({ controlsStock: dir }),
  dre: (dir) => ({ dreCategory: { name: dir } })
};

/** Ordem da lista: só campos conhecidos, e sempre o nome como desempate para a paginação não embaralhar. */
export function productListOrderBy(query: Record<string, unknown>): Prisma.ProductOrderByWithRelationInput[] {
  const conhecido = typeof query.sort === "string" && Object.hasOwn(CAMPOS_DE_ORDEM, query.sort);
  if (!conhecido) return [{ name: "asc" }];
  const campo = query.sort as string;
  const direcao: Prisma.SortOrder = query.dir === "desc" ? "desc" : "asc";
  return campo === "name" ? [{ name: direcao }] : [CAMPOS_DE_ORDEM[campo](direcao), { name: "asc" }];
}
