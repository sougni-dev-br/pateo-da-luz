import crypto from "node:crypto";
import { Router, type Request } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { parseBody } from "../../shared/validate-body.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";

// Cardápio do evento para o display de acrílico: seções em frente e verso, cada prato em
// português e inglês. Fica sob /buffet-plates, então usa a mesma permissão das plaquinhas.
export const buffetMenusRouter = Router();

const MAX_SECTIONS = 30;
const MAX_ITEMS_PER_SECTION = 20;
const FACES = ["front", "back"] as const;
const THEMES = ["wine", "gold", "white"] as const;
// same: um cardápio repetido em todos os displays. perSection: cada seção vira um display.
// perItem: cada prato vira um display.
const LAYOUTS = ["same", "perSection", "perItem"] as const;

const texto = (campo: string, max: number) =>
  z.string().trim().transform((s) => s.replace(/\s+/g, " ")).pipe(z.string().min(2, `${campo} obrigatório`).max(max, `${campo} muito longo`));

function isRealDate(s: string) {
  const time = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === s;
}

const sectionSchema = z.object({
  face: z.enum(FACES),
  titlePt: texto("título da seção", 60),
  titleEn: texto("título da seção em inglês", 60),
  items: z.array(z.object({
    namePt: texto("prato", 160),
    nameEn: texto("prato em inglês", 160),
  })).min(1, "a seção precisa de pelo menos um prato").max(MAX_ITEMS_PER_SECTION, `no máximo ${MAX_ITEMS_PER_SECTION} pratos por seção`),
});

const menuSchema = z.object({
  name: texto("nome do cardápio", 120),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data inválida").refine(isRealDate, "data inválida").nullable().optional(),
  theme: z.enum(THEMES),
  faceWidthMm: z.coerce.number().int().min(40, "largura mínima é 4 cm").max(287, "largura máxima é 28,7 cm"),
  faceHeightMm: z.coerce.number().int().min(40, "altura mínima é 4 cm").max(287, "altura máxima é 28,7 cm"),
  copies: z.coerce.number().int().min(1, "pelo menos 1 display").max(20, "no máximo 20 displays"),
  layout: z.enum(LAYOUTS).optional().default("same"),
  sections: z.array(sectionSchema).min(1, "o cardápio precisa de pelo menos uma seção").max(MAX_SECTIONS, `no máximo ${MAX_SECTIONS} seções`),
});

type MenuInput = z.infer<typeof menuSchema>;

const auditMeta = (request: Request) => ({ ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") });
const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function payload(data: Omit<MenuInput, "layout"> & { layout?: MenuInput["layout"] }) {
  return {
    name: data.name, theme: data.theme, faceWidthMm: data.faceWidthMm, faceHeightMm: data.faceHeightMm, copies: data.copies, layout: data.layout ?? "same",
    eventDate: data.eventDate ? new Date(`${data.eventDate}T00:00:00Z`) : null,
    sections: data.sections as unknown as Prisma.InputJsonValue,
  };
}

// Lê o JSON gravado sem confiar nele: seção ou prato estragado é descartado em vez de quebrar a tela.
function storedSections(value: Prisma.JsonValue) {
  const parsed = z.array(sectionSchema).safeParse(value);
  if (parsed.success) return parsed.data;
  if (!Array.isArray(value)) return [];
  return value.flatMap((s) => {
    const one = sectionSchema.safeParse(s);
    return one.success ? [one.data] : [];
  });
}

type MenuRow = { id: string; name: string; eventDate: Date | null; theme: string; faceWidthMm: number; faceHeightMm: number; copies: number; layout: string; sections: Prisma.JsonValue; updatedAt: Date };

function summary(m: MenuRow) {
  const sections = storedSections(m.sections);
  return {
    id: m.id, name: m.name, eventDate: dateOnly(m.eventDate), theme: m.theme, faceWidthMm: m.faceWidthMm, faceHeightMm: m.faceHeightMm,
    copies: m.copies, layout: LAYOUTS.find((l) => l === m.layout) ?? "same", sectionCount: sections.length, itemCount: sections.reduce((a, s) => a + s.items.length, 0), updatedAt: m.updatedAt,
  };
}

buffetMenusRouter.get("/", async (_request, response) => {
  const menus = await prisma.buffetMenuCard.findMany({ orderBy: { updatedAt: "desc" }, take: 200 });
  response.json(menus.map(summary));
});

buffetMenusRouter.get("/:id", async (request, response) => {
  const menu = await prisma.buffetMenuCard.findUnique({ where: { id: request.params.id } });
  if (!menu) return response.status(404).json({ message: "Cardápio não encontrado." });
  response.json({ ...summary(menu), sections: storedSections(menu.sections) });
});

buffetMenusRouter.post("/", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const data = parseBody(menuSchema, request.body, response);
  if (!data) return;

  const created = await prisma.buffetMenuCard.create({ data: { id: crypto.randomUUID(), ...payload(data), createdById: user.id } });
  await auditLog({ userId: user.id, action: "CREATE_BUFFET_MENU_CARD", entity: "BuffetMenuCard", entityId: created.id, newValue: created, ...auditMeta(request) });
  response.status(201).json(summary(created));
});

buffetMenusRouter.put("/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const existing = await prisma.buffetMenuCard.findUnique({ where: { id: request.params.id } });
  if (!existing) return response.status(404).json({ message: "Cardápio não encontrado." });
  const data = parseBody(menuSchema, request.body, response);
  if (!data) return;

  const updated = await prisma.buffetMenuCard.update({ where: { id: existing.id }, data: payload(data) });
  await auditLog({ userId: user.id, action: "UPDATE_BUFFET_MENU_CARD", entity: "BuffetMenuCard", entityId: updated.id, previousValue: existing, newValue: updated, ...auditMeta(request) });
  response.json(summary(updated));
});

buffetMenusRouter.delete("/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const existing = await prisma.buffetMenuCard.findUnique({ where: { id: request.params.id } });
  if (!existing) return response.status(404).json({ message: "Cardápio não encontrado." });

  await prisma.buffetMenuCard.delete({ where: { id: existing.id } });
  await auditLog({ userId: user.id, action: "DELETE_BUFFET_MENU_CARD", entity: "BuffetMenuCard", entityId: existing.id, previousValue: existing, ...auditMeta(request) });
  response.json({ ok: true });
});
