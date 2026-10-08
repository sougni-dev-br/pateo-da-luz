import crypto from "node:crypto";
import type { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { auditLog, requireRole } from "../security/security-utils.js";

export const MENUS = ["CARDAPIO", "DELIVERY"] as const;
export type Menu = (typeof MENUS)[number];

export const ehMenuValido = (valor: unknown): valor is Menu => MENUS.includes(valor as Menu);

type Pai = { id: string; parentId: string | null; menu: string } | null;

/**
 * Regras de uma categoria nova ou editada. Pura, para testar sem banco:
 * so dois niveis (categoria > subcategoria), subcategoria herda o cardapio do pai,
 * e quem ja tem subcategorias nao pode virar subcategoria (viraria tres niveis).
 */
export function resolverCategoria(
  entrada: { name: unknown; parentId: unknown; menu: unknown },
  contexto: { id?: string; pai: Pai; temSubcategorias: boolean }
): { erro: string } | { name: string; parentId: string | null; menu: Menu } {
  const name = String(entrada.name ?? "").trim();
  if (!name) return { erro: "Nome da categoria é obrigatório." };
  if (name.length > 60) return { erro: "Nome da categoria muito longo (até 60 letras)." };

  const parentId = entrada.parentId == null || entrada.parentId === "" ? null : String(entrada.parentId);
  if (parentId) {
    if (contexto.id && parentId === contexto.id) return { erro: "Uma categoria não pode ser subcategoria dela mesma." };
    if (!contexto.pai) return { erro: "A categoria principal escolhida não existe mais." };
    if (contexto.pai.parentId) return { erro: "Só há dois níveis: escolha uma categoria principal, não uma subcategoria." };
    if (contexto.temSubcategorias) return { erro: "Esta categoria tem subcategorias e não pode virar subcategoria." };
    return { name, parentId, menu: ehMenuValido(contexto.pai.menu) ? contexto.pai.menu : "CARDAPIO" };
  }

  return { name, parentId: null, menu: ehMenuValido(entrada.menu) ? entrada.menu : "CARDAPIO" };
}

const ehNomeDuplicado = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/** Rotas de categorias e subcategorias do módulo de fichas técnicas. */
export function registrarRotasDeCategoria(router: Router) {
  router.get("/categories", async (_request, response) => {
    const rows = await prisma.dishCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { dishes: { where: { isActive: true } } } } }
    });
    response.json(rows.map(({ _count, ...category }) => ({ ...category, dishesCount: _count.dishes })));
  });

  async function gravar(
    request: { params: { id?: string }; body: Record<string, unknown>; headers: Record<string, unknown> },
    response: { status: (c: number) => { json: (b: unknown) => void }; json: (b: unknown) => void },
    id: string | null
  ) {
    const user = await requireRole(request as never, response as never, ["ADMIN", "GESTAO_COMPLETA"]);
    if (!user) return;

    const parentId = request.body.parentId == null || request.body.parentId === "" ? null : String(request.body.parentId);
    const [pai, subcategorias, atual] = await Promise.all([
      parentId ? prisma.dishCategory.findUnique({ where: { id: parentId }, select: { id: true, parentId: true, menu: true } }) : Promise.resolve(null),
      id ? prisma.dishCategory.count({ where: { parentId: id } }) : Promise.resolve(0),
      id ? prisma.dishCategory.findUnique({ where: { id }, select: { id: true, menu: true } }) : Promise.resolve(null)
    ]);
    if (id && !atual) {
      response.status(404).json({ message: "Categoria não encontrada." });
      return;
    }

    const resolvida = resolverCategoria(request.body as never, { id: id ?? undefined, pai, temSubcategorias: subcategorias > 0 });
    if ("erro" in resolvida) {
      response.status(400).json({ message: resolvida.erro });
      return;
    }

    const repetida = await prisma.dishCategory.findFirst({
      where: {
        name: { equals: resolvida.name, mode: "insensitive" },
        parentId: resolvida.parentId,
        menu: resolvida.menu,
        ...(id ? { NOT: { id } } : {})
      },
      select: { id: true }
    });
    if (repetida) {
      response.status(400).json({ message: "Já existe uma categoria com este nome nesse lugar do cardápio." });
      return;
    }

    // Trocar o cardápio de uma categoria arrasta as subcategorias; se ela já tem prato do outro cardápio, não dá.
    if (id && atual && atual.menu !== resolvida.menu) {
      const doOutroCardapio = await prisma.dish.count({
        where: { isActive: true, menu: { not: resolvida.menu }, category: { OR: [{ id }, { parentId: id }] } }
      });
      if (doOutroCardapio > 0) {
        response.status(409).json({
          message: `Há ${doOutroCardapio} prato${doOutroCardapio === 1 ? "" : "s"} do outro cardápio nesta categoria. Mova-os antes de trocar o cardápio dela.`
        });
        return;
      }
    }

    const dados = {
      name: resolvida.name,
      parentId: resolvida.parentId,
      menu: resolvida.menu,
      sortOrder: Number(request.body.sortOrder ?? 0) || 0,
      notes: String(request.body.notes ?? "").trim() || null
    };

    try {
      const row = id
        ? await prisma.$transaction(async (tx) => {
            const atualizada = await tx.dishCategory.update({ where: { id }, data: { ...dados, isActive: request.body.isActive !== false } });
            await tx.dishCategory.updateMany({ where: { parentId: id }, data: { menu: resolvida.menu } });
            return atualizada;
          })
        : await prisma.dishCategory.create({ data: { id: crypto.randomUUID(), ...dados } });

      await auditLog({ userId: user.id, action: id ? "UPDATE" : "CREATE", entity: "DishCategory", entityId: row.id, newValue: row });
      response.json(row);
    } catch (error) {
      if (!ehNomeDuplicado(error)) throw error;
      response.status(400).json({ message: "Já existe uma categoria com este nome nesse lugar do cardápio." });
    }
  }

  router.post("/categories", (request, response) => gravar(request as never, response as never, null));
  router.put("/categories/:id", (request, response) => gravar(request as never, response as never, request.params.id));
}
