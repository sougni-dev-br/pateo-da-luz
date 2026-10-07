// Recibo de pagamento de quem não tem registro: pagamento do mês (discriminado como a lista de
// pagamento), 1ª quinzena e adiantamento. Uma folha A4 por pessoa, com duas vias. Não leva
// empresa (razão social, CNPJ, endereço) nem a palavra "salário": só a pessoa e os valores.
import type { ReciboLinha, ReciboPagamentoMes, ReciboPagoAntes } from "../../api/client";
import { textoPdf } from "./envioContabilidade";
import { valorPorExtenso } from "./extenso";
import { type Doc, assinatura, dataPorExtenso, imprimirPdf, linhaDeCorte, reais, reaisComSinal, reaisNoTexto } from "./reciboComum";

export type ReciboDePagamento = ReciboPagamentoMes | ReciboPagoAntes;

const ESQ = 16;
const LARG = 178;
const ALTURA_VIA = 134;
const LINHA_MAX = 4.6;
const LINHA_MIN = 3.4;
// Espaço da discriminação dentro da via (do cabeçalho da tabela até a data).
const TOPO_TABELA = 44;
const FIM_TABELA = 101;

const SUBTITULO: Record<ReciboDePagamento["tipo"], string> = {
  PAGAMENTO_MES: "Pagamento do mês", QUINZENA: "1ª quinzena", ADIANTAMENTO: "Adiantamento",
};

/** O texto que a pessoa assina. "Referente ao pagamento do mês de 09/2026", "à 1ª quinzena", "ao adiantamento". */
export function textoDoReciboPagamento(r: ReciboDePagamento): string {
  const valor = `${reaisNoTexto(r.total)} (${valorPorExtenso(r.total)})`;
  const artigo = r.tipo === "QUINZENA" ? "à" : "ao";
  return `Recebi a importância de ${valor}, referente ${artigo} ${r.referencia}, conforme discriminado abaixo.`;
}

// Muitos vales não cabem na via: viram uma linha só, com a soma e quantos são.
export function linhasQueCabem(linhas: ReciboLinha[], cabem: number): ReciboLinha[] {
  if (linhas.length <= cabem) return linhas;
  const vales = linhas.filter((l) => l.vale);
  if (vales.length < 2) return linhas;
  const soma = Math.round(vales.reduce((a, l) => a + l.valor, 0) * 100) / 100;
  const juntos: ReciboLinha = { descricao: "Vales e créditos da gorjeta", detalhe: `${vales.length} lançamentos`, valor: soma };
  const primeiro = linhas.findIndex((l) => l.vale);
  return [...linhas.slice(0, primeiro).filter((l) => !l.vale), juntos, ...linhas.slice(primeiro).filter((l) => !l.vale)];
}

function tabela(doc: Doc, r: ReciboDePagamento, topo: number) {
  const espaco = FIM_TABELA - TOPO_TABELA - 12; // cabeçalho e total
  // Aperta as linhas até o mínimo legível; só depois junta os vales numa linha.
  const linhas = linhasQueCabem(r.linhas, Math.floor(espaco / LINHA_MIN));
  const altura = Math.max(LINHA_MIN, Math.min(LINHA_MAX, espaco / Math.max(1, linhas.length)));
  const dir = ESQ + LARG;
  const colDetalhe = ESQ + 82;
  let y = topo + TOPO_TABELA;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(90);
  doc.text("Discriminação", ESQ, y);
  doc.text("Valor", dir, y, { align: "right" });
  doc.setTextColor(0);
  doc.setDrawColor(160);
  doc.setLineWidth(0.2);
  doc.line(ESQ, y + 1.3, dir, y + 1.3);
  y += 1.3 + altura;

  doc.setFontSize(altura < 4 ? 8 : 9);
  for (const l of linhas) {
    doc.setFont("helvetica", "normal");
    doc.text(doc.splitTextToSize(l.descricao, colDetalhe - ESQ - 3)[0], ESQ, y);
    const valor = reaisComSinal(l.valor);
    if (l.detalhe) {
      // O detalhe vai até perto do valor (o da base e o do ajuste têm números que não podem sumir).
      doc.setTextColor(90);
      doc.text(doc.splitTextToSize(l.detalhe, dir - colDetalhe - doc.getTextWidth(valor) - 4)[0], colDetalhe, y);
      doc.setTextColor(0);
    }
    doc.text(valor, dir, y, { align: "right" });
    y += altura;
  }

  doc.setDrawColor(60);
  doc.setLineWidth(0.4);
  doc.line(ESQ, y - altura + 1.6, dir, y - altura + 1.6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Total recebido", ESQ, y + 2.4);
  doc.text(reais(r.total), dir, y + 2.4, { align: "right" });
}

function via(doc: Doc, r: ReciboDePagamento, topo: number, rotulo: string, emitido: string) {
  doc.setDrawColor(60);
  doc.setLineWidth(0.3);
  doc.roundedRect(ESQ - 4, topo, LARG + 8, ALTURA_VIA, 2, 2);

  // Título, referência e valor
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("RECIBO DE PAGAMENTO", ESQ, topo + 11);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(90);
  doc.text(`${SUBTITULO[r.tipo]} · competência ${r.competencia}`, ESQ, topo + 16.5);
  doc.setTextColor(0);
  doc.setLineWidth(0.5);
  doc.rect(ESQ + LARG - 56, topo + 5, 56, 14);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(reais(r.total), ESQ + LARG - 4, topo + 14.5, { align: "right" });

  // Texto
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.text(doc.splitTextToSize(textoDoReciboPagamento(r), LARG), ESQ, topo + 28, { lineHeightFactor: 1.45 });

  tabela(doc, r, topo);

  // Data, assinatura e rodapé
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`São Paulo, ${dataPorExtenso(r.dataPagamento)}.`, ESQ, topo + 108);
  assinatura(doc, ESQ + LARG / 2 + 30, topo + 117, r.nome, r.cpf);
  doc.setFontSize(7.5);
  doc.setTextColor(110);
  doc.text(`${rotulo} · emitido em ${emitido}`, ESQ, topo + ALTURA_VIA - 3);
  doc.setTextColor(0);
}

// Nomes, descrições e referências passam pela limpeza dos traços que a fonte não desenha.
function paraPdf(r: ReciboDePagamento): ReciboDePagamento {
  return {
    ...r,
    nome: textoPdf(r.nome),
    referencia: textoPdf(r.referencia),
    linhas: r.linhas.map((l) => ({ ...l, descricao: textoPdf(l.descricao), detalhe: l.detalhe == null ? null : textoPdf(l.detalhe) })),
  };
}

/** Um PDF com uma folha por recibo (duas vias); recibos de valor zero ficam de fora. */
export async function gerarRecibosPagamento(recibos: ReciboDePagamento[]) {
  const validos = recibos.filter((r) => r.total > 0.004).map(paraPdf);
  if (validos.length === 0) throw new Error("Nenhum recibo com valor a receber.");
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const emitido = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  validos.forEach((r, i) => {
    if (i > 0) doc.addPage();
    via(doc, r, 8, "Via da empresa", emitido);
    linhaDeCorte(doc);
    via(doc, r, 155, "Via do funcionário", emitido);
  });
  const so = validos.length === 1 ? ` ${validos[0].nome}` : "";
  doc.setProperties({ title: `Recibo ${SUBTITULO[validos[0].tipo].toLowerCase()} ${validos[0].competencia}${so}` });
  return doc;
}

/** Gera e abre a impressão; devolve o endereço do PDF para "abrir/baixar". */
export async function imprimirRecibosPagamento(recibos: ReciboDePagamento[]): Promise<string> {
  return imprimirPdf(await gerarRecibosPagamento(recibos));
}
