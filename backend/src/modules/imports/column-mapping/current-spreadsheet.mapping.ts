export type PurchaseSpreadsheetField =
  | "purchaseDate"
  | "receivedAt"
  | "supplierCode"
  | "invoiceNumber"
  | "purchaseOrderNumber"
  | "supplierDocument"
  | "supplierName"
  | "productCode"
  | "categoryName"
  | "subcategoryName"
  | "expenseType"
  | "productDescription"
  | "unit"
  | "quantity"
  | "unitPrice"
  | "totalPrice"
  | "paymentMethod"
  | "dueDates";

export type SpreadsheetColumnMapping = Record<PurchaseSpreadsheetField, string[]>;

export const currentSpreadsheetMapping: SpreadsheetColumnMapping = {
  purchaseDate: ["DT. COMPRA", "DATA COMPRA", "DATA DA COMPRA"],
  receivedAt: ["DT. RECEBIMENTO", "DATA RECEBIMENTO", "DATA DE RECEBIMENTO", "RECEBIMENTO", "DATA ENTRADA", "DT. ENTRADA", "ENTRADA ESTOQUE"],
  supplierCode: ["COD. FORNE", "COD FORNE", "CODIGO FORNECEDOR", "COD. FORNECEDOR"],
  invoiceNumber: ["N\u00ba NF", "N NF", "NF", "NOTA FISCAL", "NUMERO NF"],
  purchaseOrderNumber: ["PEDIDO", "NUMERO PEDIDO", "N PEDIDO", "NO PEDIDO", "PEDIDO COMPRA", "NUMERO DO PEDIDO"],
  supplierDocument: ["CNPJ/CPF", "CNPJ", "CPF", "DOCUMENTO"],
  supplierName: ["FORNECEDOR", "NOME FORNECEDOR"],
  productCode: ["C. PRODUTO", "COD PRODUTO", "COD. PRODUTO", "CODIGO PRODUTO"],
  categoryName: ["CATEGORIA"],
  subcategoryName: ["SUB. CATEGORIA", "SUB CATEGORIA", "SUBCATEGORIA"],
  expenseType: ["TIPO DE GASTOS", "TIPO GASTO", "TIPO DE GASTO"],
  productDescription: [
    "ITEM/DESCRI\u00c7\u00c3O",
    "ITEM/DESCRICAO",
    "DESCRI\u00c7\u00c3O",
    "DESCRICAO",
    "ITEM"
  ],
  unit: ["UNIDADES", "UNIDADE", "UND", "U. MEDIDA", "U MEDIDA", "UN"],
  quantity: ["QTDE", "QTD", "QUANTIDADE"],
  unitPrice: ["V.UNI", "V UNI", "VALOR UNITARIO", "VALOR UNIT\u00c1RIO", "VLR UNITARIO"],
  totalPrice: ["V.TOTAL", "V TOTAL", "VALOR TOTAL", "VLR TOTAL", "TOTAL"],
  paymentMethod: ["TIPO DE PAGAMENTO", "TP. PAGAMENTO", "TP PAGAMENTO", "FORMA DE PAGAMENTO", "PAGAMENTO"],
  dueDates: ["VENCIMENTOS", "VENCIMENTO", "DATA VENCIMENTO", "DATA", "VCTO", "VENCTO"]
};
