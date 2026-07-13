import { prisma } from "../../../../config/database.js";
import type { Prisma } from "@prisma/client";

// Webhook receiver do 99 Food (DiDi Food).
//
// Enquanto 99 Food OpenAPI não expõe endpoint pra LISTAR pedidos, o
// contrato é receber cada evento por webhook e agregar. Este arquivo
// é o parse+persist idempotente.
//
// Eventos esperados (do YAML, seção Order + Item):
//   - novo pedido recebido (event=orderCreated ou similar)
//   - status muda (confirmed, ready, delivered, cancelled)
//   - upload de menu completou (event=uploadMenuTaskStatus)
//
// A doc HTML descreve o formato exato do envelope e da assinatura HMAC —
// que ainda não confirmei. Este service trata o payload principal
// (OrderModel) e ignora eventos desconhecidos com log — melhor perder
// evento do que persistir garbage.

// Envelope REAL do webhook (validado via sandbox 2026-07-13):
//   {
//     type: "orderNew" | "orderStatusChanged" | ...,   // NÃO é "event"
//     app_id: number (long),
//     app_shop_id: string,
//     timestamp: number,             // unix seconds
//     data: {
//       order_id: number,
//       order_info: OrderModel,       // pedido fica DENTRO de data.order_info
//       ...
//     }
//   }
// Assinatura (sign) não observada no sandbox — pode vir em header ou
// só em prod. TODO: confirmar em prod real com pedido de cliente.
// shop_id: vem dentro de data.order_info.shop.shop_id.

export type WebhookEnvelope = {
  // Campos observados no sandbox 2026-07-13
  type?: string;
  app_id?: string | number;
  app_shop_id?: string;
  timestamp?: number;
  data?: {
    order_id?: string | number;
    order_info?: OrderCallbackPayload;
    // Fallback pra outros tipos de callback
    [key: string]: unknown;
  };
  // Fallbacks pra variações do contrato (documentação antiga usava event)
  event?: string;
  shop_id?: string | number;
  sign?: string;
};

export type OrderCallbackPayload = {
  order_id?: string | number;
  status?: number;
  shop_accept_status?: number;
  order_index?: number;
  create_time?: number;
  pay_time?: number;
  complete_time?: number;
  cancel_time?: number;
  pay_type?: number;
  delivery_type?: number;
  country?: string;
  timezone?: string;
  price?: {
    order_price?: number;
    real_price?: number;
    real_pay_price?: number;
    delivery_price?: number;
    shop_paid_money?: number;
    refund_price?: number;
    currency?: string;
    items_discount?: number;
    delivery_discount?: number;
    customer_need_paying_money?: number;
    others_fees?: {
      small_order_price?: number;
      total_tip_money?: number;
      service_price?: number;
      coupon_discount?: number;
    };
  };
  shop?: {
    shop_id?: string | number;
    app_shop_id?: string;
    shop_name?: string;
    shop_addr?: string;
  };
  order_items?: unknown[];
  promotions?: unknown[];
};

export type WebhookResult = {
  event: string;
  handled: boolean;
  reason: string;
  saleId: string | null;
};

// TODO: implementar verificação real. Placeholder retorna sempre true no
// modo mock/dev; em produção deve validar HMAC contra app_secret. Bloqueia
// deploy real até doc HTML confirmar algoritmo.
export function verifyWebhookSignature(envelope: WebhookEnvelope, _appSecret: string): boolean {
  const signaturePresent = typeof envelope.sign === "string" && envelope.sign.length > 0;
  // Sem algoritmo confirmado ainda — retornamos true e logamos.
  // NÃO SUBIR PRA PRODUÇÃO SEM IMPLEMENTAR.
  console.warn("[99Food webhook] signature verification is NOT implemented yet. TODO before production. Signature present:", signaturePresent);
  return true;
}

// PriceModel vem em cents (menor denominação). Convertemos pra BRL
// dividindo por 100. Currency guarda pra auditoria.
function centsToDecimal(cents: number | undefined): number {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return 0;
  return Math.round(cents) / 100;
}

function unixToDate(unixSeconds: number | undefined): Date | null {
  if (typeof unixSeconds !== "number" || !Number.isFinite(unixSeconds) || unixSeconds <= 0) return null;
  return new Date(unixSeconds * 1000);
}

// Localiza a DeliveryStore correspondente ao evento. Preferência:
//   1. match por shopIdRemote (data.order_info.shop.shop_id ou envelope.shop_id fallback)
//   2. match por externalId (envelope.app_shop_id ou data.order_info.shop.app_shop_id)
async function findStoreForCallback(envelope: WebhookEnvelope, orderInfo: OrderCallbackPayload | null) {
  const remoteFromShop = orderInfo?.shop?.shop_id !== undefined ? String(orderInfo.shop.shop_id) : null;
  const remoteFromEnvelope = envelope.shop_id !== undefined ? String(envelope.shop_id) : null;
  const remoteId = remoteFromShop ?? remoteFromEnvelope;
  const appShopId = envelope.app_shop_id ?? orderInfo?.shop?.app_shop_id ?? null;

  if (remoteId) {
    const byRemote = await prisma.deliveryStore.findFirst({
      where: { platform: "NOVENTA_NOVE", shopIdRemote: remoteId }
    });
    if (byRemote) return byRemote;
  }
  if (appShopId) {
    const byApp = await prisma.deliveryStore.findFirst({
      where: { platform: "NOVENTA_NOVE", externalId: appShopId }
    });
    if (byApp) {
      if (remoteId && !byApp.shopIdRemote) {
        await prisma.deliveryStore.update({
          where: { id: byApp.id },
          data: { shopIdRemote: remoteId }
        });
      }
      return byApp;
    }
  }
  return null;
}

async function persistOrderCallback(
  storeId: string,
  order: OrderCallbackPayload,
  rawPayload: unknown
): Promise<string | null> {
  const externalOrderId = order.order_id !== undefined ? String(order.order_id) : null;
  if (!externalOrderId) return null;

  const orderDate = unixToDate(order.create_time) ?? unixToDate(order.pay_time) ?? new Date();
  const price = order.price ?? {};
  const others = price.others_fees ?? {};

  const grossAmount = centsToDecimal(price.order_price);
  const netAmount = centsToDecimal(price.real_price);
  const deliveryFeeAmount = centsToDecimal(price.delivery_price);
  const promotionAmount = centsToDecimal(price.items_discount) + centsToDecimal(others.coupon_discount);
  // 99 não expõe comissão explicitamente via callback. Aproximação:
  // grossAmount - netAmount - promo - delivery. Fica em fee "estimativa"
  // enquanto invoice mensal do 99 não chegar pra reconciliar.
  const noventaNoveFeeAmount = Math.max(0, grossAmount - netAmount - promotionAmount - deliveryFeeAmount);

  const data: Prisma.NoventaNoveSaleUncheckedCreateInput = {
    deliveryStoreId: storeId,
    externalOrderId,
    orderDate,
    competenceYear: orderDate.getFullYear(),
    competenceMonth: orderDate.getMonth() + 1,
    grossAmount,
    noventaNoveFeeAmount,
    promotionAmount,
    deliveryFeeAmount,
    netAmount,
    paymentMethod: order.pay_type !== undefined ? String(order.pay_type) : null,
    channel: order.delivery_type !== undefined ? String(order.delivery_type) : null,
    rawPayload: rawPayload as Prisma.InputJsonValue
  };

  // Idempotente: upsert por (deliveryStoreId, externalOrderId)
  const sale = await prisma.noventaNoveSale.upsert({
    where: {
      // Composite unique key — Prisma expõe assim
      deliveryStoreId_externalOrderId: {
        deliveryStoreId: storeId,
        externalOrderId
      }
    },
    create: data,
    update: {
      orderDate: data.orderDate,
      competenceYear: data.competenceYear,
      competenceMonth: data.competenceMonth,
      grossAmount: data.grossAmount,
      noventaNoveFeeAmount: data.noventaNoveFeeAmount,
      promotionAmount: data.promotionAmount,
      deliveryFeeAmount: data.deliveryFeeAmount,
      netAmount: data.netAmount,
      paymentMethod: data.paymentMethod,
      channel: data.channel,
      rawPayload: data.rawPayload
    }
  });
  return sale.id;
}

// Handler principal — chamado direto do route handler.
// Contrato real DiDi:
//   - Nome do tipo em `type` (com fallback pra `event` da doc antiga)
//   - Payload do pedido em `data.order_info` (com fallback pra `data`)
export async function handleWebhook(envelope: WebhookEnvelope, rawBody: string): Promise<WebhookResult> {
  const event = typeof envelope.type === "string"
    ? envelope.type
    : typeof envelope.event === "string" ? envelope.event : "unknown";

  await prisma.noventaNoveSyncLog.create({
    data: {
      syncType: `WEBHOOK:${event}`,
      startedAt: new Date(),
      finishedAt: new Date(),
      status: "RECEIVED",
      itemsProcessed: 0,
      errorMessage: null
    }
  });

  // Extrai pedido: real está em data.order_info, mas aceita data direto
  // como fallback pra webhooks de outros tipos.
  const orderInfo: OrderCallbackPayload | null = envelope.data?.order_info
    ?? (envelope.data as OrderCallbackPayload | undefined)
    ?? null;

  const store = await findStoreForCallback(envelope, orderInfo);
  if (!store) {
    return {
      event,
      handled: false,
      reason: `Nenhuma loja NOVENTA_NOVE encontrada pra shop_id=${orderInfo?.shop?.shop_id ?? envelope.shop_id} / app_shop_id=${envelope.app_shop_id ?? orderInfo?.shop?.app_shop_id}. Evento ignorado.`,
      saleId: null
    };
  }

  const cred = await prisma.noventaNoveCredential.findFirst({ where: { active: true } });
  if (cred) {
    const valid = verifyWebhookSignature(envelope, cred.clientSecret);
    if (!valid) {
      return { event, handled: false, reason: "Assinatura inválida", saleId: null };
    }
  }

  // orderNew / orderCreated / order_new / orderStatusChanged etc — todos
  // trazem OrderModel; persistimos como venda (upsert por order_id).
  const isOrderEvent = event.toLowerCase().startsWith("order") || event === "unknown";
  if (isOrderEvent) {
    if (!orderInfo) {
      return { event, handled: false, reason: "Payload sem order_info — nada a persistir", saleId: null };
    }
    try {
      const saleId = await persistOrderCallback(store.id, orderInfo, rawBody);
      return {
        event,
        handled: Boolean(saleId),
        reason: saleId ? "Pedido persistido/atualizado" : "order_id ausente — nada persistido",
        saleId
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Erro ao persistir pedido";
      return { event, handled: false, reason: message, saleId: null };
    }
  }

  return {
    event,
    handled: false,
    reason: `Evento "${event}" não tem handler específico ainda — logado e ignorado`,
    saleId: null
  };
}
