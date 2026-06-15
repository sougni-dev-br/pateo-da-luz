export type ProductCatalogField =
  | "productCode"
  | "productDescription"
  | "categoryName"
  | "subcategoryName"
  | "unit"
  | "sectorName"
  | "storageLocation"
  | "storageCorridor"
  | "storageShelf"
  | "storagePosition"
  | "storageNotes"
  | "accountType";

export type ProductCatalogColumnMapping = Record<ProductCatalogField, string[]>;

export const productCatalogMapping: ProductCatalogColumnMapping = {
  productCode: ["C. PRODUTO", "COD. PRODUTO", "COD PRODUTO", "CODIGO PRODUTO"],
  productDescription: [
    "ITEM/DESCRI\u00c7\u00c3O",
    "ITEM / DESCRI\u00c7\u00c3O",
    "ITEM/DESCRICAO",
    "ITEM / DESCRICAO",
    "DESCRI\u00c7\u00c3O",
    "DESCRICAO",
    "ITEM",
    "PRODUTO"
  ],
  categoryName: ["CATEGORIA"],
  subcategoryName: ["SUB. CATEGORIA", "SUB CATEGORIA", "SUBCATEGORIA"],
  unit: ["UND", "UN", "UNIDADE", "U. MEDIDA", "U MEDIDA", "UNIDADE MEDIDA"],
  sectorName: ["SETOR"],
  storageLocation: ["LOCALIZACAO", "LOCALIZAÇÃO", "LOCAL", "LOCAL FISICO", "LOCAL FÍSICO"],
  storageCorridor: ["CORREDOR"],
  storageShelf: ["PRATELEIRA"],
  storagePosition: ["POSICAO", "POSIÇÃO", "NIVEL", "NÍVEL"],
  storageNotes: ["OBS LOCALIZACAO", "OBS LOCALIZAÇÃO", "OBSERVACAO LOCALIZACAO", "OBSERVAÇÃO LOCALIZAÇÃO"],
  accountType: ["TP DE CONTA", "TIPO DE CONTA", "TIPO CONTA"]
};
