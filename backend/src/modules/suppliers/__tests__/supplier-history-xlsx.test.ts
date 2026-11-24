import ExcelJS from "exceljs";
import { describe, expect, test } from "vitest";
import { buildSupplierHistoryWorkbook, historyFileName } from "../supplier-history-xlsx.js";
import type { SupplierHistoryResult } from "../supplier-history.js";
import type { TitleSummary } from "../supplier-history-title.js";

const titulo = (over: Partial<TitleSummary>): TitleSummary => ({
  state: "OPEN", parcels: [], installments: 0, paidInstallments: 0, amount: 0, paidAmount: 0, nextDueDate: null, paidDate: null, viaCycle: false, ...over
});

const resultado: SupplierHistoryResult = {
  period: { from: "2026-11-01", to: "2026-11-30" },
  periodTotal: 6000,
  purchaseCount: 2,
  lastPurchase: null,
  averagePaymentTermDays: 20,
  purchases: {
    items: [
      {
        id: "c1", purchaseNumber: "CMP-1", invoiceNumber: "NF-100", purchaseDate: new Date("2026-11-23T00:00:00.000Z"), totalAmount: "5000.50", status: "ACTIVE", paymentMethod: "BOLETO 2X",
        title: titulo({
          state: "OVERDUE", installments: 2, paidInstallments: 1, nextDueDate: "2026-11-30", amount: 5000.5, paidAmount: 2500.25, paidDate: "2026-11-10",
          parcels: [
            { number: 1, dueDate: "2026-11-10", amount: 2500.25, state: "PAID", paidDate: "2026-11-10", paidAmount: 2500.25 },
            { number: 2, dueDate: "2026-11-30", amount: 2500.25, state: "OVERDUE", paidDate: null, paidAmount: 0 }
          ]
        })
      },
      {
        id: "c2", purchaseNumber: "CMP-2", invoiceNumber: null, purchaseDate: new Date("2026-11-02T00:00:00.000Z"), totalAmount: "999.50", status: "CANCELLED", paymentMethod: null,
        title: titulo({ state: "NONE" })
      }
    ],
    total: 2, page: 1, pageSize: 2000, truncated: false
  },
  titleBuckets: {
    all: { count: 1, amount: 5000.5 }, open: { count: 0, amount: 0 }, overdue: { count: 1, amount: 5000.5 }, paid: { count: 0, amount: 0 }, none: { count: 0, amount: 0 }
  },
  paymentMethods: []
};

async function ler(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

describe("planilha do histórico do fornecedor", () => {
  test("tem as abas Resumo, Compras e Parcelas", async () => {
    const workbook = await ler(await buildSupplierHistoryWorkbook("CASTELÃO LTDA", resultado, { titleFilter: null, search: null, includeCancelled: true }, new Date("2026-11-24T15:00:00Z")));
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Resumo", "Compras", "Parcelas"]);
  });

  test("uma linha por compra, com valores numéricos e datas de verdade", async () => {
    const workbook = await ler(await buildSupplierHistoryWorkbook("CASTELÃO LTDA", resultado, { titleFilter: null, search: null, includeCancelled: true }));
    const sheet = workbook.getWorksheet("Compras")!;
    expect(sheet.getRow(1).values).toEqual(expect.arrayContaining(["Data", "Pedido", "NF", "Total", "Situação do título"]));
    const linha = sheet.getRow(2);
    const col = (nome: string) => (sheet.getRow(1).values as string[]).indexOf(nome);
    expect(linha.getCell(col("Total")).value).toBe(5000.5);
    expect(linha.getCell(col("Data")).value).toEqual(new Date("2026-11-23T00:00:00.000Z"));
    expect(linha.getCell(col("Situação do título")).value).toBe("Vencido");
    expect(linha.getCell(col("Parcelas")).value).toBe(2);
    expect(sheet.getRow(3).getCell(col("Situação do título")).value).toBe("Cancelada");
    expect(sheet.getRow(3).getCell(col("NF")).value ?? "").toBe("");
  });

  test("uma linha por parcela, com vencimento, situação e baixa", async () => {
    const workbook = await ler(await buildSupplierHistoryWorkbook("CASTELÃO LTDA", resultado, { titleFilter: null, search: null, includeCancelled: true }));
    const sheet = workbook.getWorksheet("Parcelas")!;
    const cabecalho = sheet.getRow(1).values as string[];
    const col = (nome: string) => cabecalho.indexOf(nome);
    expect(sheet.rowCount).toBe(3);
    expect(sheet.getRow(2).getCell(col("Parcela")).value).toBe("1/2");
    expect(sheet.getRow(2).getCell(col("Situação")).value).toBe("Baixada");
    expect(sheet.getRow(2).getCell(col("Baixa em")).value).toEqual(new Date("2026-11-10T00:00:00.000Z"));
    expect(sheet.getRow(3).getCell(col("Situação")).value).toBe("Vencida");
    expect(sheet.getRow(3).getCell(col("Vencimento")).value).toEqual(new Date("2026-11-30T00:00:00.000Z"));
    expect(sheet.getRow(3).getCell(col("Valor")).value).toBe(2500.25);
    // Cada parcela leva a compra junto: pagamento e total da compra repetidos.
    expect(sheet.getRow(3).getCell(col("Pagamento")).value).toBe("BOLETO 2X");
    expect(sheet.getRow(3).getCell(col("Total da compra")).value).toBe(5000.5);
  });

  test("compra de ciclo não entra na aba Parcelas (o título é do fechamento)", async () => {
    const doCiclo = { ...resultado, purchases: { ...resultado.purchases, items: [{ ...resultado.purchases.items[0], title: { ...resultado.purchases.items[0].title, viaCycle: true } }] } };
    const workbook = await ler(await buildSupplierHistoryWorkbook("X", doCiclo, { titleFilter: null, search: null, includeCancelled: false }));
    expect(workbook.getWorksheet("Parcelas")!.rowCount).toBe(1);
    expect(workbook.getWorksheet("Compras")!.rowCount).toBe(2);
  });

  test("o resumo registra o fornecedor, o período e os filtros usados", async () => {
    const workbook = await ler(await buildSupplierHistoryWorkbook("CASTELÃO LTDA", resultado, { titleFilter: "overdue", search: "100", includeCancelled: false }));
    const texto = JSON.stringify(workbook.getWorksheet("Resumo")!.getSheetValues());
    expect(texto).toContain("CASTELÃO LTDA");
    expect(texto).toContain("01/11/2026 a 30/11/2026");
    expect(texto).toContain("Vencidas");
    expect(texto).toContain("100");
  });

  test("avisa no resumo quando a lista foi cortada no teto", async () => {
    const cortado = { ...resultado, purchases: { ...resultado.purchases, truncated: true } };
    const workbook = await ler(await buildSupplierHistoryWorkbook("X", cortado, { titleFilter: null, search: null, includeCancelled: false }));
    expect(JSON.stringify(workbook.getWorksheet("Resumo")!.getSheetValues())).toContain("cortada");
  });
});

describe("historyFileName", () => {
  test("sem acento, sem espaço e com a data", () => {
    expect(historyFileName("CASTELÃO Distribuidora, de Frios!", "xlsx", new Date("2026-11-24T15:00:00Z"))).toBe("Historico_CASTELAO_Distribuidora_de_Frios_2026-11-24.xlsx");
  });
});
