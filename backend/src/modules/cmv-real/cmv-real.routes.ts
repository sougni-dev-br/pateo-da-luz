import { Router } from "express";
import { parseDate } from "../../shared/utils/parse-date.js";
import { auditLog, requestIp, requireAdmin, requireRole } from "../security/security-utils.js";
import {
  closeCmvPeriod,
  deleteCmvPeriod,
  getCmvPeriod,
  getCmvPeriodPdf,
  getCmvRealSuggestions,
  listCmvBases,
  listCmvPeriods,
  listCmvSessions,
  recalculateCmvPeriod,
  reopenCmvPeriod,
  saveCmvPeriod
} from "./cmv-real.service.js";

export const cmvRealRouter = Router();

function asText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function asId(value: unknown) {
  return String(value ?? "").trim();
}

cmvRealRouter.get("/sessions", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;
  response.json(await listCmvSessions());
});

cmvRealRouter.get("/bases", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;
  response.json(await listCmvBases());
});

cmvRealRouter.get("/suggestions", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;
  response.json(await getCmvRealSuggestions());
});

cmvRealRouter.get("/", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;
  response.json(await listCmvPeriods());
});

cmvRealRouter.post("/", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  try {
    const dataInicial = parseDate(request.body.dataInicial);
    const dataFinal = parseDate(request.body.dataFinal);
    const estoqueInicialSnapshotId = asId(request.body.estoqueInicialSnapshotId);
    const estoqueFinalSnapshotId = asId(request.body.estoqueFinalSnapshotId);
    const estoqueInicialSessionId = asText(request.body.estoqueInicialSessionId);
    const estoqueFinalSessionId = asText(request.body.estoqueFinalSessionId);
    const hasInicial = estoqueInicialSnapshotId || estoqueInicialSessionId;
    const hasFinal = estoqueFinalSnapshotId || estoqueFinalSessionId;
    if (!dataInicial || !dataFinal || !hasInicial || !hasFinal) {
      response.status(400).json({ message: "Periodo, inventarios inicial/final e obrigatorio." });
      return;
    }
    response.status(201).json(await saveCmvPeriod({
      name: asText(request.body.name) ?? "",
      dataInicial,
      dataFinal,
      estoqueInicialSnapshotId,
      estoqueFinalSnapshotId,
      estoqueInicialSessionId,
      estoqueFinalSessionId,
      observacoes: asText(request.body.observacoes),
      userId: user.id,
      userRole: user.role,
      continuityOverrideReason: asText(request.body.continuityOverrideReason),
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "")
    }));
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao salvar apuracao de CMV." });
  }
});

cmvRealRouter.put("/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  try {
    const dataInicial = parseDate(request.body.dataInicial);
    const dataFinal = parseDate(request.body.dataFinal);
    const estoqueInicialSnapshotId = asId(request.body.estoqueInicialSnapshotId);
    const estoqueFinalSnapshotId = asId(request.body.estoqueFinalSnapshotId);
    const estoqueInicialSessionId = asText(request.body.estoqueInicialSessionId);
    const estoqueFinalSessionId = asText(request.body.estoqueFinalSessionId);
    const hasInicial = estoqueInicialSnapshotId || estoqueInicialSessionId;
    const hasFinal = estoqueFinalSnapshotId || estoqueFinalSessionId;
    if (!dataInicial || !dataFinal || !hasInicial || !hasFinal) {
      response.status(400).json({ message: "Periodo, inventarios inicial/final e obrigatorio." });
      return;
    }
    response.json(await saveCmvPeriod({
      id: request.params.id,
      name: asText(request.body.name) ?? "",
      dataInicial,
      dataFinal,
      estoqueInicialSnapshotId,
      estoqueFinalSnapshotId,
      estoqueInicialSessionId,
      estoqueFinalSessionId,
      observacoes: asText(request.body.observacoes),
      userId: user.id,
      userRole: user.role,
      continuityOverrideReason: asText(request.body.continuityOverrideReason),
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "")
    }));
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao atualizar apuracao de CMV." });
  }
});

cmvRealRouter.get("/:id/pdf", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;
  try {
    const pdf = await getCmvPeriodPdf(request.params.id);
    await auditLog({
      userId: user.id,
      action: "GENERATE_CMV_REAL_PDF",
      entity: "CmvPeriod",
      entityId: request.params.id,
      newValue: { id: request.params.id },
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "")
    });
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", "attachment; filename=cmv-real.pdf");
    response.send(pdf);
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao gerar PDF do CMV." });
  }
});

cmvRealRouter.get("/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;
  try {
    response.json(await getCmvPeriod(request.params.id));
  } catch (error) {
    response.status(404).json({ message: error instanceof Error ? error.message : "Apuracao de CMV nao encontrada." });
  }
});

cmvRealRouter.post("/:id/calculate", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  try {
    response.json(await recalculateCmvPeriod(request.params.id, {
      userId: user.id,
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "")
    }));
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao calcular CMV." });
  }
});

cmvRealRouter.post("/:id/close", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  try {
    response.json(await closeCmvPeriod(request.params.id, {
      userId: user.id,
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "")
    }));
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao fechar apuracao." });
  }
});

cmvRealRouter.post("/:id/reopen", async (request, response) => {
  const admin = await requireAdmin(request, response);
  if (!admin) return;
  try {
    const reason = asText(request.body.reason);
    if (!reason) {
      response.status(400).json({ message: "Motivo obrigatorio." });
      return;
    }
    response.json(await reopenCmvPeriod(request.params.id, {
      userId: admin.id,
      reason,
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "")
    }));
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao reabrir apuracao." });
  }
});

cmvRealRouter.delete("/:id", async (request, response) => {
  const admin = await requireAdmin(request, response);
  if (!admin) return;
  try {
    response.json(await deleteCmvPeriod(request.params.id, {
      userId: admin.id,
      reason: asText(request.body.reason),
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "")
    }));
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao excluir apuracao." });
  }
});
