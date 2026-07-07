import { Router, type NextFunction, type Request, type Response } from "express";
import { requireRole } from "../../security/security-utils.js";
import { agileSyncPayloadSchema } from "./agile-sync.types.js";
import { getAgileSyncStatus, importAgileSync } from "./agile-sync.service.js";

export const agileIntegrationRouter = Router();

// O agente que roda na máquina PDVTOUCH não é um usuário — é uma máquina.
// Autenticamos por header X-Agile-Token contra a env var AGILE_INGEST_TOKEN.
// Isso vive fora do JWT / requireMenuAccess: qualquer request para /sync
// que não trouxer o token correto é rejeitada com 401 antes de qualquer trabalho.
function requireAgileToken(request: Request, response: Response, next: NextFunction) {
  const expected = process.env.AGILE_INGEST_TOKEN;
  if (!expected || expected.trim().length < 16) {
    response.status(503).json({
      message: "Integração Agile PDV não configurada no servidor. Defina AGILE_INGEST_TOKEN."
    });
    return;
  }
  const provided = String(request.header("x-agile-token") ?? "").trim();
  // Comparação constante-no-tempo para não vazar o token via timing attack.
  const ok = provided.length === expected.length
    && provided.length > 0
    && timingSafeEqualString(provided, expected);
  if (!ok) {
    response.status(401).json({ message: "Token de integração inválido." });
    return;
  }
  next();
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

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

// GET /status é para usuários (Eli abre a tela de Faturamento Salão).
// Usa JWT normal, gated pela permissão de "revenue" já registrada em menu-permissions.
agileIntegrationRouter.get("/status", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;
  const status = await getAgileSyncStatus();
  response.json(status);
});
