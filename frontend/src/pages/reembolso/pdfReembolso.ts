// PDF do reembolso: a folha que vai para a pasta do Contas a Pagar junto com os
// comprovantes. Quem pagou, o período, cada compra (data, loja, o quê, nota), o total e as
// linhas de assinatura de quem recebe e de quem conferiu.
import type { ReimbursementDetail, ReimbursementStatus } from "../../api/client";
import { textoPdf } from "../gorjeta/envioContabilidade";
import {
  type AutoTable, CINZA, type Doc, LISTRA, M, MARROM, type Selo, TINTA, cabecalhoPdf, caixasResumo, faixaTotal, rodapePdf,
} from "../gorjeta/pdfTema";

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/ /g, " ");
const data = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "-");

const SELO: Record<ReimbursementStatus, Selo> = {
  OPEN: { texto: "PRÉVIA - AINDA EM CONFERÊNCIA", tom: "aviso" },
  CLOSED: { texto: "FECHADO - A PAGAR", tom: "ok" },
  PAID: { texto: "PAGO", tom: "ok" },
  CANCELLED: { texto: "CANCELADO", tom: "aviso" },
};

type Item = ReimbursementDetail["items"][number];

function descricao(item: Item) {
  const nome = item.firstItemName ?? (item.isSmallExpense ? "Pequeno gasto" : "Compra");
  return item.itemLines > 1 ? `${nome} +${item.itemLines - 1}` : nome;
}

/** "03/11/2026" ou "03/11/2026 a 20/11/2026"; sem compras, "-". */
export function periodoDoReembolso(items: Pick<Item, "purchaseDate">[]): string {
  if (items.length === 0) return "-";
  const dias = items.map((i) => i.purchaseDate.slice(0, 10)).sort();
  const primeiro = data(dias[0]);
  const ultimo = data(dias[dias.length - 1]);
  return primeiro === ultimo ? primeiro : `${primeiro} a ${ultimo}`;
}

/** Compras da mais antiga para a mais nova (mesma data: pela loja), sem mexer na lista da tela. */
export function ordenarCompras(items: Item[]): Item[] {
  return [...items].sort((a, b) =>
    a.purchaseDate.slice(0, 10).localeCompare(b.purchaseDate.slice(0, 10)) || a.storeName.localeCompare(b.storeName, "pt-BR", { sensitivity: "base" }));
}

export function nomeArquivoReembolso(detail: Pick<ReimbursementDetail, "payeeName" | "id">): string {
  const nome = detail.payeeName.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `Reembolso_${nome || "beneficiario"}_${detail.id.slice(-6)}.pdf`;
}

export async function montarPdfReembolso(detail: ReimbursementDetail): Promise<Doc> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default as unknown as AutoTable;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" }) as unknown as Doc;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const itens = ordenarCompras(detail.items);
  const total = Number(detail.totalAmount);
  const titulo = detail.installments[0] ?? null;
  const conferidas = itens.filter((i) => i.checked).length;

  cabecalhoPdf(doc, {
    titulo: "Reembolso",
    apoio: `${detail.payeeName}   |   compras de ${periodoDoReembolso(itens)}`,
    selo: SELO[detail.status],
  });

  let y = caixasResumo(doc, 33, [
    ["Total a reembolsar", reais(total), 1.5],
    ["Compras", String(itens.length), 0.8],
    ["Conferidas", `${conferidas}/${itens.length}`, 0.9],
    ["Vencimento", data(titulo?.dueDate ?? detail.dueDate), 1],
  ]);
  y += 3;
  if (titulo?.paymentMethodName) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...CINZA);
    doc.text(textoPdf(`Forma de pagamento: ${titulo.paymentMethodName}${titulo.paidDate ? `   |   pago em ${data(titulo.paidDate)}` : ""}`), M, y + 3);
    y += 5;
  }
  y += 3;

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, top: 18, bottom: 22 },
    theme: "plain",
    rowPageBreak: "avoid",
    styles: { font: "helvetica", fontSize: 9, textColor: [...TINTA], cellPadding: { top: 2, bottom: 2, left: 2.5, right: 2.5 }, valign: "middle" },
    headStyles: { fillColor: [...MARROM], textColor: 255, fontStyle: "bold", fontSize: 8 },
    alternateRowStyles: { fillColor: [...LISTRA] },
    head: [["Data", "Loja", "O quê", "Nota", "Valor"].map(textoPdf)],
    body: itens.map((i) => [data(i.purchaseDate), i.storeName, descricao(i), i.invoiceNumber ?? i.purchaseNumber ?? "-", reais(Number(i.amount))].map(textoPdf)),
    columnStyles: { 0: { cellWidth: 22 }, 3: { cellWidth: 26 }, 4: { cellWidth: 28, halign: "right" } },
    didParseCell: (d: { section: string; column: { index: number }; cell: { styles: Record<string, unknown> } }) => {
      if (d.section === "head" && d.column.index === 4) d.cell.styles.halign = "right";
    },
  });

  let fim = doc.lastAutoTable.finalY + 8;
  // Total e assinaturas não podem ficar separados da tabela por uma quebra no meio.
  const alturaFinal = 11 + (detail.notes ? 14 : 0) + 38;
  if (fim + alturaFinal > H - 16) { doc.addPage(); fim = 26; }

  faixaTotal(doc, fim, "Total do reembolso", reais(total));
  fim += 14;
  if (detail.notes) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...CINZA);
    doc.text(doc.splitTextToSize(textoPdf(`Observação: ${detail.notes}`), W - 2 * M), M, fim);
    fim += 10;
  }

  // Assinaturas: quem recebe e quem conferiu os comprovantes.
  const yLinha = fim + 22;
  const meioA = M + (W - 2 * M) * 0.25;
  const meioB = M + (W - 2 * M) * 0.75;
  doc.setDrawColor(...CINZA);
  doc.setLineWidth(0.3);
  doc.line(meioA - 38, yLinha, meioA + 38, yLinha);
  doc.line(meioB - 38, yLinha, meioB + 38, yLinha);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...TINTA);
  doc.text(textoPdf(detail.payeeName.toUpperCase()), meioA, yLinha + 5, { align: "center", maxWidth: 80 });
  doc.text("CONFERIDO POR", meioB, yLinha + 5, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...CINZA);
  doc.text("Recebi o valor acima", meioA, yLinha + 9.5, { align: "center" });
  doc.text("Comprovantes conferidos", meioB, yLinha + 9.5, { align: "center" });

  rodapePdf(doc, textoPdf(`Reembolso ${detail.payeeName}`), new Date());
  return doc;
}

export async function gerarPdfReembolso(detail: ReimbursementDetail) {
  const doc = await montarPdfReembolso(detail);
  doc.save(nomeArquivoReembolso(detail));
}

