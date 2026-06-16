// ─── Types ────────────────────────────────────────────────────────────────────

type CmvPdfParams = {
  code: string;
  dataInicial: Date;
  dataFinal: Date;
  estoqueInicialTotal: number;
  comprasTotal: number;
  estoqueFinalTotal: number;
  cmvReal: number;
  faturamentoTotal: number;
  cmvPercentual: number | null;
  margemBruta: number | null;
  status: string;
  generatedAt: Date;
  purchaseByCategory: { categoryName: string; itemsCount: number; totalAmount: number }[];
  purchaseBySupplier: { supplierName: string; supplierDocument?: string | null; purchasesCount: number; totalAmount: number }[];
  revenueByChannel: { channel: string; count: number; grossAmount: number; netAmount: number }[];
};

// ─── Page constants ────────────────────────────────────────────────────────────

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MX = 32;
const MT = 38;
const MB = 30;
const CW = PAGE_W - MX * 2; // 531.28

// ─── Fonts ─────────────────────────────────────────────────────────────────────

const F_REG  = "F1";
const F_BOLD = "F2";
const F_ITAL = "F3";
type Font = typeof F_REG | typeof F_BOLD | typeof F_ITAL;

// ─── Colors ─────────────────────────────────────────────────────────────────────

const C_INK    : [number, number, number] = [0.086, 0.086, 0.094];
const C_MUTED  : [number, number, number] = [0.40,  0.42,  0.47 ];
const C_DARK   : [number, number, number] = [0.118, 0.133, 0.165];
const C_GOLD   : [number, number, number] = [0.557, 0.463, 0.208];
const C_LINE   : [number, number, number] = [0.84,  0.86,  0.89 ];
const C_WHITE  : [number, number, number] = [1,     1,     1    ];

// ─── Palette helpers ───────────────────────────────────────────────────────────

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "dark";

const TONES: Record<Tone, { bg: [number, number, number]; val: [number, number, number] }> = {
  neutral: { bg: [0.96,  0.96,  0.97 ], val: C_INK },
  success: { bg: [0.90,  0.96,  0.91 ], val: [0.12, 0.44, 0.19] },
  warning: { bg: [1.00,  0.96,  0.87 ], val: [0.58, 0.38, 0.06] },
  danger:  { bg: [0.99,  0.91,  0.91 ], val: [0.70, 0.17, 0.15] },
  info:    { bg: [0.90,  0.94,  1.00 ], val: [0.14, 0.36, 0.65] },
  dark:    { bg: C_DARK,                val: C_WHITE },
};

// ─── Utility ──────────────────────────────────────────────────────────────────

function cleanText(v: unknown) {
  return String(v ?? "")
    .normalize("NFC")
    .replace(/[–—]/g, "-")
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

function estW(text: string, size: number, bold = false) {
  return cleanText(text).length * size * (bold ? 0.56 : 0.52);
}

function wrapText(v: unknown, maxW: number, size: number, bold = false): string[] {
  const text = cleanText(v);
  if (!text) return [""];
  if (estW(text, size, bold) <= maxW) return [text];
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (estW(next, size, bold) > maxW && cur) { lines.push(cur); cur = w; }
    else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

function brl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function pct(v: number | null) {
  return v == null ? "-" : `${(v * 100).toFixed(2)}%`;
}

function rgb(r: number, g: number, b: number) {
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`;
}

function fmtDate(d: Date) {
  return d.toLocaleDateString("pt-BR");
}

// ─── Canvas ────────────────────────────────────────────────────────────────────

class Canvas {
  pages: { cmds: string[] }[] = [{ cmds: [] }];
  get page() { return this.pages[this.pages.length - 1]; }
  newPage() { this.pages.push({ cmds: [] }); }

  txt(text: string, x: number, y: number, size = 9, font: Font = F_REG, color: [number, number, number] = C_INK) {
    this.page.cmds.push(
      "BT", `/${font} ${size} Tf`, `${rgb(...color)} rg`,
      `${x.toFixed(2)} ${y.toFixed(2)} Td`, `(${escapePdf(text)}) Tj`, "ET"
    );
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

// ─── Drawing helpers ───────────────────────────────────────────────────────────

function drawHeader(cv: Canvas, params: CmvPdfParams, pageNum: number, totalPages: number) {
  const topY = PAGE_H - MT;
  cv.txt("Pateo da Luz", MX, topY, 16, F_BOLD, C_INK);
  cv.txt("Apuracao de CMV Real", MX, topY - 17, 8.5, F_ITAL, C_MUTED);
  const codeW = estW(params.code, 14, true);
  cv.txt(params.code, PAGE_W - MX - codeW, topY, 14, F_BOLD, C_GOLD);
  cv.line(MX, topY - 28, PAGE_W - MX, topY - 28, 0.8, C_LINE);
  const pg = `Pagina ${pageNum} de ${totalPages}`;
  cv.txt(pg, PAGE_W - MX - estW(pg, 8), MB - 4, 8, F_REG, C_MUTED);
  cv.line(MX, MB + 8, PAGE_W - MX, MB + 8, 0.5, C_LINE);
}

function card(cv: Canvas, x: number, y: number, w: number, h: number, label: string, value: string, tone: Tone = "neutral") {
  const pal = TONES[tone];
  const isLight = tone !== "dark";
  cv.rect(x, y - h, w, h, pal.bg, C_LINE, 0.6);
  cv.txt(label, x + 8, y - 14, 7, F_REG, isLight ? C_MUTED : ([0.8, 0.82, 0.85] as [number, number, number]));
  const vLines = wrapText(value, w - 16, 13, true);
  vLines.forEach((line, i) => cv.txt(line, x + 8, y - 31 - i * 14, 13, F_BOLD, pal.val));
}

function sectionHeading(cv: Canvas, y: number, title: string): number {
  cv.txt(title.toUpperCase(), MX, y, 8, F_BOLD, [0.35, 0.37, 0.41]);
  cv.line(MX, y - 4, PAGE_W - MX, y - 4, 0.5, C_LINE);
  return y - 16;
}

// ─── Table drawing ─────────────────────────────────────────────────────────────

type ColDef = { label: string; width: number; align?: "left" | "right" | "center"; bold?: boolean };

function tableHeader(cv: Canvas, y: number, cols: ColDef[]): number {
  const h = 18;
  cv.rect(MX, y - h, CW, h, C_DARK);
  let x = MX;
  for (const col of cols) {
    cv.txt(col.label, x + 4, y - 12, 7, F_BOLD, C_WHITE);
    x += col.width;
  }
  return y - h;
}

function tableRow(
  cv: Canvas,
  y: number,
  cols: ColDef[],
  cells: string[],
  bg: [number, number, number],
  minY: number,
  ensureSpace: (n: number) => void
): number {
  const cellLines: string[][] = cols.map((col, i) =>
    wrapText(cells[i] ?? "-", col.width - 8, 7.5, col.bold)
  );
  const lineCount = Math.max(...cellLines.map((l) => l.length));
  const rowH = Math.max(16, lineCount * 9 + 7);
  ensureSpace(rowH + 4);

  cv.rect(MX, y - rowH, CW, rowH, bg, C_LINE, 0.3);
  let x = MX;
  cols.forEach((col, ci) => {
    if (ci > 0) cv.line(x, y, x, y - rowH, 0.3, C_LINE);
    cellLines[ci].forEach((ln, li) => {
      let tx = x + 4;
      if (col.align === "right") tx = x + col.width - 4 - estW(ln, 7.5, col.bold);
      cv.txt(ln, tx, y - 11 - li * 9, 7.5, col.bold ? F_BOLD : F_REG, C_INK);
    });
    x += col.width;
  });
  return y - rowH;
}

// ─── Main export ───────────────────────────────────────────────────────────────

export function createCmvRealPdf(params: CmvPdfParams): Buffer {
  const cv = new Canvas();
  // rough page count estimate
  const totalPages = 1 + Math.ceil((params.purchaseByCategory.length + params.purchaseBySupplier.length + params.revenueByChannel.length) / 30);

  const MIN_Y = MB + 28;
  let pageIdx = 1;

  const ensureSpace = (need: number) => {
    if (y - need >= MIN_Y) return;
    cv.newPage();
    pageIdx++;
    drawHeader(cv, params, pageIdx, totalPages);
    y = PAGE_H - MT - 46;
  };

  drawHeader(cv, params, 1, totalPages);
  let y = PAGE_H - MT - 46;

  // ── Title ──
  const statusColors: Record<string, [number, number, number]> = {
    OPEN:   [0.14, 0.50, 0.28],
    CLOSED: [0.22, 0.35, 0.60],
  };
  const statusBg: Record<string, [number, number, number]> = {
    OPEN:   [0.88, 0.97, 0.90],
    CLOSED: [0.88, 0.92, 0.99],
  };
  const periodo = `${fmtDate(params.dataInicial)}  ate  ${fmtDate(params.dataFinal)}`;
  cv.txt("Apuracao de CMV Real", MX, y, 13, F_BOLD, C_INK);
  y -= 18;
  cv.txt(`Periodo: ${periodo}`, MX, y, 8.5, F_REG, C_MUTED);
  const statusLabel = params.status === "CLOSED" ? "FECHADO" : "ABERTO";
  const sW = estW(statusLabel, 7.5, true) + 12;
  const sX = PAGE_W - MX - sW;
  cv.rect(sX, y - 3, sW, 14, statusBg[params.status] ?? [0.95, 0.95, 0.95], undefined);
  cv.txt(statusLabel, sX + 6, y + 5, 7.5, F_BOLD, statusColors[params.status] ?? C_MUTED);
  cv.txt(`Gerado em: ${params.generatedAt.toLocaleString("pt-BR")}`, MX, y - 13, 7.5, F_REG, C_MUTED);
  y -= 34;

  // ── Formula card ──
  cv.rect(MX, y - 28, CW, 28, [0.97, 0.97, 0.99], C_LINE, 0.6);
  cv.txt("Formula: Estoque inicial + Compras - Estoque final = CMV Real", MX + 12, y - 17, 8, F_ITAL, [0.30, 0.30, 0.38]);
  y -= 40;

  // ── Metrics cards (2 rows × 3) ──
  const cardW = (CW - 20) / 3;
  const cardH = 52;
  const gap = 10;

  // Row 1
  card(cv, MX,                    y, cardW, cardH, "Estoque inicial", brl(params.estoqueInicialTotal), "info");
  card(cv, MX + cardW + gap,       y, cardW, cardH, "Compras no periodo", brl(params.comprasTotal), "neutral");
  card(cv, MX + (cardW + gap) * 2, y, cardW, cardH, "Estoque final", brl(params.estoqueFinalTotal), "info");
  y -= cardH + gap;

  // Row 2
  card(cv, MX,                    y, cardW, cardH, "CMV Real apurado", brl(params.cmvReal), "dark");
  card(cv, MX + cardW + gap,       y, cardW, cardH, "Faturamento liquido", brl(params.faturamentoTotal), "neutral");
  card(cv, MX + (cardW + gap) * 2, y, cardW, cardH, "CMV % / Margem bruta", `${pct(params.cmvPercentual)}  /  ${params.margemBruta == null ? "-" : brl(params.margemBruta)}`, "success");
  y -= cardH + 18;

  // ── Compras por categoria ──
  y = sectionHeading(cv, y, "Compras por categoria");

  const catCols: ColDef[] = [
    { label: "Categoria",  width: 340 },
    { label: "Itens",      width: 80,  align: "right" },
    { label: "Total",      width: 111, align: "right", bold: true },
  ];
  y = tableHeader(cv, y, catCols);

  params.purchaseByCategory.forEach((row, idx) => {
    const bg: [number, number, number] = idx % 2 === 0 ? [1, 1, 1] : [0.975, 0.975, 0.985];
    y = tableRow(cv, y, catCols, [
      row.categoryName,
      String(row.itemsCount),
      brl(row.totalAmount),
    ], bg, MIN_Y, ensureSpace);
  });

  y -= 18;

  // ── Compras por fornecedor ──
  ensureSpace(80);
  y = sectionHeading(cv, y, "Compras por fornecedor");

  const supCols: ColDef[] = [
    { label: "Fornecedor",  width: 210 },
    { label: "CNPJ / CPF", width: 120 },
    { label: "Pedidos",    width: 60,  align: "right" },
    { label: "Total",      width: 141, align: "right", bold: true },
  ];
  y = tableHeader(cv, y, supCols);

  params.purchaseBySupplier.forEach((row, idx) => {
    const bg: [number, number, number] = idx % 2 === 0 ? [1, 1, 1] : [0.975, 0.975, 0.985];
    y = tableRow(cv, y, supCols, [
      row.supplierName,
      row.supplierDocument ?? "-",
      String(row.purchasesCount),
      brl(row.totalAmount),
    ], bg, MIN_Y, ensureSpace);
  });

  y -= 18;

  // ── Faturamento por canal ──
  ensureSpace(80);
  y = sectionHeading(cv, y, "Faturamento por canal");

  const chanCols: ColDef[] = [
    { label: "Canal",   width: 220 },
    { label: "Qtd.",    width: 60,  align: "right" },
    { label: "Bruto",   width: 125, align: "right" },
    { label: "Liquido", width: 126, align: "right", bold: true },
  ];
  y = tableHeader(cv, y, chanCols);

  params.revenueByChannel.forEach((row, idx) => {
    const bg: [number, number, number] = idx % 2 === 0 ? [1, 1, 1] : [0.975, 0.975, 0.985];
    y = tableRow(cv, y, chanCols, [
      row.channel,
      String(row.count),
      brl(row.grossAmount),
      brl(row.netAmount),
    ], bg, MIN_Y, ensureSpace);
  });

  // ── Build PDF ─────────────────────────────────────────────────────────────────

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
      `<< /Type /Page /Parent ${pagesObjId} 0 R /MediaBox [0 0 ${PAGE_W.toFixed(2)} ${PAGE_H.toFixed(2)}] ` +
      `/Resources << /Font << /F1 ${idReg} 0 R /F2 ${idBold} 0 R /F3 ${idItal} 0 R >> >> ` +
      `/Contents ${contentIds[idx]} 0 R >>`
    );
  });

  const pagesId   = push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
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
