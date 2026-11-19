// Demonstrativo do complemento do salário combinado nas férias: o papel que acompanha o título na hora de
// pagar, para quem paga ver de onde vem o valor (recibo da contabilidade + complemento). Uma folha A4.
import type { MesDaGorjetaFerias, PreviaFeriasCombinado } from "../../../api/client";
import { textoPdf } from "../../gorjeta/envioContabilidade";
import { type AutoTable, BEGE, CINZA, type Doc, LINHA, LISTRA, M, MARROM, TINTA, cabecalhoPdf, caixasResumo, faixaTotal, rodapePdf } from "../../gorjeta/pdfTema";

const reais = (v: number) => textoPdf(v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/ /g, " "));
const mesBr = (chave: string) => `${chave.slice(5, 7)}/${chave.slice(0, 4)}`;
export const ROTULO_INFORMADO_SOBRE_APURACAO = "informado vale sobre a apuração";
const origemDoMes = (m: MesDaGorjetaFerias) => {
  if (m.origem === "AUSENTE" && m.apuracaoErp != null) return `informar à mão (apuração do ERP não vale; ERP: ${reais(m.apuracaoErp)})`;
  if (m.origem !== "INFORMADA") return ORIGEM[m.origem];
  return m.apuracaoErp != null ? `${ROTULO_INFORMADO_SOBRE_APURACAO} (ERP: ${reais(m.apuracaoErp)})` : ORIGEM.INFORMADA;
};
const ORIGEM: Record<MesDaGorjetaFerias["origem"], string> = { APURACAO: "apuração", INFORMADA: "informada à mão", AUSENTE: "sem apuração" };

/** Linhas da conta, na ordem do modal. `soma` marca as linhas de total parcial. */
export function linhasDaConta(p: PreviaFeriasCombinado): Array<{ rotulo: string; valor: string; soma: boolean }> {
  const mensal = p.combinado != null ? p.combinado + p.mediaGorjeta : null;
  return [
    { rotulo: "Salário combinado vigente", valor: p.combinado == null ? "Sem combinado vigente" : reais(p.combinado), soma: false },
    { rotulo: `Média da gorjeta (${p.mesesContados} ${p.mesesContados === 1 ? "mês contado" : "meses contados"} de 12)`, valor: reais(p.mediaGorjeta), soma: false },
    ...(mensal != null ? [{ rotulo: "Remuneração mensal", valor: reais(mensal), soma: true }] : []),
    { rotulo: "Remuneração devida nas férias (já com o 1/3)", valor: reais(p.remuneracao), soma: true },
    { rotulo: "Líquido do recibo da contabilidade (já descontados IR e INSS)", valor: `- ${reais(p.liquidoRecibo)}`, soma: false },
    { rotulo: "Complemento a pagar", valor: reais(p.complemento), soma: true },
  ];
}

export function nomeDoArquivoComplemento(nome: string): string {
  const base = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  return `complemento-ferias-${base || "pessoa"}.pdf`;
}

/** `gravado`: o complemento já foi somado ao título (selo verde); senão sai como prévia (selo âmbar). */
export async function gerarPdfComplementoFerias(p: PreviaFeriasCombinado, gravado: boolean, emitido = new Date()): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default as unknown as AutoTable;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" }) as unknown as Doc;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  cabecalhoPdf(doc, {
    titulo: "Complemento de férias - salário combinado",
    apoio: p.nome,
    selo: gravado ? { texto: "GRAVADO NO TÍTULO", tom: "ok" } : { texto: "PRÉVIA - AINDA NÃO GRAVADO", tom: "aviso" },
  });

  const yResumo = 33;
  caixasResumo(doc, yResumo, [
    ["Valor a pagar (novo título)", reais(p.valorDepois), 1.5],
    ["Título antes", reais(p.valorAntes), 1],
    ["Complemento", reais(p.complemento), 1],
  ]);

  let y = yResumo + 24;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...TINTA);
  doc.text("Como chegamos nesse valor", M, y);
  const conta = linhasDaConta(p);
  autoTable(doc, {
    startY: y + 3,
    margin: { left: M, right: M, bottom: 22 },
    theme: "plain",
    styles: { font: "helvetica", fontSize: 9, textColor: [...TINTA], cellPadding: { top: 2, bottom: 2, left: 2.5, right: 2.5 }, valign: "middle" },
    body: conta.map((l) => [textoPdf(l.rotulo), l.valor]),
    columnStyles: { 0: { cellWidth: "auto" }, 1: { cellWidth: 42, halign: "right" } },
    didParseCell: (d: { section: string; row: { index: number }; cell: { styles: Record<string, unknown> } }) => {
      if (d.section !== "body") return;
      if (conta[d.row.index]?.soma) { d.cell.styles.fontStyle = "bold"; d.cell.styles.fillColor = [...BEGE]; }
      else if (d.row.index % 2 === 1) d.cell.styles.fillColor = [...LISTRA];
    },
  });
  y = doc.lastAutoTable.finalY + 4;
  if (p.formula) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...CINZA);
    doc.text(doc.splitTextToSize(textoPdf(`Fórmula: ${p.formula}`), W - 2 * M), M, y);
    y += doc.splitTextToSize(textoPdf(`Fórmula: ${p.formula}`), W - 2 * M).length * 3.6 + 4;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...TINTA);
  doc.text("Gorjeta dos 12 meses da média", M, y);
  autoTable(doc, {
    startY: y + 3,
    margin: { left: M, right: M, bottom: 22 },
    theme: "plain",
    styles: { font: "helvetica", fontSize: 8.6, textColor: [...TINTA], cellPadding: { top: 1.5, bottom: 1.5, left: 2.5, right: 2.5 }, valign: "middle" },
    headStyles: { fillColor: [...MARROM], textColor: 255, fontStyle: "bold", fontSize: 8 },
    alternateRowStyles: { fillColor: [...LISTRA] },
    head: [["Mês", "Gorjeta", "Origem"]],
    body: p.meses.map((m) => [mesBr(m.chave), m.valor == null ? "-" : reais(m.valor), textoPdf(origemDoMes(m))]),
    columnStyles: { 0: { cellWidth: 28 }, 1: { cellWidth: 38, halign: "right" }, 2: { cellWidth: "auto" } },
    didParseCell: (d: { section: string; column: { index: number }; cell: { styles: Record<string, unknown> } }) => {
      if (d.section === "head" && d.column.index === 1) d.cell.styles.halign = "right";
    },
  });
  y = doc.lastAutoTable.finalY + 6;

  for (const aviso of p.avisos) {
    const linhas = doc.splitTextToSize(textoPdf(`Atenção: ${aviso}`), W - 2 * M);
    if (y + linhas.length * 3.6 > H - 30) { doc.addPage(); y = 20; }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.4);
    doc.setTextColor(166, 88, 10);
    doc.text(linhas, M, y);
    y += linhas.length * 3.6 + 2;
  }

  if (y > H - 34) { doc.addPage(); y = 24; }
  faixaTotal(doc, y + 4, gravado ? "Valor a pagar no título" : "Valor a pagar depois de confirmar", reais(p.valorDepois));
  doc.setDrawColor(...LINHA);

  rodapePdf(doc, `Pateo da Luz  |  ${textoPdf(p.nome)}  |  Complemento de férias`, emitido);
  doc.save(nomeDoArquivoComplemento(p.nome));
}
