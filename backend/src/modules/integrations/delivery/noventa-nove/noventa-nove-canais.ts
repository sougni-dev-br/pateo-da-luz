// Canais das vendas do 99Food. Fica num arquivo proprio, sem dependencias, para o webhook e o
// sync poderem importar sem ciclo.
//
// REGRA: o canal "DELIVERY"/"DELIVERY_REFUND" e o que transforma uma venda em RECEITA (o sync que
// reflete no razao, as telas e os insights leem so esses). Quem decide esse canal e a API
// FINANCEIRA da 99, nunca o corpo de um webhook, que e publico (fica antes do portao de acesso).

// Canais que a API FINANCEIRA grava (ver persistSales: channel = isRevenue ? "DELIVERY" :
// "DELIVERY_REFUND"). O webhook grava outra coisa no mesmo campo, o delivery_type numerico do
// payload, tipicamente "1", entao o canal serve para separar as duas origens.
export const CANAIS_FATURADOS = ["DELIVERY", "DELIVERY_REFUND"] as const;

const RESERVADOS = new Set<string>(CANAIS_FATURADOS.map((c) => c.toUpperCase()));
const PREFIXO_WEBHOOK = "WEBHOOK:";
const TAMANHO_BASE = 32; // base + prefixo cabem em 40 caracteres

export function ehCanalFaturado(canal: string | null | undefined): boolean {
  return typeof canal === "string" && RESERVADOS.has(canal.trim().toUpperCase());
}

// Canal que o webhook pode gravar. Vem do corpo da requisicao, entao NAO e confiavel:
// um valor igual a um canal de faturamento ganha o prefixo "WEBHOOK:" e deixa de contar como
// receita. O delivery_type legitimo (numerico) passa igual. Nunca devolve um canal faturado.
// O corte de tamanho vem ANTES do teste: testar o texto inteiro e cortar depois deixaria passar
// entradas como "DELIVERY" + muitos espacos + "x".
export function canalDoWebhook(deliveryType: unknown): string | null {
  if (deliveryType === undefined || deliveryType === null) return null;
  const base = String(deliveryType).trim().slice(0, TAMANHO_BASE).trim();
  if (base === "") return null;
  return ehCanalFaturado(base) ? `${PREFIXO_WEBHOOK}${base}` : base;
}
