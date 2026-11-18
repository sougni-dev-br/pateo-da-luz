// PDF de conferência da apuração: o papel que quem fecha o mês confere e arquiva. Paisagem,
// com o resumo, como o valor do ponto foi formado, o que está pendente e a tabela por pessoa.
import type { TipComputation } from "../../api/client";
import { type Conferencia, montarConferencia } from "./conferencia";
import { textoPdf } from "./envioContabilidade";
import {
  AMBAR, type AutoTable, BEGE, CINZA, type Doc, LINHA, LISTRA, M, MARROM, TINTA, cabecalhoPdf, caixasResumo, rodapePdf,
} from "./pdfTema";

const LARGURA_TEXTO_MM = 6; // recuo do texto das listas
const MIN_TABELA_MM = 70; // espaço mínimo no pé da página para abrir a tabela de pessoas

function bloco(doc: Doc, y: number, titulo: string): number {
  const H = doc.internal.pageSize.getHeight();
  if (y > H - 40) { doc.addPage(); y = 20; }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...TINTA);
  doc.text(textoPdf(titulo), M, y);
  return y + 5;
}

function listaDeTextos(doc: Doc, y: number, textos: string[], cor: readonly [number, number, number]): number {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...cor);
  for (const t of textos) {
    const partes = doc.splitTextToSize(textoPdf(t), W - 2 * M - LARGURA_TEXTO_MM);
    if (y + partes.length * 4 > H - 18) { doc.addPage(); y = 20; doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...cor); }
    doc.text("-", M + 1, y);
    doc.text(partes, M + LARGURA_TEXTO_MM, y);
    y += partes.length * 4 + 1.2;
  }
  return y;
}

function formacao(doc: Doc, autoTable: AutoTable, y: number, c: Conferencia): number {
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, top: 18, bottom: 22 },
    tableWidth: 110,
    theme: "plain",
    styles: { font: "helvetica", fontSize: 8.8, textColor: [...TINTA], cellPadding: { top: 1.3, bottom: 1.3, left: 2.5, right: 2.5 } },
    alternateRowStyles: { fillColor: [...LISTRA] },
    body: c.formacao.map(([r, v]) => [textoPdf(r), textoPdf(v)]),
    columnStyles: { 0: { cellWidth: "auto" }, 1: { cellWidth: 34, halign: "right", fontStyle: "bold" } },
    didParseCell: (d: { section: string; row: { index: number }; cell: { styles: Record<string, unknown> } }) => {
      const destaque = c.formacao[d.row.index]?.[0] === "Líquido do período" || c.formacao[d.row.index]?.[0] === "Valor do ponto";
      if (d.section === "body" && destaque) d.cell.styles.fillColor = [...BEGE];
    },
  });
  return doc.lastAutoTable.finalY + 8;
}

export async function gerarPdfConferencia(comp: TipComputation) {
  const c = montarConferencia(comp);
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default as unknown as AutoTable;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" }) as unknown as Doc;
  const emitido = new Date();

  cabecalhoPdf(doc, {
    titulo: c.titulo,
    apoio: `Competência ${c.competencia}   |   Ciclo da gorjeta: ${c.ciclo}`,
    codigo: c.codigo,
    selo: c.fechado ? { texto: `FECHADO EM ${c.fechadoEm}`, tom: "ok" } : { texto: "PRÉVIA - GORJETA EM ABERTO", tom: "aviso" },
  });

  let y = 33;
  y = caixasResumo(doc, y, c.resumo.map(([r, v], i) => [r, v, i === 0 ? 1.5 : 1] as [string, string, number])) + 9;

  y = bloco(doc, y, "Como o valor foi formado");
  y = formacao(doc, autoTable, y, c);

  y = bloco(doc, y, c.pendencias.length ? `Pendências que impedem o fechamento (${c.pendencias.length})` : "Situação do fechamento");
  if (c.pendencias.length) y = listaDeTextos(doc, y, c.pendencias, [170, 30, 30]);
  else y = listaDeTextos(doc, y, ["Nenhuma pendência: a apuração está pronta para fechar."], [36, 104, 58]);
  if (c.avisos.length) {
    y = bloco(doc, y + 3, `Para conferir (${c.avisos.length})`);
    y = listaDeTextos(doc, y, c.avisos, AMBAR);
  }

  // A tabela não começa com uma ou duas linhas no pé da página: sem espaço para o cabeçalho e
  // algumas pessoas, abre a página seguinte.
  if (y + 5 > doc.internal.pageSize.getHeight() - MIN_TABELA_MM) { doc.addPage(); y = 14; } else { y += 5; }
  y = bloco(doc, y, `Gorjeta por pessoa${c.anteriorLabel ? ` (comparada com ${c.anteriorLabel})` : ""}`);
  const ultima = c.cabecalho.length - 1;
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, top: 18, bottom: 22 },
    theme: "plain",
    styles: { font: "helvetica", fontSize: 8.4, textColor: [...TINTA], cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 }, valign: "middle" },
    headStyles: { fillColor: [...MARROM], textColor: 255, fontStyle: "bold", fontSize: 7.8 },
    footStyles: { fillColor: [...BEGE], textColor: [...TINTA], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [...LISTRA] },
    head: [c.cabecalho.map(textoPdf)],
    body: c.linhas.map((l) => l.map(textoPdf)),
    foot: [c.total.map(textoPdf)],
    showFoot: "lastPage",
    didParseCell: (d: { section: string; column: { index: number }; cell: { styles: Record<string, unknown> } }) => {
      // Nome, função e observação à esquerda; números à direita.
      if (d.column.index > 1 && d.column.index < ultima) d.cell.styles.halign = "right";
      if (d.column.index === ultima) d.cell.styles.fontSize = 7.6;
    },
    didDrawCell: (d: { section: string; cell: { x: number; y: number; width: number; height: number } }) => {
      if (d.section === "foot") {
        doc.setDrawColor(...MARROM);
        doc.setLineWidth(0.4);
        doc.line(d.cell.x, d.cell.y, d.cell.x + d.cell.width, d.cell.y);
        return;
      }
      if (d.section !== "body") return;
      doc.setDrawColor(...LINHA);
      doc.setLineWidth(0.2);
      doc.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height);
    },
  });
  y = doc.lastAutoTable.finalY + 6;

  const H = doc.internal.pageSize.getHeight();
  if (c.soSalario.length) {
    if (y > H - 40) { doc.addPage(); y = 20; }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...CINZA);
    const partes = doc.splitTextToSize(textoPdf(`Só salário (fora do rateio): ${c.soSalario.join(", ")}.`), doc.internal.pageSize.getWidth() - 2 * M);
    doc.text(partes, M, y);
    y += partes.length * 3.8 + 4;
  }

  // Assinatura de quem conferiu.
  if (y > H - 38) { doc.addPage(); y = 24; }
  y += 12;
  doc.setDrawColor(...CINZA);
  doc.setLineWidth(0.3);
  doc.line(M, y, M + 90, y);
  doc.line(M + 110, y, M + 150, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...CINZA);
  doc.text("Conferido por", M, y + 4);
  doc.text("Data", M + 110, y + 4);

  rodapePdf(doc, `Conferência da gorjeta ${c.competencia}${c.codigo ? ` - ${c.codigo}` : ""}`, emitido);
  doc.save(`Gorjeta_Conferencia_${c.competencia.replace("/", "_")}.pdf`);
}
