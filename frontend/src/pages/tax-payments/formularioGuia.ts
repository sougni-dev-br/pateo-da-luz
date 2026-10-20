import type { TaxPaymentDetail } from "../../api/client";
import { competenciaSugerida } from "../../lib/competencia-imposto";
import { maskMoney, moneyToMasked, numeroBr } from "../../utils/format";
import { competenciaDoMes, mesDaData } from "./regras";

export const TIPOS_DE_GUIA = [
  "FGTS", "GPS / INSS", "DARF", "DARF IR", "IRRF", "Simples Nacional / DAS", "DASN",
  "DARE", "DARE-SP", "GARE ICMS", "GARE ISS", "TFE", "IPTU", "ISS",
  "Parcelamento Tributário", "Outros",
];

// Os tipos que quase todo lançamento usa ficam à vista; os demais, no seletor.
export const TIPOS_EM_DESTAQUE = ["Simples Nacional / DAS", "FGTS", "GPS / INSS", "DARF"];

export type FormGuia = {
  documentType: string;
  /** Mês da competência no formato do campo de mês (AAAA-MM). */
  mes: string;
  dueDate: string;
  amount: string;
  companyId: string;
  cnpj: string;
  legalName: string;
  tradeName: string;
  description: string;
  dreCategoryId: string;
  jaPaga: boolean;
  paymentDate: string;
  paidAmount: string;
  comments: string;
  cancelada: boolean;
};

export const FORM_VAZIO: FormGuia = {
  documentType: "", mes: "", dueDate: "", amount: "", companyId: "", cnpj: "", legalName: "", tradeName: "",
  description: "", dreCategoryId: "", jaPaga: false, paymentDate: "", paidAmount: "", comments: "", cancelada: false,
};

export function formDaGuia(d: TaxPaymentDetail): FormGuia {
  return {
    documentType: d.documentType,
    mes: mesDaData(d.competenceDate),
    dueDate: d.dueDate.slice(0, 10),
    amount: moneyToMasked(d.amount),
    companyId: d.companyId ?? "",
    cnpj: d.cnpj ?? "",
    legalName: d.legalName ?? "",
    tradeName: d.tradeName ?? "",
    description: d.description ?? "",
    dreCategoryId: d.dreCategoryId ?? "",
    jaPaga: Boolean(d.paymentDate),
    paymentDate: d.paymentDate ? d.paymentDate.slice(0, 10) : "",
    paidAmount: moneyToMasked(d.paidAmount),
    comments: d.comments ?? "",
    cancelada: d.status === "CANCELED",
  };
}

// Duplicar copia a guia e deixa em branco o que muda a cada mês (competência, vencimento, pagamento).
export function formDuplicado(d: TaxPaymentDetail): FormGuia {
  return { ...formDaGuia(d), mes: "", dueDate: "", jaPaga: false, paymentDate: "", paidAmount: "", cancelada: false };
}

// Competência sugerida (mês anterior ao vencimento) só para os tipos que seguem essa regra.
export function mesSugerido(documentType: string, dueDate: string): string {
  return competenciaSugerida(documentType, dueDate).slice(0, 7);
}

export type ErrosGuia = Partial<Record<"documentType" | "mes" | "dueDate" | "amount" | "paymentDate" | "paidAmount", string>>;

export function validarGuia(f: FormGuia, emEdicao: boolean, hoje: string): ErrosGuia {
  const erros: ErrosGuia = {};
  if (!f.documentType) erros.documentType = "Escolha o tipo da guia.";
  if (!f.cancelada && !f.mes) erros.mes = "Informe a competência: sem ela a guia fica fora do DRE.";
  if (!f.dueDate) erros.dueDate = "Informe o vencimento.";
  if (!(numeroBr(f.amount) > 0)) erros.amount = "Informe o valor da guia.";
  if (!emEdicao && f.jaPaga) {
    if (!f.paymentDate) erros.paymentDate = "Informe a data do pagamento.";
    else if (f.paymentDate > hoje) erros.paymentDate = "A data do pagamento não pode ser futura.";
    if (f.paidAmount && !(numeroBr(f.paidAmount) > 0)) erros.paidAmount = "Valor pago inválido.";
  }
  return erros;
}

// Corpo enviado à API. Na edição o pagamento não vai (só /pay e /reverse alteram), e na criação o
// status não vai (sai das datas).
export function payloadDaGuia(f: FormGuia, emEdicao: boolean, categoriaEscolhida: boolean) {
  const base = {
    companyId: f.companyId || null,
    cnpj: f.cnpj || null,
    legalName: f.legalName || null,
    tradeName: f.tradeName || null,
    documentType: f.documentType,
    description: f.description || null,
    competenceDate: competenciaDoMes(f.mes) || null,
    dueDate: f.dueDate,
    amount: String(numeroBr(f.amount)),
    comments: f.comments || null,
    // Sem escolha da pessoa vai undefined e o servidor aplica a regra; null é "sem categoria".
    dreCategoryId: f.dreCategoryId || (categoriaEscolhida ? null : undefined),
  };
  if (emEdicao) return { ...base, status: (f.cancelada ? "CANCELED" : "PENDING") as "CANCELED" | "PENDING" };
  return {
    ...base,
    paymentDate: f.jaPaga ? f.paymentDate : null,
    paidAmount: f.jaPaga ? String(numeroBr(f.paidAmount || f.amount)) : null,
  };
}

export { maskMoney };
