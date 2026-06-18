// ─── Types ────────────────────────────────────────────────────────────────────

export type InstallmentEntry = {
  installmentNum: number | null;
  dueDate: string | null;
  amount: number;
  isPaid: boolean;
  isOverdue: boolean;
};

export type ItemEntry = {
  code: string | null;
  name: string;
  unit: string | null;
  quantity: number;
  totalPrice: number;
};

export type PurchaseEntry = {
  supplierName: string;
  supplierDocument: string | null;
  purchaseDate: string;
  purchaseNumber: string | null;
  invoiceNumber: string | null;
  totalAmount: number;
  paymentMethodLabel: string;
  items: ItemEntry[];
  installments: InstallmentEntry[];
};

export type SupplierPositionData = {
  period: { from: string | null; to: string | null };
  supplierFilter: string | null;
  summary: {
    totalPurchased: number;
    paidAmount: number;
    openAmount: number;
    overdueAmount: number;
    purchaseCount: number;
  };
  purchases: PurchaseEntry[];
};

// ─── Page constants ───────────────────────────────────────────────────────────

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MX     = 32;
const MT     = 38;
const MB     = 30;
const CW     = PAGE_W - MX * 2; // 531.28

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
const C_GREEN : [number, number, number] = [0.12,  0.44,  0.19 ];
const C_RED   : [number, number, number] = [0.70,  0.17,  0.15 ];

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const TONES: Record<Tone, { bg: [number, number, number]; val: [number, number, number] }> = {
  neutral: { bg: [0.96, 0.96, 0.97], val: C_INK   },
  success: { bg: [0.90, 0.96, 0.91], val: C_GREEN  },
  warning: { bg: [1.00, 0.96, 0.87], val: [0.58, 0.38, 0.06] },
  danger:  { bg: [0.99, 0.91, 0.91], val: C_RED    },
  info:    { bg: [0.90, 0.94, 1.00], val: [0.14, 0.36, 0.65] },
};

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

function drawHeader(cv: Canvas, code: string, subtitle: string, pageNum: number, totalPages: number) {
  const topY = PAGE_H - MT;
  cv.txt("Pateo da Luz",    MX, topY,      16,  F_BOLD, C_INK);
  cv.txt(subtitle,          MX, topY - 17, 8.5, F_ITAL, C_MUTED);
  cv.rtxt(code, PAGE_W - MX, topY, 14, F_BOLD, C_GOLD);
  cv.line(MX, topY - 28, PAGE_W - MX, topY - 28, 0.8, C_LINE);
  const pg = `Pagina ${pageNum} de ${totalPages}`;
  cv.txt(pg, PAGE_W - MX - estW(pg, 8), MB - 4, 8, F_REG, C_MUTED);
  cv.line(MX, MB + 8, PAGE_W - MX, MB + 8, 0.5, C_LINE);
}

function card(cv: Canvas, x: number, y: number, w: number, h: number, label: string, value: string, tone: Tone = "neutral") {
  const pal = TONES[tone];
  cv.rect(x, y - h, w, h, pal.bg, C_LINE, 0.6);
  cv.txt(label, x + 8, y - 14, 7, F_REG, C_MUTED);
  const vLines = wrapText(value, w - 16, 12, true);
  vLines.forEach((ln, i) => cv.txt(ln, x + 8, y - 30 - i * 13, 12, F_BOLD, pal.val));
}

function sectionHeading(cv: Canvas, y: number, title: string): number {
  cv.txt(title.toUpperCase(), MX, y, 8, F_BOLD, [0.35, 0.37, 0.41]);
  cv.line(MX, y - 4, PAGE_W - MX, y - 4, 0.5, C_LINE);
  return y - 16;
}

type ColDef = { label: string; width: number; align?: "left" | "right"; bold?: boolean };

function tableHeader(cv: Canvas, y: number, cols: ColDef[]): number {
  cv.rect(MX, y - 18, CW, 18, C_DARK);
  let x = MX;
  for (const col of cols) {
    cv.txt(col.label, x + 4, y - 12, 7, F_BOLD, C_WHITE);
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

function groupHeader(cv: Canvas, y: number, label: string, ensureSpace: (n: number) => void): number {
  ensureSpace(20);
  cv.rect(MX, y - 18, CW, 18, [0.22, 0.25, 0.32]);
  cv.txt(cleanText(label), MX + 8, y - 11, 8, F_BOLD, C_WHITE);
  return y - 18;
}

function subtotalRow(cv: Canvas, y: number, label: string, value: string): number {
  cv.rect(MX, y - 16, CW, 16, [0.93, 0.95, 0.93], C_LINE, 0.4);
  cv.txt(cleanText(label), MX + 4, y - 10, 7.5, F_BOLD, C_DARK);
  cv.rtxt(value, MX + CW - 4, y - 10, 7.5, F_BOLD, C_DARK);
  return y - 16;
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

export function createSupplierPositionPdf(data: SupplierPositionData): Buffer {
  const cv = new Canvas();

  const isSingle = Boolean(data.supplierFilter);
  const subtitle = isSingle ? "Posicao de Fornecedor" : "Posicao de Fornecedores";

  const refDate = data.period.from ? new Date(data.period.from) : new Date();
  const code    = `FOR-${refDate.getFullYear()}-${String(refDate.getMonth() + 1).padStart(2, "0")}`;

  // Estimate total pages (used in headers; updated once content is done)
  const rowEstimate = data.purchases.length * 2 +
    data.purchases.reduce((s, p) => s + p.items.length + p.installments.length, 0);
  let totalPages = Math.max(1, 1 + Math.ceil((rowEstimate - 30) / 40));

  const MIN_Y   = MB + 28;
  let pageIdx   = 1;
  let y         = PAGE_H - MT - 46;

  const ensureSpace = (need: number) => {
    if (y - need >= MIN_Y) return;
    cv.newPage();
    pageIdx++;
    drawHeader(cv, code, subtitle, pageIdx, totalPages);
    y = PAGE_H - MT - 46;
  };

  drawHeader(cv, code, subtitle, 1, totalPages);

  // ── Title block ─────────────────────────────────────────────────────────────
  cv.txt(subtitle, MX, y, 13, F_BOLD, C_INK);
  y -= 18;

  const fromLabel = data.period.from ? fmtDate(data.period.from) : "Inicio";
  const toLabel   = data.period.to   ? fmtDate(data.period.to)   : "Hoje";
  cv.txt(`Periodo: ${fromLabel}  ate  ${toLabel}`, MX, y, 8.5, F_REG, C_MUTED);

  // Badge top-right
  const badgeText = isSingle
    ? cleanText(data.supplierFilter!)
    : `${data.summary.purchaseCount} compra${data.summary.purchaseCount !== 1 ? "s" : ""}`;
  const badgeTone: Tone = isSingle ? "info" : "neutral";
  const bW = estW(badgeText, 8, true) + 16;
  const bX = PAGE_W - MX - bW;
  cv.rect(bX, y - 4, bW, 15, TONES[badgeTone].bg, C_LINE, 0.6);
  cv.txt(badgeText, bX + 8, y + 5, 8, F_BOLD, TONES[badgeTone].val);

  cv.txt(`Gerado em: ${new Date().toLocaleString("pt-BR")}`, MX, y - 13, 7.5, F_REG, C_MUTED);
  y -= 34;

  // ── Cards ───────────────────────────────────────────────────────────────────
  const cardW  = (CW - 12) / 4;
  const cardH  = 52;
  const cardGap = 4;

  const overdueAmt    = data.summary.overdueAmount;
  const openOnlyAmt   = Math.max(0, data.summary.openAmount - overdueAmt);
  const overdueTone: Tone = overdueAmt > 0 ? "danger"  : "neutral";
  const openTone: Tone    = openOnlyAmt > 0 ? "warning" : "neutral";

  card(cv, MX,                              y, cardW, cardH, "Total Comprado", brl(data.summary.totalPurchased), "neutral");
  card(cv, MX + (cardW + cardGap),          y, cardW, cardH, "Pago",           brl(data.summary.paidAmount),     "success");
  card(cv, MX + (cardW + cardGap) * 2,      y, cardW, cardH, "Em Aberto",      brl(openOnlyAmt),                 openTone);
  card(cv, MX + (cardW + cardGap) * 3,      y, cardW, cardH, "Vencido",        brl(overdueAmt),                  overdueTone);
  y -= cardH + 20;

  // ── Column layouts ───────────────────────────────────────────────────────────
  // NF:          Data(70) | Pedido(100) | NF(90) | Pagamento(181) | Total(90)  = 531
  const nfCols: ColDef[] = [
    { label: "Data",      width:  70 },
    { label: "Pedido",    width: 100 },
    { label: "NF",        width:  90 },
    { label: "Pagamento", width: 181 },
    { label: "Total",     width:  90, align: "right", bold: true },
  ];

  // Items:       Cod(70) | Item(281) | Un(60) | Qtd(60) | Total(60) = 531
  const itemCols: ColDef[] = [
    { label: "Cod.",  width:  70 },
    { label: "Item",  width: 281 },
    { label: "Un.",   width:  60 },
    { label: "Qtd.",  width:  60, align: "right" },
    { label: "Total", width:  60, align: "right", bold: true },
  ];

  // Installments: Pedido(100) | NF(90) | Parc(50) | Vencimento(90) | Valor(91) | Status(110) = 531
  const instCols: ColDef[] = [
    { label: "Pedido",     width: 100 },
    { label: "NF",         width:  90 },
    { label: "Parc.",      width:  50, align: "right" },
    { label: "Vencimento", width:  90 },
    { label: "Valor",      width:  91, align: "right", bold: true },
    { label: "Status",     width: 110 },
  ];

  // Group purchases by supplier key preserving insertion order
  const grouped = new Map<string, { name: string; doc: string | null; list: PurchaseEntry[] }>();
  for (const p of data.purchases) {
    const key = p.supplierName;
    if (!grouped.has(key)) grouped.set(key, { name: p.supplierName, doc: p.supplierDocument, list: [] });
    grouped.get(key)!.list.push(p);
  }

  // ── Section 1: Notas Fiscais ─────────────────────────────────────────────────
  ensureSpace(60);
  y = sectionHeading(cv, y, "Notas Fiscais e Pedidos Internos");
  y = tableHeader(cv, y, nfCols);

  let grandNfTotal = 0;
  for (const { name, doc, list } of grouped.values()) {
    if (!isSingle) {
      const groupLabel = doc ? `${name}   ${doc}` : name;
      y = groupHeader(cv, y, groupLabel, ensureSpace);
    }
    let sub = 0;
    list.forEach((p, idx) => {
      const bg: [number, number, number] = idx % 2 === 0 ? [1, 1, 1] : [0.975, 0.975, 0.985];
      y = tableRow(cv, y, nfCols, [
        fmtDate(p.purchaseDate),
        p.purchaseNumber  ?? "-",
        p.invoiceNumber   ?? "-",
        p.paymentMethodLabel,
        brl(p.totalAmount),
      ], bg, ensureSpace);
      sub += p.totalAmount;
    });
    if (!isSingle && list.length > 1) {
      y = subtotalRow(cv, y, `Subtotal — ${name}`, brl(sub));
    }
    grandNfTotal += sub;
  }
  y = subtotalRow(cv, y, "TOTAL COMPRADO", brl(grandNfTotal));
  y -= 16;

  // ── Section 2: Itens Comprados ───────────────────────────────────────────────
  ensureSpace(60);
  y = sectionHeading(cv, y, "Itens Comprados");
  y = tableHeader(cv, y, itemCols);

  let grandItemTotal = 0;
  for (const { name, doc, list } of grouped.values()) {
    if (!isSingle) {
      const groupLabel = doc ? `${name}   ${doc}` : name;
      y = groupHeader(cv, y, groupLabel, ensureSpace);
    }
    let sub = 0;
    let rowIdx = 0;
    for (const p of list) {
      for (const item of p.items) {
        const bg: [number, number, number] = rowIdx % 2 === 0 ? [1, 1, 1] : [0.975, 0.975, 0.985];
        y = tableRow(cv, y, itemCols, [
          item.code ?? "-",
          item.name,
          item.unit ?? "-",
          item.quantity.toLocaleString("pt-BR", { maximumFractionDigits: 3 }),
          brl(item.totalPrice),
        ], bg, ensureSpace);
        sub += item.totalPrice;
        rowIdx++;
      }
    }
    if (!isSingle) {
      y = subtotalRow(cv, y, `Subtotal itens — ${name}`, brl(sub));
    }
    grandItemTotal += sub;
  }
  y = subtotalRow(cv, y, "TOTAL ITENS", brl(grandItemTotal));
  y -= 16;

  // ── Section 3: Parcelas e Vencimentos ────────────────────────────────────────
  const hasInstallments = data.purchases.some((p) => p.installments.length > 0);
  if (hasInstallments) {
    ensureSpace(60);
    y = sectionHeading(cv, y, "Parcelas e Vencimentos");
    y = tableHeader(cv, y, instCols);

    for (const { name, doc, list } of grouped.values()) {
      if (!isSingle) {
        const groupLabel = doc ? `${name}   ${doc}` : name;
        y = groupHeader(cv, y, groupLabel, ensureSpace);
      }
      let rowIdx = 0;
      for (const p of list) {
        for (const inst of p.installments) {
          const bg: [number, number, number] = rowIdx % 2 === 0 ? [1, 1, 1] : [0.975, 0.975, 0.985];
          const statusLabel = inst.isPaid ? "Pago" : inst.isOverdue ? "Vencido" : "Em aberto";
          y = tableRow(cv, y, instCols, [
            p.purchaseNumber ?? "-",
            p.invoiceNumber  ?? "-",
            inst.installmentNum != null ? String(inst.installmentNum) : "-",
            fmtDate(inst.dueDate),
            brl(inst.amount),
            statusLabel,
          ], bg, ensureSpace);
          rowIdx++;
        }
      }
    }

    // Installment summary bar
    ensureSpace(22);
    cv.rect(MX, y - 20, CW, 20, [0.92, 0.94, 0.92], C_LINE, 0.4);
    const openOnly = Math.max(0, data.summary.openAmount - data.summary.overdueAmount);
    cv.txt(
      `Pago: ${brl(data.summary.paidAmount)}     Em aberto: ${brl(openOnly)}     Vencido: ${brl(data.summary.overdueAmount)}`,
      MX + 8, y - 12, 7.5, F_BOLD, C_DARK
    );
    y -= 20;
  }

  // Update total page count now that we know it
  totalPages = cv.pages.length;

  return encodePdf(cv);
}
