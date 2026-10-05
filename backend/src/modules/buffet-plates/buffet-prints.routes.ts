import crypto from "node:crypto";
import { Router, type Request } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { naoEncontrado, parseCorpo } from "./validacao.js";
import { HISTORY_DAYS, addDays, buildUsageReport } from "./buffet-usage.js";

// Impressões de plaquinhas e o acompanhamento que sai delas. Fica sob /buffet-plates,
// então usa a mesma permissão das plaquinhas.
export const buffetPrintsRouter = Router();

const KINDS = ["BUFFET", "COFFEE_BREAK", "EVENTO"] as const;
const WINDOWS = [7, 30, 90] as const;
const MAX_ITEMS = 300;
const RECENT_PRINTS = 15;
const MAX_PAST_DAYS = 400;
const MAX_FUTURE_DAYS = 60;

const isRealDate = (s: string) => {
  const time = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === s;
};

const printSchema = z.object({
  servedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data inválida").refine(isRealDate, "data inválida")
    // Ano digitado errado (2062, 2002) estragaria o acompanhamento.
    .refine((d) => d >= addDays(todayInSaoPaulo(), -MAX_PAST_DAYS) && d <= addDays(todayInSaoPaulo(), MAX_FUTURE_DAYS), "data fora do intervalo aceito"),
  kind: z.enum(KINDS),
  listId: z.string().trim().min(1).max(64).nullable().optional(),
  listName: z.string().trim().max(120).nullable().optional(),
  itemIds: z.array(z.string().trim().min(1)).min(1, "nenhum prato na folha").max(MAX_ITEMS),
});

const auditMeta = (request: Request) => ({ ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") });
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

// O dia da cozinha é o de São Paulo; o servidor roda em UTC e às 21h já estaria no dia seguinte.
export function todayInSaoPaulo(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}

function storedIds(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

buffetPrintsRouter.post("/prints", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const data = parseCorpo(printSchema, request.body, response);
  if (!data) return;

  // Só guarda prato que existe; prato apagado do banco não conta.
  const unique = [...new Set(data.itemIds)];
  const found = await prisma.buffetPlateItem.findMany({ where: { id: { in: unique } }, select: { id: true } });
  const known = new Set(found.map((f) => f.id));
  const itemIds = unique.filter((id) => known.has(id));
  if (!itemIds.length) return response.status(400).json({ message: "Nenhum prato da folha existe no catálogo." });

  const created = await prisma.buffetPlatePrint.create({
    data: {
      id: crypto.randomUUID(), servedOn: new Date(`${data.servedOn}T00:00:00Z`), kind: data.kind,
      listId: data.listId ?? null, listName: data.listName || null, itemIds, createdById: user.id,
    },
  });
  await auditLog({ userId: user.id, action: "REGISTER_BUFFET_PLATE_PRINT", entity: "BuffetPlatePrint", entityId: created.id, newValue: created, ...auditMeta(request) });
  response.status(201).json({ id: created.id, servedOn: dayOf(created.servedOn), itemCount: itemIds.length });
});

buffetPrintsRouter.get("/prints", async (request, response) => {
  const kind = KINDS.find((k) => k === request.query.kind) ?? "BUFFET";
  const rows = await prisma.buffetPlatePrint.findMany({
    where: { kind }, orderBy: [{ servedOn: "desc" }, { createdAt: "desc" }], take: RECENT_PRINTS,
  });
  response.json(rows.map((r) => ({
    id: r.id, servedOn: dayOf(r.servedOn), kind: r.kind, listName: r.listName, itemCount: storedIds(r.itemIds).length, createdAt: r.createdAt,
  })));
});

// Apagar serve para corrigir uma impressão errada (folha impressa e jogada fora).
buffetPrintsRouter.delete("/prints/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const existing = await prisma.buffetPlatePrint.findUnique({ where: { id: request.params.id } });
  if (!existing) return response.status(404).json({ message: "Registro não encontrado." });
  await prisma.buffetPlatePrint.delete({ where: { id: existing.id } });
  await auditLog({ userId: user.id, action: "DELETE_BUFFET_PLATE_PRINT", entity: "BuffetPlatePrint", entityId: existing.id, previousValue: existing, ...auditMeta(request) });
  response.json({ ok: true });
});

buffetPrintsRouter.get("/usage", async (request, response) => {
  const kind = KINDS.find((k) => k === request.query.kind) ?? "BUFFET";
  const windowDays = WINDOWS.find((w) => String(w) === request.query.days) ?? 30;
  const today = todayInSaoPaulo();
  const from = addDays(today, -(Math.max(HISTORY_DAYS, windowDays) - 1));
  const rows = await prisma.buffetPlatePrint.findMany({
    where: { kind, servedOn: { gte: new Date(`${from}T00:00:00Z`) } },
    select: { servedOn: true, itemIds: true },
  });
  const report = buildUsageReport(rows.map((r) => ({ servedOn: dayOf(r.servedOn), itemIds: storedIds(r.itemIds) })), today, windowDays);
  // Prato inativado saiu do catálogo de propósito: continua no ranking (é histórico), mas não vira alerta.
  const inativos = new Set((await prisma.buffetPlateItem.findMany({ where: { isActive: false }, select: { id: true } })).map((i) => i.id));
  response.json({
    ...report,
    forgotten: report.forgotten.filter((f) => !inativos.has(f.itemId)),
    repeating: report.repeating.filter((id) => !inativos.has(id)),
  });
});
