// Formulário de cadastro do cartão: a conta (fatura) e os cartões dela (um físico e vários
// virtuais vinculados a ele). Só contas e validações, sem tela.
import type { CreditCard } from "../../api/client";

export type VirtualDoForm = { key: string; id?: string; label: string; last4Digits: string; isActive: boolean };

export type FormDoCartao = {
  id: string;
  name: string;
  bankName: string;
  closingDay: string;
  dueDay: string;
  notes: string;
  isActive: boolean;
  fisico: { id?: string; last4Digits: string };
  virtuais: VirtualDoForm[];
};

/** O melhor dia de compra é o dia seguinte ao fechamento: a compra só entra na fatura seguinte. */
export function melhorDiaDeCompra(closingDay: number): number {
  return closingDay >= 31 ? 1 : closingDay + 1;
}

export function formDoCartao(card?: CreditCard): FormDoCartao {
  if (!card) {
    return { id: "", name: "", bankName: "", closingDay: "", dueDay: "", notes: "", isActive: true, fisico: { last4Digits: "" }, virtuais: [] };
  }
  const finais = card.finais ?? [];
  const fisico = finais.find((final) => final.kind === "PHYSICAL" && final.isActive);
  return {
    id: card.id,
    name: card.name,
    bankName: card.bankName,
    closingDay: String(card.closingDay),
    dueDay: String(card.dueDay),
    notes: card.notes ?? "",
    isActive: card.isActive,
    // Conta antiga, sem cartões cadastrados: o final da conta vira o do físico.
    fisico: fisico ? { id: fisico.id, last4Digits: fisico.last4Digits } : { last4Digits: card.last4Digits },
    virtuais: finais
      .filter((final) => final.kind === "VIRTUAL")
      .map((final) => ({ key: final.id, id: final.id, label: final.label, last4Digits: final.last4Digits, isActive: final.isActive }))
  };
}

function diaValido(valor: string): boolean {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 && n <= 31;
}

export function errosDoFormulario(form: FormDoCartao): Record<string, string> {
  const erros: Record<string, string> = {};
  if (!form.name.trim()) erros.name = "Dê um nome ao cartão (ex.: Cartão Sicredi).";
  if (!form.bankName.trim()) erros.bankName = "Informe o banco.";
  if (!diaValido(form.closingDay)) erros.closingDay = "Informe um dia entre 1 e 31.";
  if (!diaValido(form.dueDay)) erros.dueDay = "Informe um dia entre 1 e 31.";
  if (!/^\d{4}$/.test(form.fisico.last4Digits)) erros.fisico = "Informe os 4 últimos dígitos do cartão físico.";

  const ativos = form.virtuais.filter((virtual) => virtual.isActive || virtual.id);
  if (ativos.some((virtual) => !/^\d{4}$/.test(virtual.last4Digits))) {
    erros.virtuais = "Cada cartão virtual precisa dos 4 últimos dígitos.";
  } else {
    const finais = [form.fisico.last4Digits, ...ativos.map((virtual) => virtual.last4Digits)];
    const repetido = finais.find((final, indice) => final && finais.indexOf(final) !== indice);
    if (repetido) erros.virtuais = `O final ${repetido} aparece em mais de um cartão desta conta.`;
  }
  return erros;
}

export type PayloadDoCartao = {
  id?: string;
  name: string;
  bankName: string;
  closingDay: number;
  dueDay: number;
  notes: string;
  isActive: boolean;
  finais: Array<{ id?: string; label: string; last4Digits: string; kind: "PHYSICAL" | "VIRTUAL"; isActive: boolean }>;
};

export function paraPayload(form: FormDoCartao): PayloadDoCartao {
  return {
    id: form.id || undefined,
    name: form.name.trim(),
    bankName: form.bankName.trim(),
    closingDay: Number(form.closingDay),
    dueDay: Number(form.dueDay),
    notes: form.notes.trim(),
    isActive: form.isActive,
    finais: [
      { id: form.fisico.id, label: "Físico", last4Digits: form.fisico.last4Digits, kind: "PHYSICAL", isActive: true },
      ...form.virtuais.map((virtual) => ({
        id: virtual.id,
        label: virtual.label.trim(),
        last4Digits: virtual.last4Digits,
        kind: "VIRTUAL" as const,
        isActive: virtual.isActive
      }))
    ]
  };
}
