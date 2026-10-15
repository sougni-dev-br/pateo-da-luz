import type { PurchaseOrder } from "../api/client";

// Texto e links para mandar o pedido de compra ao fornecedor. O PDF vai como arquivo (compartilhar pelo
// celular) ou baixado e anexado; a mensagem já traz os itens para o fornecedor ler sem abrir o arquivo.

const LIMITE_DE_ITENS_NA_MENSAGEM = 40;

/** Telefone do cadastro (com parênteses, traço, espaços) para o formato do WhatsApp: DDI 55 + DDD + número. */
export function telefoneParaWhatsapp(telefone: string | null | undefined): string | null {
  const digitos = String(telefone ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) return digitos;
  return null;
}

const quantidade = (valor: string | number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(Number(valor));

const dataBr = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(iso));

export function mensagemDoPedido(pedido: Pick<PurchaseOrder, "code" | "supplierNameSnapshot" | "supplierContactName" | "expectedDeliveryDate" | "items">): string {
  const itens = pedido.items ?? [];
  const linhas = itens.slice(0, LIMITE_DE_ITENS_NA_MENSAGEM).map((i) => `• ${quantidade(i.requestedQuantity)} ${i.unitSnapshot ?? ""} — ${i.productNameSnapshot}`.replace("  —", " —"));
  const resto = itens.length - LIMITE_DE_ITENS_NA_MENSAGEM;
  return [
    `Olá${pedido.supplierContactName ? `, ${pedido.supplierContactName}` : ""}! Segue o pedido de compra ${pedido.code} do Pateo da Luz.`,
    "",
    ...linhas,
    ...(resto > 0 ? [`… e mais ${resto} ${resto === 1 ? "item" : "itens"} (veja o PDF).`] : []),
    ...(pedido.expectedDeliveryDate ? ["", `Entrega prevista: ${dataBr(pedido.expectedDeliveryDate)}`] : []),
    "",
    "Pode confirmar o recebimento do pedido, os valores e o prazo de entrega? Obrigado!"
  ].join("\n");
}

export function linkWhatsapp(telefone: string | null | undefined, mensagem: string): string | null {
  const numero = telefoneParaWhatsapp(telefone);
  return numero ? `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}` : null;
}

export function linkEmail(email: string | null | undefined, assunto: string, corpo: string): string | null {
  const endereco = String(email ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(endereco)) return null;
  return `mailto:${endereco}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
}

export type AcaoDeStatus = "SEND_REVIEW" | "APPROVE" | "MARK_SENT";

/** O que falta para o pedido poder ir ao fornecedor: o fluxo normal passa por revisão e aprovação. */
export function etapasParaAprovar(status: string): AcaoDeStatus[] {
  if (status === "RASCUNHO") return ["SEND_REVIEW", "APPROVE"];
  if (status === "EM_REVISAO") return ["APPROVE"];
  return [];
}

export const podeEnviarAoFornecedor = (status: string) => status === "APROVADO" || status === "ENVIADO";
