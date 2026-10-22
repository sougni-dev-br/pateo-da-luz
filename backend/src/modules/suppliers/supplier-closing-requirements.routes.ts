// Exigências mensais do fornecedor no Fechamento Mensal.
// Montado em /suppliers/:id/closing-requirements — o prefixo /suppliers já é
// coberto pelo portão de permissão do menu "Fornecedores".

import { Prisma } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../../config/database.js";
import { auditLog, requestIp, requireRole } from "../security/security-utils.js";
import { lerExigencia } from "./exigencia-input.js";

export const supplierClosingRequirementsRouter = Router({ mergeParams: true });

const PODE_VER = ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"] as const;
const PODE_EDITAR = ["ADMIN", "GESTAO_COMPLETA"] as const;

const incluirProduto = { product: { select: { id: true, name: true } } } as const;

type ExigenciaComProduto = Prisma.SupplierClosingRequirementGetPayload<{ include: typeof incluirProduto }>;

function paraResposta(e: ExigenciaComProduto) {
  return {
    id: e.id,
    label: e.label,
    productId: e.productId,
    productName: e.product.name,
    settledAt: e.settledAt ? e.settledAt.toISOString() : null
  };
}

const idDoFornecedor = (params: Record<string, string | undefined>) => String(params.id ?? "");

async function auditar(
  request: Parameters<Parameters<typeof supplierClosingRequirementsRouter.get>[1]>[0],
  userId: string,
  action: string,
  entityId: string,
  previousValue: unknown,
  newValue: unknown
) {
  await auditLog({
    userId, action, entity: "SupplierClosingRequirement", entityId, previousValue, newValue,
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "")
  });
}

supplierClosingRequirementsRouter.get("/", async (request, response) => {
  const user = await requireRole(request, response, [...PODE_VER]);
  if (!user) return;
  const lista = await prisma.supplierClosingRequirement.findMany({
    where: { supplierId: idDoFornecedor(request.params) },
    include: incluirProduto,
    orderBy: { createdAt: "asc" }
  });
  response.json(lista.map(paraResposta));
});

supplierClosingRequirementsRouter.post("/", async (request, response) => {
  const user = await requireRole(request, response, [...PODE_EDITAR]);
  if (!user) return;
  const supplierId = idDoFornecedor(request.params);

  const lida = lerExigencia(request.body);
  if (!lida.ok) { response.status(400).json({ message: lida.erro }); return; }

  const [fornecedor, produto] = await Promise.all([
    prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true } }),
    prisma.product.findUnique({ where: { id: lida.valor.productId }, select: { id: true } })
  ]);
  if (!fornecedor) { response.status(404).json({ message: "Fornecedor nao encontrado." }); return; }
  if (!produto) { response.status(400).json({ message: "Produto nao encontrado." }); return; }

  try {
    const criada = await prisma.supplierClosingRequirement.create({
      data: { supplierId, label: lida.valor.label, productId: lida.valor.productId },
      include: incluirProduto
    });
    await auditar(request, user.id, "CREATE_SUPPLIER_CLOSING_REQUIREMENT", criada.id, null, paraResposta(criada));
    response.status(201).json(paraResposta(criada));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      response.status(409).json({ message: "Este fornecedor já tem um lançamento obrigatório com esse produto. Use um produto diferente para cada um." });
      return;
    }
    throw error;
  }
});

supplierClosingRequirementsRouter.patch("/:requirementId", async (request, response) => {
  const user = await requireRole(request, response, [...PODE_EDITAR]);
  if (!user) return;
  const supplierId = idDoFornecedor(request.params);

  const lida = lerExigencia(request.body, { parcial: true });
  if (!lida.ok) { response.status(400).json({ message: lida.erro }); return; }

  const anterior = await prisma.supplierClosingRequirement.findFirst({
    where: { id: request.params.requirementId, supplierId }, include: incluirProduto
  });
  if (!anterior) { response.status(404).json({ message: "Lancamento obrigatorio nao encontrado." }); return; }

  if (lida.valor.productId) {
    const produto = await prisma.product.findUnique({ where: { id: lida.valor.productId }, select: { id: true } });
    if (!produto) { response.status(400).json({ message: "Produto nao encontrado." }); return; }
  }

  try {
    const atualizada = await prisma.supplierClosingRequirement.update({
      where: { id: anterior.id }, data: lida.valor, include: incluirProduto
    });
    await auditar(request, user.id, "UPDATE_SUPPLIER_CLOSING_REQUIREMENT", anterior.id, paraResposta(anterior), paraResposta(atualizada));
    response.json(paraResposta(atualizada));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      response.status(409).json({ message: "Este fornecedor já tem um lançamento obrigatório com esse produto." });
      return;
    }
    throw error;
  }
});

supplierClosingRequirementsRouter.delete("/:requirementId", async (request, response) => {
  const user = await requireRole(request, response, [...PODE_EDITAR]);
  if (!user) return;
  const anterior = await prisma.supplierClosingRequirement.findFirst({
    where: { id: request.params.requirementId, supplierId: idDoFornecedor(request.params) }, include: incluirProduto
  });
  if (!anterior) { response.status(404).json({ message: "Lancamento obrigatorio nao encontrado." }); return; }

  await prisma.supplierClosingRequirement.delete({ where: { id: anterior.id } });
  await auditar(request, user.id, "DELETE_SUPPLIER_CLOSING_REQUIREMENT", anterior.id, paraResposta(anterior), null);
  response.json({ ok: true });
});

// Marcar como quitado encerra a cobrança deste lançamento nos meses seguintes
// (e ele continua visível, riscado, como histórico). Reabrir volta a cobrar.
supplierClosingRequirementsRouter.post("/:requirementId/settle", async (request, response) => {
  const user = await requireRole(request, response, [...PODE_EDITAR]);
  if (!user) return;
  const quitar = request.body?.settled !== false;

  const anterior = await prisma.supplierClosingRequirement.findFirst({
    where: { id: request.params.requirementId, supplierId: idDoFornecedor(request.params) }, include: incluirProduto
  });
  if (!anterior) { response.status(404).json({ message: "Lancamento obrigatorio nao encontrado." }); return; }

  const atualizada = await prisma.supplierClosingRequirement.update({
    where: { id: anterior.id },
    data: quitar ? { settledAt: new Date(), settledByUserId: user.id } : { settledAt: null, settledByUserId: null },
    include: incluirProduto
  });
  await auditar(
    request, user.id,
    quitar ? "SETTLE_SUPPLIER_CLOSING_REQUIREMENT" : "REOPEN_SUPPLIER_CLOSING_REQUIREMENT",
    anterior.id, paraResposta(anterior), paraResposta(atualizada)
  );
  response.json(paraResposta(atualizada));
});
