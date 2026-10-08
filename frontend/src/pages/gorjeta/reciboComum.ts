// Peças comuns dos recibos impressos (vale da gorjeta e pagamento de quem não tem registro):
// formatação, data por extenso, assinatura, linha de corte entre as vias e a impressão sem janela nova.
import { imprimirBlobPdf } from "../../utils/imprimirPdf";
import { textoPdf } from "./envioContabilidade";

export type Doc = InstanceType<typeof import("jspdf").jsPDF>;

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");
/** "R$" e o número nunca ficam em linhas diferentes no texto corrido. */
export const reaisNoTexto = (v: number) => reais(v).replace(" ", "\u00a0");

export const cpfFormatado = (c: string) => {
  const d = c.replace(/\D/g, "");
  return d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4") : c;
};

export function dataPorExtenso(iso: string | null) {
  const d = iso ? new Date(`${iso.slice(0, 10)}T12:00:00`) : new Date();
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

/** O que veio digitado (nomes, descrição) pode ter "−" ou traços que a Helvetica do jsPDF não desenha. */
export const limpo = (s: string | null) => (s == null ? s : textoPdf(s));

/** Linha de assinatura com o nome em maiúsculas e o CPF (sem CPF: linha para preencher). */
export function assinatura(doc: Doc, meio: number, y: number, nome: string, cpf: string | null, funcao?: string | null) {
  doc.setLineWidth(0.3);
  doc.line(meio - 55, y, meio + 55, y);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(nome.toUpperCase(), meio, y + 5, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(cpf ? `CPF ${cpfFormatado(cpf)}` : "CPF: ______________________", meio, y + 10, { align: "center" });
  if (funcao) doc.text(funcao, meio, y + 15, { align: "center" });
}

/** Linha tracejada no meio da folha A4, entre as duas vias. */
export function linhaDeCorte(doc: Doc) {
  doc.setLineDashPattern([2, 2], 0);
  doc.setDrawColor(150);
  doc.line(8, 148.5, 202, 148.5);
  doc.setLineDashPattern([], 0);
}

/** Abre a caixa de impressão do recibo; devolve o endereço do PDF (ver imprimirBlobPdf). */
export function imprimirPdf(doc: Doc): string {
  return imprimirBlobPdf(doc.output("blob"));
}
