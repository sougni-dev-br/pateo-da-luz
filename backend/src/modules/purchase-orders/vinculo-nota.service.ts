import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import {
  calcularStatusDoPedido,
  montarMapaDeUnidades,
  somarRecebido,
  unidadeCompativel,
  validarVinculos,
  type ItemDePedidoConhecido,
  type VinculoInformado
} from "./vinculo-nota.js";

type Tx = Prisma.TransactionClient;

type PedidoAtualizado = { id: string; code: string; de: string; para: string; promovidoSemEnvio: boolean };

export type ResultadoVinculo =
  | { ok: true; pedidosAtualizados: PedidoAtualizado[] }
  | { ok: false; status: number; message: string };

const arredondar = (valor: number) => Math.round(valor * 1000) / 1000;

async function mapaDeUnidades(tx: Tx) {
  return montarMapaDeUnidades(await tx.unitMeasure.findMany({ select: { code: true, name: true } }));
}

/** Trava os pedidos (sempre na mesma ordem, para duas gravações não se travarem) até o fim da transação. */
async function travarPedidos(tx: Tx, orderIds: string[]) {
  const ids = [...new Set(orderIds)].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT "id" FROM "PurchaseOrder" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
}

/**
 * Recalcula o recebido e o status de cada pedido: recebido = parte registrada à mão + soma dos vínculos de
 * notas não canceladas. Chamado depois de gravar, editar, cancelar ou restaurar uma nota.
 */
export async function recalcularPedidos(tx: Tx, orderIds: string[]) {
  const mudancas: PedidoAtualizado[] = [];
  for (const orderId of [...new Set(orderIds)]) {
    const pedido = await tx.purchaseOrder.findUnique({
      where: { id: orderId },
      include: { items: { include: { notaLinks: { include: { purchase: { select: { workflowStatus: true } } } } } } }
    });
    if (!pedido) continue;
    const somaDasNotas = somarRecebido(pedido.items.flatMap((item) => item.notaLinks.map((l) => ({
      purchaseOrderItemId: item.id,
      quantity: Number(l.quantity),
      purchaseCancelada: l.purchase.workflowStatus === "cancelled"
    }))));
    const recebido = new Map(pedido.items.map((item) => [
      item.id,
      arredondar(Number(item.receivedManualQuantity ?? 0) + (somaDasNotas.get(item.id) ?? 0))
    ]));
    for (const item of pedido.items) {
      const novo = recebido.get(item.id) ?? 0;
      if (Number(item.receivedQuantity ?? 0) !== novo) {
        await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { receivedQuantity: novo } });
      }
    }
    const resultado = calcularStatusDoPedido(
      pedido.status,
      pedido.items.map((i) => ({ meta: Number(i.approvedQuantity ?? i.requestedQuantity), recebido: recebido.get(i.id) ?? 0 }))
    );
    if (!resultado.mudou) continue;
    await tx.purchaseOrder.update({
      where: { id: orderId },
      data: {
        status: resultado.status,
        ...(resultado.promovidoSemEnvio && !pedido.sentAt ? { sentAt: new Date() } : {}),
        ...(resultado.status === "RECEBIDO" ? { receivedAt: new Date() } : pedido.receivedAt ? { receivedAt: null } : {})
      }
    });
    mudancas.push({ id: orderId, code: pedido.code, de: pedido.status, para: resultado.status, promovidoSemEnvio: resultado.promovidoSemEnvio });
  }
  return mudancas;
}

/** Cancelar ou restaurar a nota muda o que os pedidos dela receberam. */
export async function recalcularPedidosDaCompra(purchaseId: string) {
  return prisma.$transaction(async (tx) => {
    const links = await tx.purchaseOrderItemLink.findMany({
      where: { purchaseId },
      select: { purchaseOrderItem: { select: { purchaseOrderId: true } } }
    });
    const ids = links.map((l) => l.purchaseOrderItem.purchaseOrderId);
    await travarPedidos(tx, ids);
    return recalcularPedidos(tx, ids);
  });
}

/**
 * Troca os vínculos da nota pelos informados (lista vazia desfaz tudo) e recalcula os pedidos envolvidos.
 * Vínculo com pedido já cancelado fica como está: é histórico e a tela não o oferece mais para edição.
 * Tudo acontece numa transação com a nota e os pedidos travados, para duas gravações não calcularem cada uma a sua metade.
 */
export async function gravarVinculosDaCompra(purchaseId: string, vinculos: VinculoInformado[], userId: string): Promise<ResultadoVinculo> {
  return prisma.$transaction(async (tx): Promise<ResultadoVinculo> => {
    await tx.$queryRaw`SELECT "id" FROM "Purchase" WHERE "id" = ${purchaseId} FOR UPDATE`;
    const compra = await tx.purchase.findUnique({
      where: { id: purchaseId },
      select: { id: true, supplierId: true, workflowStatus: true, items: { select: { productId: true, unit: true } } }
    });
    if (!compra) return { ok: false, status: 404, message: "Compra nao encontrada." };
    if (compra.workflowStatus === "cancelled") return { ok: false, status: 409, message: "Compra cancelada nao pode ser ligada a pedido." };

    const itens = await tx.purchaseOrderItem.findMany({
      where: { id: { in: vinculos.map((v) => v.purchaseOrderItemId) } },
      select: { id: true, productId: true, unitSnapshot: true, purchaseOrder: { select: { id: true, status: true, supplierId: true } } }
    });
    const conhecidos = new Map<string, ItemDePedidoConhecido>(itens.map((i) => [i.id, {
      orderId: i.purchaseOrder.id,
      orderStatus: i.purchaseOrder.status,
      supplierId: i.purchaseOrder.supplierId,
      productId: i.productId
    }]));
    const validacao = validarVinculos(vinculos, conhecidos, { supplierId: compra.supplierId, productIds: new Set(compra.items.map((i) => i.productId)) });
    if (!validacao.ok) return { ok: false, status: 400, message: validacao.message };

    const mapa = await mapaDeUnidades(tx);
    for (const item of itens) {
      const unidadesDaNota = compra.items.filter((i) => i.productId === item.productId).map((i) => i.unit);
      if (!unidadeCompativel(item.unitSnapshot, unidadesDaNota, mapa)) {
        return { ok: false, status: 400, message: `Unidade do pedido (${item.unitSnapshot}) diferente da nota para o mesmo produto; converta a quantidade antes de ligar.` };
      }
    }

    const antigos = await tx.purchaseOrderItemLink.findMany({
      where: { purchaseId, purchaseOrderItem: { purchaseOrder: { status: { not: "CANCELADO" } } } },
      select: { id: true, purchaseOrderItem: { select: { purchaseOrderId: true } } }
    });
    const afetados = [...antigos.map((a) => a.purchaseOrderItem.purchaseOrderId), ...[...conhecidos.values()].map((c) => c.orderId)];
    await travarPedidos(tx, afetados);

    await tx.purchaseOrderItemLink.deleteMany({ where: { id: { in: antigos.map((a) => a.id) } } });
    for (const v of vinculos) {
      await tx.purchaseOrderItemLink.create({
        data: { purchaseOrderItemId: v.purchaseOrderItemId, purchaseId, quantity: v.quantity, createdByUserId: userId }
      });
    }
    return { ok: true, pedidosAtualizados: await recalcularPedidos(tx, afetados) };
  });
}

/**
 * Itens de pedidos do fornecedor que ainda esperam entrega, para a tela da nota oferecer o vínculo.
 * Inclui os já ligados a esta nota (edição) mesmo que o pedido já conste como recebido.
 * `unidadesPorProduto` traz as unidades que a nota usa em cada produto, para marcar o que não dá para comparar.
 */
export async function pedidosEmAbertoParaNota(supplierId: string, unidadesPorProduto: Map<string, string[]>, purchaseId: string | null) {
  const mapa = await mapaDeUnidades(prisma as unknown as Tx);
  const itens = await prisma.purchaseOrderItem.findMany({
    where: {
      productId: { in: [...unidadesPorProduto.keys()] },
      purchaseOrder: { supplierId, status: { not: "CANCELADO" } }
    },
    include: {
      purchaseOrder: { select: { id: true, code: true, status: true, createdAt: true } },
      notaLinks: { include: { purchase: { select: { id: true, workflowStatus: true } } } }
    },
    orderBy: { createdAt: "asc" }
  });
  return itens.flatMap((item) => {
    const meta = Number(item.approvedQuantity ?? item.requestedQuantity);
    const manual = Number(item.receivedManualQuantity ?? 0);
    const recebidoPorOutras = manual + item.notaLinks
      .filter((l) => l.purchaseId !== purchaseId && l.purchase.workflowStatus !== "cancelled")
      .reduce((s, l) => s + Number(l.quantity), 0);
    const nestaNota = item.notaLinks.find((l) => l.purchaseId === purchaseId);
    const restante = arredondar(Math.max(meta - recebidoPorOutras, 0));
    if (restante <= 0 && !nestaNota) return [];
    return [{
      purchaseOrderItemId: item.id,
      orderId: item.purchaseOrder.id,
      orderCode: item.purchaseOrder.code,
      orderStatus: item.purchaseOrder.status,
      orderCreatedAt: item.purchaseOrder.createdAt.toISOString(),
      productId: item.productId,
      productName: item.productNameSnapshot,
      unit: item.unitSnapshot,
      pedida: meta,
      restante,
      vinculada: nestaNota ? Number(nestaNota.quantity) : null,
      unidadeCompativel: unidadeCompativel(item.unitSnapshot, unidadesPorProduto.get(item.productId) ?? [], mapa)
    }];
  });
}

/** Pedidos e quantidades que uma nota atendeu, para mostrar na tela de compras. */
export async function pedidosDaCompra(purchaseId: string) {
  const links = await prisma.purchaseOrderItemLink.findMany({
    where: { purchaseId },
    include: { purchaseOrderItem: { select: { productNameSnapshot: true, unitSnapshot: true, purchaseOrder: { select: { id: true, code: true, status: true } } } } }
  });
  return links.map((l) => ({
    orderId: l.purchaseOrderItem.purchaseOrder.id,
    orderCode: l.purchaseOrderItem.purchaseOrder.code,
    orderStatus: l.purchaseOrderItem.purchaseOrder.status,
    productName: l.purchaseOrderItem.productNameSnapshot,
    unit: l.purchaseOrderItem.unitSnapshot,
    quantity: Number(l.quantity)
  }));
}

/** Notas que atenderam o pedido, com o que cada uma cobriu, para a tela de pedidos. */
export async function notasDoPedido(orderId: string) {
  const links = await prisma.purchaseOrderItemLink.findMany({
    where: { purchaseOrderItem: { purchaseOrderId: orderId } },
    include: {
      purchase: { select: { id: true, purchaseNumber: true, invoiceNumber: true, purchaseDate: true, workflowStatus: true } },
      purchaseOrderItem: { select: { productNameSnapshot: true, unitSnapshot: true } }
    },
    orderBy: { createdAt: "asc" }
  });
  return links.map((l) => ({
    purchaseId: l.purchase.id,
    purchaseNumber: l.purchase.purchaseNumber,
    invoiceNumber: l.purchase.invoiceNumber,
    purchaseDate: l.purchase.purchaseDate.toISOString(),
    cancelada: l.purchase.workflowStatus === "cancelled",
    productName: l.purchaseOrderItem.productNameSnapshot,
    unit: l.purchaseOrderItem.unitSnapshot,
    quantity: Number(l.quantity)
  }));
}
