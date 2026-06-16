// ─── Types ────────────────────────────────────────────────────────────────────

type ExpenseItem = { dreCategoryId: string | null; dreCategoryName: string; sortOrder: number; total: number; count: number };

export type DreSummary = {
  period: { from: string; to: string };
  revenue: {
    byChannel: Record<string, number>;
    grossAmount: number;
    discounts: number;
    platformFees: number;
    deductions: number;
    netAmount: number;
    tickets: number;
  };
  cmv: { estoqueInicial: number; compras: number; estoqueFinal: number; cmvReal: number; cmvPercent: number | null };
  lucroBruto: number;
  margemBruta: number | null;
  expenses: ExpenseItem[];
  totalExpenses: number;
  ebitda: number;
  ebitdaPercent: number | null;
};

// ─── Page constants ────────────────────────────────────────────────────────────

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MX = 36;
const MT = 38;
const MB = 32;
const CW = PAGE_W - MX * 2;

// ─── Fonts / Colors ────────────────────────────────────────────────────────────

const F_REG  = "F1";
const F_BOLD = "F2";
const F_ITAL = "F3";
type Font = typeof F_REG | typeof F_BOLD | typeof F_ITAL;

const C_INK   : [number,number,number] = [0.086, 0.086, 0.094];
const C_MUTED : [number,number,number] = [0.40,  0.42,  0.47 ];
const C_DARK  : [number,number,number] = [0.118, 0.133, 0.165];
const C_GOLD  : [number,number,number] = [0.557, 0.463, 0.208];
const C_LINE  : [number,number,number] = [0.84,  0.86,  0.89 ];
const C_WHITE : [number,number,number] = [1,     1,     1    ];
const C_GREEN : [number,number,number] = [0.12,  0.44,  0.19 ];
const C_RED   : [number,number,number] = [0.70,  0.17,  0.15 ];
const C_BG    : [number,number,number] = [0.97,  0.97,  0.98 ];
const C_BG2   : [number,number,number] = [0.93,  0.96,  0.93 ];
const C_BG3   : [number,number,number] = [0.99,  0.95,  0.93 ];

// ─── Utils ────────────────────────────────────────────────────────────────────

function escapePdf(v: unknown) {
  const text = String(v ?? "").normalize("NFC").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
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
  return String(text ?? "").length * size * (bold ? 0.56 : 0.52);
}

function rgb(r: number, g: number, b: number) { return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`; }

function brl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function pct(v: number | null) {
  return v == null ? "-" : `${v.toFixed(1)}%`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR");
}

// ─── Canvas ────────────────────────────────────────────────────────────────────

class Canvas {
  pages: { cmds: string[] }[] = [{ cmds: [] }];
  get page() { return this.pages[this.pages.length - 1]; }
  newPage() { this.pages.push({ cmds: [] }); }

  txt(text: string, x: number, y: number, size = 9, font: Font = F_REG, color: [number,number,number] = C_INK) {
    this.page.cmds.push("BT", `/${font} ${size} Tf`, `${rgb(...color)} rg`,
      `${x.toFixed(2)} ${y.toFixed(2)} Td`, `(${escapePdf(text)}) Tj`, "ET");
  }

  rtxt(text: string, rightX: number, y: number, size = 9, font: Font = F_REG, color: [number,number,number] = C_INK) {
    const w = estW(String(text), size, font === F_BOLD);
    this.txt(text, rightX - w, y, size, font, color);
  }

  line(x1: number, y1: number, x2: number, y2: number, lw = 0.6, color: [number,number,number] = C_LINE) {
    this.page.cmds.push("q", `${lw.toFixed(2)} w`, `${rgb(...color)} RG`,
      `${x1.toFixed(2)} ${y1.toFixed(2)} m`, `${x2.toFixed(2)} ${y2.toFixed(2)} l`, "S", "Q");
  }

  rect(x: number, y: number, w: number, h: number, fill?: [number,number,number], stroke?: [number,number,number], sw = 0.6) {
    this.page.cmds.push("q");
    if (fill)   this.page.cmds.push(`${rgb(...fill)} rg`);
    if (stroke) this.page.cmds.push(`${rgb(...stroke)} RG`, `${sw.toFixed(2)} w`);
    this.page.cmds.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`);
    this.page.cmds.push(fill && stroke ? "B" : fill ? "f" : "S");
    this.page.cmds.push("Q");
  }
}

// ─── Build PDF ────────────────────────────────────────────────────────────────

export function createDrePdf(data: DreSummary): Buffer {
  const cv = new Canvas();

  const dateFrom = fmtDate(data.period.from);
  const dateTo   = fmtDate(data.period.to);
  const periodLabel = `${dateFrom} a ${dateTo}`;

  // ── Header ──────────────────────────────────
  const TOP = PAGE_H - MT;
  cv.txt("Pateo da Luz", MX, TOP, 16, F_BOLD, C_INK);
  cv.txt("Demonstrativo de Resultado Gerencial (DRE)", MX, TOP - 17, 8.5, F_ITAL, C_MUTED);
  const pw = estW(periodLabel, 10, true);
  cv.txt(periodLabel, PAGE_W - MX - pw, TOP, 10, F_BOLD, C_GOLD);
  cv.line(MX, TOP - 28, PAGE_W - MX, TOP - 28, 0.8, C_LINE);

  let y = TOP - 44;

  // ── Revenue block ───────────────────────────
  y = drawSection(cv, y, "RECEITAS", C_DARK);

  const channels = Object.entries(data.revenue.byChannel).sort((a, b) => b[1] - a[1]);
  for (const [ch, val] of channels) {
    y = drawLine(cv, y, `  Receita bruta - ${ch}`, brl(val), false, C_BG, false);
  }
  y = drawLine(cv, y, "(−) Descontos e taxas de plataforma", brl(-data.revenue.deductions), false, undefined, false, C_RED);
  y = drawTotal(cv, y, "(=) RECEITA LIQUIDA", brl(data.revenue.netAmount), C_BG2);

  y -= 6;

  // ── CMV block ───────────────────────────────
  y = drawSection(cv, y, "CUSTO DA MERCADORIA VENDIDA (CMV REAL)", C_DARK);
  y = drawLine(cv, y, "  Estoque inicial",                       brl(data.cmv.estoqueInicial), false, C_BG);
  y = drawLine(cv, y, "(+) Compras no periodo",                  brl(data.cmv.compras),        false, C_BG);
  y = drawLine(cv, y, "(−) Estoque final",                       brl(-data.cmv.estoqueFinal),  false, C_BG, false, C_RED);
  y = drawTotal(cv, y, `(=) CMV REAL  [${pct(data.cmv.cmvPercent)} da rec. bruta]`, brl(data.cmv.cmvReal),
    data.cmv.cmvPercent != null && data.cmv.cmvPercent > 35 ? C_BG3 : C_BG2);

  y -= 6;

  // ── Lucro bruto ─────────────────────────────
  const lbColor: [number,number,number] = data.lucroBruto >= 0 ? [0.87, 0.96, 0.89] : [0.99, 0.91, 0.91];
  y = drawTotal(cv, y,
    `(=) LUCRO BRUTO  [margem ${pct(data.margemBruta)}]`,
    brl(data.lucroBruto), lbColor, true);

  y -= 8;

  // ── Despesas ────────────────────────────────
  y = drawSection(cv, y, "DESPESAS OPERACIONAIS", C_DARK);

  const sorted = [...data.expenses].sort((a, b) => a.sortOrder - b.sortOrder || a.dreCategoryName.localeCompare(b.dreCategoryName));
  for (const exp of sorted) {
    const pctOfRev = data.revenue.grossAmount > 0 ? (exp.total / data.revenue.grossAmount) * 100 : null;
    const label = `  ${exp.dreCategoryName}`;
    const val = brl(exp.total);
    y = drawLine(cv, y, label, val, false, C_BG, false, undefined, pctOfRev != null ? `${pctOfRev.toFixed(1)}%` : "");

    if (y < MB + 60) { cv.newPage(); y = TOP; drawPageHeader(cv, periodLabel, TOP); y -= 44; }
  }

  y = drawTotal(cv, y, "(=) TOTAL DE DESPESAS", brl(data.totalExpenses), C_BG3);

  y -= 8;

  // ── EBITDA ──────────────────────────────────
  const ebitdaColor: [number,number,number] = data.ebitda >= 0 ? [0.84, 0.96, 0.87] : [0.99, 0.87, 0.87];
  cv.rect(MX, y - 26, CW, 26, data.ebitda >= 0 ? C_DARK : [0.45, 0.10, 0.09]);
  cv.txt(`(=) EBITDA GERENCIAL  [${pct(data.ebitdaPercent)} da rec. bruta]`, MX + 8, y - 17, 9.5, F_BOLD, C_WHITE);
  cv.rtxt(brl(data.ebitda), MX + CW - 8, y - 17, 9.5, F_BOLD, data.ebitda >= 0 ? [0.72, 0.98, 0.73] : [1, 0.82, 0.82]);
  y -= 34;

  // ── Footer ──────────────────────────────────
  cv.line(MX, MB + 8, PAGE_W - MX, MB + 8, 0.5, C_LINE);
  cv.txt(`Gerado em ${new Date().toLocaleDateString("pt-BR", { day:"2-digit", month:"long", year:"numeric" })}`, MX, MB - 2, 7.5, F_REG, C_MUTED);
  cv.txt("DRE Gerencial - Pateo da Luz", PAGE_W - MX - estW("DRE Gerencial - Pateo da Luz", 7.5), MB - 2, 7.5, F_REG, C_MUTED);

  return buildPdf(cv);
}

// ─── Drawing helpers ──────────────────────────────────────────────────────────

function drawPageHeader(cv: Canvas, periodLabel: string, TOP: number) {
  cv.txt("Pateo da Luz  —  DRE Gerencial", MX, TOP, 11, F_BOLD, C_INK);
  cv.rtxt(periodLabel, PAGE_W - MX, TOP, 9, F_ITAL, C_MUTED);
  cv.line(MX, TOP - 14, PAGE_W - MX, TOP - 14, 0.6, C_LINE);
}

function drawSection(cv: Canvas, y: number, title: string, _bg: [number,number,number]): number {
  cv.line(MX, y - 1, PAGE_W - MX, y - 1, 0.5, [0.70, 0.72, 0.76]);
  cv.txt(title, MX, y - 12, 8, F_BOLD, [0.35, 0.37, 0.42]);
  return y - 24;
}

function drawLine(
  cv: Canvas, y: number,
  label: string, value: string,
  bold = false,
  bg?: [number,number,number],
  _indent = false,
  valColor?: [number,number,number],
  pctLabel?: string
): number {
  const ROW_H = 17;
  if (bg) cv.rect(MX, y - ROW_H, CW, ROW_H, bg);
  cv.txt(label, MX + 6, y - 11, 8.5, bold ? F_BOLD : F_REG, C_INK);
  if (pctLabel) cv.txt(pctLabel, MX + CW - 56, y - 11, 7.5, F_REG, C_MUTED);
  cv.rtxt(value, MX + CW - 6, y - 11, 8.5, bold ? F_BOLD : F_REG, valColor ?? C_INK);
  cv.line(MX, y - ROW_H, PAGE_W - MX, y - ROW_H, 0.3, C_LINE);
  return y - ROW_H;
}

function drawTotal(cv: Canvas, y: number, label: string, value: string, bg: [number,number,number], strong = false): number {
  const ROW_H = 20;
  cv.rect(MX, y - ROW_H, CW, ROW_H, bg, C_LINE, 0.5);
  cv.txt(label, MX + 6, y - 13, strong ? 9.5 : 9, F_BOLD, C_DARK);
  cv.rtxt(value, MX + CW - 6, y - 13, strong ? 9.5 : 9, F_BOLD, C_DARK);
  return y - ROW_H;
}

// ─── PDF serializer ────────────────────────────────────────────────────────────

function buildPdf(cv: Canvas): Buffer {
  const fontHelv = "/Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding";
  const fontBold = "/Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding";
  const fontItal = "/Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding";

  const objs: string[] = [];
  const offsets: number[] = [];
  let pos = 0;

  function addObj(content: string) {
    const n = objs.length + 1;
    const full = `${n} 0 obj\n${content}\nendobj\n`;
    objs.push(full);
    return n;
  }

  const f1 = addObj(`<<${fontHelv}>>`);
  const f2 = addObj(`<<${fontBold}>>`);
  const f3 = addObj(`<<${fontItal}>>`);
  const fontDict = `<</F1 ${f1} 0 R /F2 ${f2} 0 R /F3 ${f3} 0 R>>`;

  const pageObjs: number[] = [];
  let pagesRef = 0;

  for (const pg of cv.pages) {
    const stream = pg.cmds.join("\n");
    const streamBytes = Buffer.from(stream, "latin1");
    const len = streamBytes.length;
    const contentId = addObj(`<<\n/Length ${len}\n>>\nstream\n${stream}\nendstream`);
    const pageId = addObj(
      `<<\n/Type /Page\n/Parent ${cv.pages.length + 3 + 1} 0 R\n/MediaBox [0 0 ${PAGE_W.toFixed(2)} ${PAGE_H.toFixed(2)}]\n/Contents ${contentId} 0 R\n/Resources <<\n/Font ${fontDict}\n>>\n>>`
    );
    pageObjs.push(pageId);
  }

  pagesRef = addObj(
    `<<\n/Type /Pages\n/Kids [${pageObjs.map((n) => `${n} 0 R`).join(" ")}]\n/Count ${pageObjs.length}\n>>`
  );

  const catalogId = addObj(`<<\n/Type /Catalog\n/Pages ${pagesRef} 0 R\n>>`);

  let buf = "%PDF-1.4\n";
  pos = buf.length;

  const xref: number[] = [];
  for (const obj of objs) {
    xref.push(pos);
    buf += obj;
    pos += Buffer.byteLength(obj, "latin1");
  }

  const xrefPos = pos;
  buf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of xref) {
    buf += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  buf += `trailer\n<<\n/Size ${objs.length + 1}\n/Root ${catalogId} 0 R\n>>\nstartxref\n${xrefPos}\n%%EOF\n`;

  // Fix page parent refs
  const correctedBuf = buf.replace(
    new RegExp(`${cv.pages.length + 3 + 1} 0 R`, "g"),
    `${pagesRef} 0 R`
  );

  return Buffer.from(correctedBuf, "latin1");
}
