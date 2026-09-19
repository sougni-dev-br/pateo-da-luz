import { CANAIS_FATURADOS } from "./noventa-nove-real-sync.service.js";

/** Canal de estorno: linha de ajuste, nao venda. */
export const CANAL_ESTORNO = "DELIVERY_REFUND";

/**
 * Estorno entra no VALOR (reduz o bruto do dia) mas nao conta como PEDIDO.
 *
 * O razao ja fazia isso desde sempre — `reflectSalesIntoRevenueEntries` tem a
 * linha `if (sale.channel !== "DELIVERY_REFUND") prev.count += 1`. A tela da 99
 * contava tudo, entao mostrava mais pedidos que o razao para o mesmo dinheiro, e
 * o ticket medio saia menor: em julho/2026 eram 2.015 pedidos na tela contra
 * 1.920 no razao (95 estornos), 106 em agosto e 67 em setembro.
 */
export function contaComoPedido(channel: string | null): boolean {
  if (!channel) return false;
  if (channel === CANAL_ESTORNO) return false;
  return (CANAIS_FATURADOS as readonly string[]).includes(channel);
}
