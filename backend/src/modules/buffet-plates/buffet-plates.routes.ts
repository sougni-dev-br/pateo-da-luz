import crypto from "node:crypto";
import { Router, type Request } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { parseBody } from "../../shared/validate-body.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { buffetMenusRouter } from "./buffet-menus.routes.js";

// Plaquinhas do buffet: a cozinha monta a lista do dia (ou do coffee break) a partir
// do catálogo e imprime. Toda plaquinha sai em português e inglês, então o catálogo
// não aceita prato sem o nome em inglês.
export const buffetPlatesRouter = Router();

// Cardápio do evento (display de acrílico): mesmo módulo de permissão.
buffetPlatesRouter.use("/menus", buffetMenusRouter);

export const PLATE_CATEGORIES = [
  "Arroz e grãos", "Massas", "Risotos", "Carnes", "Aves", "Peixes e frutos do mar", "Guarnições",
  "Salgados", "Entradas", "Sopas e cremes", "Sobremesas", "Molhos", "Coffee break", "Bebidas",
] as const;
export const PLATE_FORMATS = ["std", "tent", "sauce"] as const;
export const PLATE_THEMES = ["wine", "gold", "white"] as const;
export const LIST_KINDS = ["BUFFET", "COFFEE_BREAK", "EVENTO"] as const;
const MAX_QTY = 20;
const MAX_ITEMS_PER_LIST = 300;

const nome = (campo: string) =>
  z.string().trim().transform((s) => s.replace(/\s+/g, " ")).pipe(z.string().min(2, `${campo} obrigatório`).max(120, `${campo} muito longo`));

const itemSchema = z.object({
  namePt: nome("nome em português"),
  nameEn: nome("nome em inglês"),
  category: z.enum(PLATE_CATEGORIES, { errorMap: () => ({ message: "categoria inválida" }) }),
});

function isRealDate(s: string) {
  const time = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === s;
}

const listSchema = z.object({
  name: nome("nome da lista"),
  kind: z.enum(LIST_KINDS),
  // O regex sozinho aceitaria 31/02 (o Date vira 03/03 sem avisar) e 13/2026 (vira erro 500).
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data inválida")
    .refine(isRealDate, "data inválida")
    .nullable().optional(),
  format: z.enum(PLATE_FORMATS),
  theme: z.enum(PLATE_THEMES),
  items: z.array(z.object({
    itemId: z.string().trim().min(1, "prato obrigatório"),
    qty: z.coerce.number().int().min(1, "quantidade mínima é 1").max(MAX_QTY, `quantidade máxima é ${MAX_QTY}`),
  })).max(MAX_ITEMS_PER_LIST, `no máximo ${MAX_ITEMS_PER_LIST} pratos por lista`),
});

function auditMeta(request: Request) {
  return { ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") };
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const DUPLICATE_MESSAGE = "Já existe um prato com esse nome em português no catálogo.";

// O índice único diferencia maiúsculas; "Penne ao sugo" e "penne ao sugo" seriam o mesmo prato na plaquinha.
async function sameNameExists(namePt: string, exceptId?: string) {
  const found = await prisma.buffetPlateItem.findFirst({
    where: { namePt: { equals: namePt, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  return Boolean(found);
}

// ── Catálogo ──

buffetPlatesRouter.get("/items", async (request, response) => {
  const includeInactive = request.query.includeInactive === "true";
  const items = await prisma.buffetPlateItem.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { namePt: "asc" },
    select: { id: true, namePt: true, nameEn: true, category: true, isActive: true },
  });
  response.json(items);
});

buffetPlatesRouter.post("/items", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const data = parseBody(itemSchema, request.body, response);
  if (!data) return;
  if (await sameNameExists(data.namePt)) return response.status(400).json({ message: DUPLICATE_MESSAGE });

  try {
    const created = await prisma.buffetPlateItem.create({ data: { id: crypto.randomUUID(), ...data } });
    await auditLog({ userId: user.id, action: "CREATE_BUFFET_PLATE_ITEM", entity: "BuffetPlateItem", entityId: created.id, newValue: created, ...auditMeta(request) });
    response.status(201).json(created);
  } catch (e) {
    if (isUniqueViolation(e)) return response.status(400).json({ message: DUPLICATE_MESSAGE });
    throw e;
  }
});

buffetPlatesRouter.put("/items/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const existing = await prisma.buffetPlateItem.findUnique({ where: { id: request.params.id } });
  if (!existing) return response.status(404).json({ message: "Prato não encontrado." });
  const data = parseBody(itemSchema.extend({ isActive: z.boolean().optional() }), request.body, response);
  if (!data) return;
  if (await sameNameExists(data.namePt, existing.id)) return response.status(400).json({ message: DUPLICATE_MESSAGE });

  try {
    const updated = await prisma.buffetPlateItem.update({ where: { id: existing.id }, data });
    await auditLog({ userId: user.id, action: "UPDATE_BUFFET_PLATE_ITEM", entity: "BuffetPlateItem", entityId: updated.id, previousValue: existing, newValue: updated, ...auditMeta(request) });
    response.json(updated);
  } catch (e) {
    if (isUniqueViolation(e)) return response.status(400).json({ message: DUPLICATE_MESSAGE });
    throw e;
  }
});

// Prato sai do catálogo inativado, nunca apagado: listas salvas continuam apontando para ele.
buffetPlatesRouter.delete("/items/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const existing = await prisma.buffetPlateItem.findUnique({ where: { id: request.params.id } });
  if (!existing) return response.status(404).json({ message: "Prato não encontrado." });

  const updated = await prisma.buffetPlateItem.update({ where: { id: existing.id }, data: { isActive: false } });
  await auditLog({ userId: user.id, action: "DEACTIVATE_BUFFET_PLATE_ITEM", entity: "BuffetPlateItem", entityId: existing.id, previousValue: existing, newValue: updated, ...auditMeta(request) });
  response.json(updated);
});

// ── Listas ──

type StoredListItem = { itemId: string; qty: number };

function storedItems(value: Prisma.JsonValue): StoredListItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return [];
    const itemId = typeof v.itemId === "string" ? v.itemId : null;
    const qty = Number(v.qty);
    return itemId ? [{ itemId, qty: Number.isInteger(qty) && qty >= 1 ? Math.min(qty, MAX_QTY) : 1 }] : [];
  });
}

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function listSummary(l: { id: string; name: string; kind: string; eventDate: Date | null; format: string; theme: string; items: Prisma.JsonValue; updatedAt: Date }) {
  const items = storedItems(l.items);
  return {
    id: l.id, name: l.name, kind: l.kind, eventDate: dateOnly(l.eventDate), format: l.format, theme: l.theme,
    itemCount: items.length, plateCount: items.reduce((a, i) => a + i.qty, 0), updatedAt: l.updatedAt,
  };
}

async function unknownItemIds(ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const found = await prisma.buffetPlateItem.findMany({ where: { id: { in: unique } }, select: { id: true } });
  const known = new Set(found.map((f) => f.id));
  return unique.filter((id) => !known.has(id));
}

buffetPlatesRouter.get("/lists", async (_request, response) => {
  const lists = await prisma.buffetPlateList.findMany({ orderBy: { updatedAt: "desc" } });
  response.json(lists.map(listSummary));
});

buffetPlatesRouter.get("/lists/:id", async (request, response) => {
  const list = await prisma.buffetPlateList.findUnique({ where: { id: request.params.id } });
  if (!list) return response.status(404).json({ message: "Lista não encontrada." });
  // Itens que sumiram do banco ficam de fora; os inativados continuam, porque a lista é histórica.
  const items = storedItems(list.items);
  const known = new Set((await prisma.buffetPlateItem.findMany({ where: { id: { in: items.map((i) => i.itemId) } }, select: { id: true } })).map((r) => r.id));
  response.json({ ...listSummary(list), items: items.filter((i) => known.has(i.itemId)) });
});

type ListInput = z.infer<typeof listSchema>;

// O mesmo prato repetido na lista vira uma linha só, com as quantidades somadas.
function mergeRepeated(items: ListInput["items"]) {
  const merged = new Map<string, number>();
  for (const i of items) merged.set(i.itemId, Math.min(MAX_QTY, (merged.get(i.itemId) ?? 0) + i.qty));
  return [...merged].map(([itemId, qty]) => ({ itemId, qty }));
}

function listPayload(data: ListInput) {
  return {
    name: data.name, kind: data.kind, format: data.format, theme: data.theme,
    eventDate: data.eventDate ? new Date(`${data.eventDate}T00:00:00Z`) : null,
    items: mergeRepeated(data.items) as unknown as Prisma.InputJsonValue,
  };
}

const STALE_ITEMS_MESSAGE = "A lista tem pratos que não existem mais no catálogo. Recarregue a página.";

buffetPlatesRouter.post("/lists", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const data = parseBody(listSchema, request.body, response);
  if (!data) return;
  if ((await unknownItemIds(data.items.map((i) => i.itemId))).length) return response.status(400).json({ message: STALE_ITEMS_MESSAGE });

  const created = await prisma.buffetPlateList.create({ data: { id: crypto.randomUUID(), ...listPayload(data), createdById: user.id } });
  await auditLog({ userId: user.id, action: "CREATE_BUFFET_PLATE_LIST", entity: "BuffetPlateList", entityId: created.id, newValue: created, ...auditMeta(request) });
  response.status(201).json(listSummary(created));
});

buffetPlatesRouter.put("/lists/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const existing = await prisma.buffetPlateList.findUnique({ where: { id: request.params.id } });
  if (!existing) return response.status(404).json({ message: "Lista não encontrada." });
  const data = parseBody(listSchema, request.body, response);
  if (!data) return;
  if ((await unknownItemIds(data.items.map((i) => i.itemId))).length) return response.status(400).json({ message: STALE_ITEMS_MESSAGE });

  const updated = await prisma.buffetPlateList.update({ where: { id: existing.id }, data: listPayload(data) });
  await auditLog({ userId: user.id, action: "UPDATE_BUFFET_PLATE_LIST", entity: "BuffetPlateList", entityId: updated.id, previousValue: existing, newValue: updated, ...auditMeta(request) });
  response.json(listSummary(updated));
});

buffetPlatesRouter.delete("/lists/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const existing = await prisma.buffetPlateList.findUnique({ where: { id: request.params.id } });
  if (!existing) return response.status(404).json({ message: "Lista não encontrada." });

  await prisma.buffetPlateList.delete({ where: { id: existing.id } });
  await auditLog({ userId: user.id, action: "DELETE_BUFFET_PLATE_LIST", entity: "BuffetPlateList", entityId: existing.id, previousValue: existing, ...auditMeta(request) });
  response.json({ ok: true });
});
