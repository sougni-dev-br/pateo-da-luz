// PDF (A4 paisagem) do histórico de compras de um fornecedor: resumo no topo e uma linha por compra
// (parcelada: uma por parcela) com data, NF/pedido, forma de pagamento, total, vencimento e status.
// Usa a mesma identidade visual dos demais PDFs (pages/gorjeta/pdfTema).
import type { SupplierHistory, SupplierHistoryPurchase, SupplierHistoryTitleFilter } from "../api/client";
import { textoPdf } from "./gorjeta/envioContabilidade";
import {
  type AutoTable, CINZA, type Doc, LINHA, LISTRA, M, MARROM, TINTA, cabecalhoPdf, caixasResumo, faixaTotal, rodapePdf
} from "./gorjeta/pdfTema";
import {
  brDay, exportFileName, purchaseStatusLabel, splitByParcel, titleStateLabel
} from "../lib/supplier-history";

export type HistoryPdfContext = {
  supplierName: string;
  titleFilter: SupplierHistoryTitleFilter | "all";
  search: string;
  includeCancelled: boolean;
};

export type LinhaPdf = {
  tipo: "compra" | "cancelada";
  celulas: string[];
  /** Vencido: o vencimento e o status saem em vermelho. Pago: em verde. */
  tom: "ok" | "vencido" | "neutro";
  /** Parcela 2/3, 3/3...: a compra repetida; a data e a NF saem esmaecidas. */
  continuacao: boolean;
};

const reais = (valor: number | string) =>
  Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const FILTRO_ROTULO: Record<SupplierHistoryTitleFilter, string> = { open: "Em aberto", overdue: "Vencidas", paid: "Baixadas", none: "Sem título" };

export const COLUNAS_PDF = ["Data da compra", "NF, Pedido", "Forma de pagamento", "Total", "Data de vencimento", "Status"] as const;
/** Índices das colunas que dependem da situação (vencimento e status). */
const COLUNA_VENCIMENTO = 4;
const COLUNA_STATUS = 5;

/** O status do PDF só tem dois valores: Pago ou Em aberto (vencido é "Em aberto", em vermelho). */
function statusPago(paga: boolean, baixadaEm: string | null): string {
  if (!paga) return "Em aberto";
  return baixadaEm ? `Pago\nem ${brDay(baixadaEm)}` : "Pago";
}

/**
 * O que vai em cada linha da tabela: uma por compra; compra parcelada se repete uma vez por
 * parcela, com "Parcela 1/3" na forma de pagamento, o valor, o vencimento e o status dela.
 */
export function linhasHistoricoPdf(compras: SupplierHistoryPurchase[]): LinhaPdf[] {
  return compras.flatMap((compra): LinhaPdf[] => {
    const data = brDay(compra.purchaseDate.slice(0, 10));
    const documento = `${compra.invoiceNumber ?? "-"}\n${compra.purchaseNumber ?? "-"}`;
    const pagamento = compra.paymentMethod ?? "-";

    if (compra.status === "CANCELLED") {
      return [{ tipo: "cancelada", tom: "neutro", continuacao: false, celulas: [data, documento, pagamento, reais(compra.totalAmount), "-", purchaseStatusLabel(compra.status)] }];
    }

    const { title } = compra;
    return splitByParcel(compra).map(({ parcel, fraction }): LinhaPdf => {
      if (parcel) {
        return {
          tipo: "compra",
          tom: parcel.state === "PAID" ? "ok" : parcel.state === "OVERDUE" ? "vencido" : "neutro",
          continuacao: !fraction!.startsWith("1/"),
          celulas: [
            data, documento, `${pagamento}\nParcela ${fraction}`,
            `${reais(parcel.amount)}\nde ${reais(compra.totalAmount)}`,
            parcel.dueDate ? brDay(parcel.dueDate) : "-",
            statusPago(parcel.state === "PAID", parcel.paidDate)
          ]
        };
      }
      // Linha da compra inteira: o vencimento é o da única parcela; no título de ciclo, o próximo.
      const vencimento = title.viaCycle ? title.nextDueDate : title.parcels[0]?.dueDate ?? title.nextDueDate;
      const status = title.state === "NONE"
        ? titleStateLabel(title)
        : `${statusPago(title.state === "PAID", title.paidDate)}${title.viaCycle ? "\nTítulo do ciclo" : ""}`;
      return {
        tipo: "compra",
        tom: title.state === "PAID" ? "ok" : title.state === "OVERDUE" ? "vencido" : "neutro",
        continuacao: false,
        celulas: [data, documento, pagamento, reais(compra.totalAmount), vencimento ? brDay(vencimento) : "-", status]
      };
    });
  });
}
/** "01/01/2026 a 31/12/2026 | Situação: Vencidas | Busca: 1208". */
export function descreverFiltrosPdf(period: SupplierHistory["period"], contexto: HistoryPdfContext): string {
  const periodo = !period.from && !period.to
    ? "Todo o histórico"
    : `${period.from ? brDay(period.from) : "início"} a ${period.to ? brDay(period.to) : "hoje"}`;
  return [
    periodo,
    contexto.titleFilter !== "all" ? `Situação: ${FILTRO_ROTULO[contexto.titleFilter]}` : null,
    contexto.search ? `Busca: ${contexto.search}` : null,
    contexto.includeCancelled ? "Inclui canceladas" : null
  ].filter(Boolean).join("   |   ");
}

const COR_OK = [36, 104, 58];
const COR_VENCIDO = [176, 42, 42];

type Celula = { text: string[]; styles: Record<string, unknown> };
type CelulaDesenho = { x: number; y: number; width: number; height: number };

export async function gerarPdfHistoricoFornecedor(historico: SupplierHistory, contexto: HistoryPdfContext, agora: Date = new Date()) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default as unknown as AutoTable;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" }) as unknown as Doc;
  const H = doc.internal.pageSize.getHeight();

  cabecalhoPdf(doc, {
    titulo: "Histórico de compras",
    apoio: `${contexto.supplierName}   |   ${descreverFiltrosPdf(historico.period, contexto)}`,
    selo: contexto.titleFilter === "all" ? { texto: "TODAS AS SITUAÇÕES", tom: "ok" } : { texto: FILTRO_ROTULO[contexto.titleFilter].toUpperCase(), tom: "aviso" }
  });

  const { titleBuckets: b } = historico;
  const emAberto = { count: b.open.count + b.overdue.count, amount: b.open.amount + b.overdue.amount };
  const y = caixasResumo(doc, 33, [
    ["Total no período", textoPdf(reais(historico.periodTotal)), 1.5],
    ["Compras", String(historico.purchaseCount), 0.8],
    [`Em aberto (${emAberto.count})`, textoPdf(reais(emAberto.amount)), 1.15],
    [`Dessas, vencidas (${b.overdue.count})`, textoPdf(reais(b.overdue.amount)), 1.15],
    [`Pagas (${b.paid.count})`, textoPdf(reais(b.paid.amount)), 1.15]
  ]);
  const linhas = linhasHistoricoPdf(historico.purchases.items);
  autoTable(doc, {
    startY: y + 8,
    margin: { left: M, right: M, top: 18, bottom: 22 },
    theme: "plain",
    rowPageBreak: "avoid",
    styles: { font: "helvetica", fontSize: 8.5, textColor: [...TINTA], cellPadding: { top: 1.6, bottom: 1.6, left: 2.2, right: 2.2 }, valign: "middle" },
    headStyles: { fillColor: [...MARROM], textColor: 255, fontStyle: "bold", fontSize: 8 },
    head: [COLUNAS_PDF.map((c) => c)],
    body: linhas.map((l) => l.celulas.map(textoPdf)),
    columnStyles: {
      // Paisagem (A4 = 297 mm útil 269): a última coluna (Status) fica com o que sobra.
      0: { cellWidth: 28 }, 1: { cellWidth: 52 }, 2: { cellWidth: 52 }, 3: { cellWidth: 38, halign: "right" }, 4: { cellWidth: 38 }, 5: { cellWidth: "auto" }
    },
    didParseCell: (d: { section: string; row: { index: number }; column: { index: number }; cell: Celula }) => {
      if (d.section === "head" && d.column.index === 3) d.cell.styles.halign = "right";
      if (d.section !== "body") return;
      const linha = linhas[d.row.index];
      if (linha.tipo === "cancelada") {
        d.cell.styles.textColor = [...CINZA];
        d.cell.styles.fontStyle = "italic";
      }
      if (linha.continuacao) {
        d.cell.styles.fillColor = [...LISTRA];
        if (d.column.index < 2) d.cell.styles.textColor = [...CINZA];
      }
      if ((d.column.index === COLUNA_VENCIMENTO || d.column.index === COLUNA_STATUS) && linha.tom !== "neutro") {
        d.cell.styles.textColor = linha.tom === "ok" ? [...COR_OK] : [...COR_VENCIDO];
        d.cell.styles.fontStyle = "bold";
      }
    },
    didDrawCell: (d: { section: string; row: { index: number }; cell: CelulaDesenho }) => {
      if (d.section !== "body") return;
      doc.setDrawColor(...LINHA);
      doc.setLineWidth(0.2);
      doc.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height);
    }
  });

  let yFim = doc.lastAutoTable.finalY + 12;
  if (yFim > H - 30) { doc.addPage(); yFim = 24; } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...CINZA);
    doc.text(textoPdf("Em aberto em vermelho = vencido. Compra parcelada aparece uma vez por parcela; o Total da linha é o da parcela."), M, yFim - 5);
  }
  const somaListada = historico.purchases.items
    .filter((c) => c.status !== "CANCELLED")
    .reduce((soma, c) => soma + Number(c.totalAmount), 0);
  faixaTotal(doc, yFim, `Compras listadas   (${historico.purchases.items.length})`, textoPdf(reais(Math.round(somaListada * 100) / 100)));

  if (historico.purchases.truncated) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...CINZA);
    doc.text(textoPdf(`Atenção: lista cortada em ${historico.purchases.pageSize} compras. Restrinja o período para ver tudo.`), M, yFim + 12);
  }

  rodapePdf(doc, `Histórico ${contexto.supplierName}`, agora);
  doc.save(exportFileName(contexto.supplierName, "pdf", agora));
}
