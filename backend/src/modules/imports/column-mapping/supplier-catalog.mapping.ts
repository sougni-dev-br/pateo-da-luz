export type SupplierCatalogField =
  | "supplierCode"
  | "supplierDocument"
  | "supplierName"
  | "registrationDate";

export type SupplierCatalogColumnMapping = Record<SupplierCatalogField, string[]>;

export const supplierCatalogMapping: SupplierCatalogColumnMapping = {
  supplierCode: [
    "COD. FORNE",
    "COD. FORNECEDOR",
    "COD FORNE",
    "CODIGO FORNECEDOR",
    "ID. FORNECEDOR",
    "ID FORNECEDOR",
    "ID. FORNE",
    "ID FORNE",
    "ID FORNECEDOR."
  ],
  supplierDocument: ["CNPJ/CPF", "CNPJ", "CPF", "DOCUMENTO"],
  supplierName: ["FORNECEDOR", "NOME FORNECEDOR", "RAZAO SOCIAL", "NOME"],
  registrationDate: [
    "DATA CADASTRO",
    "DT CADASTRO",
    "DT. CADASTRO",
    "DATA DE CADASTRO",
    "CADASTRO",
    "DATA DO CADASTRO",
    "DATA CAD."
  ]
};
