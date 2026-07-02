// Gerador de PDF de Pedido de Compra.
// Boilerplate (Canvas, encodePdf, utils) clonado de purchases/supplier-position-pdf.ts —
// padrao do projeto: cada modulo mantem sua propria implementacao PDF, sem framework
// compartilhado. Fontes Helvetica embutidas (Type1) — sem dependencia externa.

// ─── Types ────────────────────────────────────────────────────────────────────

export type PurchaseOrderItemEntry = {
  productCode: string | null;
  productName: string;
  unit: string | null;
  requestedQuantity: number;
  unitPriceEstimated: number | null;
  totalEstimated: number | null;
};

export type PurchaseOrderPdfData = {
  code: string;
  status: string;
  createdAt: string;
  expectedDeliveryDate: string | null;
  supplierName: string;
  notes: string | null;
  items: PurchaseOrderItemEntry[];
  totalEstimated: number;
};

// ─── Page constants ───────────────────────────────────────────────────────────

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MX     = 32;
const MT     = 38;
const MB     = 30;
const CW     = PAGE_W - MX * 2;

// ─── Fonts ────────────────────────────────────────────────────────────────────

const F_REG  = "F1";
const F_BOLD = "F2";
const F_ITAL = "F3";
type Font = typeof F_REG | typeof F_BOLD | typeof F_ITAL;

// ─── Colors ───────────────────────────────────────────────────────────────────

const C_INK   : [number, number, number] = [0.086, 0.086, 0.094];
const C_MUTED : [number, number, number] = [0.40,  0.42,  0.47 ];
const C_DARK  : [number, number, number] = [0.118, 0.133, 0.165];
const C_GOLD  : [number, number, number] = [0.557, 0.463, 0.208];
const C_LINE  : [number, number, number] = [0.84,  0.86,  0.89 ];
const C_WHITE : [number, number, number] = [1,     1,     1    ];

// ─── Utils ────────────────────────────────────────────────────────────────────

function cleanText(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[–—−]/g, "-")
    .replace(/ /g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapePdf(v: unknown): string {
  const text = cleanText(v);
  const bytes = Buffer.from(text, "latin1");
  let out = "";
  bytes.forEach((b) => {
    if      (b === 0x5c) out += "\\\\";
    else if (b === 0x28) out += "\\(";
    else if (b === 0x29) out += "\\)";
    else if (b >= 0x20 && b <= 0x7e) out += String.fromCharCode(b);
    else out += `\\${b.toString(8).padStart(3, "0")}`;
  });
  return out;
}

function estW(text: string, size: number, bold = false): number {
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

function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function rgb(r: number, g: number, b: number): string {
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString("pt-BR");
}

function fmtQty(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

// ─── Canvas ───────────────────────────────────────────────────────────────────

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

  rtxt(text: string, rightX: number, y: number, size = 9, font: Font = F_REG, color: [number, number, number] = C_INK) {
    this.txt(text, rightX - estW(cleanText(text), size, font === F_BOLD), y, size, font, color);
  }

  line(x1: number, y1: number, x2: number, y2: number, w = 0.6, color: [number, number, number] = C_LINE) {
    this.page.cmds.push(
      "q", `${w.toFixed(2)} w`, `${rgb(...color)} RG`,
      `${x1.toFixed(2)} ${y1.toFixed(2)} m`, `${x2.toFixed(2)} ${y2.toFixed(2)} l`, "S", "Q"
    );
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

// ─── Drawing helpers ──────────────────────────────────────────────────────────

function drawHeader(cv: Canvas, code: string, pageNum: number, totalPages: number) {
  const topY = PAGE_H - MT;
  // Comprador — hard-code "Pateo da Luz" ate feature de Empresas/filiais entregar CNPJ/endereco.
  cv.txt("Pateo da Luz",    MX, topY,      16,  F_BOLD, C_INK);
  cv.txt("Pedido de compra", MX, topY - 17, 8.5, F_ITAL, C_MUTED);
  cv.rtxt(code, PAGE_W - MX, topY, 14, F_BOLD, C_GOLD);
  cv.line(MX, topY - 28, PAGE_W - MX, topY - 28, 0.8, C_LINE);
  const pg = `Pagina ${pageNum} de ${totalPages}`;
  cv.txt(pg, PAGE_W - MX - estW(pg, 8), MB - 4, 8, F_REG, C_MUTED);
  cv.line(MX, MB + 8, PAGE_W - MX, MB + 8, 0.5, C_LINE);
}

type ColDef = { label: string; width: number; align?: "left" | "right"; bold?: boolean };

function tableHeader(cv: Canvas, y: number, cols: ColDef[]): number {
  cv.rect(MX, y - 18, CW, 18, C_DARK);
  let x = MX;
  for (const col of cols) {
    const tx = col.align === "right" ? x + col.width - 4 - estW(col.label, 7, true) : x + 4;
    cv.txt(col.label, tx, y - 12, 7, F_BOLD, C_WHITE);
    x += col.width;
  }
  return y - 18;
}

function tableRow(
  cv: Canvas,
  y: number,
  cols: ColDef[],
  cells: string[],
  bg: [number, number, number],
  ensureSpace: (n: number) => void
): number {
  const cellLines = cols.map((col, i) => wrapText(cells[i] ?? "-", col.width - 8, 7.5, col.bold));
  const lineCount = Math.max(...cellLines.map((l) => l.length));
  const rowH = Math.max(16, lineCount * 9 + 7);
  ensureSpace(rowH + 4);

  cv.rect(MX, y - rowH, CW, rowH, bg, C_LINE, 0.3);
  let x = MX;
  cols.forEach((col, ci) => {
    if (ci > 0) cv.line(x, y, x, y - rowH, 0.3, C_LINE);
    cellLines[ci].forEach((ln, li) => {
      const tx = col.align === "right"
        ? x + col.width - 4 - estW(ln, 7.5, col.bold)
        : x + 4;
      cv.txt(ln, tx, y - 11 - li * 9, 7.5, col.bold ? F_BOLD : F_REG, C_INK);
    });
    x += col.width;
  });
  return y - rowH;
}

// ─── PDF encoder ─────────────────────────────────────────────────────────────

function encodePdf(cv: Canvas): Buffer {
  const objs: string[] = [];
  const push = (o: string) => { objs.push(o); return objs.length; };

  const idReg  = push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const idBold = push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const idItal = push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>");

  const contentIds: number[] = [];
  const pageIds:    number[] = [];

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

// ─── Main export ──────────────────────────────────────────────────────────────

// Cap defensivo de itens no PDF. Alinhado ao cap de 1000 do POST /from-planning upstream;
// 2000 folga larga pra pedidos criados por outros caminhos, ainda blindando contra
// pedidos monstro (in-memory buffer + loop de layout escalam com N).
const MAX_PDF_ITEMS = 2000;

export function createPurchaseOrderPdf(data: PurchaseOrderPdfData): Buffer {
  if (data.items.length > MAX_PDF_ITEMS) {
    throw new Error(`Pedido excede o limite de ${MAX_PDF_ITEMS} itens para geracao de PDF (recebido: ${data.items.length}).`);
  }
  const cv = new Canvas();
  const MIN_Y = MB + 28;

  // Estimativa de paginas (usada nos headers; refinada ao final se necessario).
  const rowEstimate = Math.max(1, data.items.length);
  let totalPages = Math.max(1, 1 + Math.ceil((rowEstimate - 25) / 32));

  let pageIdx = 1;
  let y       = PAGE_H - MT - 46;

  const ensureSpace = (need: number) => {
    if (y - need >= MIN_Y) return;
    cv.newPage();
    pageIdx++;
    drawHeader(cv, data.code, pageIdx, totalPages);
    y = PAGE_H - MT - 46;
  };

  drawHeader(cv, data.code, 1, totalPages);

  // ── Bloco de metadados ────────────────────────────────────────────────────
  cv.txt("Pedido " + data.code, MX, y, 13, F_BOLD, C_INK);
  y -= 20;

  // Linha 1: Fornecedor
  cv.txt("Fornecedor:", MX, y, 8, F_BOLD, C_MUTED);
  cv.txt(data.supplierName, MX + 62, y, 9, F_REG, C_INK);
  y -= 14;

  // Linha 2: Status + Data criacao + Prevista entrega
  cv.txt("Status:", MX, y, 8, F_BOLD, C_MUTED);
  cv.txt(data.status, MX + 62, y, 9, F_REG, C_INK);
  cv.txt("Criado em:", MX + 200, y, 8, F_BOLD, C_MUTED);
  cv.txt(fmtDate(data.createdAt), MX + 258, y, 9, F_REG, C_INK);
  if (data.expectedDeliveryDate) {
    cv.txt("Entrega prevista:", MX + 340, y, 8, F_BOLD, C_MUTED);
    cv.txt(fmtDate(data.expectedDeliveryDate), MX + 425, y, 9, F_REG, C_INK);
  }
  y -= 24;

  // ── Tabela de itens ───────────────────────────────────────────────────────
  // Sem colunas de preco unitario e total — fornecedor cotara ao receber.
  // Larguras adaptadas ao espaco liberado; "Produto" absorve a maior parte.
  const codeW = 90;
  const qtyW  = 70;
  const unitW = 55;
  const cols: ColDef[] = [
    { label: "Cod. interno", width: codeW },
    { label: "Produto",       width: CW - codeW - qtyW - unitW, bold: true },
    { label: "Qtd.",          width: qtyW,  align: "right" },
    { label: "Unid.",         width: unitW }
  ];

  // Nota discreta sobre o codigo interno, logo acima do header da tabela.
  cv.txt("Cod. interno = codigo interno do restaurante", MX, y, 7, F_ITAL, C_MUTED);
  y -= 10;

  y = tableHeader(cv, y, cols);
  const rowBg: [number, number, number] = [0.99, 0.99, 0.99];
  for (const item of data.items) {
    const cells = [
      item.productCode ?? "-",
      item.productName,
      fmtQty(item.requestedQuantity),
      item.unit ?? "-"
    ];
    y = tableRow(cv, y, cols, cells, rowBg, ensureSpace);
  }

  // ── Rodape: observacoes (sem total — preco entra na cotacao) ────────────
  y -= 10;

  if (data.notes) {
    ensureSpace(30);
    cv.txt("Observacoes", MX, y, 8, F_BOLD, C_MUTED);
    y -= 12;
    const lines = wrapText(data.notes, CW, 8.5, false);
    for (const ln of lines) {
      ensureSpace(11);
      cv.txt(ln, MX, y, 8.5, F_REG, C_INK);
      y -= 11;
    }
  }

  // Se estimativa inicial de paginas subestimou, refaz os headers com o total real.
  if (cv.pages.length !== totalPages) {
    totalPages = cv.pages.length;
    // Reheader: nao ha caminho simples pra reescrever comandos ja emitidos;
    // aceitar leve inconsistencia no "Pagina X de Y" e' o tradeoff (mesmo comportamento
    // dos outros PDFs do projeto). Header ja usa numero correto de pageIdx corrente.
  }

  return encodePdf(cv);
}
