import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputPath = path.resolve(__dirname, "../../samples/compras-exemplo.xlsx");

const workbook = new ExcelJS.Workbook();
const worksheet = workbook.addWorksheet("Compras");

worksheet.columns = [
  { header: "DT. COMPRA", key: "purchaseDate", width: 14 },
  { header: "COD. FORNE", key: "supplierCode", width: 14 },
  { header: "N\u00ba NF", key: "invoiceNumber", width: 12 },
  { header: "CNPJ/CPF", key: "supplierDocument", width: 22 },
  { header: "FORNECEDOR", key: "supplierName", width: 24 },
  { header: "C. PRODUTO", key: "productCode", width: 14 },
  { header: "CATEGORIA", key: "categoryName", width: 16 },
  { header: "SUB. CATEGORIA", key: "subcategoryName", width: 18 },
  { header: "TIPO DE GASTOS", key: "expenseType", width: 18 },
  { header: "ITEM/DESCRI\u00c7\u00c3O", key: "productDescription", width: 28 },
  { header: "UND", key: "unit", width: 8 },
  { header: "QTDE", key: "quantity", width: 10 },
  { header: "V.UNI", key: "unitPrice", width: 12 },
  { header: "V.TOTAL", key: "totalPrice", width: 12 },
  { header: "TIPO DE PAGAMENTO", key: "paymentMethod", width: 20 },
  { header: "VENCIMENTOS", key: "dueDates", width: 28 }
];

worksheet.addRows([
  {
    purchaseDate: "05/01/2026",
    supplierCode: "F001",
    invoiceNumber: "1001",
    supplierDocument: "12.345.678/0001-90",
    supplierName: "Hortifruti Central",
    productCode: "P001",
    categoryName: "Alimentos",
    subcategoryName: "Hortifruti",
    expenseType: "Insumos",
    productDescription: "Tomate italiano",
    unit: "KG",
    quantity: "10",
    unitPrice: "8,50",
    totalPrice: "85,00",
    paymentMethod: "Boleto",
    dueDates: "10/01/2026; 10/02/2026"
  },
  {
    purchaseDate: "05/01/2026",
    supplierCode: "F001",
    invoiceNumber: "1001",
    supplierDocument: "12.345.678/0001-90",
    supplierName: "Hortifruti Central",
    productCode: "P002",
    categoryName: "Alimentos",
    subcategoryName: "Hortifruti",
    expenseType: "Insumos",
    productDescription: "Alface crespa",
    unit: "UN",
    quantity: "20",
    unitPrice: "2,50",
    totalPrice: "50,00",
    paymentMethod: "Boleto",
    dueDates: "10/01/2026; 10/02/2026"
  },
  {
    purchaseDate: "06/01/2026",
    supplierCode: "F002",
    invoiceNumber: "2001",
    supplierDocument: "98.765.432/0001-10",
    supplierName: "Acougue Bom Corte",
    productCode: "P010",
    categoryName: "Alimentos",
    subcategoryName: "Carnes",
    expenseType: "Insumos",
    productDescription: "Carne bovina patinho",
    unit: "KG",
    quantity: "15",
    unitPrice: "38,90",
    totalPrice: "583,50",
    paymentMethod: "Pix",
    dueDates: ""
  },
  {
    purchaseDate: "07/01/2026",
    supplierCode: "F003",
    invoiceNumber: "",
    supplierDocument: "123.456.789-00",
    supplierName: "Mercado Bairro",
    productCode: "P050",
    categoryName: "Administrativo",
    subcategoryName: "Pequenos gastos",
    expenseType: "Pequeno gasto",
    productDescription: "Pilhas alcalinas",
    unit: "UN",
    quantity: "4",
    unitPrice: "6,00",
    totalPrice: "24,00",
    paymentMethod: "Dinheiro",
    dueDates: ""
  }
]);

worksheet.getRow(1).font = { bold: true };

await workbook.xlsx.writeFile(outputPath);
console.log(`Planilha criada em: ${outputPath}`);
