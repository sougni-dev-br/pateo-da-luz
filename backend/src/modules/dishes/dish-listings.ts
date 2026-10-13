import type { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { parseBody } from "../../shared/validate-body.js";
import { auditLog, requireRole } from "../security/security-utils.js";
import { PREFIXO_MANUAL, carregarDetalhe, ehListagemManual } from "./dish-detail.js";
import { registrarRevisao } from "./dish-revisions.js";

/**
 * Preço do prato em cada canal e em cada loja: o salão tem o preço da ficha, e cada loja de cada plataforma
 * (99, iFood, Keeta) pode ter o seu. A 99 vem do cardápio dela, importado — esse preço é da plataforma e só se
 * muda no portal. Os demais (iFood, Keeta, uma loja ainda não importada) são lançados aqui, à mão.
 */
const precoSchema = z.coerce
  .number({ invalid_type_error: "Preço inválido." })
  .positive("O preço deve ser maior que zero.")
  .max(99_999.99, "Preço alto demais.")
  .transform((valor) => Math.round(valor * 100) / 100);

const criarSchema = z.object({
  deliveryStoreId: z.string({ required_error: "Escolha a loja." }).trim().min(1, "Escolha a loja."),
  price: precoSchema
});

const alterarSchema = z.object({
  price: precoSchema.optional(),
  isActive: z.boolean().optional()
});

const ehUnico = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export function registrarRotasDeListagem(router: Router) {
  /** Lojas onde o prato pode ter preço: o seletor da tela. */
  router.get("/delivery-stores", async (_request, response) => {
    const lojas = await prisma.deliveryStore.findMany({
      where: { active: true },
      select: { id: true, platform: true, nickname: true },
      orderBy: [{ platform: "asc" }, { nickname: "asc" }]
    });
    response.json(lojas);
  });

  router.post("/:id/listings", async (request, response) => {
    const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
    if (!user) return;
    const body = parseBody(criarSchema, request.body, response);
    if (!body) return;

    const dishId = request.params.id;
    const [prato, loja] = await Promise.all([
      prisma.dish.findUnique({ where: { id: dishId }, select: { id: true, name: true } }),
      prisma.deliveryStore.findUnique({ where: { id: body.deliveryStoreId }, select: { id: true, platform: true, nickname: true, active: true } })
    ]);
    if (!prato) return void response.status(404).json({ message: "Prato não encontrado." });
    if (!loja || !loja.active) return void response.status(400).json({ message: "A loja escolhida não existe ou está inativa." });

    // Uma loja, um preço por prato: se a loja já tem este prato (importado da 99 ou lançado antes), edita-se o que existe.
    const jaTem = await prisma.dishListing.count({ where: { dishId, deliveryStoreId: loja.id } });
    if (jaTem > 0) {
      return void response.status(409).json({ message: `${loja.nickname} já tem preço para este prato.` });
    }

    try {
      const criada = await prisma.$transaction(async (tx) => {
        const listagem = await tx.dishListing.create({
          data: {
            dishId,
            channel: loja.platform,
            deliveryStoreId: loja.id,
            externalItemId: `${PREFIXO_MANUAL}${dishId}`,
            externalName: prato.name,
            price: body.price,
            isActive: true,
            lastSeenAt: new Date()
          }
        });
        const detalhe = await carregarDetalhe(tx, dishId);
        if (detalhe) await registrarRevisao(tx, { detalhe, action: "ALTERADA", user });
        return listagem;
      });
      await auditLog({ userId: user.id, action: "CREATE", entity: "DishListing", entityId: criada.id, newValue: { dishId, store: loja.nickname, price: body.price } });
      response.json({ id: criada.id });
    } catch (error) {
      if (!ehUnico(error)) throw error;
      response.status(409).json({ message: `${loja.nickname} já tem preço para este prato.` });
    }
  });

  async function daListagemManual(request: { params: { id?: string; listingId?: string } }, response: { status: (c: number) => { json: (b: unknown) => void } }) {
    const listagem = await prisma.dishListing.findFirst({
      where: { id: request.params.listingId, dishId: request.params.id },
      select: { id: true, externalItemId: true, price: true, isActive: true, deliveryStore: { select: { nickname: true } } }
    });
    if (!listagem) {
      response.status(404).json({ message: "Preço não encontrado." });
      return null;
    }
    if (!ehListagemManual(listagem.externalItemId)) {
      response.status(400).json({ message: "Este preço vem do cardápio da plataforma e é atualizado por ele. Para mudar, altere no portal da plataforma." });
      return null;
    }
    return listagem;
  }

  router.put("/:id/listings/:listingId", async (request, response) => {
    const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
    if (!user) return;
    const body = parseBody(alterarSchema, request.body, response);
    if (!body) return;
    if (body.price === undefined && body.isActive === undefined) {
      return void response.status(400).json({ message: "Informe o preço ou se a loja está vendendo." });
    }
    const listagem = await daListagemManual(request, response);
    if (!listagem) return;

    await prisma.$transaction(async (tx) => {
      await tx.dishListing.update({
        where: { id: listagem.id },
        data: { ...(body.price !== undefined ? { price: body.price } : {}), ...(body.isActive !== undefined ? { isActive: body.isActive } : {}) }
      });
      const detalhe = await carregarDetalhe(tx, request.params.id);
      if (detalhe) await registrarRevisao(tx, { detalhe, action: "ALTERADA", user });
    });
    await auditLog({
      userId: user.id, action: "UPDATE", entity: "DishListing", entityId: listagem.id,
      previousValue: { price: Number(listagem.price), isActive: listagem.isActive }, newValue: body
    });
    response.json({ id: listagem.id });
  });

  router.delete("/:id/listings/:listingId", async (request, response) => {
    const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
    if (!user) return;
    const listagem = await daListagemManual(request, response);
    if (!listagem) return;

    await prisma.$transaction(async (tx) => {
      await tx.dishListing.delete({ where: { id: listagem.id } });
      const detalhe = await carregarDetalhe(tx, request.params.id);
      if (detalhe) await registrarRevisao(tx, { detalhe, action: "ALTERADA", user });
    });
    await auditLog({ userId: user.id, action: "DELETE", entity: "DishListing", entityId: listagem.id, previousValue: { price: Number(listagem.price) } });
    response.json({ ok: true });
  });
}
