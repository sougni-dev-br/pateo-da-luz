// ─── Types ────────────────────────────────────────────────────────────────────

type ExpenseItem = {
  dreCategoryId: string | null;
  dreCategoryName: string;
  dreGroup: string;
  sortOrder: number;
  total: number;
  count: number;
};

type ExpenseGroup = {
  key: string;
  label: string;
  sortOrder: number;
  total: number;
  lines: ExpenseItem[];
};

export type DreSummary = {
  period: { from: string; to: string };
  revenue: {
    byChannel: Record<string, number>;
    grossAmount: number;
    discounts: number;
    platformFees: number;
    deductions: number;
    netAmount: number;
    serviceAmount: number;
    tickets: number;
  };
  cmv: {
    estoqueInicial: number;
    compras: number;
    estoqueFinal: number;
    cmvReal: number;
    cmvPercent: number | null;
    hasInventoryData?: boolean;
    warning?: string | null;
  };
  lucroBruto: number;
  margemBruta: number | null;
  expenses: ExpenseItem[];
  expenseGroups?: ExpenseGroup[];
  totalExpenses: number;
  ebitda: number;
  ebitdaPercent: number | null;
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

// ─── Colors ────────────────────────────────────────────────────────────────────

const C_INK   : [number, number, number] = [0.086, 0.086, 0.094];
const C_MUTED : [number, number, number] = [0.40,  0.42,  0.47 ];
const C_DARK  : [number, number, number] = [0.118, 0.133, 0.165];
const C_GOLD  : [number, number, number] = [0.557, 0.463, 0.208];
const C_LINE  : [number, number, number] = [0.84,  0.86,  0.89 ];
const C_WHITE : [number, number, number] = [1,     1,     1    ];
const C_GREEN : [number, number, number] = [0.12,  0.44,  0.19 ];
const C_RED   : [number, number, number] = [0.70,  0.17,  0.15 ];

type Tone = "neutral" | "success" | "warning" | "danger" | "dark" | "info";

const TONES: Record<Tone, { bg: [number, number, number]; val: [number, number, number] }> = {
  neutral: { bg: [0.96,  0.96,  0.97 ], val: C_INK },
  success: { bg: [0.90,  0.96,  0.91 ], val: C_GREEN },
  warning: { bg: [1.00,  0.96,  0.87 ], val: [0.58, 0.38, 0.06] },
  danger:  { bg: [0.99,  0.91,  0.91 ], val: C_RED },
  info:    { bg: [0.90,  0.94,  1.00 ], val: [0.14, 0.36, 0.65] },
  dark:    { bg: C_DARK,                val: C_WHITE },
};

// ─── Utils ────────────────────────────────────────────────────────────────────

function cleanText(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // remove combining diacritics (NFD decomposed)
    .replace(/[–—−]/g, "-")           // all dash variants including U+2212 minus
    .replace(/ /g, " ")          // non-breaking space (U+00A0) used by toLocaleString
    .replace(/[^\x20-\x7E]/g, "")     // drop remaining non-ASCII
    .replace(/\s+/g, " ")
    .trim();
}

function escapePdf(v: unknown): string {
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

function pctFmt(v: number | null): string {
  return v == null ? "-" : `${v.toFixed(1)}%`;
}

function rgb(r: number, g: number, b: number): string {
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR");
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

  rtxt(text: string, rightX: number, y: number, size = 9, font: Font = F_REG, color: [number, number, number] = C_INK) {
    this.txt(text, rightX - estW(cleanText(text), size, font === F_BOLD), y, size, font, color);
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

function drawHeader(cv: Canvas, code: string, pageNum: number, totalPages: number) {
  const topY = PAGE_H - MT;
  cv.txt("Pateo da Luz", MX, topY, 16, F_BOLD, C_INK);
  cv.txt("DRE Gerencial", MX, topY - 17, 8.5, F_ITAL, C_MUTED);
  cv.rtxt(code, PAGE_W - MX, topY, 14, F_BOLD, C_GOLD);
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
  const vLines = wrapText(value, w - 16, 12, true);
  vLines.forEach((ln, i) => cv.txt(ln, x + 8, y - 30 - i * 13, 12, F_BOLD, pal.val));
}

function sectionHeading(cv: Canvas, y: number, title: string): number {
  cv.txt(title.toUpperCase(), MX, y, 8, F_BOLD, [0.35, 0.37, 0.41]);
  cv.line(MX, y - 4, PAGE_W - MX, y - 4, 0.5, C_LINE);
  return y - 16;
}

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

export function createDrePdf(data: DreSummary, extras?: { operationalUncatCount?: number; operationalUncatTotal?: number }): Buffer {
  const cv = new Canvas();

  const dateFrom = fmtDate(data.period.from);
  const dateTo   = fmtDate(data.period.to);
  const periodLabel = `${dateFrom}  ate  ${dateTo}`;

  // Code: DRE-YYYY-MM
  const fromDate = new Date(data.period.from);
  const code = `DRE-${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, "0")}`;

  // Status
  const hasInventory = data.cmv.hasInventoryData ?? false;
  const status = hasInventory ? "ABERTO" : "ESTIMADO";
  const statusColors: Record<string, [number, number, number]> = {
    ABERTO:   [0.14, 0.50, 0.28],
    ESTIMADO: [0.55, 0.35, 0.05],
  };
  const statusBg: Record<string, [number, number, number]> = {
    ABERTO:   [0.88, 0.97, 0.90],
    ESTIMADO: [1.00, 0.95, 0.85],
  };

  // Rough page count estimate
  const groupCount   = (data.expenseGroups ?? []).length;
  const catCount     = data.expenses.length;
  const chanCount    = Object.keys(data.revenue.byChannel).length;
  const totalPages = 1 + Math.ceil((groupCount + catCount + chanCount - 15) / 30);

  const MIN_Y = MB + 28;
  let pageIdx = 1;

  const ensureSpace = (need: number) => {
    if (y - need >= MIN_Y) return;
    cv.newPage();
    pageIdx++;
    drawHeader(cv, code, pageIdx, totalPages);
    y = PAGE_H - MT - 46;
  };

  drawHeader(cv, code, 1, totalPages);
  let y = PAGE_H - MT - 46;

  // ── Title block ──────────────────────────────────────────────────────────────
  cv.txt("DRE Gerencial", MX, y, 13, F_BOLD, C_INK);
  y -= 18;
  cv.txt(`Periodo: ${periodLabel}`, MX, y, 8.5, F_REG, C_MUTED);

  // Status badge
  const sLabel = status;
  const sW = estW(sLabel, 7.5, true) + 14;
  const sX = PAGE_W - MX - sW;
  cv.rect(sX, y - 4, sW, 15, statusBg[status] ?? [0.95, 0.95, 0.95]);
  cv.txt(sLabel, sX + 7, y + 6, 7.5, F_BOLD, statusColors[status] ?? C_MUTED);

  cv.txt(`Gerado em: ${new Date().toLocaleString("pt-BR")}`, MX, y - 13, 7.5, F_REG, C_MUTED);
  y -= 34;

  // ── Formula block ─────────────────────────────────────────────────────────────
  cv.rect(MX, y - 28, CW, 28, [0.97, 0.97, 0.99], C_LINE, 0.6);
  cv.txt("Formula: Receita Bruta - CMV - Despesas Operacionais = Lucro Operacional", MX + 12, y - 17, 8, F_ITAL, [0.30, 0.30, 0.38]);
  y -= 40;

  // ── Aviso receita zero ────────────────────────────────────────────────────────
  if (data.revenue.grossAmount === 0) {
    cv.rect(MX, y - 32, CW, 32, [1.00, 0.95, 0.85], [0.75, 0.50, 0.15], 0.7);
    cv.txt("Atencao: Nao ha faturamento lancado neste periodo.", MX + 12, y - 14, 8, F_BOLD, [0.55, 0.35, 0.05]);
    cv.txt("Percentuais e margem nao podem ser calculados.", MX + 12, y - 25, 7.5, F_REG, [0.55, 0.35, 0.05]);
    y -= 44;
  }

  // ── CMV estimado aviso ────────────────────────────────────────────────────────
  if (data.cmv.warning) {
    cv.rect(MX, y - 28, CW, 28, [1.00, 0.96, 0.90], [0.75, 0.45, 0.20], 0.7);
    const warnLines = wrapText(data.cmv.warning, CW - 24, 7.5);
    warnLines.forEach((ln, i) => cv.txt(ln, MX + 12, y - 12 - i * 10, 7.5, F_ITAL, [0.55, 0.30, 0.10]));
    y -= 38 + Math.max(0, warnLines.length - 1) * 10;
  }

  // ── Cards row 1: Receita Bruta, CMV, Lucro Bruto ─────────────────────────────
  const cardW = (CW - 20) / 3;
  const cardH = 52;
  const gap   = 10;

  const cmvTone: Tone = data.cmv.cmvPercent != null && data.cmv.cmvPercent > 35 ? "warning" : "neutral";

  card(cv, MX,                    y, cardW, cardH, "Receita Bruta",
    brl(data.revenue.grossAmount), "neutral");
  card(cv, MX + cardW + gap,       y, cardW, cardH,
    hasInventory ? "CMV Real" : "CMV (estimado)",
    `${brl(data.cmv.cmvReal)}  ${pctFmt(data.cmv.cmvPercent)}`, cmvTone);
  card(cv, MX + (cardW + gap) * 2, y, cardW, cardH, "Lucro Bruto",
    `${brl(data.lucroBruto)}  ${pctFmt(data.margemBruta)}`,
    data.lucroBruto >= 0 ? "success" : "danger");
  y -= cardH + gap;

  // ── Cards row 2: Total Despesas, Lucro Operacional, Margem ───────────────────
  const despPct = data.revenue.grossAmount > 0
    ? (data.totalExpenses / data.revenue.grossAmount) * 100
    : null;

  card(cv, MX,                    y, cardW, cardH, "Total Despesas",
    `${brl(data.totalExpenses)}  ${pctFmt(despPct)}`, "neutral");
  card(cv, MX + cardW + gap,       y, cardW, cardH, "Lucro Operacional",
    `${brl(data.ebitda)}  ${pctFmt(data.ebitdaPercent)}`,
    data.ebitda >= 0 ? "success" : "danger");
  card(cv, MX + (cardW + gap) * 2, y, cardW, cardH, "Margem Operacional",
    pctFmt(data.ebitdaPercent),
    data.ebitdaPercent != null && data.ebitdaPercent >= 10 ? "success"
      : data.ebitdaPercent != null && data.ebitdaPercent < 0 ? "danger"
      : "neutral");
  y -= cardH + 20;

  // ── Receitas por canal ────────────────────────────────────────────────────────
  const channels = Object.entries(data.revenue.byChannel).sort((a, b) => b[1] - a[1]);
  if (channels.length > 0) {
    ensureSpace(60 + channels.length * 18);
    y = sectionHeading(cv, y, "Receitas por Canal");

    const chanCols: ColDef[] = [
      { label: "Canal",        width: 300 },
      { label: "% Rec. Bruta", width: 100, align: "right" },
      { label: "Total",        width: 131, align: "right", bold: true },
    ];
    y = tableHeader(cv, y, chanCols);

    const totalGross = data.revenue.grossAmount;
    channels.forEach(([ch, gross], idx) => {
      const bg: [number, number, number] = idx % 2 === 0 ? [1, 1, 1] : [0.975, 0.975, 0.985];
      const chanPct = totalGross > 0 ? (gross / totalGross) * 100 : null;
      y = tableRow(cv, y, chanCols, [
        ch,
        pctFmt(chanPct),
        brl(gross),
      ], bg, ensureSpace);
    });
    // Total row
    const totalBg: [number, number, number] = [0.93, 0.95, 0.93];
    cv.rect(MX, y - 16, CW, 16, totalBg, C_LINE, 0.4);
    cv.txt("TOTAL (receita bruta)", MX + 4, y - 10, 7.5, F_BOLD, C_DARK);
    cv.rtxt(brl(data.revenue.grossAmount), MX + CW - 4, y - 10, 7.5, F_BOLD, C_DARK);
    y -= 16;
    y -= 16;
  }

  // ── Despesas por grupo DRE ────────────────────────────────────────────────────
  const groups = data.expenseGroups ?? [];
  if (groups.length > 0) {
    ensureSpace(60 + groups.length * 20);
    y = sectionHeading(cv, y, "Despesas por Grupo DRE");

    // grpCols soma exata: 262+65+72+132 = 531 = CW
    const grpCols: ColDef[] = [
      { label: "Grupo",        width: 262 },
      { label: "Categorias",   width: 65,  align: "right" },
      { label: "% Rec. Bruta", width: 72,  align: "right" },
      { label: "Total",        width: 132, align: "right", bold: true },
    ];
    y = tableHeader(cv, y, grpCols);

    groups.forEach((grp, idx) => {
      const bg: [number, number, number] = idx % 2 === 0 ? [1, 1, 1] : [0.975, 0.975, 0.985];
      const gpct = data.revenue.grossAmount > 0
        ? (grp.total / data.revenue.grossAmount) * 100
        : null;
      y = tableRow(cv, y, grpCols, [
        grp.label,
        String(grp.lines.length),
        pctFmt(gpct),
        brl(grp.total),
      ], bg, ensureSpace);
    });
    // Total row — posições derivadas das larguras de grpCols
    const totalBg: [number, number, number] = [0.92, 0.94, 0.92];
    cv.rect(MX, y - 16, CW, 16, totalBg, C_LINE, 0.4);
    cv.txt("TOTAL DESPESAS", MX + 4, y - 10, 7.5, F_BOLD, C_DARK);
    const tdPct = data.revenue.grossAmount > 0 ? (data.totalExpenses / data.revenue.grossAmount) * 100 : null;
    const pctColRightX = MX + 262 + 65 + 72; // fim da coluna %
    cv.txt(pctFmt(tdPct), pctColRightX - 4 - estW(pctFmt(tdPct), 7.5), y - 10, 7.5, F_BOLD, C_DARK);
    cv.rtxt(brl(data.totalExpenses), MX + CW - 4, y - 10, 7.5, F_BOLD, C_DARK);
    y -= 16;
    y -= 16;
  }

  // ── Despesas por categoria ────────────────────────────────────────────────────
  const allCats = groups.length > 0
    ? groups.flatMap((g) => g.lines.map((l) => ({ ...l, groupLabel: g.label })))
    : data.expenses.map((e) => ({ ...e, groupLabel: e.dreGroup }));

  if (allCats.length > 0) {
    ensureSpace(60);
    y = sectionHeading(cv, y, "Despesas por Categoria");

    // catCols soma exata: 185+165+72+109 = 531 = CW
    const catCols: ColDef[] = [
      { label: "Categoria",    width: 185 },
      { label: "Grupo",        width: 165 },
      { label: "% Rec. Bruta", width: 72,  align: "right" },
      { label: "Total",        width: 109, align: "right", bold: true },
    ];
    y = tableHeader(cv, y, catCols);

    allCats.forEach((cat, idx) => {
      const bg: [number, number, number] = idx % 2 === 0 ? [1, 1, 1] : [0.975, 0.975, 0.985];
      const cpct = data.revenue.grossAmount > 0
        ? (cat.total / data.revenue.grossAmount) * 100
        : null;
      y = tableRow(cv, y, catCols, [
        cat.dreCategoryName,
        cat.groupLabel,
        pctFmt(cpct),
        brl(cat.total),
      ], bg, ensureSpace);
    });
    y -= 16;
  }

  // ── Lucro Operacional destaque ────────────────────────────────────────────────
  ensureSpace(44);
  const ebitdaTone: [number, number, number] = data.ebitda >= 0 ? C_DARK : [0.45, 0.10, 0.09];
  cv.rect(MX, y - 36, CW, 36, ebitdaTone);
  cv.txt(
    `(=) LUCRO OPERACIONAL  [${pctFmt(data.ebitdaPercent)} da rec. bruta]`,
    MX + 10, y - 22, 10, F_BOLD, C_WHITE
  );
  cv.rtxt(brl(data.ebitda), MX + CW - 10, y - 22, 10, F_BOLD,
    data.ebitda >= 0 ? ([0.72, 0.98, 0.73] as [number, number, number]) : ([1, 0.82, 0.82] as [number, number, number])
  );
  y -= 44;

  // ── Observacoes gerenciais ────────────────────────────────────────────────────
  ensureSpace(60);
  y = sectionHeading(cv, y, "Observacoes Gerenciais");

  const obs: string[] = [];
  if (!hasInventory) {
    obs.push("CMV estimado: nao ha inventario inicial e final fechado para este periodo. O valor exibido considera compras do periodo, nao consumo real.");
  }
  if (data.revenue.grossAmount === 0) {
    obs.push("Nenhum faturamento registrado neste periodo. Verifique se as receitas foram importadas corretamente.");
  }
  if (data.expenses.filter((e) => e.dreCategoryId === null).length > 0) {
    const operationalCount = extras?.operationalUncatCount ?? 0;
    const operationalTotal = extras?.operationalUncatTotal ?? 0;
    if (operationalCount > 0) {
      obs.push(`${operationalCount} despesa(s) operacional(is) sem categoria DRE totalizando ${brl(operationalTotal)}. Use DRE Gerencial > Classificar Despesas para atribuir categorias e obter um DRE mais preciso.`);
    } else {
      obs.push("Ha lancamentos de compra sem categoria DRE, porem todos sao compras de estoque ja incluidas no CMV e nao requerem classificacao adicional.");
    }
  }
  if (obs.length === 0) {
    obs.push("Nenhuma observacao gerencial para este periodo.");
  }

  const obsBg: [number, number, number] = [0.97, 0.97, 0.99];
  obs.forEach((ob) => {
    const obLines = wrapText(ob, CW - 24, 7.5);
    const obH = Math.max(24, obLines.length * 10 + 8);
    ensureSpace(obH + 4);
    cv.rect(MX, y - obH, CW, obH, obsBg, C_LINE, 0.4);
    obLines.forEach((ln, i) => cv.txt(ln, MX + 12, y - 12 - i * 10, 7.5, F_ITAL, C_MUTED));
    y -= obH + 6;
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
