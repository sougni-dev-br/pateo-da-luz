export type PayablesFinancialPdfRow = {
  dueDate: unknown;
  paidDate: unknown;
  amount: unknown;
  paidAmount: unknown;
  installment: unknown;
  paymentMethodName: unknown;
  paymentNotes: unknown;
  status: unknown;
  supplierName: unknown;
  purchaseNumber: unknown;
  invoiceNumber: unknown;
  purchaseDate: unknown;
  notes: unknown;
};

type PayablesFinancialPdfInput = {
  generatedAt?: Date;
  today?: Date;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  periodLabel: string;
  supplierLabel: string;
  paymentMethodLabel: string;
  statusLabel: string;
  rows: PayablesFinancialPdfRow[];
};

const pageWidth = 842;
const pageHeight = 595;
const marginX = 24;
const marginTop = 24;
const marginBottom = 24;
const contentWidth = pageWidth - marginX * 2;
const textPrimaryGray = 0.08;
const textSecondaryGray = 0.28;
const textMutedGray = 0.40;

type TableColumn = {
  key: "purchaseNumber" | "invoiceNumber" | "purchaseDate" | "dueDate" | "installment" | "amount" | "paidAmount" | "paymentMethodName" | "status" | "notes";
  label: string;
  width: number;
  align?: "left" | "center" | "right";
  maxLines?: number;
};

const statusLabels: Record<string, string> = {
  OPEN: "Em aberto",
  PAID: "Pago",
  PAID_LATE: "Pago com atraso",
  OVERDUE: "Vencido",
  CANCELLED: "Cancelado"
};

function removeDiacritics(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function cleanPdfText(value: unknown) {
  return removeDiacritics(String(value ?? ""))
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapePdfText(value: unknown) {
  return cleanPdfText(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function approxChars(width: number, fontSize: number) {
  return Math.max(4, Math.floor(width / Math.max(3.5, fontSize * 0.53)));
}

function wrapText(value: unknown, width: number, fontSize: number, maxLines = 99) {
  const text = cleanPdfText(value);
  if (!text) return ["-"];

  const max = approxChars(width, fontSize);
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > max && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    } else {
      current = next;
    }
  }

  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length > maxLines) lines.length = maxLines;
  return lines;
}

function formatCurrency(value: unknown) {
  return Number(value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateValue(value: unknown) {
  if (!value) return "-";
  return new Date(String(value)).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function formatDateTimeValue(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  const dateText = date.toLocaleDateString("pt-BR");
  const timeText = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${dateText} as ${timeText}`;
}

function localDateOnly(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function yToPdf(y: number) {
  return pageHeight - y;
}

function amountSum(rows: PayablesFinancialPdfRow[], statuses: string[], usePaidAmount = false) {
  return rows
    .filter((row) => statuses.includes(String(row.status ?? "")))
    .reduce((sum, row) => sum + Number(usePaidAmount ? row.paidAmount ?? row.amount ?? 0 : row.amount ?? 0), 0);
}

// Returns sum of OPEN titles with dueDate in [from, to] (exclusive range for faixas)
function openInRange(rows: PayablesFinancialPdfRow[], from: Date, to: Date) {
  return rows
    .filter((row) => String(row.status ?? "") === "OPEN")
    .filter((row) => row.dueDate)
    .reduce((sum, row) => {
      const dueDate = localDateOnly(new Date(String(row.dueDate)));
      return dueDate >= from && dueDate <= to ? sum + Number(row.amount ?? 0) : sum;
    }, 0);
}

// Aging: includes OPEN rows that are past their due date (system may not have updated status)
function bucketAging(rows: PayablesFinancialPdfRow[], today: Date) {
  const buckets = [
    { label: "Vencido 1-7", min: 1, max: 7, value: 0, count: 0 },
    { label: "Vencido 8-15", min: 8, max: 15, value: 0, count: 0 },
    { label: "Vencido 16-30", min: 16, max: 30, value: 0, count: 0 },
    { label: "Vencido 31+", min: 31, max: Number.POSITIVE_INFINITY, value: 0, count: 0 }
  ];

  for (const row of rows) {
    const status = String(row.status ?? "");
    if (!row.dueDate) continue;
    const dueDate = localDateOnly(new Date(String(row.dueDate)));
    // Include OVERDUE status OR OPEN status that is past due (system lag)
    const isEffectivelyOverdue = status === "OVERDUE" || (status === "OPEN" && dueDate < today);
    if (!isEffectivelyOverdue) continue;
    const diffDays = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 1) continue;
    const bucket = buckets.find((item) => diffDays >= item.min && diffDays <= item.max);
    if (!bucket) continue;
    bucket.value += Number(row.amount ?? 0);
    bucket.count += 1;
  }

  return buckets;
}

function isPaidStatus(status: unknown) {
  return ["PAID", "PAID_LATE"].includes(String(status ?? ""));
}

function isPendingStatus(status: unknown) {
  return ["OPEN", "OVERDUE"].includes(String(status ?? ""));
}

function inPeriod(value: unknown, start?: Date | null, end?: Date | null) {
  if (!value) return false;
  const date = localDateOnly(new Date(String(value)));
  if (start && date < localDateOnly(start)) return false;
  if (end && date > localDateOnly(end)) return false;
  return true;
}

// ─── Enriched row type ──────────────────────────────────────────────────────

type EnrichedRow = PayablesFinancialPdfRow & {
  purchaseNumberLabel: string;
  invoiceNumberLabel: string;
  purchaseDateLabel: string;
  dueDateLabel: string;
  installmentLabel: string;
  amountLabel: string;
  paidAmountLabel: string;
  paymentMethodNameLabel: string;
  statusLabel: string;
  notesLabel: string;
  duplicateFlag: boolean;
};

type NfSubGroup = {
  nfKey: string;
  purchaseNumber: string;
  invoiceNumber: string;
  purchaseDate: string;
  nfTotal: number;
  rows: EnrichedRow[];
};

type SupplierGroup = {
  supplierName: string;
  nfGroups: NfSubGroup[];
  allRows: EnrichedRow[];
  total: number;
  pending: number;
  open: number;
  overdue: number;
  paidInPeriod: number;
};

function buildSupplierGroups(
  rows: PayablesFinancialPdfRow[],
  cancelledDupKeys: Set<string>,
  periodStart?: Date | null,
  periodEnd?: Date | null
): SupplierGroup[] {
  const groups = new Map<string, SupplierGroup>();

  for (const row of rows) {
    const supplierName = cleanPdfText(row.supplierName || "-") || "-";
    const status = String(row.status ?? "");
    const amount = Number(row.amount ?? 0);

    if (!groups.has(supplierName)) {
      groups.set(supplierName, {
        supplierName,
        nfGroups: [],
        allRows: [],
        total: 0,
        pending: 0,
        open: 0,
        overdue: 0,
        paidInPeriod: 0
      });
    }
    const group = groups.get(supplierName)!;

    group.total += amount;
    if (isPendingStatus(status)) group.pending += amount;
    if (status === "OPEN") group.open += amount;
    if (status === "OVERDUE") group.overdue += amount;
    if (isPaidStatus(status) && inPeriod(row.paidDate, periodStart, periodEnd)) {
      group.paidInPeriod += Number(row.paidAmount ?? amount);
    }

    const invoiceKey = cleanPdfText(row.invoiceNumber || "");
    const purchaseKey = cleanPdfText(row.purchaseNumber || "");
    const nfKey = `${purchaseKey}__${invoiceKey}`;
    const dupKey = `${supplierName}_${invoiceKey}`;
    const duplicateFlag = invoiceKey !== "" && cancelledDupKeys.has(dupKey);

    const enriched: EnrichedRow = {
      ...row,
      purchaseNumberLabel: purchaseKey || "-",
      invoiceNumberLabel: invoiceKey || "-",
      purchaseDateLabel: formatDateValue(row.purchaseDate),
      dueDateLabel: formatDateValue(row.dueDate),
      installmentLabel: cleanPdfText(row.installment || "-") || "-",
      amountLabel: formatCurrency(row.amount),
      paidAmountLabel: row.paidAmount != null ? formatCurrency(row.paidAmount) : "-",
      paymentMethodNameLabel: cleanPdfText(row.paymentMethodName || "-") || "-",
      statusLabel: statusLabels[status] ?? (cleanPdfText(row.status || "-") || "-"),
      notesLabel: duplicateFlag
        ? `[!] VERIFICAR DUPLICIDADE  ${cleanPdfText(row.paymentNotes || row.notes || "") || ""}`.trim()
        : (cleanPdfText(row.paymentNotes || row.notes || "-") || "-"),
      duplicateFlag
    };

    group.allRows.push(enriched);

    // NF sub-grouping
    let nfGroup = group.nfGroups.find((g) => g.nfKey === nfKey);
    if (!nfGroup) {
      nfGroup = {
        nfKey,
        purchaseNumber: purchaseKey || "-",
        invoiceNumber: invoiceKey || "-",
        purchaseDate: formatDateValue(row.purchaseDate),
        nfTotal: 0,
        rows: []
      };
      group.nfGroups.push(nfGroup);
    }
    nfGroup.nfTotal += amount;
    nfGroup.rows.push(enriched);
  }

  return Array.from(groups.values()).sort((a, b) => a.supplierName.localeCompare(b.supplierName, "pt-BR"));
}

function buildTableColumns(includePaidColumn: boolean, includePurchaseColumn: boolean): TableColumn[] {
  const base: TableColumn[] = [];

  if (includePurchaseColumn) {
    base.push({ key: "purchaseNumber", label: "Pedido", width: 84, align: "left", maxLines: 1 });
  }

  base.push(
    { key: "invoiceNumber", label: "NF", width: includePurchaseColumn ? 66 : 80, align: "left", maxLines: 1 },
    { key: "purchaseDate", label: "Compra", width: 52, align: "center", maxLines: 1 },
    { key: "dueDate", label: "Venc.", width: 52, align: "center", maxLines: 1 },
    { key: "installment", label: "Parc.", width: 42, align: "center", maxLines: 1 },
    { key: "amount", label: "Valor", width: 72, align: "right", maxLines: 1 }
  );

  if (includePaidColumn) {
    base.push({ key: "paidAmount", label: "Pago", width: 72, align: "right", maxLines: 1 });
  }

  const notesWidth = includePurchaseColumn
    ? (includePaidColumn ? 188 : 214)
    : (includePaidColumn ? 272 : 298);

  base.push(
    { key: "paymentMethodName", label: "Forma", width: includePaidColumn ? 98 : 118, align: "left", maxLines: 1 },
    { key: "status", label: "Status", width: 68, align: "center", maxLines: 1 },
    { key: "notes", label: "Observacoes", width: notesWidth, align: "left", maxLines: 2 }
  );

  return base;
}

function drawRect(commands: string[], x: number, y: number, width: number, height: number, fillGray?: number, strokeGray = 0.82) {
  if (fillGray != null) {
    commands.push(`${fillGray.toFixed(2)} g`);
    commands.push(`${x.toFixed(2)} ${(yToPdf(y + height)).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`);
  }
  commands.push(`${strokeGray.toFixed(2)} G`);
  commands.push(`${x.toFixed(2)} ${(yToPdf(y + height)).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`);
}

function drawVerticalLine(commands: string[], x: number, top: number, height: number, gray = 0.90) {
  commands.push(`${gray.toFixed(2)} G`);
  commands.push(`${x.toFixed(2)} ${yToPdf(top).toFixed(2)} m ${x.toFixed(2)} ${yToPdf(top + height).toFixed(2)} l S`);
}

function drawText(
  commands: string[],
  x: number,
  y: number,
  text: unknown,
  fontSize = 9,
  font: "F1" | "F2" = "F1",
  gray = textPrimaryGray
) {
  commands.push(`${gray.toFixed(2)} g`);
  commands.push("BT");
  commands.push(`/${font} ${fontSize} Tf`);
  commands.push(`${x.toFixed(2)} ${yToPdf(y).toFixed(2)} Td`);
  commands.push(`(${escapePdfText(text)}) Tj`);
  commands.push("ET");
}

function alignedTextX(x: number, width: number, text: string, fontSize: number, align: "left" | "center" | "right" = "left") {
  const estimatedWidth = text.length * fontSize * 0.48;
  if (align === "right") return Math.max(x + 3, x + width - estimatedWidth - 4);
  if (align === "center") return Math.max(x + 3, x + (width - estimatedWidth) / 2);
  return x + 3;
}

export function createPayablesFinancialPdf(input: PayablesFinancialPdfInput) {
  const allRowsSorted = [...input.rows].sort((a, b) => {
    const supplierCompare = cleanPdfText(a.supplierName).localeCompare(cleanPdfText(b.supplierName), "pt-BR");
    if (supplierCompare !== 0) return supplierCompare;
    const nfA = `${cleanPdfText(a.purchaseNumber)}__${cleanPdfText(a.invoiceNumber)}`;
    const nfB = `${cleanPdfText(b.purchaseNumber)}__${cleanPdfText(b.invoiceNumber)}`;
    if (nfA !== nfB) return nfA.localeCompare(nfB, "pt-BR");
    return Number(a.installment ?? 0) - Number(b.installment ?? 0);
  });

  // Separate cancelled from active
  const activeRows = allRowsSorted.filter((r) => String(r.status ?? "") !== "CANCELLED");
  const cancelledRows = allRowsSorted.filter((r) => String(r.status ?? "") === "CANCELLED");

  // Build set of cancelled NF keys that have duplicate notes
  const cancelledDupKeys = new Set<string>();
  for (const row of cancelledRows) {
    const notes = (cleanPdfText(row.paymentNotes || "") + " " + cleanPdfText(row.notes || "")).toLowerCase();
    if (notes.includes("duplicid") || notes.includes("duplicata")) {
      const supplier = cleanPdfText(row.supplierName || "");
      const invoice = cleanPdfText(row.invoiceNumber || "");
      if (invoice) cancelledDupKeys.add(`${supplier}_${invoice}`);
    }
  }

  const today = localDateOnly(input.today ?? new Date());
  const includePaidColumn = activeRows.some((row) => isPaidStatus(row.status) || row.paidAmount != null || row.paidDate != null);
  const hasPurchaseNumbers = activeRows.some((row) => cleanPdfText(row.purchaseNumber || "") !== "");
  const tableColumns = buildTableColumns(includePaidColumn, hasPurchaseNumbers);
  const hasSpecificSupplier = cleanPdfText(input.supplierLabel).toLowerCase() !== "todos";
  const reportTitle = hasSpecificSupplier ? "Financeiro - Posicao de Fornecedor" : "Financeiro - Posicao de Fornecedores";

  // Exclusive faixas for próximos
  const next7end = localDateOnly(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7));
  const next8start = localDateOnly(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 8));
  const next30end = localDateOnly(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 30));

  const totals = {
    open: amountSum(activeRows, ["OPEN"]),
    overdue: amountSum(activeRows, ["OVERDUE"]),
    paid: amountSum(activeRows, ["PAID", "PAID_LATE"], true),
    next1to7: openInRange(activeRows, today, next7end),
    next8to30: openInRange(activeRows, next8start, next30end),
    overall: activeRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
  };

  const aging = bucketAging(activeRows, today);
  const groups = buildSupplierGroups(activeRows, cancelledDupKeys, input.periodStart, input.periodEnd);
  const cancelledGroups = buildSupplierGroups(cancelledRows, new Set(), input.periodStart, input.periodEnd);

  // Ranking: sorted by urgency % (overdue / pending desc), then by overdue value
  const ranking = [...groups]
    .filter((g) => g.pending > 0 || g.overdue > 0)
    .sort((a, b) => {
      const ratioA = a.pending > 0 ? a.overdue / a.pending : (a.overdue > 0 ? 1 : 0);
      const ratioB = b.pending > 0 ? b.overdue / b.pending : (b.overdue > 0 ? 1 : 0);
      return ratioB - ratioA || b.overdue - a.overdue || b.pending - a.pending;
    })
    .slice(0, 6);

  const pages: string[][] = [[]];
  let pageIndex = 0;
  let cursorY = marginTop;

  const currentCommands = () => pages[pageIndex];
  const newPage = () => {
    pages.push([]);
    pageIndex += 1;
    cursorY = marginTop;
  };
  const ensureSpace = (height: number) => {
    if (cursorY + height > pageHeight - marginBottom) newPage();
  };

  const drawPageHeader = (isFirstPage: boolean) => {
    const commands = currentCommands();
    drawText(commands, marginX, cursorY, reportTitle, 16, "F2");
    drawText(commands, pageWidth - 188, cursorY + 1, `Gerado em ${formatDateTimeValue(input.generatedAt ?? new Date())}`, 8, "F1");
    cursorY += 18;

    const filterLines = [
      `Periodo: ${input.periodLabel}`,
      `Fornecedor: ${input.supplierLabel}`,
      `Forma: ${input.paymentMethodLabel}  |  Status: ${input.statusLabel}`
    ];
    for (const line of filterLines) {
      drawText(commands, marginX, cursorY, line, 8, "F1");
      cursorY += 11;
    }

    if (isFirstPage) {
      const cancelledNote = cancelledRows.length > 0 ? `  |  Cancelados: ${cancelledRows.length} (listados ao final)` : "";
      drawText(commands, marginX, cursorY + 2, `Titulos ativos: ${activeRows.length}${cancelledNote}`, 8, "F1");
      cursorY += 12;
    }

    commands.push("0.70 G");
    commands.push(`${marginX} ${yToPdf(cursorY).toFixed(2)} m ${pageWidth - marginX} ${yToPdf(cursorY).toFixed(2)} l S`);
    cursorY += 10;
  };

  const drawCardGrid = (title: string, cards: Array<{ label: string; value: string; helper?: string }>, columns: number) => {
    ensureSpace(24 + Math.ceil(cards.length / columns) * 43);
    drawText(currentCommands(), marginX, cursorY, title, 11, "F2", textPrimaryGray);
    cursorY += 14;

    const gap = 10;
    const cardWidth = (contentWidth - gap * (columns - 1)) / columns;
    const cardHeight = 34;

    cards.forEach((card, index) => {
      const label = cleanPdfText(card.label) || "-";
      const value = cleanPdfText(card.value) || formatCurrency(0);
      const helper = card.helper ? cleanPdfText(card.helper) || "-" : undefined;
      const col = index % columns;
      const row = Math.floor(index / columns);
      const x = marginX + col * (cardWidth + gap);
      const y = cursorY + row * (cardHeight + 8);
      const commands = currentCommands();
      drawRect(commands, x, y, cardWidth, cardHeight, 0.96);
      drawText(commands, x + 7, y + 11, label, 7.5, "F1", textSecondaryGray);
      drawText(commands, x + 7, y + 23, value, 10.5, "F2", textPrimaryGray);
      if (helper) drawText(commands, x + 7, y + 31, helper, 6.6, "F1", textMutedGray);
    });

    cursorY += Math.ceil(cards.length / columns) * (cardHeight + 8) + 2;
  };

  const drawTableHeader = () => {
    ensureSpace(24);
    const commands = currentCommands();
    let x = marginX;
    drawRect(commands, marginX, cursorY, contentWidth, 18, 0.90, 0.75);
    for (const column of tableColumns) {
      drawText(commands, alignedTextX(x, column.width, column.label, 7, column.align ?? "left"), cursorY + 12, column.label, 7, "F2", textSecondaryGray);
      drawVerticalLine(commands, x, cursorY, 18);
      x += column.width;
    }
    drawVerticalLine(commands, marginX + contentWidth, cursorY, 18);
    cursorY += 18;
  };

  const drawSupplierHeader = (group: SupplierGroup, isActive = true) => {
    const supplierLines = wrapText(group.supplierName, 320, 10, 2);
    const rightSummary = isActive
      ? [
          `Subtotal pendente: ${formatCurrency(group.pending)}`,
          `A vencer: ${formatCurrency(group.open)}`,
          `Vencido: ${formatCurrency(group.overdue)}`,
          `Pago no periodo: ${formatCurrency(group.paidInPeriod)}`
        ]
      : [
          `Total cancelado: ${formatCurrency(group.total)}`,
          `${group.allRows.length} titulo(s)`
        ];
    const headerHeight = Math.max(38, supplierLines.length * 10 + 10);
    ensureSpace(headerHeight + 8);
    const commands = currentCommands();
    drawRect(commands, marginX, cursorY, contentWidth, headerHeight, isActive ? 0.93 : 0.97, 0.75);
    supplierLines.forEach((line, index) => drawText(commands, marginX + 8, cursorY + 14 + index * 10, line, 10, "F2", isActive ? textPrimaryGray : 0.50));
    rightSummary.forEach((line, index) => drawText(commands, pageWidth - marginX - 170, cursorY + 12 + index * 8, line, 6.8, index === 0 ? "F2" : "F1", index === 0 ? (isActive ? textPrimaryGray : 0.50) : textSecondaryGray));
    cursorY += headerHeight;
  };

  const drawNfSubHeader = (nfGroup: NfSubGroup) => {
    const h = 14;
    ensureSpace(h + 4);
    const commands = currentCommands();
    drawRect(commands, marginX, cursorY, contentWidth, h, 0.965, 0.85);
    const label = `NF ${nfGroup.invoiceNumber}${hasPurchaseNumbers && nfGroup.purchaseNumber !== "-" ? `  |  Pedido ${nfGroup.purchaseNumber}` : ""}  |  Compra ${nfGroup.purchaseDate}  |  ${nfGroup.rows.length} parcela(s)`;
    drawText(commands, marginX + 10, cursorY + 10, label, 6.8, "F1", textSecondaryGray);
    drawText(commands, pageWidth - marginX - 160, cursorY + 10, `Total NF: ${formatCurrency(nfGroup.nfTotal)}`, 6.8, "F2", textPrimaryGray);
    cursorY += h;
  };

  const drawDetailRow = (row: EnrichedRow, suppressNfCols: boolean) => {
    const fontSize = 7.2;
    const lineHeight = 9;
    const rowLines = tableColumns.map((column) => {
      // Suppress NF-identifying columns in installment rows (they're in the NF sub-header)
      if (suppressNfCols && (column.key === "purchaseNumber" || column.key === "invoiceNumber" || column.key === "purchaseDate")) {
        return [""];
      }
      const value = row[`${column.key}Label` as keyof typeof row] ?? "-";
      return wrapText(value, column.width - 8, fontSize, column.maxLines ?? (column.key === "notes" ? 2 : 1));
    });
    const height = Math.max(...rowLines.map((lines) => lines.length)) * lineHeight + 8;
    ensureSpace(height + 2);
    const commands = currentCommands();
    const rowFill = row.duplicateFlag ? 0.99 : undefined;
    drawRect(commands, marginX, cursorY, contentWidth, height, rowFill, 0.88);

    let x = marginX;
    rowLines.forEach((lines, index) => {
      const column = tableColumns[index];
      lines.forEach((line, lineIndex) => {
        if (!line) return;
        const gray = (column.key === "status" && row.status === "OVERDUE") ? 0.55
          : row.duplicateFlag && column.key === "notes" ? 0.55
          : textPrimaryGray;
        drawText(commands, alignedTextX(x, column.width, line, fontSize, column.align ?? "left"), cursorY + 12 + lineIndex * lineHeight, line, fontSize, "F1", gray);
      });
      drawVerticalLine(commands, x, cursorY, height, 0.92);
      x += column.width;
    });
    drawVerticalLine(commands, marginX + contentWidth, cursorY, height, 0.92);
    cursorY += height;
  };

  // ── Page 1 ──────────────────────────────────────────────────────────────────

  drawPageHeader(true);

  drawCardGrid("Resumo executivo", [
    { label: "Total do relatorio", value: formatCurrency(totals.overall), helper: `${activeRows.length} titulos ativos` },
    { label: "Em aberto", value: formatCurrency(totals.open) },
    { label: "Vencido", value: formatCurrency(totals.overdue) },
    { label: "Pago no periodo", value: formatCurrency(totals.paid) },
    { label: "Proximos 1-7 dias", value: formatCurrency(totals.next1to7), helper: "faixa exclusiva" },
    { label: "Proximos 8-30 dias", value: formatCurrency(totals.next8to30), helper: "faixa exclusiva" }
  ], 3);

  drawCardGrid("Aging de vencidos", aging.map((bucket) => ({
    label: bucket.label,
    value: formatCurrency(bucket.value),
    helper: `${bucket.count} titulo(s)`
  })), 4);

  const rankingCards = ranking.map((item, index) => {
    const urgencyPct = item.pending > 0 ? Math.round((item.overdue / item.pending) * 100) : 0;
    const urgencyBadge = item.overdue > 0 && item.open === 0
      ? "(100% VENCIDO)"
      : item.overdue > 0
        ? `(${urgencyPct}% VENCIDO)`
        : "(EM DIA)";
    const label = groups.length > 1
      ? `${index + 1}. ${cleanPdfText(item.supplierName)} ${urgencyBadge}`
      : `${cleanPdfText(item.supplierName)} ${urgencyBadge}`;
    return {
      label,
      value: formatCurrency(item.pending),
      helper: `${item.allRows.length} titulo(s) | a vencer ${formatCurrency(item.open)} | vencido ${formatCurrency(item.overdue)}`
    };
  });

  drawCardGrid(groups.length > 1 ? "Ranking por fornecedor (urgencia)" : "Resumo do fornecedor", rankingCards, 2);

  // ── Detail section ──────────────────────────────────────────────────────────

  ensureSpace(18);
  drawText(currentCommands(), marginX, cursorY, "Detalhamento por fornecedor", 11, "F2", textPrimaryGray);
  cursorY += 16;
  drawTableHeader();

  for (const group of groups) {
    drawSupplierHeader(group, true);
    if (cursorY + 12 > pageHeight - marginBottom) {
      newPage();
      drawPageHeader(false);
      drawTableHeader();
      drawSupplierHeader(group, true);
    }

    for (const nfGroup of group.nfGroups) {
      // NF sub-header
      drawNfSubHeader(nfGroup);

      for (const row of nfGroup.rows) {
        if (cursorY + 24 > pageHeight - marginBottom) {
          newPage();
          drawPageHeader(false);
          drawTableHeader();
          drawSupplierHeader(group, true);
          drawNfSubHeader(nfGroup);
        }
        drawDetailRow(row, true);
      }
    }
    cursorY += 6;
  }

  // ── Cancelled section ───────────────────────────────────────────────────────

  if (cancelledGroups.length > 0) {
    ensureSpace(28);
    drawText(currentCommands(), marginX, cursorY, `Titulos cancelados (${cancelledRows.length})`, 11, "F2", 0.50);
    cursorY += 16;
    drawTableHeader();

    for (const group of cancelledGroups) {
      drawSupplierHeader(group, false);
      if (cursorY + 12 > pageHeight - marginBottom) {
        newPage();
        drawPageHeader(false);
        drawTableHeader();
        drawSupplierHeader(group, false);
      }

      for (const nfGroup of group.nfGroups) {
        drawNfSubHeader(nfGroup);
        for (const row of nfGroup.rows) {
          if (cursorY + 24 > pageHeight - marginBottom) {
            newPage();
            drawPageHeader(false);
            drawTableHeader();
            drawSupplierHeader(group, false);
            drawNfSubHeader(nfGroup);
          }
          drawDetailRow(row, true);
        }
      }
      cursorY += 6;
    }
  }

  // ── Build PDF binary ────────────────────────────────────────────────────────

  const objects: string[] = [];
  const addObject = (content: string) => {
    objects.push(content);
    return objects.length;
  };

  const fontRegular = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const fontBold = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const pageObjectIds: number[] = [];
  const contentObjectIds: number[] = [];

  pages.forEach((commands) => {
    const stream = commands.join("\n");
    const contentObject = addObject(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    contentObjectIds.push(contentObject);
    pageObjectIds.push(0);
  });

  const pagesObjectId = objects.length + pages.length + 1;
  for (let index = 0; index < pages.length; index += 1) {
    const pageObject = addObject(
      `<< /Type /Page /Parent ${pagesObjectId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentObjectIds[index]} 0 R >>`
    );
    pageObjectIds[index] = pageObject;
  }

  const pagesObject = addObject(`<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`);
  const catalogObject = addObject(`<< /Type /Catalog /Pages ${pagesObject} 0 R >>`);

  const chunks = ["%PDF-1.4\n"];
  const offsets: number[] = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(chunks.join(""), "latin1"));
    chunks.push(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`);
  }
  const xrefOffset = Buffer.byteLength(chunks.join(""), "latin1");
  chunks.push(`xref\n0 ${objects.length + 1}\n`);
  chunks.push("0000000000 65535 f \n");
  for (let index = 1; index < offsets.length; index += 1) {
    chunks.push(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`);
  }
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogObject} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return Buffer.from(chunks.join(""), "latin1");
}
