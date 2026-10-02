// Recibo do vale em nome da empresa, com autorização de desconto na gorjeta e
// campo de assinatura. Uma folha A4 com duas vias (empresa e funcionário).
import type { TipReciboVale, TipValeType } from "../../api/client";
import { textoPdf } from "./envioContabilidade";
import { valorPorExtenso } from "./extenso";

type Doc = InstanceType<typeof import("jspdf").jsPDF>;

const TITULO: Record<TipValeType, string> = {
  ADIANTAMENTO: "RECIBO DE ADIANTAMENTO",
  RETIRADA_CAIXA: "RECIBO DE RETIRADA DE CAIXA",
  REFEICAO: "RECIBO DE REFEIÇÃO",
  VALE_CONSUMO: "RECIBO DE CONSUMO",
  OUTRO: "RECIBO DE DESCONTO",
  CREDITO: "RECIBO",
};
const NOME_TIPO: Record<TipValeType, string> = {
  ADIANTAMENTO: "adiantamento", RETIRADA_CAIXA: "retirada de caixa", REFEICAO: "refeição",
  VALE_CONSUMO: "consumo", OUTRO: "desconto", CREDITO: "crédito",
};
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");
const cnpjFormatado = (c: string) => {
  const d = c.replace(/\D/g, "");
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : c;
};
const cpfFormatado = (c: string) => {
  const d = c.replace(/\D/g, "");
  return d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4") : c;
};
function dataPorExtenso(iso: string | null) {
  const d = iso ? new Date(`${iso.slice(0, 10)}T12:00:00`) : new Date();
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

// O texto que a pessoa assina: recebeu (adiantamento, retirada) ou adquiriu (refeição, consumo,
// outros), e autoriza o desconto na gorjeta daquela apuração.
export function textoDoRecibo(r: TipReciboVale): string {
  // Espaço inseparável: "R$" e o número nunca ficam em linhas diferentes.
  const valor = `${reais(r.vale.valor).replace(" ", "\u00a0")} (${valorPorExtenso(r.vale.valor)})`;
  const empresa = `${r.empresa.razaoSocial}, CNPJ ${cnpjFormatado(r.empresa.cnpj)}`;
  const referente = r.vale.descricao ? `, referente a ${r.vale.descricao}` : "";
  const desconto = `e autorizo o desconto desse valor da minha gorjeta da apuração ${r.apuracao.codigo} (${r.apuracao.periodo}).`;
  const recebeu = r.vale.tipo === "ADIANTAMENTO" || r.vale.tipo === "RETIRADA_CAIXA";
  return recebeu
    ? `Recebi de ${empresa}, a importância de ${valor}, a título de ${NOME_TIPO[r.vale.tipo]}${referente}, ${desconto}`
    : `Declaro que adquiri de ${empresa}, a título de ${NOME_TIPO[r.vale.tipo]}${referente}, o valor de ${valor}, ${desconto}`;
}

function via(doc: Doc, r: TipReciboVale, topo: number, rotulo: string) {
  const esq = 16;
  const larg = 178;
  doc.setDrawColor(60);
  doc.setLineWidth(0.3);
  doc.roundedRect(esq - 4, topo, larg + 8, 128, 2, 2);

  // Emitente
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(r.empresa.razaoSocial, esq, topo + 9);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(90);
  doc.text(`CNPJ ${cnpjFormatado(r.empresa.cnpj)}${r.empresa.fantasia && r.empresa.fantasia !== r.empresa.razaoSocial ? ` · ${r.empresa.fantasia}` : ""}`, esq, topo + 14);
  if (r.empresa.endereco) doc.text(doc.splitTextToSize(r.empresa.endereco, 110)[0], esq, topo + 18);
  doc.setTextColor(0);

  // Título, número e valor
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(TITULO[r.vale.tipo], esq, topo + 30);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Nº ${r.codigo ?? "—"}`, esq, topo + 35);
  doc.setLineWidth(0.5);
  doc.rect(esq + larg - 56, topo + 23, 56, 15);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(reais(r.vale.valor), esq + larg - 4, topo + 33, { align: "right" });

  // Texto
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  const linhas = doc.splitTextToSize(textoDoRecibo(r), larg);
  doc.text(linhas, esq, topo + 48, { lineHeightFactor: 1.5 });

  // Data e assinatura
  const cidade = r.empresa.cidade || "São Paulo";
  doc.text(`${cidade}, ${dataPorExtenso(r.vale.data)}.`, esq, topo + 86);
  const meio = esq + larg / 2;
  doc.setLineWidth(0.3);
  doc.line(meio - 55, topo + 105, meio + 55, topo + 105);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(r.funcionario.nome.toUpperCase(), meio, topo + 110, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(r.funcionario.cpf ? `CPF ${cpfFormatado(r.funcionario.cpf)}` : "CPF: ______________________", meio, topo + 115, { align: "center" });
  if (r.funcionario.funcao) doc.text(r.funcionario.funcao, meio, topo + 120, { align: "center" });

  // Rodapé
  doc.setFontSize(7.5);
  doc.setTextColor(110);
  const emitido = new Date(r.emitidoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  doc.text(`${rotulo} · emitido por ${r.emitidoPor} em ${emitido}${r.vez > 1 ? ` · ${r.vez}ª emissão` : ""}`, esq, topo + 125);
  doc.setTextColor(0);
}

// O que veio digitado (nomes, descrição, endereço) pode ter "−" ou traços que a Helvetica do
// jsPDF não desenha: limpa uma cópia antes de montar o recibo.
const limpo = (s: string | null) => (s == null ? s : textoPdf(s));
function reciboParaPdf(r: TipReciboVale): TipReciboVale {
  return {
    ...r,
    empresa: { ...r.empresa, razaoSocial: textoPdf(r.empresa.razaoSocial), fantasia: textoPdf(r.empresa.fantasia), endereco: textoPdf(r.empresa.endereco), cidade: limpo(r.empresa.cidade) },
    funcionario: { ...r.funcionario, nome: textoPdf(r.funcionario.nome), funcao: limpo(r.funcionario.funcao) },
    vale: { ...r.vale, descricao: limpo(r.vale.descricao) },
    apuracao: { codigo: textoPdf(r.apuracao.codigo), periodo: textoPdf(r.apuracao.periodo) },
    emitidoPor: textoPdf(r.emitidoPor),
  };
}

export async function gerarReciboVale(recibo: TipReciboVale) {
  const r = reciboParaPdf(recibo);
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  via(doc, r, 10, "Via da empresa");
  // Linha de corte entre as vias
  doc.setLineDashPattern([2, 2], 0);
  doc.setDrawColor(150);
  doc.line(8, 148.5, 202, 148.5);
  doc.setLineDashPattern([], 0);
  via(doc, r, 158, "Via do funcionário");
  doc.setProperties({ title: `Recibo ${r.codigo ?? ""}` });
  return doc;
}

// Abre a caixa de impressão sem janela nova (celular e navegador bloqueiam pop-up):
// o PDF carrega num quadro invisível da própria página. Devolve o endereço do PDF,
// para a tela oferecer "abrir/baixar" caso a impressão não abra.
export async function imprimirReciboVale(r: TipReciboVale): Promise<string> {
  const doc = await gerarReciboVale(r);
  const url = URL.createObjectURL(doc.output("blob"));
  const quadro = document.createElement("iframe");
  quadro.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  quadro.src = url;
  quadro.onload = () => {
    try { quadro.contentWindow?.focus(); quadro.contentWindow?.print(); } catch { /* a tela oferece abrir o PDF */ }
    // Tira o quadro depois que a impressão teve tempo de começar.
    window.setTimeout(() => quadro.remove(), 60_000);
  };
  document.body.appendChild(quadro);
  return url;
}
