// Recibo de pagamento de quem não tem registro — pagamento do mês, 1ª quinzena e adiantamento — no
// layout do holerite da contabilidade: duas vias iguais por folha A4, cada uma com o quadro de
// itens (Código | Descrição | Referência | Vencimentos | Descontos), totais, valor líquido e uma
// faixa à direita com a declaração e a assinatura. Não leva empresa (razão social, CNPJ, CC) nem
// a palavra "salário": no lugar da empresa vai "RECIBO DE PAGAMENTO".
import type { ReciboLinha, ReciboPagamentoMes, ReciboPagoAntes } from "../../api/client";
import { textoPdf } from "./envioContabilidade";
import { valorPorExtenso } from "./extenso";
import { type Doc, cpfFormatado, imprimirPdf, reaisNoTexto } from "./reciboComum";

export type ReciboDePagamento = ReciboPagamentoMes | ReciboPagoAntes;

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

// Geometria (mm). Quadro principal de X0 a X1; faixa da assinatura de FX0 a FX1.
const X0 = 7;
const X1 = 176;
const FX0 = 178;
const FX1 = 204;
const ALTURA = 114;
const TOPOS = [8, 146] as const;
// Colunas: fim do código, da descrição, da referência e dos vencimentos.
const C1 = X0 + 10;
const C2 = X0 + 90;
const C3 = X0 + 117;
const C4 = X0 + 143;
// Faixas verticais dentro da via (a partir do topo).
const CAB_TABELA = 21;
const CORPO = 25.5;
const TOTAIS = 85;
const LIQUIDO = 95;
const RODAPE = 104;
const LINHA_MAX = 3.6;
const LINHA_MIN = 3.0;

const SUBTITULO: Record<ReciboDePagamento["tipo"], string> = {
  PAGAMENTO_MES: "Pagamento do mês", QUINZENA: "1ª quinzena", ADIANTAMENTO: "Adiantamento",
};

/** Número como no holerite: "1.218,33" (sem R$). */
export const numero = (v: number) => Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "09/2026" → "Setembro de 2026". */
export function mesPorExtenso(competencia: string): string {
  const [mm, aaaa] = competencia.split("/");
  const nome = MESES[Number(mm) - 1] ?? "";
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${aaaa}`;
}

/** O texto que a pessoa assina. "Referente ao pagamento do mês de 09/2026", "à 1ª quinzena", "ao adiantamento". */
export function textoDoReciboPagamento(r: ReciboDePagamento): string {
  const valor = `${reaisNoTexto(r.total)} (${valorPorExtenso(r.total)})`;
  const artigo = r.tipo === "QUINZENA" ? "à" : "ao";
  return `Recebi a importância de ${valor}, referente ${artigo} ${r.referencia}.`;
}

/** Totais do quadro: vencimentos (positivos), descontos (negativos) e o líquido = vencimentos − descontos. */
export function totaisDoRecibo(linhas: ReciboLinha[]) {
  const centavos = (v: number) => Math.round(v * 100);
  const vencimentos = linhas.reduce((a, l) => a + (l.valor > 0 ? centavos(l.valor) : 0), 0) / 100;
  const descontos = linhas.reduce((a, l) => a + (l.valor < 0 ? -centavos(l.valor) : 0), 0) / 100;
  return { vencimentos, descontos, liquido: Math.round((vencimentos - descontos) * 100) / 100 };
}

// Mês em que a pessoa recebe: o da baixa; sem baixa, o pagamento do mês sai no mês seguinte à
// competência e a quinzena/adiantamento no próprio mês.
export function mesDoPagamento(r: ReciboDePagamento): number {
  if (r.dataPagamento) return Number(r.dataPagamento.slice(5, 7));
  const mes = Number(r.competencia.slice(0, 2));
  return r.tipo === "PAGAMENTO_MES" ? (mes % 12) + 1 : mes;
}

/** "*** PARABÉNS ... NO DIA 12 DE OUTUBRO ***" quando o aniversário cai no mês do pagamento. */
export function linhaDeParabens(r: ReciboDePagamento): string | null {
  const m = /^(\d{2})\/(\d{2})$/.exec(r.aniversario ?? "");
  if (!m || Number(m[2]) !== mesDoPagamento(r)) return null;
  return `*** PARABÉNS PELO SEU ANIVERSÁRIO NO DIA ${m[1]} DE ${MESES[Number(m[2]) - 1].toUpperCase()} ***`;
}

// Muitos vales não cabem no quadro: os créditos viram uma linha e os vales outra, com a soma e
// quantos são (vencimentos e descontos continuam separados).
export function linhasQueCabem(linhas: ReciboLinha[], cabem: number): ReciboLinha[] {
  if (linhas.length <= cabem) return linhas;
  const creditos = linhas.filter((l) => l.vale && l.valor > 0);
  const vales = linhas.filter((l) => l.vale && l.valor <= 0);
  const soma = (ls: ReciboLinha[]) => Math.round(ls.reduce((a, l) => a + l.valor, 0) * 100) / 100;
  const juntos: ReciboLinha[] = [
    ...(creditos.length ? [{ codigo: 300, descricao: `CRÉDITOS DA GORJETA (${creditos.length})`, referencia: null, valor: soma(creditos) }] : []),
    ...(vales.length ? [{ codigo: 990, descricao: `VALES DA GORJETA (${vales.length})`, referencia: null, valor: soma(vales) }] : []),
  ];
  const primeiro = linhas.findIndex((l) => l.vale);
  if (primeiro < 0) return linhas;
  const semVales = linhas.filter((l) => !l.vale);
  const antes = linhas.slice(0, primeiro).filter((l) => !l.vale).length;
  return [...semVales.slice(0, antes), ...juntos, ...semVales.slice(antes)];
}

const rotulo = (doc: Doc, texto: string, x: number, y: number, align: "left" | "center" | "right" = "left") => {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.5);
  doc.text(texto, x, y, { align });
};
const dado = (doc: Doc, texto: string, x: number, y: number, tamanho = 8, align: "left" | "center" | "right" = "left") => {
  doc.setFont("courier", "normal");
  doc.setFontSize(tamanho);
  doc.text(texto, x, y, { align });
};
// Courier: cada caractere tem 0,6 do tamanho da fonte (pt → mm).
const cabeNaLargura = (texto: string, larguraMm: number, tamanho: number) =>
  texto.slice(0, Math.max(1, Math.floor(larguraMm / ((tamanho * 0.6 * 25.4) / 72))));

function cabecalho(doc: Doc, r: ReciboDePagamento, y: number) {
  dado(doc, "RECIBO DE PAGAMENTO", X0 + 2, y + 4.2, 8.5);
  dado(doc, SUBTITULO[r.tipo], X1 - 2, y + 4.2, 8.5, "right");
  dado(doc, mesPorExtenso(r.competencia), X1 - 2, y + 8.2, 8.5, "right");
  doc.line(X0, y + 10, X1, y + 10);
  rotulo(doc, "Código", X0 + 2, y + 12);
  rotulo(doc, "Nome do Funcionário", X0 + 12, y + 12);
  rotulo(doc, "CPF", X0 + 117, y + 12);
  if (r.codigo) dado(doc, r.codigo, X0 + 9, y + 15.5, 8, "right");
  dado(doc, cabeNaLargura(r.nome.toLocaleUpperCase("pt-BR"), 102, 8), X0 + 12, y + 15.5);
  // Sem CPF no cadastro: espaço para preencher à mão.
  dado(doc, r.cpf ? cpfFormatado(r.cpf) : "___.___.___-__", X0 + 117, y + 15.5);
  if (r.funcao) dado(doc, cabeNaLargura(r.funcao.toLocaleUpperCase("pt-BR"), 102, 8), X0 + 12, y + 19);
  if (r.admissao) dado(doc, `Admissão:   ${r.admissao.slice(0, 10).split("-").reverse().join("/")}`, X1 - 2, y + 19, 8, "right");
}

function quadroDeItens(doc: Doc, r: ReciboDePagamento, y: number) {
  const espaco = TOTAIS - CORPO - 1;
  const linhas = linhasQueCabem(r.linhas, Math.floor(espaco / LINHA_MIN));
  const altura = Math.max(LINHA_MIN, Math.min(LINHA_MAX, espaco / Math.max(1, linhas.length)));
  // Grade: cabeçalho e linhas verticais até os totais (o espaço vazio fica, como no modelo).
  doc.line(X0, y + CAB_TABELA, X1, y + CAB_TABELA);
  doc.line(X0, y + CORPO, X1, y + CORPO);
  for (const x of [C1, C2, C3, C4]) doc.line(x, y + CAB_TABELA, x, y + TOTAIS);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  const cab: Array<[string, number]> = [["Código", (X0 + C1) / 2], ["Descrição", (C1 + C2) / 2], ["Referência", (C2 + C3) / 2], ["Vencimentos", (C3 + C4) / 2], ["Descontos", (C4 + X1) / 2]];
  for (const [t, x] of cab) doc.text(t, x, y + CAB_TABELA + 3.3, { align: "center" });

  const tamanho = altura < 3.4 ? 7 : 7.5;
  let yl = y + CORPO + altura - 0.6;
  for (const l of linhas) {
    dado(doc, String(l.codigo), C1 - 1.2, yl, tamanho, "right");
    dado(doc, cabeNaLargura(l.descricao, C2 - C1 - 2.5, tamanho), C1 + 1.2, yl, tamanho);
    if (l.referencia) dado(doc, l.referencia, C3 - 1.2, yl, tamanho, "right");
    if (l.valor > 0) dado(doc, numero(l.valor), C4 - 1.2, yl, tamanho, "right");
    if (l.valor < 0) dado(doc, numero(l.valor), X1 - 1.2, yl, tamanho, "right");
    yl += altura;
  }
}

// Seta "⇨" desenhada (a fonte do PDF não tem o caractere).
function seta(doc: Doc, x: number, y: number) {
  doc.setLineWidth(0.35);
  doc.line(x, y, x + 5, y);
  doc.line(x + 5, y, x + 3.4, y - 1.2);
  doc.line(x + 5, y, x + 3.4, y + 1.2);
  doc.setLineWidth(0.2);
}

function totais(doc: Doc, r: ReciboDePagamento, y: number) {
  const t = totaisDoRecibo(r.linhas);
  doc.line(X0, y + TOTAIS, X1, y + TOTAIS);
  doc.line(C3, y + TOTAIS, C3, y + RODAPE);
  doc.line(C4, y + TOTAIS, C4, y + RODAPE);
  doc.line(C3, y + LIQUIDO, X1, y + LIQUIDO);
  rotulo(doc, "Total de Vencimentos", (C3 + C4) / 2, y + TOTAIS + 2.3, "center");
  rotulo(doc, "Total de Descontos", (C4 + X1) / 2, y + TOTAIS + 2.3, "center");
  dado(doc, numero(t.vencimentos), C4 - 1.5, y + TOTAIS + 7.5, 8.5, "right");
  dado(doc, numero(t.descontos), X1 - 1.5, y + TOTAIS + 7.5, 8.5, "right");
  rotulo(doc, "Valor Líquido", C3 + 1.5, y + LIQUIDO + 5.6);
  seta(doc, C3 + 15, y + LIQUIDO + 5);
  dado(doc, numero(t.liquido), X1 - 1.5, y + LIQUIDO + 6, 8.5, "right");
  // O valor por extenso fica no espaço à esquerda dos totais (o holerite não tem; aqui ajuda a conferir).
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.text(doc.splitTextToSize(textoDoReciboPagamento(r), C3 - X0 - 5).slice(0, 4), X0 + 2, y + TOTAIS + 4, { lineHeightFactor: 1.3 });
}

function rodape(doc: Doc, r: ReciboDePagamento, y: number) {
  doc.line(X0, y + RODAPE, X1, y + RODAPE);
  rotulo(doc, "Valor mensal", X0 + 14, y + RODAPE + 2.3, "center");
  dado(doc, r.valorMensal != null ? numero(r.valorMensal) : "", X0 + 26, y + RODAPE + 7.5, 8.5, "right");
}

// Faixa à direita: declaração e assinatura em pé (texto girado 90°), como no holerite.
function faixaDaAssinatura(doc: Doc, r: ReciboDePagamento, y: number) {
  doc.rect(FX0, y, FX1 - FX0, ALTURA);
  const vertical = (texto: string, x: number, inicio: number) => doc.text(texto, x, inicio, { angle: 90 });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.5);
  vertical("Declaro ter recebido a importância líquida discriminada neste recibo.", FX0 + 5, y + ALTURA - 8);
  doc.line(FX0 + 15, y + 6, FX0 + 15, y + 62);
  vertical("Assinatura do Funcionário", FX0 + 19, y + 34 + doc.getTextWidth("Assinatura do Funcionário") / 2);
  // Data: a da baixa quando já pago; senão, em branco para preencher na assinatura.
  const data = r.dataPagamento ? r.dataPagamento.slice(0, 10).split("-").reverse().join("/") : "___/___/______";
  doc.setFont("courier", "normal");
  doc.setFontSize(7.5);
  vertical(data, FX0 + 15, y + ALTURA - 8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.5);
  vertical("Data", FX0 + 19, y + ALTURA - 8);
}

function via(doc: Doc, r: ReciboDePagamento, y: number) {
  doc.setDrawColor(0);
  doc.setTextColor(0);
  doc.setLineWidth(0.2);
  doc.rect(X0, y, X1 - X0, ALTURA);
  cabecalho(doc, r, y);
  quadroDeItens(doc, r, y);
  totais(doc, r, y);
  rodape(doc, r, y);
  faixaDaAssinatura(doc, r, y);
  const parabens = linhaDeParabens(r);
  if (parabens) dado(doc, parabens, X0 + 2, y + ALTURA + 4.5, 8);
}

// Nomes, descrições e referências passam pela limpeza dos traços que a fonte não desenha.
function paraPdf(r: ReciboDePagamento): ReciboDePagamento {
  return {
    ...r,
    nome: textoPdf(r.nome),
    funcao: r.funcao == null ? null : textoPdf(r.funcao),
    referencia: textoPdf(r.referencia),
    linhas: r.linhas.map((l) => ({ ...l, descricao: textoPdf(l.descricao), referencia: l.referencia == null ? null : textoPdf(l.referencia) })),
  };
}

/** Um PDF com uma folha por recibo (duas vias iguais); recibos de valor zero ficam de fora. */
export async function gerarRecibosPagamento(recibos: ReciboDePagamento[]) {
  const validos = recibos.filter((r) => r.total > 0.004).map(paraPdf);
  if (validos.length === 0) throw new Error("Nenhum recibo com valor a receber.");
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  validos.forEach((r, i) => {
    if (i > 0) doc.addPage();
    for (const topo of TOPOS) via(doc, r, topo);
  });
  const so = validos.length === 1 ? ` ${validos[0].nome}` : "";
  doc.setProperties({ title: `Recibo ${SUBTITULO[validos[0].tipo].toLowerCase()} ${validos[0].competencia}${so}` });
  return doc;
}

/** Gera e abre a impressão; devolve o endereço do PDF para "abrir/baixar". */
export async function imprimirRecibosPagamento(recibos: ReciboDePagamento[]): Promise<string> {
  return imprimirPdf(await gerarRecibosPagamento(recibos));
}
