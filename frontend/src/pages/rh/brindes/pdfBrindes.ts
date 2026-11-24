// PDF para a entrega do brinde: uma lista só, em ordem alfabética, com uma linha alta para a pessoa assinar ao
// retirar. Usa a mesma identidade visual dos PDFs da folha (cabeçalho, rodapé, cores).
import type { DetalheBrinde, PessoaBrinde } from "../../../api/client";
import { textoPdf } from "../../gorjeta/envioContabilidade";
import { type AutoTable, BEGE, CINZA, type Doc, LINHA, LISTRA, M, MARROM, TINTA, cabecalhoPdf, rodapePdf } from "../../gorjeta/pdfTema";
import { type QuemEntraNoPdf, dataBr, nomeArquivoBrinde, ordenarAlfabetico, pessoasParaPdf } from "./brindeLista";

const ALTURA_LINHA_ASSINATURA = 12;

export async function montarPdfBrinde(detalhe: DetalheBrinde, quem: QuemEntraNoPdf, emitido = new Date()): Promise<Doc> {
  const lista = pessoasParaPdf(detalhe.pessoas, quem);
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default as unknown as AutoTable;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" }) as unknown as Doc;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const { campanha } = detalhe;

  cabecalhoPdf(doc, {
    titulo: `${campanha.nome} ${campanha.ano}`,
    apoio: quem === "FALTAM" ? "Lista de retirada: quem ainda não recebeu" : "Lista de retirada: todos os funcionários ativos",
    codigo: `${lista.length} ${lista.length === 1 ? "pessoa" : "pessoas"}`,
    selo: { texto: "Para assinatura", tom: "aviso" },
  });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...TINTA);
  doc.text(textoPdf(`Declaro ter recebido o brinde (${campanha.nome} ${campanha.ano}), em perfeitas condições. Assine na linha ao lado do seu nome.`), M, 36);

  let y = 42;
  if (lista.length > 0) {
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M, top: 18, bottom: 18 },
      theme: "grid",
      rowPageBreak: "avoid",
      styles: { font: "helvetica", fontSize: 9, textColor: [...TINTA], lineColor: [...LINHA], lineWidth: 0.2, cellPadding: { top: 1.5, bottom: 1.5, left: 2.5, right: 2.5 }, valign: "middle", minCellHeight: ALTURA_LINHA_ASSINATURA },
      headStyles: { fillColor: [...MARROM], textColor: 255, fontStyle: "bold", fontSize: 8, minCellHeight: 7 },
      alternateRowStyles: { fillColor: [...LISTRA] },
      head: [["Funcionário", "Setor", "Data", "Assinatura"]],
      body: ordenarAlfabetico(lista).map((p: PessoaBrinde) => [textoPdf(p.nomeCompleto), textoPdf(p.setor ?? ""), p.entrega ? dataBr(p.entrega.entregueEm) : "", ""]),
      columnStyles: { 0: { cellWidth: 62 }, 1: { cellWidth: 30 }, 2: { cellWidth: 22, halign: "center" }, 3: { cellWidth: "auto" } },
    });
    y = doc.lastAutoTable.finalY + 9;
  }

  if (lista.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...CINZA);
    doc.text("Ninguém para entrar nesta lista.", M, y + 4);
  } else {
    if (y > H - 30) { doc.addPage(); y = 18; }
    doc.setFillColor(...BEGE);
    doc.roundedRect(M, y, W - 2 * M, 9, 1.5, 1.5, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...TINTA);
    doc.text(textoPdf(`Entregue por: ______________________________   Data: ____/____/______`), M + 3, y + 5.9);
  }

  rodapePdf(doc, textoPdf(`${campanha.nome} ${campanha.ano} - lista de retirada`), emitido);
  return doc;
}

export async function gerarPdfBrinde(detalhe: DetalheBrinde, quem: QuemEntraNoPdf) {
  const doc = await montarPdfBrinde(detalhe, quem);
  doc.save(nomeArquivoBrinde(detalhe.campanha.nome, detalhe.campanha.ano));
}
