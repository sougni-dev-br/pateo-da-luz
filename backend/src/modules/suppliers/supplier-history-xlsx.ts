import ExcelJS from "exceljs";
import type { SupplierHistoryResult, TitleFilter } from "./supplier-history.js";
import { restaurantToday } from "./supplier-history.js";
import type { TitleParcel, TitleState } from "./supplier-history-title.js";

export type HistoryExportFilters = {
  titleFilter: TitleFilter | null;
  search: string | null;
  includeCancelled: boolean;
};

const MONEY_FORMAT = '"R$" #,##0.00';
const DATE_FORMAT = "dd/mm/yyyy";
const HEADER_FILL = "FF6B4F2A";

const TITLE_LABEL: Record<TitleState, string> = { PAID: "Baixado", OVERDUE: "Vencido", OPEN: "Em aberto", NONE: "Sem título" };
const PARCEL_LABEL: Record<TitleParcel["state"], string> = { PAID: "Baixada", OVERDUE: "Vencida", OPEN: "Em aberto" };
const FILTER_LABEL: Record<TitleFilter, string> = { open: "Em aberto", overdue: "Vencidas", paid: "Baixadas", none: "Sem título" };

/** Dia (YYYY-MM-DD ou Date) como meia-noite UTC: o Excel mostra o mesmo dia em qualquer fuso. */
function asDay(value: Date | string | null): Date | null {
  if (!value) return null;
  const iso = typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  return new Date(`${iso}T00:00:00.000Z`);
}

const brDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function styleHeader(sheet: ExcelJS.Worksheet) {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  header.alignment = { vertical: "middle" };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
}

function describePeriod(period: SupplierHistoryResult["period"]): string {
  if (!period.from && !period.to) return "Todo o histórico";
  if (period.from && period.to) return `${brDay(period.from)} a ${brDay(period.to)}`;
  return period.from ? `a partir de ${brDay(period.from)}` : `até ${brDay(period.to as string)}`;
}

function buildSummary(workbook: ExcelJS.Workbook, supplierName: string, result: SupplierHistoryResult, filters: HistoryExportFilters, now: Date) {
  const sheet = workbook.addWorksheet("Resumo");
  sheet.columns = [{ width: 30 }, { width: 46 }, { width: 18 }];
  const emitido = `${restaurantToday(now).toISOString().slice(0, 10).split("-").reverse().join("/")}`;
  const filtros = [
    filters.titleFilter ? `Situação: ${FILTER_LABEL[filters.titleFilter]}` : null,
    filters.search ? `Busca: ${filters.search}` : null,
    filters.includeCancelled ? "Inclui canceladas" : null
  ].filter(Boolean).join(" · ");

  const title = sheet.addRow(["Histórico de compras do fornecedor"]);
  title.font = { bold: true, size: 14 };
  sheet.addRow([]);
  for (const [label, value] of [
    ["Fornecedor", supplierName],
    ["Período", describePeriod(result.period)],
    ["Filtros", filtros || "Nenhum"],
    ["Emitido em", emitido]
  ] as const) sheet.addRow([label, value]).getCell(1).font = { bold: true };

  sheet.addRow([]);
  const totals = sheet.addRow(["Total no período (sem canceladas)", result.periodTotal]);
  totals.getCell(1).font = { bold: true };
  totals.getCell(2).numFmt = MONEY_FORMAT;
  totals.getCell(2).alignment = { horizontal: "left" };
  sheet.addRow(["Compras no período", result.purchaseCount]).getCell(1).font = { bold: true };

  sheet.addRow([]);
  const head = sheet.addRow(["Título", "Compras", "Valor das compras"]);
  head.font = { bold: true };
  for (const [key, label] of [["open", "Em aberto"], ["overdue", "Vencidas"], ["paid", "Baixadas"], ["none", "Sem título"]] as const) {
    const bucket = result.titleBuckets[key];
    const row = sheet.addRow([label, bucket.count, bucket.amount]);
    row.getCell(3).numFmt = MONEY_FORMAT;
  }
  if (result.purchases.truncated) {
    sheet.addRow([]);
    const warn = sheet.addRow([`Atenção: a lista foi cortada em ${result.purchases.pageSize} compras. Restrinja o período para exportar tudo.`]);
    warn.font = { bold: true, color: { argb: "FFA6580A" } };
  }
}

function buildPurchases(workbook: ExcelJS.Workbook, result: SupplierHistoryResult) {
  const sheet = workbook.addWorksheet("Compras");
  sheet.columns = [
    { header: "Data", key: "date", width: 12, style: { numFmt: DATE_FORMAT } },
    { header: "Pedido", key: "order", width: 18 },
    { header: "NF", key: "invoice", width: 14 },
    { header: "Pagamento", key: "payment", width: 18 },
    { header: "Total", key: "total", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "Situação do título", key: "state", width: 18 },
    { header: "Parcelas", key: "parcels", width: 10 },
    { header: "Próximo vencimento", key: "due", width: 20, style: { numFmt: DATE_FORMAT } },
    { header: "Baixado em", key: "paidDate", width: 14, style: { numFmt: DATE_FORMAT } },
    { header: "Valor pago", key: "paid", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "Origem do título", key: "origin", width: 16 }
  ];
  for (const purchase of result.purchases.items) {
    const cancelled = purchase.status === "CANCELLED";
    const { title } = purchase;
    sheet.addRow({
      date: asDay(purchase.purchaseDate),
      order: purchase.purchaseNumber ?? "",
      invoice: purchase.invoiceNumber ?? "",
      payment: purchase.paymentMethod ?? "",
      total: Number(purchase.totalAmount),
      state: cancelled ? "Cancelada" : TITLE_LABEL[title.state],
      parcels: cancelled ? null : title.installments || null,
      due: cancelled ? null : asDay(title.nextDueDate),
      paidDate: cancelled ? null : asDay(title.paidDate),
      paid: cancelled || title.paidAmount === 0 ? null : title.paidAmount,
      origin: cancelled ? "" : title.viaCycle ? "Ciclo" : title.state === "NONE" ? "" : "Compra"
    });
  }
  styleHeader(sheet);
}

function buildParcels(workbook: ExcelJS.Workbook, result: SupplierHistoryResult) {
  const sheet = workbook.addWorksheet("Parcelas");
  sheet.columns = [
    { header: "Pedido", key: "order", width: 18 },
    { header: "NF", key: "invoice", width: 14 },
    { header: "Data da compra", key: "date", width: 14, style: { numFmt: DATE_FORMAT } },
    { header: "Pagamento", key: "payment", width: 18 },
    { header: "Total da compra", key: "purchaseTotal", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "Parcela", key: "parcel", width: 10 },
    { header: "Vencimento", key: "due", width: 14, style: { numFmt: DATE_FORMAT } },
    { header: "Valor", key: "amount", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "Situação", key: "state", width: 12 },
    { header: "Baixa em", key: "paidDate", width: 14, style: { numFmt: DATE_FORMAT } },
    { header: "Valor pago", key: "paid", width: 16, style: { numFmt: MONEY_FORMAT } }
  ];
  for (const purchase of result.purchases.items) {
    // Compra de ciclo: as parcelas são do título do fechamento e valem para várias compras; ficam só na aba Compras.
    if (purchase.status === "CANCELLED" || purchase.title.viaCycle) continue;
    const total = purchase.title.parcels.length;
    for (const parcel of purchase.title.parcels) {
      sheet.addRow({
        order: purchase.purchaseNumber ?? "",
        invoice: purchase.invoiceNumber ?? "",
        date: asDay(purchase.purchaseDate),
        payment: purchase.paymentMethod ?? "",
        purchaseTotal: Number(purchase.totalAmount),
        parcel: `${parcel.number}/${total}`,
        due: asDay(parcel.dueDate),
        amount: parcel.amount,
        state: PARCEL_LABEL[parcel.state],
        paidDate: asDay(parcel.paidDate),
        paid: parcel.state === "PAID" ? parcel.paidAmount : null
      });
    }
  }
  styleHeader(sheet);
}

/** Planilha do histórico: Resumo (filtros e totais), Compras (uma linha por compra) e Parcelas (uma por parcela). */
export async function buildSupplierHistoryWorkbook(
  supplierName: string,
  result: SupplierHistoryResult,
  filters: HistoryExportFilters,
  now: Date = new Date()
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Pateo da Luz";
  workbook.created = now;
  buildSummary(workbook, supplierName, result, filters, now);
  buildPurchases(workbook, result);
  buildParcels(workbook, result);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** "Historico_CASTELAO_Distribuidora_2026-11-24.xlsx": ASCII puro, seguro em header e em qualquer sistema de arquivos. */
export function historyFileName(supplierName: string, extension: "xlsx" | "pdf", now: Date = new Date()): string {
  const slug = supplierName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
    .replace(/_+$/g, "");
  return `Historico_${slug || "fornecedor"}_${restaurantToday(now).toISOString().slice(0, 10)}.${extension}`;
}
