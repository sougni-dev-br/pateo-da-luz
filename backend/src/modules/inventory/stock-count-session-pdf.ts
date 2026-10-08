// Folha de contagem em PDF: a mesma conta da tela (anterior + compras =
// esperado) e um quadro em branco para a quantidade, escrita à caneta e depois
// lançada no sistema. Agrupada por setor e categoria na ordem da tela.
// Gerador self-contained
// (sem dependência externa); boilerplate do motor de desenho clonado de
// operational-inventory-pdf.ts.
type CountSessionPdfItem = {
  productCode: string | null;
  productName: string;
  sectorName: string | null;
  categoryName: string | null;
  unit: string | null;
  /** Ultima contagem aprovada do produto; `null` = nunca aprovado. */
  anterior: number | null;
  /** Compras recebidas desde a contagem anterior. */
  compras: number;
  notes: string | null;
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
  { key: "code",     label: "Código",     width: 40,  align: "left"  },
  { key: "product",  label: "Produto",    width: 205, align: "left"  },
  { key: "unit",     label: "Unid.",      width: 34,  align: "left"  },
  { key: "anterior", label: "Anterior",   width: 58,  align: "right" },
  { key: "compras",  label: "+ Compras",  width: 58,  align: "right" },
  { key: "esperado", label: "= Esperado", width: 62,  align: "right" },
  { key: "quantity", label: "Contado",    width: 74,  align: "right" },
] as const;
// sum = 40 + 205 + 34 + 58 + 58 + 62 + 74 = 531 ≈ CONTENT_WIDTH ✓
const COL_X = TABLE_COLS.map((_col, i) => MARGIN_X + TABLE_COLS.slice(0, i).reduce((soma, c) => soma + c.width, 0));

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
// A Helvetica do PDF so tem latin1: "–" virava caractere de controle e emoji
// virava "=". Troca o que tem equivalente e marca o resto com "?".
function paraLatin1(text: string) {
  return text
    .replace(/[\u2012-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[^\u0000-\u00FF]/gu, "?");
}
function escapePdf(v: unknown) {
  const text = paraLatin1(cleanText(v));
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
// Estimativa conservadora: o cadastro e quase todo em CAIXA ALTA, que na
// Helvetica mede bem mais que a media (0,52 deixava o nome invadir Unid.).
function estWidth(text: string, size: number, font: FontName) {
  return cleanText(text).length * size * (font === F_BOLD ? 0.68 : 0.6);
}
// Palavra maior que a coluna (codigo longo, nome sem espaco) e cortada por letra.
function partirPalavra(palavra: string, maxW: number, size: number, font: FontName): string[] {
  const pedacos: string[] = [];
  let atual = "";
  for (const letra of palavra) {
    if (atual && estWidth(atual + letra, size, font) > maxW) { pedacos.push(atual); atual = letra; }
    else atual += letra;
  }
  if (atual) pedacos.push(atual);
  return pedacos;
}
function truncar(v: unknown, maxW: number, size: number, font: FontName): string {
  const text = cleanText(v);
  if (estWidth(text, size, font) <= maxW) return text;
  let corte = text;
  while (corte.length > 1 && estWidth(`${corte}...`, size, font) > maxW) corte = corte.slice(0, -1);
  return `${corte}...`;
}
function wrapText(v: unknown, maxW: number, size: number, font: FontName): string[] {
  const text = cleanText(v);
  if (!text) return [""];
  if (estWidth(text, size, font) <= maxW) return [text];
  const words = text.split(" ").flatMap((w) => (estWidth(w, size, font) > maxW ? partirPalavra(w, maxW, size, font) : [w]));
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

// ─── Grouping: setor > categoria, como a tela ───────────────────────────────
type Row =
  | { kind: "sector"; label: string; count: number }
  | { kind: "category"; label: string }
  | { kind: "item";   item: CountSessionPdfItem };

const SEM_SETOR = "SEM SETOR";
const SEM_CATEGORIA = "Sem categoria";

// Setor vazio e setor nulo sao o mesmo "SEM SETOR", e vao para o fim.
const chaveDoGrupo = (v: string | null) => sortKey(cleanText(v) || null, "zzz");

function sortItems(items: CountSessionPdfItem[]) {
  return [...items].sort((a, b) => {
    const ka = [chaveDoGrupo(a.sectorName), chaveDoGrupo(a.categoryName), sortKey(a.productName)];
    const kb = [chaveDoGrupo(b.sectorName), chaveDoGrupo(b.categoryName), sortKey(b.productName)];
    for (let i = 0; i < ka.length; i++) {
      const d = ka[i].localeCompare(kb[i], "pt-BR");
      if (d) return d;
    }
    return 0;
  });
}

export function buildRows(items: CountSessionPdfItem[]): Row[] {
  const sorted = sortItems(items);
  const porSetor = new Map<string, number>();
  for (const item of sorted) {
    const sec = cleanText(item.sectorName) || SEM_SETOR;
    porSetor.set(sec, (porSetor.get(sec) ?? 0) + 1);
  }
  const rows: Row[] = [];
  let curSec: string | null = null;
  let curCat: string | null = null;
  for (const item of sorted) {
    const sec = cleanText(item.sectorName) || SEM_SETOR;
    const cat = cleanText(item.categoryName) || SEM_CATEGORIA;
    if (sec !== curSec) {
      rows.push({ kind: "sector", label: sec, count: porSetor.get(sec) ?? 0 });
      curSec = sec;
      curCat = null;
    }
    if (cat !== curCat) {
      rows.push({ kind: "category", label: cat });
      curCat = cat;
    }
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

// Quem contou e quem conferiu assinam no papel: a folha impressa volta para o
// lançamento e precisa dizer de quem é.
function drawSignatureBlock(cv: PdfCanvas, y: number): number {
  const h = 26;
  cv.rect(MARGIN_X, y - h, CONTENT_WIDTH, h, undefined, C_LINE, 0.6);
  const campos = [
    { label: "Contado por", width: 210 },
    { label: "Conferido por", width: 210 },
    { label: "Data", width: CONTENT_WIDTH - 420 }
  ];
  let x = MARGIN_X;
  campos.forEach((campo, i) => {
    cv.txt(campo.label.toUpperCase(), x + 7, y - 9, 6.5, F_BOLD, C_MUTED);
    cv.line(x + 7, y - 21, x + campo.width - 9, y - 21, 0.5, C_MUTED);
    if (i > 0) cv.line(x, y, x, y - h, 0.6, C_LINE);
    x += campo.width;
  });
  return y - h - 10;
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
  TABLE_COLS.forEach((col, i) => {
    const x = COL_X[i];
    if (col.align === "right") {
      const w = estWidth(col.label, 7.5, F_BOLD);
      cv.txt(col.label, x + col.width - 6 - w, y - 13, 7.5, F_BOLD, C_PAGE_BG);
    } else {
      cv.txt(col.label, x + 6, y - 13, 7.5, F_BOLD, C_PAGE_BG);
    }
  });
  return y - h;
}

// ─── Main export ─────────────────────────────────────────────────────────────
export function createStockCountSessionPdf(params: CreateStockCountSessionPdfParams): Buffer {
  const cv = new PdfCanvas();
  const rows = buildRows(params.items);

  drawPageHeader(cv, params);
  let y = PAGE_HEIGHT - MARGIN_TOP - 40;
  y = drawSignatureBlock(cv, y);
  y = drawTableHeader(cv, y);

  const MIN_Y = MARGIN_BOTTOM + 22;
  let zebra = false;

  // Pagina que comeca no meio de um grupo repete de onde sao os itens: a
  // folha solta na mao do estoquista nao pode depender da anterior.
  let grupoAtual: { setor: string; categoria: string } | null = null;
  const ensureSpace = (need: number, continuaGrupo = true): boolean => {
    if (y - need >= MIN_Y) return false;
    cv.newPage();
    drawPageHeader(cv, params);
    y = PAGE_HEIGHT - MARGIN_TOP - 40;
    y = drawTableHeader(cv, y);
    zebra = false;
    if (continuaGrupo && grupoAtual) {
      const h = 16;
      cv.txt(`${grupoAtual.setor}  ·  ${grupoAtual.categoria.toUpperCase()}  (continuação)`, MARGIN_X + 7, y - 11, 7, F_BOLD, C_GOLD);
      cv.line(MARGIN_X, y - h, MARGIN_X + CONTENT_WIDTH, y - h, 0.6, C_GOLD);
      y -= h;
    }
    return true;
  };

  // Titulo de grupo nunca fica sozinho no pe da pagina: pede espaco para ele
  // e pelo menos uma linha de item.
  const ITEM_MIN_H = 20;
  let setorAtual = "";
  const drawSectorRow = (label: string, count: number) => {
    setorAtual = label;
    const h = 17;
    ensureSpace(h + 16 + ITEM_MIN_H, false);
    grupoAtual = null;
    cv.rect(MARGIN_X, y - h, CONTENT_WIDTH, h, C_SECTOR_BG, C_LINE, 0.5);
    cv.txt(`SETOR: ${label}`, MARGIN_X + 7, y - 12, 8.5, F_BOLD, [0.22, 0.24, 0.28]);
    const total = `${count} ${count === 1 ? "item" : "itens"}`;
    cv.txt(total, MARGIN_X + CONTENT_WIDTH - 7 - estWidth(total, 7.5, F_REG), y - 12, 7.5, F_REG, C_MUTED);
    y -= h;
    zebra = false;
  };

  const drawCategoryRow = (label: string) => {
    const h = 16;
    // Quebra antes da categoria: o setor tambem precisa aparecer na pagina nova.
    if (ensureSpace(h + 15 + ITEM_MIN_H, false)) {
      cv.txt(`SETOR: ${setorAtual}  (continuação)`, MARGIN_X + 7, y - 11, 7.5, F_BOLD, [0.22, 0.24, 0.28]);
      y -= 15;
    }
    grupoAtual = { setor: setorAtual, categoria: label };
    cv.txt(label.toUpperCase(), MARGIN_X + 7, y - 11, 7, F_BOLD, C_GOLD);
    cv.line(MARGIN_X, y - h, MARGIN_X + CONTENT_WIDTH, y - h, 0.6, C_GOLD);
    y -= h;
    zebra = false;
  };

  for (const row of rows) {
    if (row.kind === "sector") { drawSectorRow(row.label, row.count); continue; }
    if (row.kind === "category") { drawCategoryRow(row.label); continue; }

    const item = row.item;
    const codeLines = wrapText(item.productCode || "-", TABLE_COLS[0].width - 8, 7.5, F_REG);
    const nameLines = wrapText(item.productName,        TABLE_COLS[1].width - 12, 8, F_BOLD);
    // Observacao longa nao pode empurrar a linha por cima do rodape.
    const MAX_LINHAS_OBS = 3;
    const todasObs = item.notes ? wrapText(`Obs.: ${item.notes}`, TABLE_COLS[1].width - 12, 7, F_ITAL) : [];
    const noteLines = todasObs.length > MAX_LINHAS_OBS
      ? [...todasObs.slice(0, MAX_LINHAS_OBS - 1), `${todasObs[MAX_LINHAS_OBS - 1]}...`]
      : todasObs;
    const unitText  = truncar(item.unit || "-", TABLE_COLS[2].width - 8, 8, F_REG);

    const lineCount = Math.max(codeLines.length, nameLines.length + noteLines.length);
    const rowH = Math.max(ITEM_MIN_H, lineCount * 10 + 8);
    ensureSpace(rowH);

    if (zebra) cv.rect(MARGIN_X, y - rowH, CONTENT_WIDTH, rowH, C_ZEBRA);
    zebra = !zebra;

    codeLines.forEach((ln, li) => cv.txt(ln, COL_X[0] + 4, y - 13 - li * 10, 7.5, F_REG, C_MUTED));
    nameLines.forEach((ln, li) => cv.txt(ln, COL_X[1] + 6, y - 13 - li * 10, 8, F_BOLD, C_INK));
    noteLines.forEach((ln, li) => cv.txt(ln, COL_X[1] + 6, y - 13 - (nameLines.length + li) * 10, 7, F_ITAL, C_MUTED));
    cv.txt(unitText, COL_X[2] + 6, y - 13, 8, F_REG, C_INK);

    // A conta da tela. Sem contagem aprovada nao ha esperado: o traco diz isso.
    const numeroNaColuna = (texto: string, col: number, font: FontName, color: [number, number, number]) => {
      const w = estWidth(texto, 8.5, font);
      cv.txt(texto, COL_X[col] + TABLE_COLS[col].width - 8 - w, y - 13, 8.5, font, color);
    };
    const temReferencia = item.anterior != null;
    numeroNaColuna(temReferencia ? fmtQty(item.anterior) : "-", 3, F_REG, C_MUTED);
    numeroNaColuna(temReferencia ? fmtQty(item.compras) : "-", 4, F_REG, C_MUTED);
    numeroNaColuna(temReferencia ? fmtQty((item.anterior ?? 0) + item.compras) : "-", 5, F_BOLD, C_INK);

    // Quantidade sempre em branco: e escrita a caneta e depois lancada.
    const qCol = TABLE_COLS[6];
    cv.rect(COL_X[6] + 8, y - 16, qCol.width - 14, 13, C_PAGE_BG, C_INK, 0.7);

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
