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
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, Math.max(0, max - 3)).trimEnd()}...`;
  }
  return lines;
}

function formatCurrency(value: unknown) {
  return Number(value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateValue(value: unknown) {
  if (!value) return "-";
  return new Date(String(value)).toLocaleDateString("pt-BR");
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

function openUntil(rows: PayablesFinancialPdfRow[], today: Date, limit: Date) {
  return rows
    .filter((row) => ["OPEN", "OVERDUE"].includes(String(row.status ?? "")))
    .filter((row) => row.dueDate)
    .reduce((sum, row) => {
      const dueDate = localDateOnly(new Date(String(row.dueDate)));
      return dueDate >= today && dueDate <= limit ? sum + Number(row.amount ?? 0) : sum;
    }, 0);
}

function bucketAging(rows: PayablesFinancialPdfRow[], today: Date) {
  const buckets = [
    { label: "Vencido 1-7", min: 1, max: 7, value: 0, count: 0 },
    { label: "Vencido 8-15", min: 8, max: 15, value: 0, count: 0 },
    { label: "Vencido 16-30", min: 16, max: 30, value: 0, count: 0 },
    { label: "Vencido 31+", min: 31, max: Number.POSITIVE_INFINITY, value: 0, count: 0 }
  ];

  for (const row of rows) {
    if (String(row.status ?? "") !== "OVERDUE" || !row.dueDate) continue;
    const dueDate = localDateOnly(new Date(String(row.dueDate)));
    const diffDays = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
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

function buildSupplierGroups(rows: PayablesFinancialPdfRow[]) {
  const groups = new Map<string, {
    supplierName: string;
    rows: Array<PayablesFinancialPdfRow & {
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
    }>;
    total: number;
    pending: number;
    open: number;
    overdue: number;
    paidInPeriod: number;
  }>();

  for (const row of rows) {
    const supplierName = cleanPdfText(row.supplierName || "-") || "-";
    const current = groups.get(supplierName) ?? {
      supplierName,
      rows: [],
      total: 0,
      pending: 0,
      open: 0,
      overdue: 0,
      paidInPeriod: 0
    };

    const amount = Number(row.amount ?? 0);
    const paidAmount = Number(row.paidAmount ?? 0);
    current.total += amount;
    if (isPendingStatus(row.status)) current.pending += amount;
    if (String(row.status ?? "") === "OPEN") current.open += amount;
    if (String(row.status ?? "") === "OVERDUE") current.overdue += amount;
    current.rows.push({
      ...row,
      purchaseNumberLabel: cleanPdfText(row.purchaseNumber || "-") || "-",
      invoiceNumberLabel: cleanPdfText(row.invoiceNumber || "-") || "-",
      purchaseDateLabel: formatDateValue(row.purchaseDate),
      dueDateLabel: formatDateValue(row.dueDate),
      installmentLabel: cleanPdfText(row.installment || "-") || "-",
      amountLabel: formatCurrency(row.amount),
      paidAmountLabel: row.paidAmount != null ? formatCurrency(row.paidAmount) : "-",
      paymentMethodNameLabel: cleanPdfText(row.paymentMethodName || "-") || "-",
      statusLabel: statusLabels[String(row.status ?? "")] ?? (cleanPdfText(row.status || "-") || "-"),
      notesLabel: cleanPdfText(row.paymentNotes || row.notes || "-") || "-"
    });
    groups.set(supplierName, current);
  }

  return Array.from(groups.values()).sort((a, b) => a.supplierName.localeCompare(b.supplierName, "pt-BR"));
}

function buildTableColumns(includePaidColumn: boolean): TableColumn[] {
  const base: TableColumn[] = [
    { key: "purchaseNumber", label: "Pedido", width: 84, align: "left", maxLines: 1 },
    { key: "invoiceNumber", label: "NF", width: 66, align: "left", maxLines: 1 },
    { key: "purchaseDate", label: "Compra", width: 52, align: "center", maxLines: 1 },
    { key: "dueDate", label: "Venc.", width: 52, align: "center", maxLines: 1 },
    { key: "installment", label: "Parc.", width: 42, align: "center", maxLines: 1 },
    { key: "amount", label: "Valor", width: 72, align: "right", maxLines: 1 }
  ];

  if (includePaidColumn) {
    base.push({ key: "paidAmount", label: "Pago", width: 72, align: "right", maxLines: 1 });
  }

  base.push(
    { key: "paymentMethodName", label: "Forma", width: includePaidColumn ? 98 : 118, align: "left", maxLines: 1 },
    { key: "status", label: "Status", width: 68, align: "center", maxLines: 1 },
    { key: "notes", label: "Observacoes", width: includePaidColumn ? 188 : 214, align: "left", maxLines: 2 }
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
  const rows = [...input.rows].sort((a, b) => {
    const supplierCompare = cleanPdfText(a.supplierName).localeCompare(cleanPdfText(b.supplierName), "pt-BR");
    if (supplierCompare !== 0) return supplierCompare;
    return String(a.dueDate ?? "").localeCompare(String(b.dueDate ?? ""));
  });

  const today = localDateOnly(input.today ?? new Date());
  const includePaidColumn = rows.some((row) => isPaidStatus(row.status) || row.paidAmount != null || row.paidDate != null);
  const tableColumns = buildTableColumns(includePaidColumn);
  const hasSpecificSupplier = cleanPdfText(input.supplierLabel).toLowerCase() !== "todos";
  const reportTitle = hasSpecificSupplier ? "Financeiro - Posicao de Fornecedor" : "Financeiro - Posicao de Fornecedores";
  const next7 = localDateOnly(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7));
  const next30 = localDateOnly(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 30));
  const totals = {
    open: amountSum(rows, ["OPEN"]),
    overdue: amountSum(rows, ["OVERDUE"]),
    paid: amountSum(rows, ["PAID", "PAID_LATE"], true),
    next7: openUntil(rows, today, next7),
    next30: openUntil(rows, today, next30),
    overall: rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
  };
  const aging = bucketAging(rows, today);
  const groups = buildSupplierGroups(rows);
  groups.forEach((group) => {
    group.paidInPeriod = group.rows
      .filter((row) => isPaidStatus(row.status) && inPeriod(row.paidDate, input.periodStart, input.periodEnd))
      .reduce((sum, row) => sum + Number(row.paidAmount ?? row.amount ?? 0), 0);
  });
  const ranking = [...groups]
    .sort((a, b) => b.pending - a.pending || b.total - a.total)
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
      drawText(commands, marginX, cursorY + 2, `Titulos listados: ${rows.length}`, 8, "F1");
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

  const drawSupplierHeader = (group: ReturnType<typeof buildSupplierGroups>[number]) => {
    const supplierLines = wrapText(group.supplierName, 320, 10, 2);
    const rightSummary = [
      `Subtotal pendente: ${formatCurrency(group.pending)}`,
      `A vencer: ${formatCurrency(group.open)}`,
      `Vencido: ${formatCurrency(group.overdue)}`,
      `Pago no periodo: ${formatCurrency(group.paidInPeriod)}`
    ];
    const headerHeight = Math.max(38, supplierLines.length * 10 + 10);
    ensureSpace(headerHeight + 8);
    const commands = currentCommands();
    drawRect(commands, marginX, cursorY, contentWidth, headerHeight, 0.93, 0.75);
    supplierLines.forEach((line, index) => drawText(commands, marginX + 8, cursorY + 14 + index * 10, line, 10, "F2", textPrimaryGray));
    rightSummary.forEach((line, index) => drawText(commands, pageWidth - marginX - 170, cursorY + 12 + index * 8, line, 6.8, index === 0 ? "F2" : "F1", index === 0 ? textPrimaryGray : textSecondaryGray));
    cursorY += headerHeight;
  };

  const drawDetailRow = (row: ReturnType<typeof buildSupplierGroups>[number]["rows"][number]) => {
    const fontSize = 7.2;
    const lineHeight = 9;
    const rowLines = tableColumns.map((column) => {
      const value = row[`${column.key}Label` as keyof typeof row] ?? "-";
      return wrapText(value, column.width - 8, fontSize, column.maxLines ?? (column.key === "notes" ? 2 : 1));
    });
    const height = Math.max(...rowLines.map((lines) => lines.length)) * lineHeight + 8;
    ensureSpace(height + 2);
    const commands = currentCommands();
    drawRect(commands, marginX, cursorY, contentWidth, height, undefined, 0.88);

    let x = marginX;
    rowLines.forEach((lines, index) => {
      const column = tableColumns[index];
      lines.forEach((line, lineIndex) => {
        drawText(commands, alignedTextX(x, column.width, line, fontSize, column.align ?? "left"), cursorY + 12 + lineIndex * lineHeight, line, fontSize, "F1", textPrimaryGray);
      });
      drawVerticalLine(commands, x, cursorY, height, 0.92);
      x += column.width;
    });
    drawVerticalLine(commands, marginX + contentWidth, cursorY, height, 0.92);
    cursorY += height;
  };

  drawPageHeader(true);
  drawCardGrid("Resumo executivo", [
    { label: "Total do relatorio", value: formatCurrency(totals.overall), helper: `${rows.length} titulos` },
    { label: "Em aberto", value: formatCurrency(totals.open) },
    { label: "Vencido", value: formatCurrency(totals.overdue) },
    { label: "Pago no periodo", value: formatCurrency(totals.paid) },
    { label: "Proximos 7 dias", value: formatCurrency(totals.next7) },
    { label: "Proximos 30 dias", value: formatCurrency(totals.next30) }
  ], 3);

  drawCardGrid("Aging de vencidos", aging.map((bucket) => ({
    label: bucket.label,
    value: formatCurrency(bucket.value),
    helper: `${bucket.count} titulo(s)`
  })), 4);

  drawCardGrid(groups.length > 1 ? "Ranking por fornecedor" : "Resumo do fornecedor", ranking.map((item, index) => ({
    label: groups.length > 1 ? `${index + 1}. ${cleanPdfText(item.supplierName)}` : cleanPdfText(item.supplierName) || "-",
    value: formatCurrency(item.pending),
    helper: `${item.rows.length} titulo(s) | a vencer ${formatCurrency(item.open)} | vencido ${formatCurrency(item.overdue)}`
  })), 2);

  ensureSpace(18);
  drawText(currentCommands(), marginX, cursorY, "Detalhamento por fornecedor", 11, "F2", textPrimaryGray);
  cursorY += 16;
  drawTableHeader();

  for (const group of groups) {
    drawSupplierHeader(group);
    if (cursorY + 12 > pageHeight - marginBottom) {
      newPage();
      drawPageHeader(false);
      drawTableHeader();
      drawSupplierHeader(group);
    }
    for (const row of group.rows) {
      if (cursorY + 24 > pageHeight - marginBottom) {
        newPage();
        drawPageHeader(false);
        drawTableHeader();
        drawSupplierHeader(group);
      }
      drawDetailRow(row);
    }
    cursorY += 6;
  }

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
