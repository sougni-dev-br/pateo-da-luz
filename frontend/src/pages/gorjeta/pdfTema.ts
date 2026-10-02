// Identidade dos PDFs da gorjeta (envio à contabilidade, folha de líquidos): paleta,
// margem e o pedaço do jsPDF que eles usam. Cabeçalho e rodapé saem iguais nos dois.
import { textoPdf } from "./envioContabilidade";

export type Doc = {
  setFont: (f: string, s?: string) => void; setFontSize: (n: number) => void;
  setTextColor: (...c: number[]) => void; setDrawColor: (...c: number[]) => void; setFillColor: (...c: number[]) => void;
  setLineWidth: (n: number) => void; getTextWidth: (t: string) => number; text: (t: string | string[], x: number, y: number, o?: Record<string, unknown>) => void;
  splitTextToSize: (t: string, largura: number) => string[];
  line: (x1: number, y1: number, x2: number, y2: number) => void;
  rect: (x: number, y: number, w: number, h: number, s?: string) => void;
  roundedRect: (x: number, y: number, w: number, h: number, rx: number, ry: number, s?: string) => void;
  addPage: () => void; setPage: (n: number) => void; getNumberOfPages: () => number;
  internal: { pageSize: { getWidth: () => number; getHeight: () => number } };
  lastAutoTable: { finalY: number };
  save: (nome: string) => void;
};
export type AutoTable = (doc: unknown, options: Record<string, unknown>) => void;

export const MARROM = [107, 79, 42] as const;
export const BEGE = [246, 242, 235] as const;
export const LISTRA = [251, 249, 245] as const;
export const LINHA = [226, 219, 207] as const;
export const TINTA = [38, 32, 26] as const;
export const CINZA = [118, 110, 100] as const;
export const AMBAR = [166, 88, 10] as const;
export const M = 14; // margem

export type Selo = { texto: string; tom: "ok" | "aviso" };

/** Faixa marrom, marca, título, linha de apoio e o selo de situação no canto. */
export function cabecalhoPdf(doc: Doc, o: { titulo: string; apoio: string; codigo?: string | null; selo: Selo }) {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(...MARROM);
  doc.rect(0, 0, W, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...MARROM);
  doc.text("PATEO DA LUZ", M, 13);
  doc.setFontSize(17);
  doc.setTextColor(...TINTA);
  doc.text(textoPdf(o.titulo), M, 21);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...CINZA);
  doc.text(textoPdf(o.apoio), M, 27.5);

  doc.setFontSize(8.5);
  if (o.codigo) doc.text(o.codigo, W - M, 13, { align: "right" });
  const selo = textoPdf(o.selo.texto);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  const larg = doc.getTextWidth(selo) + 7;
  if (o.selo.tom === "ok") doc.setFillColor(228, 242, 232); else doc.setFillColor(253, 238, 220);
  doc.roundedRect(W - M - larg, 16.5, larg, 6.5, 3.2, 3.2, "F");
  if (o.selo.tom === "ok") doc.setTextColor(36, 104, 58); else doc.setTextColor(...AMBAR);
  doc.text(selo, W - M - larg / 2, 20.9, { align: "center" });
}

/** Linha fina, identificação do documento com data e hora de emissão, e "Página x de y" em todas as páginas. */
export function rodapePdf(doc: Doc, identificacao: string, emitido: Date) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const total = doc.getNumberOfPages();
  const quando = `${emitido.toLocaleDateString("pt-BR")} às ${emitido.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINHA);
    doc.setLineWidth(0.2);
    doc.line(M, H - 12, W - M, H - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...CINZA);
    doc.text(textoPdf(`${identificacao}   |   Emitido em ${quando}`), M, H - 7.5);
    doc.text(`Página ${i} de ${total}`, W - M, H - 7.5, { align: "right" });
  }
}

/** Caixas de resumo no topo; a primeira (o total) em destaque. Devolve o y logo abaixo. */
export function caixasResumo(doc: Doc, y: number, caixas: Array<[rotulo: string, valor: string, peso: number]>): number {
  const W = doc.internal.pageSize.getWidth();
  const gap = 3.5;
  const pesos = caixas.reduce((a, c) => a + c[2], 0);
  const util = W - 2 * M - gap * (caixas.length - 1);
  let x = M;
  caixas.forEach(([rotulo, valor, peso], i) => {
    const larg = (util * peso) / pesos;
    doc.setFillColor(...BEGE);
    doc.roundedRect(x, y, larg, 15, 2, 2, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...CINZA);
    doc.text(textoPdf(rotulo.toUpperCase()), x + 4, y + 5.5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(i === 0 ? 13 : 11.5);
    doc.setTextColor(...(i === 0 ? MARROM : TINTA));
    doc.text(textoPdf(valor), x + 4, y + 12);
    x += larg + gap;
  });
  return y + 15;
}

/** Faixa marrom com o total geral. */
export function faixaTotal(doc: Doc, y: number, rotulo: string, valor: string) {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(...MARROM);
  doc.roundedRect(M, y - 4, W - 2 * M, 11, 1.5, 1.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(255, 255, 255);
  doc.text(textoPdf(rotulo), M + 4, y + 3);
  doc.text(textoPdf(valor), W - M - 4, y + 3, { align: "right" });
}
