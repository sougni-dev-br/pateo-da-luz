import { Router } from "express";
import { requireRole } from "../../../security/security-utils.js";
import {
  createStore,
  getPeriodSummary,
  getStatus,
  listStores,
  runMockSync,
  runSmartSync,
  saveCredential,
  updateStore
} from "./ifood.service.js";
import {
  ifoodCredentialInputSchema,
  ifoodStoreInputSchema,
  periodQuerySchema
} from "./ifood.types.js";
import { getPainelDonoInsights } from "./ifood-insights.service.js";
import { testIfoodConnection } from "./ifood-http-client.js";
import { prisma } from "../../../../config/database.js";

export const ifoodDeliveryRouter = Router();

const READ_ROLES = ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"] as const;
const WRITE_ROLES = ["ADMIN", "GESTAO_COMPLETA"] as const;

ifoodDeliveryRouter.get("/status", async (request, response) => {
  const user = await requireRole(request, response, [...READ_ROLES]);
  if (!user) return;
  const status = await getStatus();
  response.json(status);
});

ifoodDeliveryRouter.get("/stores", async (request, response) => {
  const user = await requireRole(request, response, [...READ_ROLES]);
  if (!user) return;
  const stores = await listStores();
  response.json(stores);
});

ifoodDeliveryRouter.post("/stores", async (request, response) => {
  const user = await requireRole(request, response, [...WRITE_ROLES]);
  if (!user) return;
  const parsed = ifoodStoreInputSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Payload inválido", errors: parsed.error.flatten() });
    return;
  }
  const created = await createStore(parsed.data);
  response.status(201).json(created);
});

ifoodDeliveryRouter.put("/stores/:id", async (request, response) => {
  const user = await requireRole(request, response, [...WRITE_ROLES]);
  if (!user) return;
  const parsed = ifoodStoreInputSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Payload inválido", errors: parsed.error.flatten() });
    return;
  }
  try {
    const updated = await updateStore(request.params.id, parsed.data);
    response.json(updated);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erro ao atualizar loja";
    response.status(400).json({ message });
  }
});

ifoodDeliveryRouter.post("/credential", async (request, response) => {
  const user = await requireRole(request, response, [...WRITE_ROLES]);
  if (!user) return;
  const parsed = ifoodCredentialInputSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Credencial inválida", errors: parsed.error.flatten() });
    return;
  }
  const status = await saveCredential(parsed.data);
  response.json(status);
});

ifoodDeliveryRouter.get("/summary", async (request, response) => {
  const user = await requireRole(request, response, [...READ_ROLES]);
  if (!user) return;
  const parsed = periodQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ message: "Parâmetros inválidos", errors: parsed.error.flatten() });
    return;
  }
  const summary = await getPeriodSummary(parsed.data);
  response.json(summary);
});

ifoodDeliveryRouter.get("/insights", async (request, response) => {
  const user = await requireRole(request, response, [...READ_ROLES]);
  if (!user) return;
  const parsed = periodQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ message: "Parâmetros inválidos", errors: parsed.error.flatten() });
    return;
  }
  const insights = await getPainelDonoInsights({ year: parsed.data.year, month: parsed.data.month });
  response.json(insights);
});

ifoodDeliveryRouter.post("/test-connection", async (request, response) => {
  const user = await requireRole(request, response, [...WRITE_ROLES]);
  if (!user) return;
  const result = await testIfoodConnection();
  response.status(result.ok ? 200 : 400).json(result);
});

ifoodDeliveryRouter.post("/sync", async (request, response) => {
  const user = await requireRole(request, response, [...WRITE_ROLES]);
  if (!user) return;
  const now = new Date();
  const year = Number(request.body?.year) || now.getFullYear();
  const month = Number(request.body?.month) || (now.getMonth() + 1);
  const result = await runSmartSync(user.id ?? null, year, month);
  response.json(result);
});

// Auditoria financeira — endpoints exigidos na homologação, consultáveis
// pra responder o formulário de perguntas do iFood.
ifoodDeliveryRouter.get("/audit/:kind", async (request, response) => {
  const user = await requireRole(request, response, [...READ_ROLES]);
  if (!user) return;
  const parsed = periodQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ message: "Parâmetros inválidos", errors: parsed.error.flatten() });
    return;
  }
  const { year, month, storeId } = parsed.data;
  const baseWhere: Record<string, unknown> = { competenceYear: year, competenceMonth: month };
  if (storeId) baseWhere.deliveryStoreId = storeId;
  const kind = request.params.kind;
  try {
    if (kind === "events") {
      const rows = await prisma.ifoodFinancialEvent.findMany({
        where: baseWhere,
        orderBy: { eventDate: "asc" },
        include: { deliveryStore: { select: { nickname: true } } }
      });
      response.json(rows.map((r) => ({
        id: r.id,
        externalId: r.externalId,
        storeNickname: r.deliveryStore.nickname,
        eventType: r.eventType,
        eventDate: r.eventDate.toISOString().slice(0, 10),
        amount: Number(r.amount),
        description: r.description,
        referenceOrderId: r.referenceOrderId,
        status: r.status
      })));
      return;
    }
    if (kind === "reconciliation") {
      const rows = await prisma.ifoodReconciliationItem.findMany({
        where: baseWhere,
        orderBy: { referenceDate: "asc" },
        include: { deliveryStore: { select: { nickname: true } } }
      });
      response.json(rows.map((r) => ({
        id: r.id,
        externalId: r.externalId,
        storeNickname: r.deliveryStore.nickname,
        itemType: r.itemType,
        referenceDate: r.referenceDate.toISOString().slice(0, 10),
        orderId: r.orderId,
        amount: Number(r.amount),
        description: r.description,
        settlementRef: r.settlementRef
      })));
      return;
    }
    if (kind === "anticipations") {
      const rows = await prisma.ifoodAnticipation.findMany({
        where: baseWhere,
        orderBy: { requestedAt: "asc" },
        include: { deliveryStore: { select: { nickname: true } } }
      });
      response.json(rows.map((r) => ({
        id: r.id,
        externalId: r.externalId,
        storeNickname: r.deliveryStore.nickname,
        requestedAt: r.requestedAt.toISOString().slice(0, 10),
        paidAt: r.paidAt ? r.paidAt.toISOString().slice(0, 10) : null,
        requestedAmount: Number(r.requestedAmount),
        feeAmount: Number(r.feeAmount),
        netAmount: Number(r.netAmount),
        status: r.status
      })));
      return;
    }
    response.status(400).json({ message: "kind inválido. Use events, reconciliation ou anticipations." });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erro ao carregar auditoria";
    response.status(500).json({ message });
  }
});

ifoodDeliveryRouter.post("/sync-mock-only", async (request, response) => {
  const user = await requireRole(request, response, [...WRITE_ROLES]);
  if (!user) return;
  const result = await runMockSync(user.id ?? null);
  response.json(result);
});
