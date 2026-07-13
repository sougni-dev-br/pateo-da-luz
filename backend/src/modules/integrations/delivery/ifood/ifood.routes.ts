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

ifoodDeliveryRouter.post("/sync-mock-only", async (request, response) => {
  const user = await requireRole(request, response, [...WRITE_ROLES]);
  if (!user) return;
  const result = await runMockSync(user.id ?? null);
  response.json(result);
});
