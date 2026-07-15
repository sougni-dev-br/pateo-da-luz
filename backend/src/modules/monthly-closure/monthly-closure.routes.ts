import { Router } from "express";
import { requireRole, auditLog, requestIp } from "../security/security-utils.js";
import {
  getMonthlyClosure,
  justifyClosureBlock,
  removeClosureJustification,
  lockMonthlyClosure,
  unlockMonthlyClosure,
} from "./monthly-closure.service.js";

export const monthlyClosureRouter = Router();

function parseYearMonth(year: unknown, month: unknown): { year: number; month: number } | null {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return null;
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  return { year: y, month: m };
}

monthlyClosureRouter.get("/:year/:month", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;
  const parsed = parseYearMonth(request.params.year, request.params.month);
  if (!parsed) { response.status(400).json({ message: "Ano/mes invalidos." }); return; }
  try {
    const data = await getMonthlyClosure(parsed.year, parsed.month);
    response.json(data);
  } catch (error) {
    response.status(500).json({ message: error instanceof Error ? error.message : "Erro ao carregar fechamento." });
  }
});

monthlyClosureRouter.post("/:year/:month/justify", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  const parsed = parseYearMonth(request.params.year, request.params.month);
  if (!parsed) { response.status(400).json({ message: "Ano/mes invalidos." }); return; }
  const blockKey = String(request.body.blockKey ?? "").trim();
  const reason = String(request.body.reason ?? "").trim();
  if (!blockKey) { response.status(400).json({ message: "blockKey obrigatorio." }); return; }
  if (!reason) { response.status(400).json({ message: "Motivo obrigatorio." }); return; }
  try {
    const data = await justifyClosureBlock({ ...parsed, blockKey, reason, userId: user.id });
    await auditLog({
      userId: user.id, action: "JUSTIFY_MONTHLY_CLOSURE_BLOCK",
      entity: "MonthlyCmv", entityId: `${parsed.year}-${parsed.month}`,
      newValue: { blockKey, reason },
      ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
    });
    response.json(data);
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao justificar." });
  }
});

monthlyClosureRouter.delete("/:year/:month/justify/:blockKey", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  const parsed = parseYearMonth(request.params.year, request.params.month);
  if (!parsed) { response.status(400).json({ message: "Ano/mes invalidos." }); return; }
  const blockKey = decodeURIComponent(String(request.params.blockKey ?? ""));
  try {
    const data = await removeClosureJustification({ ...parsed, blockKey });
    await auditLog({
      userId: user.id, action: "REMOVE_MONTHLY_CLOSURE_JUSTIFICATION",
      entity: "MonthlyCmv", entityId: `${parsed.year}-${parsed.month}`,
      newValue: { blockKey },
      ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
    });
    response.json(data);
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao remover." });
  }
});

monthlyClosureRouter.post("/:year/:month/lock", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  const parsed = parseYearMonth(request.params.year, request.params.month);
  if (!parsed) { response.status(400).json({ message: "Ano/mes invalidos." }); return; }
  try {
    const data = await lockMonthlyClosure({ ...parsed, userId: user.id });
    await auditLog({
      userId: user.id, action: "LOCK_MONTHLY_CLOSURE",
      entity: "MonthlyCmv", entityId: `${parsed.year}-${parsed.month}`,
      newValue: { pendingCount: data.summary.pendingCount, cmvAttributed: data.cmvAttribution.total },
      ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
    });
    response.json(data);
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao travar." });
  }
});

monthlyClosureRouter.post("/:year/:month/unlock", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  const parsed = parseYearMonth(request.params.year, request.params.month);
  if (!parsed) { response.status(400).json({ message: "Ano/mes invalidos." }); return; }
  const reason = String(request.body.reason ?? "").trim();
  if (!reason) { response.status(400).json({ message: "Motivo obrigatorio para reabrir." }); return; }
  try {
    const data = await unlockMonthlyClosure({ ...parsed, reason, userId: user.id });
    await auditLog({
      userId: user.id, action: "UNLOCK_MONTHLY_CLOSURE",
      entity: "MonthlyCmv", entityId: `${parsed.year}-${parsed.month}`,
      newValue: { reason },
      ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
    });
    response.json(data);
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Erro ao reabrir." });
  }
});
