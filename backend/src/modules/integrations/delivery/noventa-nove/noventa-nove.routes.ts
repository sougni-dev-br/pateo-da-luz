import { Router } from "express";
import { prisma } from "../../../../config/database.js";
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
} from "./noventa-nove.service.js";
import {
  noventaNoveCredentialInputSchema,
  noventaNoveStoreInputSchema,
  periodQuerySchema
} from "./noventa-nove.types.js";
import { fetchAuthorizationPageUrl, testNoventaNoveConnection } from "./noventa-nove-http-client.js";
import { seedTestMenu } from "./noventa-nove-test-menu.service.js";
import { handleWebhook, type WebhookEnvelope } from "./noventa-nove-webhook.service.js";

// Router protegido — usado por telas do ERP com sessão de usuário.
export const noventaNoveDeliveryRouter = Router();

// Router PÚBLICO — usado APENAS pelo callback da 99/DiDi. Sem
// requireRole/requireMenuAccess. Segurança fica na verificação de
// assinatura HMAC dentro do handler (ver noventa-nove-webhook.service).
export const noventaNovePublicRouter = Router();

const READ_ROLES = ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"] as const;
const WRITE_ROLES = ["ADMIN", "GESTAO_COMPLETA"] as const;

noventaNoveDeliveryRouter.get("/status", async (request, response) => {
  const user = await requireRole(request, response, [...READ_ROLES]);
  if (!user) return;
  const status = await getStatus();
  response.json(status);
});

noventaNoveDeliveryRouter.get("/stores", async (request, response) => {
  const user = await requireRole(request, response, [...READ_ROLES]);
  if (!user) return;
  const stores = await listStores();
  response.json(stores);
});

noventaNoveDeliveryRouter.post("/stores", async (request, response) => {
  const user = await requireRole(request, response, [...WRITE_ROLES]);
  if (!user) return;
  const parsed = noventaNoveStoreInputSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Payload inválido", errors: parsed.error.flatten() });
    return;
  }
  const created = await createStore(parsed.data);
  response.status(201).json(created);
});

noventaNoveDeliveryRouter.put("/stores/:id", async (request, response) => {
  const user = await requireRole(request, response, [...WRITE_ROLES]);
  if (!user) return;
  const parsed = noventaNoveStoreInputSchema.safeParse(request.body);
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

noventaNoveDeliveryRouter.post("/credential", async (request, response) => {
  const user = await requireRole(request, response, [...WRITE_ROLES]);
  if (!user) return;
  const parsed = noventaNoveCredentialInputSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Credencial inválida", errors: parsed.error.flatten() });
    return;
  }
  const status = await saveCredential(parsed.data);
  response.json(status);
});

noventaNoveDeliveryRouter.get("/summary", async (request, response) => {
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

noventaNoveDeliveryRouter.post("/test-connection", async (request, response) => {
  const user = await requireRole(request, response, [...WRITE_ROLES]);
  if (!user) return;
  const result = await testNoventaNoveConnection();
  response.status(result.ok ? 200 : 400).json(result);
});

noventaNoveDeliveryRouter.post("/sync", async (request, response) => {
  const user = await requireRole(request, response, [...WRITE_ROLES]);
  if (!user) return;
  const now = new Date();
  const year = Number(request.body?.year) || now.getFullYear();
  const month = Number(request.body?.month) || (now.getMonth() + 1);
  const result = await runSmartSync(user.id ?? null, year, month);
  response.json(result);
});

noventaNoveDeliveryRouter.post("/sync-mock-only", async (request, response) => {
  const user = await requireRole(request, response, [...WRITE_ROLES]);
  if (!user) return;
  const result = await runMockSync(user.id ?? null);
  response.json(result);
});

// Gera URL de autorização da loja no portal 99/DiDi. O dono da loja
// abre essa URL, faz login no 99 Food e autoriza o vínculo com a nossa
// app_shop_id. Após confirmação, o shop_id do 99 fica vinculado.
// Sobe um menu mínimo (1 item "teste01" a R$ 15,00) na loja indicada,
// necessário pra desbloquear a simulação de pedido no Ambiente sandbox
// do portal 99. Idempotente — reenvio sobrescreve o menu.
noventaNoveDeliveryRouter.post("/stores/:id/seed-test-menu", async (request, response) => {
  const user = await requireRole(request, response, [...WRITE_ROLES]);
  if (!user) return;
  const store = await prisma.deliveryStore.findFirst({
    where: { id: request.params.id, platform: "NOVENTA_NOVE" }
  });
  if (!store) {
    response.status(404).json({ message: "Loja 99 Food não encontrada." });
    return;
  }
  if (store.externalId.startsWith("PENDENTE-")) {
    response.status(400).json({
      message: "Substitua o app_shop_id PENDENTE-* pelo ID real antes de fazer upload de menu."
    });
    return;
  }
  try {
    const result = await seedTestMenu(store.id, store.externalId);
    response.json({
      message: `Menu de teste enviado. APPitemID cadastrado: ${result.itemId}. Use esse valor no Ambiente sandbox do portal 99.`,
      appItemId: result.itemId,
      taskId: result.taskId
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Falha ao subir menu de teste.";
    response.status(400).json({ message });
  }
});

noventaNoveDeliveryRouter.post("/stores/:id/authorization-url", async (request, response) => {
  const user = await requireRole(request, response, [...WRITE_ROLES]);
  if (!user) return;
  const store = await prisma.deliveryStore.findFirst({
    where: { id: request.params.id, platform: "NOVENTA_NOVE" }
  });
  if (!store) {
    response.status(404).json({ message: "Loja 99 Food não encontrada." });
    return;
  }
  if (store.externalId.startsWith("PENDENTE-")) {
    response.status(400).json({
      message: "Substitua o app_shop_id PENDENTE-* pelo ID real antes de gerar a URL de autorização."
    });
    return;
  }
  try {
    const url = await fetchAuthorizationPageUrl(store.externalId);
    response.json({ url, appShopId: store.externalId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Falha ao gerar URL de autorização.";
    response.status(400).json({ message });
  }
});

// ---------------------------------------------------------------------------
// PÚBLICO — chamado pela 99/DiDi. Nenhum requireRole aqui.
// URL final em produção: https://pateo-backend.onrender.com/public/delivery/noventa-nove/webhook
// Config essa URL no portal developer-food.99app.com como callback do app.
// ---------------------------------------------------------------------------

// Guarda o body raw pra HMAC (assinatura precisa do payload textual, não do
// objeto parseado). Assume que o app.use(express.json()) já rodou — usamos
// stringify do body parseado como proxy. Quando a assinatura real for
// implementada, pode ser preciso body-parser custom com verify().
noventaNovePublicRouter.post("/webhook", async (request, response) => {
  try {
    const envelope = request.body as WebhookEnvelope;
    const rawBody = typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {});
    const result = await handleWebhook(envelope, rawBody);
    // Sempre 200 pra 99 não reentregar em loop — logamos internamente
    // se algo deu errado.
    response.status(200).json({ status: "ok", ...result });
  } catch (error: unknown) {
    console.error("[99Food webhook] unhandled error", error);
    response.status(200).json({
      status: "error",
      message: error instanceof Error ? error.message : "unknown"
    });
  }
});
