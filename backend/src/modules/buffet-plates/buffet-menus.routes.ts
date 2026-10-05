import crypto from "node:crypto";
import { Router, type Request } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { naoEncontrado, parseCorpo } from "./validacao.js";

// Cardápio do evento para o display de acrílico: seções em frente e verso, cada prato em
// português e inglês. Fica sob /buffet-plates, então usa a mesma permissão das plaquinhas.
export const buffetMenusRouter = Router();

const MAX_SECTIONS = 30;
const MAX_ITEMS_PER_SECTION = 20;
const MAX_COPIES = 20;
// Teto de displays numa impressão (somando cópias): acima disso a aba do navegador trava.
export const MAX_TOTAL_DISPLAYS = 100;
// A face precisa caber numa A4 com 8 mm de margem: 210 − 16 = 194 e 297 − 16 = 281.
const MAX_FACE_MM = 281;
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
    // Quantas vezes o prato sai na folha quando cada prato é um display ("perItem").
    qty: z.coerce.number().int().min(1, "quantidade mínima é 1").max(MAX_COPIES, `quantidade máxima é ${MAX_COPIES}`).optional(),
  })).min(1, "a seção precisa de pelo menos um prato").max(MAX_ITEMS_PER_SECTION, `no máximo ${MAX_ITEMS_PER_SECTION} pratos por seção`),
});

const menuSchema = z.object({
  name: texto("nome do cardápio", 120),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data inválida").refine(isRealDate, "data inválida").nullable().optional(),
  theme: z.enum(THEMES),
  faceWidthMm: z.coerce.number().int().min(40, "largura mínima é 4 cm").max(MAX_FACE_MM, "largura máxima é 28,1 cm"),
  faceHeightMm: z.coerce.number().int().min(40, "altura mínima é 4 cm").max(MAX_FACE_MM, "altura máxima é 28,1 cm"),
  copies: z.coerce.number().int().min(1, "pelo menos 1 display").max(20, "no máximo 20 displays"),
  layout: z.enum(LAYOUTS).optional().default("same"),
  sections: z.array(sectionSchema).min(1, "o cardápio precisa de pelo menos uma seção").max(MAX_SECTIONS, `no máximo ${MAX_SECTIONS} seções`),
}).refine((m) => totalDisplays(m) <= MAX_TOTAL_DISPLAYS, {
  message: `no máximo ${MAX_TOTAL_DISPLAYS} displays por impressão: diminua as quantidades ou as cópias`, path: ["copies"],
});

/** Quantos displays o cardápio imprime de uma vez, somando as cópias. */
export function totalDisplays(m: { layout?: string; copies: number; sections: Array<{ items: Array<{ qty?: number }> }> }) {
  if (m.layout === "perItem") return m.sections.reduce((a, s) => a + s.items.reduce((n, i) => n + (i.qty ?? 1), 0), 0);
  if (m.layout === "perSection") return m.sections.length * m.copies;
  return m.copies;
}

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

// Lê o JSON gravado sem confiar nele, mas sem jogar nada fora: um prato fora do limite de hoje
// (nome curto, quantidade alta) é ajustado e volta para a tela, onde a pessoa corrige antes de salvar.
// Descartar a seção inteira fazia o próximo "Salvar" apagá-la de vez.
const texto0 = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
function storedSections(value: Prisma.JsonValue) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((s) => {
    if (!s || typeof s !== "object" || Array.isArray(s)) return [];
    const r = s as Record<string, unknown>;
    const items = (Array.isArray(r.items) ? r.items : []).flatMap((i) => {
      if (!i || typeof i !== "object" || Array.isArray(i)) return [];
      const it = i as Record<string, unknown>;
      const namePt = texto0(it.namePt, 160);
      if (!namePt) return [];
      const qty = typeof it.qty === "number" && Number.isFinite(it.qty) ? Math.min(MAX_COPIES, Math.max(1, Math.round(it.qty))) : undefined;
      return [{ namePt, nameEn: texto0(it.nameEn, 160), ...(qty && qty > 1 ? { qty } : {}) }];
    });
    const titlePt = texto0(r.titlePt, 60);
    if (!titlePt && !items.length) return [];
    return [{ face: r.face === "back" ? "back" as const : "front" as const, titlePt, titleEn: texto0(r.titleEn, 60), items: items.slice(0, MAX_ITEMS_PER_SECTION) }];
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
  const data = parseCorpo(menuSchema, request.body, response);
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
  const data = parseCorpo(menuSchema, request.body, response);
  if (!data) return;

  let updated;
  try {
    updated = await prisma.buffetMenuCard.update({ where: { id: existing.id }, data: payload(data) });
  } catch (e) {
    if (naoEncontrado(e)) return response.status(404).json({ message: "Cardápio não encontrado: outra pessoa apagou." });
    throw e;
  }
  await auditLog({ userId: user.id, action: "UPDATE_BUFFET_MENU_CARD", entity: "BuffetMenuCard", entityId: updated.id, previousValue: existing, newValue: updated, ...auditMeta(request) });
  response.json(summary(updated));
});

buffetMenusRouter.delete("/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const existing = await prisma.buffetMenuCard.findUnique({ where: { id: request.params.id } });
  if (!existing) return response.status(404).json({ message: "Cardápio não encontrado." });

  try {
    await prisma.buffetMenuCard.delete({ where: { id: existing.id } });
  } catch (e) {
    if (naoEncontrado(e)) return response.status(404).json({ message: "Cardápio não encontrado." });
    throw e;
  }
  await auditLog({ userId: user.id, action: "DELETE_BUFFET_MENU_CARD", entity: "BuffetMenuCard", entityId: existing.id, previousValue: existing, ...auditMeta(request) });
  response.json({ ok: true });
});
