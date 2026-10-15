import crypto from "node:crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { auditLog, requestIp, requireRole } from "../security/security-utils.js";
import { nextPurchaseOrderCode } from "./purchase-order-code.js";
import { carregarInteligenciaDePreco } from "../inventory/preco-por-fornecedor.js";
import {
  QUANTIDADE_MAXIMA,
  agruparPorFornecedor,
  fornecedorPadrao,
  precoParaFornecedor,
  quantidadeSugerida,
  totalEstimado,
  validarItensDoPedido
} from "./requisicao-pedido.js";

// Pedido de compra a partir de uma requisição de insumos: a revisão mostra o que saiu, o saldo de hoje e o
// fornecedor de cada item; o que a pessoa confirmar vira o pedido (rascunho) e segue o fluxo normal de aprovação.
export const requisicaoPedidoRouter = Router();

type ItemDaRequisicao = {
  productId: string;
  productName: string;
  productCode: string | null;
  unit: string | null;
  quantity: string;
  fornecedorPrincipalId: string | null;
  fornecedorPrincipalNome: string | null;
  fornecedorPrincipalAtivo: boolean | null;
  estoqueMinimo: string | null;
  estoqueIdeal: string | null;
  saldo: string | null;
};

async function carregarRequisicao(id: string) {
  const [requisicao] = await prisma.$queryRaw<Array<{ id: string; code: string; date: Date; shift: string; reason: string; sectorName: string | null; requestedByName: string | null }>>`
    SELECT r."id", r."code", r."date", r."shift", r."reason", sec."name" AS "sectorName", u."name" AS "requestedByName"
    FROM "InventoryRequisition" r
    LEFT JOIN "InventorySector" sec ON sec."id" = r."sectorId"
    LEFT JOIN "User" u ON u."id" = r."requestedByUserId"
    WHERE r."id" = ${id} AND r."status" <> 'CANCELLED'
  `;
  if (!requisicao) return null;
  const itens = await prisma.$queryRaw<ItemDaRequisicao[]>`
    SELECT i."productId", i."productName", i."productCode", i."unit", i."quantity"::text AS "quantity",
           p."fornecedorPrincipalId", sup."name" AS "fornecedorPrincipalNome", sup."isActive" AS "fornecedorPrincipalAtivo", p."estoqueMinimo"::text AS "estoqueMinimo", p."estoqueIdeal"::text AS "estoqueIdeal",
           s."currentQuantity"::text AS "saldo"
    FROM "InventoryRequisitionItem" i
    LEFT JOIN "Product" p ON p."id" = i."productId"
    LEFT JOIN "Supplier" sup ON sup."id" = p."fornecedorPrincipalId"
    LEFT JOIN "InventoryStock" s ON s."productId" = i."productId"
    WHERE i."requisitionId" = ${id} AND i."productId" IS NOT NULL
    ORDER BY i."productName"
  `;
  return { requisicao, itens };
}

class PedidoJaGerado extends Error {}

const numero = (valor: string | null) => (valor == null ? null : Number(valor));

requisicaoPedidoRouter.get("/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;

  const carregada = await carregarRequisicao(request.params.id);
  if (!carregada) return void response.status(404).json({ message: "Requisição não encontrada." });

  const [leituraDePreco, fornecedores, pedidos] = await Promise.all([
    // Mesma regra do planejamento de compra: histórico de 24 meses, preço convertido para a unidade do estoque.
    carregarInteligenciaDePreco(carregada.itens.map((i) => i.productId), { apenasFornecedoresAtivos: true }),
    prisma.$queryRaw<Array<{ id: string; name: string }>>`SELECT "id", "name" FROM "Supplier" WHERE "isActive" = true ORDER BY "name"`,
    prisma.$queryRaw<Array<{ id: string; code: string; supplierName: string; status: string; totalItems: number }>>`
      SELECT po."id", po."code", po."supplierNameSnapshot" AS "supplierName", po."status",
             (SELECT COUNT(*)::int FROM "PurchaseOrderItem" i WHERE i."purchaseOrderId" = po."id") AS "totalItems"
      FROM "PurchaseOrder" po
      WHERE po."sourceRequisitionId" = ${request.params.id} AND po."status" <> 'CANCELADO'
      ORDER BY po."createdAt"
    `
  ]);

  const ativos = new Set(fornecedores.map((f) => f.id));
  response.json({
    requisition: carregada.requisicao,
    items: carregada.itens.map((item) => {
      const retirada = Number(item.quantity);
      // Fornecedor principal inativo não é oferecido: a tela o mostraria selecionado e o servidor o descartaria.
      const principalId = item.fornecedorPrincipalId && ativos.has(item.fornecedorPrincipalId) ? item.fornecedorPrincipalId : null;
      const leitura = leituraDePreco(item.productId, principalId, principalId ? item.fornecedorPrincipalNome : null);
      const padrao = fornecedorPadrao(leitura.supplierPriceOptions, principalId);
      return {
        productId: item.productId,
        name: item.productName,
        code: item.productCode,
        unit: item.unit,
        withdrawn: retirada,
        balance: numero(item.saldo),
        estoqueMinimo: numero(item.estoqueMinimo),
        estoqueIdeal: numero(item.estoqueIdeal),
        suggestedQuantity: quantidadeSugerida(retirada),
        defaultSupplierId: padrao,
        unitPrice: precoParaFornecedor(leitura, padrao),
        preferredSupplierId: leitura.preferredSupplierId,
        preferredSupplierName: leitura.preferredSupplierName,
        // Ordenadas por menor preço (o primeiro é o recomendado), como no planejamento.
        supplierOptions: leitura.supplierPriceOptions,
        bestPriceSupplierId: leitura.bestPriceSupplierId,
        bestPriceSupplierName: leitura.bestPriceSupplierName,
        bestUnitPrice: leitura.bestUnitPrice,
        lastUnitPrice: leitura.lastUnitPrice,
        lastPurchaseSupplierName: leitura.lastPurchaseSupplierName,
        lastPurchaseDate: leitura.lastPurchaseDate,
        hasCheaperAlternative: leitura.hasCheaperAlternative,
        priceComparisonNote: leitura.priceComparisonNote,
        conversionMissing: leitura.conversionMissing
      };
    }),
    suppliers: fornecedores,
    existingOrders: pedidos
  });
});

requisicaoPedidoRouter.post("/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const carregada = await carregarRequisicao(request.params.id);
  if (!carregada) return void response.status(404).json({ message: "Requisição não encontrada." });
  const { requisicao, itens } = carregada;

  const jaGerados = await prisma.$queryRaw<Array<{ id: string; code: string; supplierName: string }>>`
    SELECT "id", "code", "supplierNameSnapshot" AS "supplierName" FROM "PurchaseOrder"
    WHERE "sourceRequisitionId" = ${requisicao.id} AND "status" <> 'CANCELADO'
  `;
  if (jaGerados.length > 0 && request.body?.confirmarOutroPedido !== true) {
    return void response.status(409).json({
      message: `Esta requisição já gerou ${jaGerados.length === 1 ? "o pedido" : "os pedidos"} ${jaGerados.map((p) => p.code).join(", ")}. Confirme para gerar outro.`,
      existingOrders: jaGerados
    });
  }

  const recebidos = Array.isArray(request.body?.items) ? request.body.items : [];
  if (recebidos.length > 1000) return void response.status(400).json({ message: "Itens demais para um pedido." });
  const retiradaPorProduto = new Map(itens.map((i) => [i.productId, i]));
  const { validos, foraDaEscala, ignorados } = validarItensDoPedido(recebidos, new Set(retiradaPorProduto.keys()));
  const comNomes = (lista: typeof ignorados) => lista.map((i) => ({ ...i, productName: (i.productId && retiradaPorProduto.get(i.productId)?.productName) || null }));

  if (foraDaEscala.length > 0) {
    const nomes = foraDaEscala.map((o) => `${retiradaPorProduto.get(o.productId)?.productName ?? o.productId}: ${o.quantity}`);
    return void response.status(400).json({ message: `Quantidade acima do máximo (${QUANTIDADE_MAXIMA}). Reveja: ${nomes.join("; ")}.` });
  }

  const idsDosFornecedores = Array.from(new Set(validos.map((l) => l.supplierId)));
  const fornecedores = idsDosFornecedores.length
    ? await prisma.$queryRaw<Array<{ id: string; name: string }>>`SELECT "id", "name" FROM "Supplier" WHERE "id" IN (${Prisma.join(idsDosFornecedores)}) AND "isActive" = true`
    : [];
  const fornecedorPorId = new Map(fornecedores.map((f) => [f.id, f.name]));
  const aceitos = validos.filter((l) => {
    if (fornecedorPorId.has(l.supplierId!)) return true;
    ignorados.push({ productId: l.productId, reason: "Fornecedor não encontrado ou inativo." });
    return false;
  });
  if (aceitos.length === 0) {
    return void response.status(400).json({ message: "Nenhum item válido para gerar o pedido.", skippedItems: comNomes(ignorados) });
  }

  const expectedDeliveryDate = (() => {
    const bruto = String(request.body?.expectedDeliveryDate ?? "").trim();
    const data = bruto ? new Date(bruto) : null;
    return data && !Number.isNaN(data.getTime()) ? data : null;
  })();
  const observacao = String(request.body?.notes ?? "").trim();
  const origem = `Gerado da requisição ${requisicao.code}`;
  const notas = observacao ? `${origem} — ${observacao}` : origem;
  const leituraDePreco = await carregarInteligenciaDePreco(aceitos.map((l) => l.productId), { apenasFornecedoresAtivos: true });

  const criados = await prisma.$transaction(async (tx) => {
    // Duas gerações simultâneas da mesma requisição (toque duplo, duas abas) esperam uma à outra:
    // a segunda reconfere se já existe pedido antes de gravar.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requisicao.id}))`;
    if (request.body?.confirmarOutroPedido !== true) {
      const [{ total }] = await tx.$queryRaw<Array<{ total: number }>>`
        SELECT COUNT(*)::int AS "total" FROM "PurchaseOrder" WHERE "sourceRequisitionId" = ${requisicao.id} AND "status" <> 'CANCELADO'
      `;
      if (total > 0) throw new PedidoJaGerado();
    }
    const resultado: Array<{ id: string; code: string; supplierId: string; supplierName: string; totalItems: number; totalEstimated: number; status: string }> = [];
    for (const [supplierId, linhas] of agruparPorFornecedor(aceitos)) {
      const id = crypto.randomUUID();
      const code = await nextPurchaseOrderCode(tx, new Date().getFullYear());
      const supplierName = fornecedorPorId.get(supplierId)!;
      await tx.$executeRaw`
        INSERT INTO "PurchaseOrder" (
          "id", "code", "supplierId", "supplierNameSnapshot", "status", "source", "sourceRequisitionId",
          "createdByUserId", "expectedDeliveryDate", "notes", "createdAt", "updatedAt"
        )
        VALUES (
          ${id}, ${code}, ${supplierId}, ${supplierName}, 'RASCUNHO', 'REQUISICAO', ${requisicao.id},
          ${user.id}, ${expectedDeliveryDate}, ${notas}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `;
      let total = 0;
      for (const linha of linhas) {
        const item = retiradaPorProduto.get(linha.productId)!;
        // O preço que a pessoa viu na revisão vale; sem ele, o da última compra daquele fornecedor.
        const preco = linha.unitPrice ?? precoParaFornecedor(leituraDePreco(linha.productId, null, null), supplierId);
        const totalDoItem = totalEstimado(linha.quantity, preco);
        total += totalDoItem ?? 0;
        await tx.$executeRaw`
          INSERT INTO "PurchaseOrderItem" (
            "id", "purchaseOrderId", "productId", "productCodeSnapshot", "productNameSnapshot", "unitSnapshot",
            "suggestedQuantity", "requestedQuantity", "estoqueMinimoSnapshot", "estoqueIdealSnapshot",
            "unitPriceEstimated", "totalEstimated", "createdAt", "updatedAt"
          )
          VALUES (
            ${crypto.randomUUID()}, ${id}, ${linha.productId}, ${item.productCode}, ${item.productName}, ${item.unit},
            ${quantidadeSugerida(Number(item.quantity))}, ${linha.quantity}, ${numero(item.estoqueMinimo)}, ${numero(item.estoqueIdeal)},
            ${preco}, ${totalDoItem}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
        `;
      }
      resultado.push({ id, code, supplierId, supplierName, totalItems: linhas.length, totalEstimated: Math.round(total * 100) / 100, status: "RASCUNHO" });
    }
    return resultado;
  }, { timeout: 30_000, maxWait: 10_000 }).catch((erro: unknown) => {
    if (erro instanceof PedidoJaGerado) return null;
    throw erro;
  });
  if (criados == null) {
    return void response.status(409).json({ message: "Esta requisição acabou de gerar um pedido. Atualize a tela para vê-lo." });
  }

  await auditLog({
    userId: user.id,
    action: "CREATE_PURCHASE_ORDER_FROM_REQUISITION",
    entity: "PurchaseOrder",
    newValue: { requisitionId: requisicao.id, requisitionCode: requisicao.code, createdOrders: criados, skippedItems: comNomes(ignorados) },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });
  response.status(201).json({ createdOrders: criados, skippedItems: comNomes(ignorados) });
});
