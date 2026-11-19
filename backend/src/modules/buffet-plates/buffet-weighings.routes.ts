import crypto from "node:crypto";
import { Router, type Request } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { naoEncontrado, parseCorpo } from "./validacao.js";
import { MAX_FUTURE_DAYS, MAX_PAST_DAYS, isRealDate, todayInSaoPaulo } from "./buffet-prints.routes.js";
import { addDays } from "./buffet-usage.js";
import { summarizeDay } from "./buffet-weighing-summary.js";
import { valorizarDia } from "./buffet-costs.js";
import { custoVisivel, custosDosPratos, semValores } from "./buffet-costs.service.js";

// Pesagem do buffet: panelas (com o peso vazio) e as pesagens de produção e sobra por prato.
// Fica sob /buffet-plates, então usa a mesma permissão das plaquinhas.
export const buffetWeighingsRouter = Router();

const KINDS = ["BUFFET", "COFFEE_BREAK", "EVENTO"] as const;
const PHASES = ["PRODUCAO", "SOBRA"] as const;
const MAX_WEIGHT_G = 200_000;
const MAX_POTS = 200;

const gramas = (nome: string) => z.number({ invalid_type_error: `${nome}: valor inválido` }).int(`${nome}: use gramas inteiras`)
  .positive(`${nome} deve ser maior que zero`).max(MAX_WEIGHT_G, `${nome}: acima de ${MAX_WEIGHT_G / 1000} kg`);

const dataSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data inválida").refine(isRealDate, "data inválida")
  .refine((d) => d >= addDays(todayInSaoPaulo(), -MAX_PAST_DAYS) && d <= addDays(todayInSaoPaulo(), MAX_FUTURE_DAYS), "data fora do intervalo aceito");

// O código (P01, P02…) é gerado pelo servidor: quem cadastra descreve a panela e o sistema numera.
const potCreateSchema = z.object({
  name: z.string().trim().min(1, "informe a descrição da panela").max(80, "descrição: no máximo 80 caracteres"),
  tareG: gramas("peso da panela"),
});
const potUpdateSchema = potCreateSchema.partial().extend({ isActive: z.boolean().optional() });

const CODIGO_PANELA = /^P(\d+)$/;
const MAX_TENTATIVAS_CODIGO = 5;
/** Próximo código livre: um acima do maior P<número> existente (inclusive de panelas inativas), com 2 dígitos no mínimo. */
async function proximoCodigoPanela(): Promise<string> {
  const todas = await prisma.buffetPot.findMany({ select: { code: true } });
  const maior = todas.reduce((m, p) => Math.max(m, Number(CODIGO_PANELA.exec(p.code)?.[1] ?? 0)), 0);
  return `P${String(maior + 1).padStart(2, "0")}`;
}

const weighingCreateSchema = z.object({
  servedOn: dataSchema,
  kind: z.enum(KINDS).default("BUFFET"),
  itemId: z.string().trim().min(1, "informe o prato"),
  potId: z.string().trim().min(1, "informe a panela"),
  phase: z.enum(PHASES).default("PRODUCAO"),
  grossG: gramas("peso bruto"),
  notes: z.string().trim().max(200).nullable().optional(),
});
const weighingUpdateSchema = z.object({
  potId: z.string().trim().min(1).optional(),
  phase: z.enum(PHASES).optional(),
  grossG: gramas("peso bruto").optional(),
  notes: z.string().trim().max(200).nullable().optional(),
});

const auditMeta = (request: Request) => ({ ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") });
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const kg = (g: number) => `${(g / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg`;
const codigoDuplicado = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

// ── Panelas ──

buffetWeighingsRouter.get("/pots", async (request, response) => {
  const todas = request.query.all === "1";
  const pots = await prisma.buffetPot.findMany({
    where: todas ? {} : { isActive: true }, orderBy: { code: "asc" }, take: MAX_POTS,
  });
  response.json(pots);
});

buffetWeighingsRouter.post("/pots", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const data = parseCorpo(potCreateSchema, request.body, response);
  if (!data) return;
  if (await prisma.buffetPot.count() >= MAX_POTS) return response.status(400).json({ message: `Limite de ${MAX_POTS} panelas.` });
  // Dois cadastros ao mesmo tempo podem sortear o mesmo número: o índice único barra um deles e ele tenta o próximo.
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_CODIGO; tentativa++) {
    const code = await proximoCodigoPanela();
    try {
      const created = await prisma.buffetPot.create({ data: { id: crypto.randomUUID(), code, name: data.name, tareG: data.tareG } });
      await auditLog({ userId: user.id, action: "CREATE_BUFFET_POT", entity: "BuffetPot", entityId: created.id, newValue: created, ...auditMeta(request) });
      return response.status(201).json(created);
    } catch (e) {
      if (!codigoDuplicado(e)) throw e;
    }
  }
  return response.status(409).json({ message: "Não foi possível gerar o código da panela agora. Tente de novo." });
});

// Mudar o peso da panela NÃO mexe nas pesagens antigas: cada uma guarda o peso da panela na hora.
buffetWeighingsRouter.put("/pots/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const data = parseCorpo(potUpdateSchema, request.body, response);
  if (!data) return;
  const existing = await prisma.buffetPot.findUnique({ where: { id: request.params.id } });
  if (!existing) return response.status(404).json({ message: "Panela não encontrada." });
  try {
    const updated = await prisma.buffetPot.update({
      where: { id: existing.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.tareG !== undefined ? { tareG: data.tareG } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
    });
    await auditLog({ userId: user.id, action: "UPDATE_BUFFET_POT", entity: "BuffetPot", entityId: existing.id, previousValue: existing, newValue: updated, ...auditMeta(request) });
    response.json(updated);
  } catch (e) {
    if (naoEncontrado(e)) return response.status(404).json({ message: "Panela não encontrada." });
    throw e;
  }
});

// ── Pesagens ──

const INCLUDE = { item: { select: { namePt: true } }, pot: { select: { code: true } } } as const;
type WeighingWithNames = Prisma.BuffetWeighingGetPayload<{ include: typeof INCLUDE }>;

function weighingView(w: WeighingWithNames) {
  return {
    id: w.id, servedOn: dayOf(w.servedOn), kind: w.kind, itemId: w.itemId, itemName: w.item.namePt, potId: w.potId, potCode: w.pot.code,
    phase: w.phase, grossG: w.grossG, tareG: w.tareG, netG: w.netG, notes: w.notes, createdAt: w.createdAt,
  };
}

buffetWeighingsRouter.get("/weighings", async (request, response) => {
  // Leitura aceita qualquer data real (histórico antigo); o limite de ±400 dias vale só para gravar.
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDate).safeParse(request.query.date);
  if (!date.success) return response.status(400).json({ message: "Informe a data (AAAA-MM-DD)." });
  const kind = KINDS.find((k) => k === request.query.kind) ?? "BUFFET";
  const rows = await prisma.buffetWeighing.findMany({
    where: { servedOn: new Date(`${date.data}T00:00:00Z`), kind }, include: INCLUDE, orderBy: { createdAt: "asc" }, take: 1000,
  });
  const summary = summarizeDay(rows.map((r) => ({ itemId: r.itemId, phase: r.phase === "SOBRA" ? "SOBRA" : "PRODUCAO", netG: r.netG })));
  // Custo por kg pela ficha ligada a cada prato (R$ de hoje); prato sem ficha pronta fica sem custo e fora do total.
  const [custos, verCusto] = await Promise.all([custosDosPratos(summary.items.map((i) => i.itemId)), custoVisivel(request)]);
  response.json({
    date: date.data, kind, rows: rows.map(weighingView), summary, costVisible: verCusto,
    costs: Object.fromEntries([...custos].map(([id, c]) => [id, verCusto ? c : semValores(c)])),
    value: verCusto ? valorizarDia(summary.items, custos) : null,
  });
});

// O líquido é calculado AQUI (bruto − panela): o que vem do navegador não define o líquido.
buffetWeighingsRouter.post("/weighings", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const data = parseCorpo(weighingCreateSchema, request.body, response);
  if (!data) return;
  const [item, pot] = await Promise.all([
    prisma.buffetPlateItem.findUnique({ where: { id: data.itemId }, select: { id: true } }),
    prisma.buffetPot.findUnique({ where: { id: data.potId } }),
  ]);
  if (!item) return response.status(400).json({ message: "Prato não encontrado no catálogo." });
  if (!pot || !pot.isActive) return response.status(400).json({ message: "Panela não encontrada ou inativa." });
  if (data.grossG < pot.tareG) {
    return response.status(400).json({ message: `O peso bruto (${kg(data.grossG)}) é menor que o da panela ${pot.code} vazia (${kg(pot.tareG)}). Confira a panela e a balança.` });
  }
  const created = await prisma.buffetWeighing.create({
    data: {
      id: crypto.randomUUID(), servedOn: new Date(`${data.servedOn}T00:00:00Z`), kind: data.kind, itemId: data.itemId, potId: pot.id,
      phase: data.phase, grossG: data.grossG, tareG: pot.tareG, netG: data.grossG - pot.tareG, notes: data.notes || null, createdById: user.id,
    },
    include: INCLUDE,
  });
  await auditLog({ userId: user.id, action: "CREATE_BUFFET_WEIGHING", entity: "BuffetWeighing", entityId: created.id, newValue: created, ...auditMeta(request) });
  response.status(201).json(weighingView(created));
});

buffetWeighingsRouter.put("/weighings/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const data = parseCorpo(weighingUpdateSchema, request.body, response);
  if (!data) return;
  const existing = await prisma.buffetWeighing.findUnique({ where: { id: request.params.id } });
  if (!existing) return response.status(404).json({ message: "Pesagem não encontrada." });

  // Trocar a panela passa a valer o peso ATUAL da nova; sem trocar, mantém o peso da panela da época.
  let tareG = existing.tareG;
  let potId = existing.potId;
  if (data.potId && data.potId !== existing.potId) {
    const pot = await prisma.buffetPot.findUnique({ where: { id: data.potId } });
    if (!pot || !pot.isActive) return response.status(400).json({ message: "Panela não encontrada ou inativa." });
    tareG = pot.tareG;
    potId = pot.id;
  }
  const grossG = data.grossG ?? existing.grossG;
  if (grossG < tareG) {
    return response.status(400).json({ message: `O peso bruto (${kg(grossG)}) é menor que o da panela vazia (${kg(tareG)}). Confira a panela e a balança.` });
  }
  try {
    const updated = await prisma.buffetWeighing.update({
      where: { id: existing.id },
      data: { potId, tareG, grossG, netG: grossG - tareG, ...(data.phase ? { phase: data.phase } : {}), ...(data.notes !== undefined ? { notes: data.notes || null } : {}) },
      include: INCLUDE,
    });
    await auditLog({ userId: user.id, action: "UPDATE_BUFFET_WEIGHING", entity: "BuffetWeighing", entityId: existing.id, previousValue: existing, newValue: updated, ...auditMeta(request) });
    response.json(weighingView(updated));
  } catch (e) {
    if (naoEncontrado(e)) return response.status(404).json({ message: "Pesagem não encontrada." });
    throw e;
  }
});

buffetWeighingsRouter.delete("/weighings/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const existing = await prisma.buffetWeighing.findUnique({ where: { id: request.params.id } });
  if (!existing) return response.status(404).json({ message: "Pesagem não encontrada." });
  try {
    await prisma.buffetWeighing.delete({ where: { id: existing.id } });
  } catch (e) {
    if (naoEncontrado(e)) return response.status(404).json({ message: "Pesagem não encontrada." });
    throw e;
  }
  await auditLog({ userId: user.id, action: "DELETE_BUFFET_WEIGHING", entity: "BuffetWeighing", entityId: existing.id, previousValue: existing, ...auditMeta(request) });
  response.json({ ok: true });
});
