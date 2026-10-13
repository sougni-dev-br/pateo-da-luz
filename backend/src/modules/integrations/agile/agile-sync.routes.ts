import { Router } from "express";
import { requireRole } from "../../security/security-utils.js";
import { requireAgileToken } from "./agile-token.middleware.js";
import { agileSyncPayloadSchema } from "./agile-sync.types.js";
import { heartbeatPayloadSchema } from "./agile-heartbeat.types.js";
import { getAgileSyncStatus, importAgileSync } from "./agile-sync.service.js";
import { registrarHeartbeat } from "./agile-heartbeat.service.js";
import { agileAnaliseRouter } from "./agile-analise.routes.js";

export const agileIntegrationRouter = Router();

// Relatórios para gestão (cancelamentos, vendas por pessoa). Autenticação por sessão e
// permissão do módulo "analise-salao"; o token do agente NÃO vale aqui.
agileIntegrationRouter.use("/analise", agileAnaliseRouter);

agileIntegrationRouter.post("/sync", requireAgileToken, async (request, response) => {
  const parsed = agileSyncPayloadSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      message: "Payload inválido para /integrations/agile/sync.",
      errors: parsed.error.flatten()
    });
    return;
  }
  try {
    const report = await importAgileSync(parsed.data);
    response.json(report);
  } catch (error: unknown) {
    console.error("Falha ao importar sync do Agile PDV", error);
    const message = error instanceof Error ? error.message : "Erro interno na sincronização.";
    response.status(500).json({ message });
  }
});

// Sinal de vida do agente, enviado ao fim de cada execução (ok ou erro). O corpo de
// erro é { erro } — contrato combinado com o agente, diferente do { message } do /sync.
agileIntegrationRouter.post("/heartbeat", requireAgileToken, async (request, response) => {
  const parsed = heartbeatPayloadSchema.safeParse(request.body);
  if (!parsed.success) {
    const primeiro = parsed.error.issues[0];
    const campo = primeiro?.path.join(".") || "corpo";
    response.status(400).json({ erro: `Heartbeat inválido (${campo}): ${primeiro?.message ?? "formato incorreto"}` });
    return;
  }
  try {
    response.json(await registrarHeartbeat(parsed.data));
  } catch (error: unknown) {
    console.error("Falha ao registrar heartbeat do Agile PDV", error);
    response.status(500).json({ erro: "Não foi possível registrar o heartbeat." });
  }
});

// GET /status é para usuários (Eli abre a tela de Faturamento Salão).
// Usa JWT normal, gated pela permissão de "revenue" já registrada em menu-permissions.
agileIntegrationRouter.get("/status", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;
  const status = await getAgileSyncStatus();
  response.json(status);
});
