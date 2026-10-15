import { Router } from "express";
import { prisma } from "../../config/database.js";
import { auditLog, requireMenuPermission } from "../security/security-utils.js";
import { validarConversaoManual } from "../../shared/unidades/conversao-manual.js";
import { aplicarUmaConversao, carregarProdutosParaConversao } from "../products/conversao-automatica.service.js";
import { montarRotina } from "./conversoes-pendentes.js";

// Rotina do estoquista (menu Estoque > Conversões): a situação da conversão de cada produto e o cadastro na hora.
// Quem tem acesso a Requisições vê e cadastra; o fator passa por validarConversaoManual e tudo entra na auditoria.
export const conversoesPendentesRouter = Router();

const DIAS_DE_USO = 90;

conversoesPendentesRouter.get("/", async (request, response) => {
  const user = await requireMenuPermission(request, response);
  if (!user) return;

  const [carregados, estoque, produtos, setores, usos, conferencias] = await Promise.all([
    carregarProdutosParaConversao(),
    prisma.$queryRaw<Array<{ productId: string; currentQuantity: string }>>`SELECT "productId", "currentQuantity"::text AS "currentQuantity" FROM "InventoryStock"`,
    prisma.$queryRaw<Array<{ id: string; sectorId: string | null }>>`SELECT "id", "inventorySectorId" AS "sectorId" FROM "Product" WHERE "isActive" = true AND "controlsStock" IS NOT FALSE`,
    prisma.$queryRaw<Array<{ id: string; name: string }>>`SELECT "id", "name" FROM "InventorySector" WHERE "isActive" = true ORDER BY "countOrder", "name"`,
    prisma.$queryRaw<Array<{ productId: string; usos: number }>>`
      SELECT i."productId", COUNT(*)::int AS "usos"
      FROM "InventoryRequisitionItem" i
      JOIN "InventoryRequisition" r ON r."id" = i."requisitionId"
      WHERE i."productId" IS NOT NULL AND r."status" <> 'CANCELLED' AND r."createdAt" > NOW() - (${DIAS_DE_USO} * INTERVAL '1 day')
      GROUP BY i."productId"`,
    prisma.$queryRaw<Array<{ productId: string; por: string | null; em: Date }>>`
      SELECT c."productId", u."name" AS "por", c."reviewedAt" AS "em"
      FROM "ProductConversionReview" c LEFT JOIN "User" u ON u."id" = c."reviewedByUserId"`
  ]);

  const { produtos: lista, resumo } = montarRotina(carregados, {
    saldos: new Map(estoque.map((e) => [e.productId, Number(e.currentQuantity)])),
    controlaEstoque: new Set(produtos.map((p) => p.id)),
    setores: new Map(setores.map((s) => [s.id, { id: s.id, nome: s.name }])),
    setorDoProduto: new Map(produtos.filter((p) => p.sectorId).map((p) => [p.id, p.sectorId as string])),
    usos: new Map(usos.map((u) => [u.productId, u.usos])),
    conferencias: new Map(conferencias.map((c) => [c.productId, { por: c.por, em: c.em.toISOString() }]))
  });
  response.json({ produtos: lista, resumo, locais: setores.map((s) => ({ id: s.id, nome: s.name })) });
});

conversoesPendentesRouter.post("/", async (request, response) => {
  const user = await requireMenuPermission(request, response);
  if (!user) return;

  const productId = String(request.body?.productId ?? "").trim();
  if (!productId) return void response.status(400).json({ message: "Escolha o produto." });

  const [carregado] = await carregarProdutosParaConversao([productId]);
  if (!carregado) return void response.status(404).json({ message: "Produto não encontrado ou inativo." });

  const validada = validarConversaoManual({ fromUnit: request.body?.fromUnit, factor: request.body?.factor }, carregado.contagem, carregado.entrada.cadastradas);
  if (!validada.ok) return void response.status(validada.conflito ? 409 : 400).json({ message: validada.erro });
  const { fromUnit, toUnit, factor, jaCadastrada } = validada.valor;
  if (jaCadastrada) return void response.status(200).json({ criada: false, comprasConvertidas: 0, comprasEmPeriodoFechado: 0, conversao: { fromUnit, toUnit, factor } });

  const aplicada = await aplicarUmaConversao({
    productId,
    nome: carregado.nome,
    fromUnit,
    toUnit,
    factor,
    motivo: `Manual (estoquista): 1 ${fromUnit} = ${factor.toLocaleString("pt-BR", { maximumFractionDigits: 6 })} ${toUnit}.`,
    origem: "MANUAL",
    userId: user.id
  });
  // Cadastrou a conversão: a conferência de "não precisa" deixa de valer.
  await prisma.productConversionReview.deleteMany({ where: { productId } });
  response.status(201).json({ ...aplicada, conversao: { fromUnit, toUnit, factor } });
});

// "Não precisa de conversão" (contado e comprado na mesma unidade, por exemplo): sai da fila sem cadastro.
// naoPrecisa: false desfaz a conferência e o produto volta para as pendências.
conversoesPendentesRouter.put("/:productId/conferencia", async (request, response) => {
  const user = await requireMenuPermission(request, response);
  if (!user) return;

  const { productId } = request.params;
  const produto = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true } });
  if (!produto) return void response.status(404).json({ message: "Produto não encontrado." });

  const naoPrecisa = request.body?.naoPrecisa === true;
  if (naoPrecisa) {
    const nota = String(request.body?.note ?? "").trim().slice(0, 200) || null;
    await prisma.productConversionReview.upsert({
      where: { productId },
      create: { productId, status: "NAO_PRECISA", note: nota, reviewedByUserId: user.id },
      update: { status: "NAO_PRECISA", note: nota, reviewedByUserId: user.id, reviewedAt: new Date() }
    });
  } else {
    await prisma.productConversionReview.deleteMany({ where: { productId } });
  }
  await auditLog({ userId: user.id, action: naoPrecisa ? "PRODUCT_CONVERSION_NOT_NEEDED" : "PRODUCT_CONVERSION_REVIEW_UNDONE", entity: "Product", entityId: productId, newValue: { nome: produto.name, naoPrecisa } });
  response.json({ productId, naoPrecisa });
});
