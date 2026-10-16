import { Prisma } from "@prisma/client";
import { normalizeText } from "../../shared/utils/normalize-text.js";
import { PRODUCT_NATURES } from "./product-nature.js";

/** Filtro da listagem, compartilhado entre a lista e o resumo. */
export function productListWhere(query: Record<string, unknown>): Prisma.ProductWhereInput {
  const rawSearch = query.search ? String(query.search) : undefined;
  const search = rawSearch ? normalizeText(rawSearch) : undefined;
  const category = query.category ? String(query.category) : undefined;
  const sector = query.sector ? String(query.sector) : undefined;
  const controlsStock = query.controlsStock ? String(query.controlsStock) === "true" : undefined;
  const isActive = query.isActive == null ? undefined : String(query.isActive) === "true";
  const semDreCategoria = query.semDreCategoria === "true";

  const subcategory = query.subcategory ? String(query.subcategory) : undefined;
  const nature = PRODUCT_NATURES.find((valor) => valor === query.nature);
  // Lista de trabalho: mostra o que falta preencher, em vez de caçar produto
  // a produto. "sem-apelido" ficou de fora de proposito — 816 dos 831 produtos
  // se encaixariam, entao nao ajuda a priorizar nada.
  const pendencia = query.pendencia ? String(query.pendencia) : undefined;
  const porPendencia: Record<string, Prisma.ProductWhereInput> = {
    "sem-setor": { inventorySectorId: null },
    "sem-categoria": { categoryId: null },
    "sem-subcategoria": { subcategoryId: null },
    "sem-dre": { dreCategoryId: null },
    "sem-natureza": { nature: null }
  };

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
    ...(pendencia && porPendencia[pendencia] ? porPendencia[pendencia] : {})
  };
}
