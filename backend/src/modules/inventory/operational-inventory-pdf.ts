type InventoryPdfStatus = "PENDENTE" | "CONTADO" | "ZERO" | "DIVERGENTE" | "IGNORADO";

type InventoryPdfItem = {
  productCode: string | null;
  productName: string;
  sectorName: string | null;
  categoryName: string | null;
  subcategoryName: string | null;
  unit: string | null;
  countedQuantity: number | null;
  differenceQuantity: number | null;
  status: InventoryPdfStatus;
  notes: string | null;
};

type CreateOperationalInventoryPdfParams = {
  systemName: string;
  inventoryCode: string;
  inventoryName: string;
  inventoryTypeLabel: string;
  inventoryStatusLabel: string;
  inventoryDateLabel: string;
  responsibleName: string;
  approverName?: string | null;
  reviewerName?: string | null;
  closedByName?: string | null;
  generatedAtLabel: string;
  notes?: string | null;
  cancelReason?: string | null;
  rejectionReason?: string | null;
  snapshotTotalLabel?: string | null;
  totals: {
    totalItems: number;
    countedItems: number;
    pendingItems: number;
    divergentItems: number;
    zeroItems: number;
  };
  items: InventoryPdfItem[];
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 34;
const MARGIN_TOP = 36;
const MARGIN_BOTTOM = 28;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

const FONT_REGULAR = "F1";
const FONT_BOLD = "F2";
const FONT_ITALIC = "F3";

type FontName = typeof FONT_REGULAR | typeof FONT_BOLD | typeof FONT_ITALIC;

type PdfPage = {
  commands: string[];
};

function removeDiacritics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizedSortText(value: unknown, fallback = "") {
  const text = String(value ?? fallback).trim();
  if (!text) return removeDiacritics(fallback).toLocaleLowerCase("pt-BR");
  return removeDiacritics(text).toLocaleLowerCase("pt-BR");
}

function displayLabel(value: unknown, fallback: string) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  return text;
}

function cleanPdfText(value: unknown) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapePdfText(value: unknown) {
  const text = cleanPdfText(value);
  const bytes = Buffer.from(text, "latin1");
  let escaped = "";
  bytes.forEach((byte) => {
    if (byte === 0x5c) escaped += "\\\\";
    else if (byte === 0x28) escaped += "\\(";
    else if (byte === 0x29) escaped += "\\)";
    else if (byte >= 0x20 && byte <= 0x7e) escaped += String.fromCharCode(byte);
    else escaped += `\\${byte.toString(8).padStart(3, "0")}`;
  });
  return escaped;
}

function formatQuantity(value: number | null) {
  if (value == null) return "-";
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

function estimateTextWidth(text: string, fontSize: number, font: FontName) {
  const factor = font === FONT_BOLD ? 0.56 : 0.52;
  return cleanPdfText(text).length * fontSize * factor;
}

function wrapText(value: unknown, maxWidth: number, fontSize: number, font: FontName) {
  const text = cleanPdfText(value);
  if (!text) return [""];
  if (estimateTextWidth(text, fontSize, font) <= maxWidth) return [text];

  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (estimateTextWidth(next, fontSize, font) > maxWidth && current) {
      lines.push(current);
      current = word;
      continue;
    }
    current = next;
  }
  if (current) lines.push(current);
  return lines;
}

function pdfColor(r: number, g: number, b: number) {
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`;
}

class PdfCanvas {
  pages: PdfPage[] = [{ commands: [] }];

  get currentPage() {
    return this.pages[this.pages.length - 1];
  }

  addPage() {
    this.pages.push({ commands: [] });
  }

  text(text: string, x: number, y: number, options?: { size?: number; font?: FontName; color?: [number, number, number] }) {
    const size = options?.size ?? 10;
    const font = options?.font ?? FONT_REGULAR;
    const color = options?.color ?? [0.12, 0.12, 0.12];
    this.currentPage.commands.push("BT");
    this.currentPage.commands.push(`/${font} ${size} Tf`);
    this.currentPage.commands.push(`${pdfColor(color[0], color[1], color[2])} rg`);
    this.currentPage.commands.push(`${x.toFixed(2)} ${y.toFixed(2)} Td`);
    this.currentPage.commands.push(`(${escapePdfText(text)}) Tj`);
    this.currentPage.commands.push("ET");
  }

  line(x1: number, y1: number, x2: number, y2: number, options?: { width?: number; color?: [number, number, number] }) {
    const width = options?.width ?? 1;
    const color = options?.color ?? [0.82, 0.84, 0.88];
    this.currentPage.commands.push("q");
    this.currentPage.commands.push(`${width.toFixed(2)} w`);
    this.currentPage.commands.push(`${pdfColor(color[0], color[1], color[2])} RG`);
    this.currentPage.commands.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m`);
    this.currentPage.commands.push(`${x2.toFixed(2)} ${y2.toFixed(2)} l`);
    this.currentPage.commands.push("S");
    this.currentPage.commands.push("Q");
  }

  rect(x: number, y: number, width: number, height: number, options?: { fill?: [number, number, number]; stroke?: [number, number, number]; lineWidth?: number }) {
    const fill = options?.fill;
    const stroke = options?.stroke;
    const lineWidth = options?.lineWidth ?? 1;
    this.currentPage.commands.push("q");
    if (fill) this.currentPage.commands.push(`${pdfColor(fill[0], fill[1], fill[2])} rg`);
    if (stroke) {
      this.currentPage.commands.push(`${pdfColor(stroke[0], stroke[1], stroke[2])} RG`);
      this.currentPage.commands.push(`${lineWidth.toFixed(2)} w`);
    }
    this.currentPage.commands.push(`${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re`);
    this.currentPage.commands.push(fill && stroke ? "B" : fill ? "f" : "S");
    this.currentPage.commands.push("Q");
  }
}

function buildInventoryHeaderLines(params: CreateOperationalInventoryPdfParams) {
  return [
    { label: "C\u00f3digo", value: params.inventoryCode },
    { label: "Data", value: params.inventoryDateLabel },
    { label: "Tipo", value: params.inventoryTypeLabel },
    { label: "Status", value: params.inventoryStatusLabel },
    { label: "Respons\u00e1vel", value: params.responsibleName || "-" },
    { label: "Aprovador", value: params.approverName || params.reviewerName || "-" },
    { label: "Fechado por", value: params.closedByName || "-" },
    { label: "Gerado em", value: params.generatedAtLabel }
  ];
}

function sortInventoryItems(items: InventoryPdfItem[]) {
  return [...items].sort((a, b) => {
    const valuesA = [
      normalizedSortText(a.sectorName, "zzzz_sem_setor"),
      normalizedSortText(a.categoryName, "zzzz_sem_categoria"),
      normalizedSortText(a.subcategoryName, "zzzz_sem_subcategoria"),
      normalizedSortText(a.productName),
      normalizedSortText(a.productCode, "zzzz_sem_codigo")
    ];
    const valuesB = [
      normalizedSortText(b.sectorName, "zzzz_sem_setor"),
      normalizedSortText(b.categoryName, "zzzz_sem_categoria"),
      normalizedSortText(b.subcategoryName, "zzzz_sem_subcategoria"),
      normalizedSortText(b.productName),
      normalizedSortText(b.productCode, "zzzz_sem_codigo")
    ];
    for (let index = 0; index < valuesA.length; index += 1) {
      const diff = valuesA[index].localeCompare(valuesB[index], "pt-BR");
      if (diff !== 0) return diff;
    }
    return 0;
  });
}

function groupedItems(items: InventoryPdfItem[]) {
  const rows: Array<
    | { kind: "sector"; label: string }
    | { kind: "category"; label: string }
    | { kind: "subcategory"; label: string }
    | { kind: "item"; item: InventoryPdfItem }
  > = [];

  let currentSector = "";
  let currentCategory = "";
  let currentSubcategory = "";
  sortInventoryItems(items).forEach((item) => {
    const sector = cleanPdfText(item.sectorName || "SEM SETOR - PEND\u00caNCIA DE CADASTRO");
    const category = cleanPdfText(displayLabel(item.categoryName, "Sem categoria"));
    const subcategory = cleanPdfText(displayLabel(item.subcategoryName, "Sem subcategoria"));
    if (sector !== currentSector) {
      rows.push({ kind: "sector", label: sector });
      currentSector = sector;
      currentCategory = "";
      currentSubcategory = "";
    }
    if (category !== currentCategory) {
      rows.push({ kind: "category", label: category });
      currentCategory = category;
      currentSubcategory = "";
    }
    if (subcategory !== currentSubcategory) {
      rows.push({ kind: "subcategory", label: subcategory });
      currentSubcategory = subcategory;
    }
    rows.push({ kind: "item", item });
  });

  return rows;
}

function drawPageHeader(canvas: PdfCanvas, params: CreateOperationalInventoryPdfParams, pageNumber: number, pageCount: number) {
  const topY = PAGE_HEIGHT - MARGIN_TOP;
  canvas.text(params.systemName, MARGIN_X, topY, { size: 17, font: FONT_BOLD, color: [0.13, 0.13, 0.14] });
  canvas.text("Relat\u00f3rio de invent\u00e1rio oficial", MARGIN_X, topY - 18, { size: 9, font: FONT_ITALIC, color: [0.37, 0.39, 0.43] });
  canvas.text(params.inventoryCode, PAGE_WIDTH - MARGIN_X - estimateTextWidth(params.inventoryCode, 16, FONT_BOLD), topY, {
    size: 16,
    font: FONT_BOLD,
    color: [0.16, 0.17, 0.19]
  });
  canvas.text(`P\u00e1gina ${pageNumber} de ${pageCount}`, PAGE_WIDTH - MARGIN_X - 58, MARGIN_BOTTOM - 2, {
    size: 8,
    color: [0.45, 0.46, 0.5]
  });
  canvas.line(MARGIN_X, topY - 28, PAGE_WIDTH - MARGIN_X, topY - 28, { color: [0.82, 0.84, 0.88] });
}

function drawSummaryCard(canvas: PdfCanvas, x: number, y: number, width: number, height: number, label: string, value: string, tone: "neutral" | "success" | "warning" | "danger" | "info" = "neutral") {
  const palette = {
    neutral: { fill: [0.97, 0.97, 0.98] as [number, number, number], text: [0.17, 0.18, 0.2] as [number, number, number] },
    success: { fill: [0.92, 0.97, 0.93] as [number, number, number], text: [0.16, 0.47, 0.22] as [number, number, number] },
    warning: { fill: [1, 0.97, 0.89] as [number, number, number], text: [0.62, 0.39, 0.08] as [number, number, number] },
    danger: { fill: [0.99, 0.92, 0.92] as [number, number, number], text: [0.71, 0.19, 0.16] as [number, number, number] },
    info: { fill: [0.92, 0.96, 1] as [number, number, number], text: [0.16, 0.38, 0.67] as [number, number, number] }
  }[tone];

  canvas.rect(x, y - height, width, height, { fill: palette.fill, stroke: [0.86, 0.88, 0.91], lineWidth: 0.7 });
  canvas.text(label, x + 10, y - 16, { size: 8, color: [0.39, 0.4, 0.43] });
  canvas.text(value, x + 10, y - 34, { size: 15, font: FONT_BOLD, color: palette.text });
}

export function createOperationalInventoryPdf(params: CreateOperationalInventoryPdfParams) {
  const canvas = new PdfCanvas();
  const sections = groupedItems(params.items);
  const pageCountEstimate = Math.max(1, Math.ceil((sections.length + 18) / 19));
  const headerFields = buildInventoryHeaderLines(params);
  const sectorLabels = [...new Set(params.items.map((item) => cleanPdfText(item.sectorName || "SEM SETOR - PEND\u00caNCIA DE CADASTRO")))];
  const itemsWithoutSector = params.items.filter((item) => !String(item.sectorName ?? "").trim()).length;
  const itemsWithoutCategory = params.items.filter((item) => !String(item.categoryName ?? "").trim()).length;
  const itemsWithoutSubcategory = params.items.filter((item) => !String(item.subcategoryName ?? "").trim()).length;

  const tableColumns = [
    { key: "code", label: "C\u00f3digo", width: 54 },
    { key: "product", label: "Produto", width: 242 },
    { key: "unit", label: "Un.", width: 36 },
    { key: "quantity", label: "Qtd.", width: 42 },
    { key: "status", label: "Status", width: 44 },
    { key: "notes", label: "Observa\u00e7\u00e3o / Diverg\u00eancia", width: 177 }
  ] as const;

  const drawTableHeader = (y: number) => {
    let x = MARGIN_X;
    const height = 20;
    canvas.rect(MARGIN_X, y - height, CONTENT_WIDTH, height, { fill: [0.16, 0.17, 0.2] });
    tableColumns.forEach((column) => {
      canvas.text(column.label, x + 4, y - 14, { size: 7.5, font: FONT_BOLD, color: [1, 1, 1] });
      x += column.width;
    });
    return y - height;
  };

  const startPage = (pageIndex: number) => {
    drawPageHeader(canvas, params, pageIndex + 1, pageCountEstimate);
    return PAGE_HEIGHT - MARGIN_TOP - 44;
  };

  let cursorY = startPage(0);

  canvas.text(params.inventoryName, MARGIN_X, cursorY, { size: 13, font: FONT_BOLD, color: [0.15, 0.16, 0.18] });
  cursorY -= 18;

  const fieldColumnWidth = (CONTENT_WIDTH - 16) / 2;
  headerFields.forEach((field, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = MARGIN_X + column * (fieldColumnWidth + 16);
    const y = cursorY - row * 22;
    canvas.text(`${field.label}:`, x, y, { size: 8, font: FONT_BOLD, color: [0.33, 0.35, 0.38] });
    canvas.text(field.value, x + 72, y, { size: 8.6, color: [0.12, 0.12, 0.14] });
  });
  cursorY -= 96;

  const summaryCardWidth = (CONTENT_WIDTH - 24) / 3;
  drawSummaryCard(canvas, MARGIN_X, cursorY, summaryCardWidth, 48, "Total de itens", String(params.totals.totalItems));
  drawSummaryCard(canvas, MARGIN_X + summaryCardWidth + 12, cursorY, summaryCardWidth, 48, "Contados", String(params.totals.countedItems), "success");
  drawSummaryCard(canvas, MARGIN_X + (summaryCardWidth + 12) * 2, cursorY, summaryCardWidth, 48, "Pendentes", String(params.totals.pendingItems), "warning");
  cursorY -= 58;
  drawSummaryCard(canvas, MARGIN_X, cursorY, summaryCardWidth, 48, "Divergentes", String(params.totals.divergentItems), "danger");
  drawSummaryCard(canvas, MARGIN_X + summaryCardWidth + 12, cursorY, summaryCardWidth, 48, "Zerados", String(params.totals.zeroItems), "info");
  drawSummaryCard(canvas, MARGIN_X + (summaryCardWidth + 12) * 2, cursorY, summaryCardWidth, 48, "Setores", String(sectorLabels.length));
  cursorY -= 60;

  canvas.text(`Setores envolvidos: ${sectorLabels.join(", ") || "-"}`, MARGIN_X, cursorY, { size: 8.4, color: [0.33, 0.35, 0.38] });
  cursorY -= 16;
  canvas.text(`Itens sem setor: ${itemsWithoutSector} | sem categoria: ${itemsWithoutCategory} | sem subcategoria: ${itemsWithoutSubcategory}`, MARGIN_X, cursorY, {
    size: 8.4,
    color: itemsWithoutSector || itemsWithoutCategory || itemsWithoutSubcategory ? [0.62, 0.39, 0.08] : [0.33, 0.35, 0.38]
  });
  cursorY -= 16;

  if (params.snapshotTotalLabel) {
    canvas.text(`Valor do snapshot: ${params.snapshotTotalLabel}`, MARGIN_X, cursorY, { size: 8.4, color: [0.33, 0.35, 0.38] });
    cursorY -= 14;
  }

  [params.notes ? `Observa\u00e7\u00f5es: ${params.notes}` : "", params.cancelReason ? `Motivo do cancelamento: ${params.cancelReason}` : "", params.rejectionReason ? `Motivo da rejei\u00e7\u00e3o: ${params.rejectionReason}` : ""]
    .filter(Boolean)
    .forEach((line) => {
      wrapText(line, CONTENT_WIDTH, 8.4, FONT_REGULAR).forEach((wrapped) => {
        canvas.text(wrapped, MARGIN_X, cursorY, { size: 8.4, color: [0.33, 0.35, 0.38] });
        cursorY -= 12;
      });
    });

  cursorY -= 8;
  cursorY = drawTableHeader(cursorY);

  const minContentY = MARGIN_BOTTOM + 24;

  const ensureSpace = (neededHeight: number) => {
    if (cursorY - neededHeight >= minContentY) return;
    canvas.addPage();
    cursorY = startPage(canvas.pages.length - 1);
    cursorY = drawTableHeader(cursorY);
  };

  const drawGroupRow = (label: string, tone: "sector" | "category" | "subcategory", keepWithNext = 0) => {
    const height = tone === "sector" ? 18 : tone === "category" ? 16 : 14;
    ensureSpace(height + 4 + keepWithNext);
    canvas.rect(MARGIN_X, cursorY - height, CONTENT_WIDTH, height, {
      fill:
        tone === "sector"
          ? label.includes("PEND\u00caNCIA")
            ? [1, 0.94, 0.9]
            : [0.93, 0.94, 0.96]
          : tone === "category"
            ? [0.98, 0.98, 0.99]
            : [0.995, 0.995, 0.997],
      stroke: [0.88, 0.89, 0.92],
      lineWidth: 0.6
    });
    canvas.text(label, MARGIN_X + 6, cursorY - (tone === "sector" ? 12 : 11), {
      size: tone === "sector" ? 9 : 8,
      font: FONT_BOLD,
      color: tone === "sector" && label.includes("PEND\u00caNCIA") ? [0.71, 0.19, 0.16] : [0.24, 0.25, 0.28]
    });
    cursorY -= height;
  };

  sections.forEach((entry, index) => {
    const nextEntry = sections[index + 1];
    const keepWithNext = nextEntry?.kind === "item" ? 28 : 18;
    if (entry.kind === "sector") {
      drawGroupRow(`SETOR: ${entry.label}`, "sector", keepWithNext);
      return;
    }
    if (entry.kind === "category") {
      drawGroupRow(`Categoria: ${entry.label}`, "category", keepWithNext);
      return;
    }
    if (entry.kind === "subcategory") {
      drawGroupRow(`Subcategoria: ${entry.label}`, "subcategory", keepWithNext);
      return;
    }

    const item = entry.item;
    const note = item.notes || (item.differenceQuantity != null && item.differenceQuantity !== 0 ? `Diferen\u00e7a ${formatQuantity(item.differenceQuantity)}` : "-");

    const cellValues = {
      code: cleanPdfText(item.productCode || "-"),
      product: cleanPdfText(item.productName),
      unit: cleanPdfText(item.unit || "-"),
      quantity: cleanPdfText(formatQuantity(item.countedQuantity)),
      status: cleanPdfText(item.status),
      notes: cleanPdfText(note)
    };

    const wrappedCells = {
      code: wrapText(cellValues.code, tableColumns[0].width - 8, 7.5, FONT_REGULAR),
      product: wrapText(cellValues.product, tableColumns[1].width - 8, 7.5, FONT_BOLD),
      unit: wrapText(cellValues.unit, tableColumns[2].width - 8, 7.3, FONT_REGULAR),
      quantity: wrapText(cellValues.quantity, tableColumns[3].width - 8, 7.3, FONT_BOLD),
      status: wrapText(cellValues.status, tableColumns[4].width - 8, 6.9, FONT_BOLD),
      notes: wrapText(cellValues.notes, tableColumns[5].width - 8, 7.1, FONT_REGULAR)
    };

    const lineCount = Math.max(
      wrappedCells.code.length,
      wrappedCells.product.length,
      wrappedCells.unit.length,
      wrappedCells.quantity.length,
      wrappedCells.status.length,
      wrappedCells.notes.length
    );
    const rowHeight = Math.max(18, lineCount * 10 + 6);
    ensureSpace(rowHeight + 1);

    const rowFill: [number, number, number] =
      item.status === "DIVERGENTE" ? [0.99, 0.93, 0.93] :
      item.status === "PENDENTE" ? [1, 0.97, 0.9] :
      item.status === "ZERO" ? [0.92, 0.96, 1] :
      [0.96, 0.99, 0.96];
    canvas.rect(MARGIN_X, cursorY - rowHeight, CONTENT_WIDTH, rowHeight, { fill: rowFill, stroke: [0.9, 0.91, 0.93], lineWidth: 0.45 });

    let x = MARGIN_X;
    tableColumns.forEach((column, index) => {
      if (index > 0) {
        canvas.line(x, cursorY, x, cursorY - rowHeight, { width: 0.35, color: [0.9, 0.91, 0.93] });
      }
      const key = column.key;
      const lines = wrappedCells[key];
      lines.forEach((line, lineIndex) => {
        canvas.text(line, x + 4, cursorY - 11 - lineIndex * 9, {
          size: key === "product" ? 7.5 : 7.1,
          font: key === "product" || key === "quantity" || key === "status" ? FONT_BOLD : FONT_REGULAR,
          color: [0.12, 0.12, 0.14]
        });
      });
      x += column.width;
    });

    cursorY -= rowHeight;
  });

  const objects: string[] = [];
  const addObject = (content: string) => {
    objects.push(content);
    return objects.length;
  };

  const regularFont = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const boldFont = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const italicFont = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>");

  const contentIds: number[] = [];
  const pageIds: number[] = [];
  canvas.pages.forEach((page) => {
    const stream = page.commands.join("\n");
    const contentId = addObject(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    contentIds.push(contentId);
    pageIds.push(0);
  });

  const pagesObjectId = objects.length + canvas.pages.length + 1;
  canvas.pages.forEach((_page, index) => {
    const pageId = addObject(
      `<< /Type /Page /Parent ${pagesObjectId} 0 R /MediaBox [0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(2)}] /Resources << /Font << /${FONT_REGULAR} ${regularFont} 0 R /${FONT_BOLD} ${boldFont} 0 R /${FONT_ITALIC} ${italicFont} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`
    );
    pageIds[index] = pageId;
  });

  const pagesId = addObject(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

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
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return Buffer.from(chunks.join(""), "latin1");
}
