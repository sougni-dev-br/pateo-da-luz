type ProductRef = {
  id: string;
  name: string;
  externalCode: string | null;
};

type AliasOwner = {
  productId: string;
  alias: string;
  ownerName: string;
  ownerExternalCode: string | null;
};

export type ProductNameConflictInput = {
  /** null em cadastro novo; o id do proprio produto em edicao. */
  productId: string | null;
  productWithSameName: ProductRef | null;
  aliasOwner: AliasOwner | null;
};

export type ProductNameConflictResult =
  | { ok: true }
  | { ok: false; reason: "DUPLICATE_NAME" | "ALIAS_TAKEN"; message: string };

function describe(name: string, externalCode: string | null) {
  return externalCode ? `${name} (codigo ${externalCode})` : name;
}

/**
 * Decide se um nome de produto pode ser gravado.
 *
 * "ProductAlias"."normalizedAlias" e unico global e o upsert de apelido
 * gravava `update: { alias, productId }` — renomear um produto para o apelido
 * de outro transferia o apelido em silencio. Como a importacao de compras casa
 * item por apelido, a compra seguinte cairia no produto errado e levaria o CMV
 * junto. Aqui o conflito vira resposta explicita, antes de qualquer escrita.
 */
export function resolveProductNameConflict(input: ProductNameConflictInput): ProductNameConflictResult {
  const { productId, productWithSameName, aliasOwner } = input;

  if (productWithSameName && productWithSameName.id !== productId) {
    return {
      ok: false,
      reason: "DUPLICATE_NAME",
      message: `Ja existe um produto chamado ${describe(productWithSameName.name, productWithSameName.externalCode)}.`
    };
  }

  if (aliasOwner && aliasOwner.productId !== productId) {
    return {
      ok: false,
      reason: "ALIAS_TAKEN",
      message:
        `"${aliasOwner.alias}" ja e apelido de ${describe(aliasOwner.ownerName, aliasOwner.ownerExternalCode)}. `
        + "Remova o apelido de la antes de usar esse nome aqui."
    };
  }

  return { ok: true };
}
