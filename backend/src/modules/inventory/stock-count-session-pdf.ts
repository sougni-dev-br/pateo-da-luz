// Ficha de contagem de estoque em PDF — versão enxuta: apenas código, nome do
// produto e quantidade em estoque, agrupados por setor. Gerador self-contained
// (sem dependência externa); boilerplate do motor de desenho clonado de
// operational-inventory-pdf.ts.
type CountSessionPdfItem = {
  productCode: string | null;
  productName: string;
  sectorName: string | null;
  unit: string | null;
  countedQuantity: number | null;
};

type CreateStockCountSessionPdfParams = {
  systemName: string;
  sessionCode: string;
  sessionTypeLabel: string;
  referenceDateLabel: string;
  generatedAtLabel: string;
  totalItems: number;
  items: CountSessionPdfItem[];
};

// A4 portrait
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 32;
const MARGIN_TOP = 38;
const MARGIN_BOTTOM = 30;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2; // 531.28

const F_REG  = "F1";
const F_BOLD = "F2";
const F_ITAL = "F3";
type FontName = typeof F_REG | typeof F_BOLD | typeof F_ITAL;

// ─── Colors ─────────────────────────────────────────────────────────────────
const C_INK       = [0.086, 0.086, 0.094] as [number, number, number];
const C_MUTED     = [0.4,   0.42,  0.47 ] as [number, number, number];
const C_HEADER_BG = [0.118, 0.133, 0.165] as [number, number, number];
const C_GOLD      = [0.557, 0.463, 0.208] as [number, number, number];
const C_LINE      = [0.84,  0.86,  0.89 ] as [number, number, number];
const C_PAGE_BG   = [1,     1,     1    ] as [number, number, number];
const C_SECTOR_BG = [0.918, 0.925, 0.945] as [number, number, number];
const C_ZEBRA     = [0.975, 0.977, 0.982] as [number, number, number];

// ─── Table columns: só o essencial ──────────────────────────────────────────
const TABLE_COLS = [
  { key: "code",     label: "Código",               width: 78,  align: "left"  },
  { key: "product",  label: "Produto",                    width: 333, align: "left"  },
  { key: "quantity", label: "Quantidade em estoque",       width: 120, align: "right" },
] as const;
// sum = 78 + 333 + 120 = 531 ≈ CONTENT_WIDTH ✓

// ─── Helpers ─────────────────────────────────────────────────────────────────
function removeDiacritics(v: string) {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function sortKey(v: unknown, fallback = "") {
  return removeDiacritics(String(v ?? fallback).trim().toLowerCase());
}
function cleanText(v: unknown) {
  return String(v ?? "")
    .normalize("NFC")
    // remove caracteres de controle (mantem \t \n \r para o collapse abaixo)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function escapePdf(v: unknown) {
  const text = cleanText(v);
  const bytes = Buffer.from(text, "latin1");
  let out = "";
  bytes.forEach((b) => {
    if (b === 0x5c) out += "\\\\";
    else if (b === 0x28) out += "\\(";
    else if (b === 0x29) out += "\\)";
    else if (b >= 0x20 && b <= 0x7e) out += String.fromCharCode(b);
    else out += `\\${b.toString(8).padStart(3, "0")}`;
  });
  return out;
}
function fmtQty(v: number | null) {
  if (v == null) return "-";
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}
function qtyLabel(qty: number | null, unit: string | null) {
  if (qty == null) return "-";
  const q = fmtQty(qty);
  const u = cleanText(unit);
  return u && u !== "-" ? `${q} ${u}` : q;
}
function estWidth(text: string, size: number, font: FontName) {
  return cleanText(text).length * size * (font === F_BOLD ? 0.56 : 0.52);
}
function wrapText(v: unknown, maxW: number, size: number, font: FontName): string[] {
  const text = cleanText(v);
  if (!text) return [""];
  if (estWidth(text, size, font) <= maxW) return [text];
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (estWidth(next, size, font) > maxW && cur) { lines.push(cur); cur = w; }
    else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}
function rgb(r: number, g: number, b: number) {
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`;
}

// ─── Canvas (raw PDF drawing) ────────────────────────────────────────────────
class PdfCanvas {
  pages: { cmds: string[] }[] = [{ cmds: [] }];
  activeIndex: number | null = null; // usado na 2ª passada do rodapé
  get page() { return this.pages[this.activeIndex ?? this.pages.length - 1]; }

  newPage() { this.pages.push({ cmds: [] }); }

  txt(text: string, x: number, y: number, size = 9, font: FontName = F_REG, color: [number, number, number] = C_INK) {
    this.page.cmds.push("BT", `/${font} ${size} Tf`, `${rgb(...color)} rg`,
      `${x.toFixed(2)} ${y.toFixed(2)} Td`, `(${escapePdf(text)}) Tj`, "ET");
  }

  line(x1: number, y1: number, x2: number, y2: number, w = 0.6, color: [number, number, number] = C_LINE) {
    this.page.cmds.push("q", `${w.toFixed(2)} w`, `${rgb(...color)} RG`,
      `${x1.toFixed(2)} ${y1.toFixed(2)} m`, `${x2.toFixed(2)} ${y2.toFixed(2)} l`, "S", "Q");
  }

  rect(x: number, y: number, w: number, h: number, fill?: [number, number, number], stroke?: [number, number, number], sw = 0.6) {
    this.page.cmds.push("q");
    if (fill)   this.page.cmds.push(`${rgb(...fill)} rg`);
    if (stroke) this.page.cmds.push(`${rgb(...stroke)} RG`, `${sw.toFixed(2)} w`);
    this.page.cmds.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`);
    this.page.cmds.push(fill && stroke ? "B" : fill ? "f" : "S");
    this.page.cmds.push("Q");
  }
}

// ─── Grouping: apenas por setor ──────────────────────────────────────────────
type Row =
  | { kind: "sector"; label: string }
  | { kind: "item";   item: CountSessionPdfItem };

function sortItems(items: CountSessionPdfItem[]) {
  return [...items].sort((a, b) => {
    const ka = [sortKey(a.sectorName, "zzz"), sortKey(a.productName)];
    const kb = [sortKey(b.sectorName, "zzz"), sortKey(b.productName)];
    for (let i = 0; i < ka.length; i++) {
      const d = ka[i].localeCompare(kb[i], "pt-BR");
      if (d) return d;
    }
    return 0;
  });
}

function buildRows(items: CountSessionPdfItem[]): Row[] {
  const rows: Row[] = [];
  let curSec = "";
  for (const item of sortItems(items)) {
    const sec = cleanText(item.sectorName || "SEM SETOR");
    if (sec !== curSec) { rows.push({ kind: "sector", label: sec }); curSec = sec; }
    rows.push({ kind: "item", item });
  }
  return rows;
}

// ─── Page header ─────────────────────────────────────────────────────────────
function drawPageHeader(cv: PdfCanvas, p: CreateStockCountSessionPdfParams) {
  const topY = PAGE_HEIGHT - MARGIN_TOP;

  cv.txt(p.systemName, MARGIN_X, topY, 15, F_BOLD, C_INK);
  cv.txt("Contagem de estoque", MARGIN_X, topY - 16, 8.5, F_ITAL, C_MUTED);

  const codeW = estWidth(p.sessionCode, 14, F_BOLD);
  cv.txt(p.sessionCode, PAGE_WIDTH - MARGIN_X - codeW, topY, 14, F_BOLD, C_GOLD);

  // Linha de metadados enxuta (data · tipo · total)
  const meta = `${p.referenceDateLabel}  ·  ${p.sessionTypeLabel}  ·  ${p.totalItems} produto(s)`;
  const metaW = estWidth(meta, 8, F_REG);
  cv.txt(meta, PAGE_WIDTH - MARGIN_X - metaW, topY - 16, 8, F_REG, C_MUTED);

  cv.line(MARGIN_X, topY - 27, PAGE_WIDTH - MARGIN_X, topY - 27, 0.8, C_LINE);
}

// Rodapé desenhado numa segunda passada, quando o total real de páginas já é conhecido.
function drawPageFooter(cv: PdfCanvas, pageNum: number, total: number) {
  const pgLabel = `Página ${pageNum} de ${total}`;
  const pgW = estWidth(pgLabel, 8, F_REG);
  cv.txt(pgLabel, PAGE_WIDTH - MARGIN_X - pgW, MARGIN_BOTTOM - 4, 8, F_REG, C_MUTED);
  cv.line(MARGIN_X, MARGIN_BOTTOM + 8, PAGE_WIDTH - MARGIN_X, MARGIN_BOTTOM + 8, 0.5, C_LINE);
}

// ─── Table header row ────────────────────────────────────────────────────────
function drawTableHeader(cv: PdfCanvas, y: number): number {
  const h = 20;
  cv.rect(MARGIN_X, y - h, CONTENT_WIDTH, h, C_HEADER_BG);
  let x = MARGIN_X;
  for (const col of TABLE_COLS) {
    if (col.align === "right") {
      const w = estWidth(col.label, 7.5, F_BOLD);
      cv.txt(col.label, x + col.width - 6 - w, y - 13, 7.5, F_BOLD, C_PAGE_BG);
    } else {
      cv.txt(col.label, x + 6, y - 13, 7.5, F_BOLD, C_PAGE_BG);
    }
    x += col.width;
  }
  return y - h;
}

// ─── Main export ─────────────────────────────────────────────────────────────
export function createStockCountSessionPdf(params: CreateStockCountSessionPdfParams): Buffer {
  const cv = new PdfCanvas();
  const rows = buildRows(params.items);

  drawPageHeader(cv, params);
  let y = PAGE_HEIGHT - MARGIN_TOP - 40;
  y = drawTableHeader(cv, y);

  const MIN_Y = MARGIN_BOTTOM + 22;
  let zebra = false;

  const ensureSpace = (need: number) => {
    if (y - need >= MIN_Y) return;
    cv.newPage();
    drawPageHeader(cv, params);
    y = PAGE_HEIGHT - MARGIN_TOP - 40;
    y = drawTableHeader(cv, y);
    zebra = false;
  };

  const drawSectorRow = (label: string) => {
    const h = 17;
    ensureSpace(h + 20);
    cv.rect(MARGIN_X, y - h, CONTENT_WIDTH, h, C_SECTOR_BG, C_LINE, 0.5);
    cv.txt(`SETOR: ${label}`, MARGIN_X + 7, y - 12, 8.5, F_BOLD, [0.22, 0.24, 0.28]);
    y -= h;
    zebra = false;
  };

  for (const row of rows) {
    if (row.kind === "sector") { drawSectorRow(row.label); continue; }

    const item = row.item;
    const codeLines = wrapText(item.productCode || "-", TABLE_COLS[0].width - 12, 8, F_REG);
    const nameLines = wrapText(item.productName,        TABLE_COLS[1].width - 12, 8, F_REG);
    const qtyText   = qtyLabel(item.countedQuantity, item.unit);

    const lineCount = Math.max(codeLines.length, nameLines.length);
    const rowH = Math.max(17, lineCount * 10 + 6);
    ensureSpace(rowH);

    if (zebra) cv.rect(MARGIN_X, y - rowH, CONTENT_WIDTH, rowH, C_ZEBRA);
    zebra = !zebra;

    // Código
    codeLines.forEach((ln, li) => cv.txt(ln, MARGIN_X + 6, y - 12 - li * 10, 8, F_REG, C_MUTED));
    // Produto
    const px = MARGIN_X + TABLE_COLS[0].width;
    nameLines.forEach((ln, li) => cv.txt(ln, px + 6, y - 12 - li * 10, 8, F_BOLD, C_INK));
    // Quantidade (alinhada à direita)
    const qCol = TABLE_COLS[2];
    const qx = MARGIN_X + TABLE_COLS[0].width + TABLE_COLS[1].width;
    const qw = estWidth(qtyText, 8.5, F_BOLD);
    cv.txt(qtyText, qx + qCol.width - 8 - qw, y - 12, 8.5, F_BOLD, C_INK);

    // separador inferior da linha
    cv.line(MARGIN_X, y - rowH, MARGIN_X + CONTENT_WIDTH, y - rowH, 0.3, C_LINE);
    y -= rowH;
  }

  // ── Rodapé (2ª passada, com o total real de páginas) ─────────────────────
  const totalPages = cv.pages.length;
  for (let i = 0; i < totalPages; i++) {
    cv.activeIndex = i;
    drawPageFooter(cv, i + 1, totalPages);
  }
  cv.activeIndex = null;

  // ── Build PDF binary ────────────────────────────────────────────────────
  const objs: string[] = [];
  const push = (o: string) => { objs.push(o); return objs.length; };

  const idReg  = push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const idBold = push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const idItal = push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>");

  const contentIds: number[] = [];
  const pageIds: number[] = [];

  cv.pages.forEach((pg) => {
    const stream = pg.cmds.join("\n");
    contentIds.push(push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`));
    pageIds.push(0);
  });

  const pagesObjId = objs.length + cv.pages.length + 1;
  cv.pages.forEach((_pg, idx) => {
    pageIds[idx] = push(
      `<< /Type /Page /Parent ${pagesObjId} 0 R /MediaBox [0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(2)}] ` +
      `/Resources << /Font << /F1 ${idReg} 0 R /F2 ${idBold} 0 R /F3 ${idItal} 0 R >> >> ` +
      `/Contents ${contentIds[idx]} 0 R >>`
    );
  });

  const pagesId  = push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  const catalogId = push(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  const chunks = ["%PDF-1.4\n"];
  const offs: number[] = [0];
  for (let i = 0; i < objs.length; i++) {
    offs.push(Buffer.byteLength(chunks.join(""), "latin1"));
    chunks.push(`${i + 1} 0 obj\n${objs[i]}\nendobj\n`);
  }
  const xrefOff = Buffer.byteLength(chunks.join(""), "latin1");
  chunks.push(`xref\n0 ${objs.length + 1}\n`);
  chunks.push("0000000000 65535 f \n");
  for (let i = 1; i < offs.length; i++) chunks.push(`${String(offs[i]).padStart(10, "0")} 00000 n \n`);
  chunks.push(`trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOff}\n%%EOF`);

  return Buffer.from(chunks.join(""), "latin1");
}
