import { Router } from "express";
import { auditLog, requestIp, requireRole } from "../security/security-utils.js";
import { gravarVinculosDaCompra, pedidosDaCompra, pedidosEmAbertoParaNota } from "../purchase-orders/vinculo-nota.service.js";

// Ligação entre a nota (compra) e os pedidos de compra que ela atendeu. Montado dentro de /purchases.
export const vinculoPedidoRouter = Router();

const MAX_PRODUTOS_NA_CONSULTA = 300;

vinculoPedidoRouter.get("/pedidos-em-aberto", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  const supplierId = String(request.query.supplierId ?? "").trim();
  // produtos=idDoProduto~UN,outroId~KG: o produto e a unidade em que a nota o traz (a unidade pode ficar vazia).
  const unidadesPorProduto = new Map<string, string[]>();
  for (const par of String(request.query.produtos ?? "").split(",").slice(0, MAX_PRODUTOS_NA_CONSULTA)) {
    const [id, unidade] = par.split("~").map((t) => t.trim());
    if (!id) continue;
    unidadesPorProduto.set(id, [...(unidadesPorProduto.get(id) ?? []), ...(unidade ? [unidade] : [])]);
  }
  const purchaseId = String(request.query.purchaseId ?? "").trim() || null;
  if (!supplierId || unidadesPorProduto.size === 0) {
    response.json({ items: [] });
    return;
  }
  response.json({ items: await pedidosEmAbertoParaNota(supplierId, unidadesPorProduto, purchaseId) });
});

vinculoPedidoRouter.get("/:id/pedidos", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;
  response.json({ items: await pedidosDaCompra(request.params.id) });
});

vinculoPedidoRouter.put("/:id/pedidos", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  const bruto: unknown = request.body?.links;
  if (!Array.isArray(bruto)) {
    response.status(400).json({ message: "Informe a lista de vinculos (links)." });
    return;
  }
  const links = bruto.map((l: Record<string, unknown>) => ({
    purchaseOrderItemId: String(l?.purchaseOrderItemId ?? "").trim(),
    quantity: Number(l?.quantity)
  }));
  const anterior = await pedidosDaCompra(request.params.id);
  const resultado = await gravarVinculosDaCompra(request.params.id, links, user.id);
  if (!resultado.ok) {
    response.status(resultado.status).json({ message: resultado.message });
    return;
  }
  await auditLog({
    userId: user.id,
    action: "LINK_PURCHASE_TO_ORDERS",
    entity: "Purchase",
    entityId: request.params.id,
    previousValue: anterior,
    newValue: { links, pedidosAtualizados: resultado.pedidosAtualizados },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });
  response.json({ items: await pedidosDaCompra(request.params.id), pedidosAtualizados: resultado.pedidosAtualizados });
});
