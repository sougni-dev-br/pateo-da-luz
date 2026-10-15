import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";

// Inteligência de preço por fornecedor (histórico de compras dos últimos 24 meses). É a mesma regra do
// apoio ao comprador / planejamento de compra e do pedido gerado a partir da requisição: o fornecedor
// recomendado é o de menor preço histórico, e o preço da unidade vem convertido para a unidade do estoque.

function brDate(date: Date) {
  return date.toISOString().slice(0, 10).split("-").reverse().join("/");
}

function formatMoney(value: unknown) {
  return Number(value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export type SupplierPriceOption = {
  supplierId: string;
  supplierName: string;
  bestUnitPrice: number;
  bestPriceDate: Date;
  lastUnitPrice: number;
  lastPurchaseDate: Date;
  purchaseCount: number;
  unit: string | null;
  conversionMissing: boolean;
};

export type InteligenciaDePreco = ReturnType<Awaited<ReturnType<typeof carregarInteligenciaDePreco>>>;

/**
 * Carrega o histórico de preços dos produtos e devolve a função que monta a leitura de cada um.
 * `apenasFornecedoresAtivos`: o pedido não pode recomendar quem não pode mais receber pedido.
 */
export async function carregarInteligenciaDePreco(reportProductIds: string[], opcoes: { apenasFornecedoresAtivos?: boolean } = {}) {
  // Consulta separada para nao alterar a query principal (regra de negocio preservada).
  // Regra: usar "convertedUnitPrice" quando existir; caso contrario, "unitPrice" como
  // preco bruto e marcar conversionMissing = true (unidades podem nao ser comparaveis).
  const priceRows = reportProductIds.length === 0
    ? []
    : await prisma.$queryRaw<Array<{
        productId: string;
        supplierId: string;
        supplierName: string;
        priceEff: Prisma.Decimal;
        convertedUnitPrice: Prisma.Decimal | null;
        unit: string | null;
        purchaseDate: Date;
      }>>`
      SELECT
        i."productId",
        pur."supplierId",
        s."name" AS "supplierName",
        COALESCE(i."convertedUnitPrice", i."unitPrice") AS "priceEff",
        i."convertedUnitPrice",
        COALESCE(i."convertedUnit", i."unit") AS "unit",
        pur."purchaseDate"
      FROM "PurchaseItem" i
      JOIN "Purchase" pur ON pur."id" = i."purchaseId"
      JOIN "Supplier" s ON s."id" = pur."supplierId"${opcoes.apenasFornecedoresAtivos ? Prisma.sql` AND s."isActive" = true` : Prisma.empty}
      WHERE i."productId" = ANY(${reportProductIds})
        AND pur."status" <> 'CANCELLED'
        AND pur."purchaseDate" >= NOW() - INTERVAL '24 months'
        AND COALESCE(i."convertedUnitPrice", i."unitPrice") > 0
      ORDER BY pur."purchaseDate" ASC, pur."createdAt" ASC
    `;

  const priceByProduct = new Map<string, { bySupplier: Map<string, SupplierPriceOption>; lastRow: { supplierId: string; supplierName: string; price: number; date: Date; unit: string | null } | null }>();
  for (const pr of priceRows) {
    const price = Number(pr.priceEff);
    if (!Number.isFinite(price) || price <= 0) continue;
    const missing = pr.convertedUnitPrice == null;
    const entry = priceByProduct.get(pr.productId) ?? { bySupplier: new Map<string, SupplierPriceOption>(), lastRow: null };
    const opt = entry.bySupplier.get(pr.supplierId);
    if (!opt) {
      entry.bySupplier.set(pr.supplierId, {
        supplierId: pr.supplierId,
        supplierName: pr.supplierName,
        bestUnitPrice: price,
        bestPriceDate: pr.purchaseDate,
        lastUnitPrice: price,
        lastPurchaseDate: pr.purchaseDate,
        purchaseCount: 1,
        unit: pr.unit,
        conversionMissing: missing
      });
    } else {
      opt.purchaseCount += 1;
      if (price < opt.bestUnitPrice) {
        opt.bestUnitPrice = price;
        opt.bestPriceDate = pr.purchaseDate;
      }
      if (pr.purchaseDate > opt.lastPurchaseDate) {
        opt.lastUnitPrice = price;
        opt.lastPurchaseDate = pr.purchaseDate;
        opt.unit = pr.unit;
      }
      if (missing) opt.conversionMissing = true;
    }
    if (!entry.lastRow || pr.purchaseDate > entry.lastRow.date) {
      entry.lastRow = { supplierId: pr.supplierId, supplierName: pr.supplierName, price, date: pr.purchaseDate, unit: pr.unit };
    }
    priceByProduct.set(pr.productId, entry);
  }

  function derivePriceIntel(productId: string, preferredSupplierId: string | null, preferredSupplierName: string | null) {
    const empty = {
      supplierPriceOptions: [] as SupplierPriceOption[],
      bestPriceSupplierId: null as string | null,
      bestPriceSupplierName: null as string | null,
      bestUnitPrice: null as number | null,
      bestPriceDate: null as Date | null,
      lastPurchaseSupplierId: null as string | null,
      lastPurchaseSupplierName: null as string | null,
      lastUnitPrice: null as number | null,
      lastPurchaseDate: null as Date | null,
      preferredSupplierId,
      preferredSupplierName,
      hasCheaperAlternative: false,
      priceComparisonNote: null as string | null,
      conversionMissing: false
    };
    const entry = priceByProduct.get(productId);
    if (!entry || entry.bySupplier.size === 0) return empty;
    const options = Array.from(entry.bySupplier.values()).sort((a, b) => a.bestUnitPrice - b.bestUnitPrice);
    const best = options[0];
    const last = entry.lastRow;
    const conversionMissing = options.some((option) => option.conversionMissing);
    const preferredOption = preferredSupplierId ? entry.bySupplier.get(preferredSupplierId) ?? null : null;
    const referenceSupplierId = preferredSupplierId ?? last?.supplierId ?? null;
    const referencePrice = preferredOption ? preferredOption.bestUnitPrice : last?.price ?? null;
    const referenceUnit = preferredOption ? preferredOption.unit : last?.unit ?? null;
    // So afirmar "mais barato" quando menor preco e referencia estao na MESMA unidade.
    // Com convertedUnitPrice ausente, precos em unidades diferentes nao sao comparaveis;
    // nesses casos o payload ainda expoe supplierPriceOptions + conversionMissing para a UI decidir.
    const normalizeUnit = (unit: string | null) => (unit ? unit.trim().toUpperCase() : null);
    const sameUnit = normalizeUnit(best.unit) != null && normalizeUnit(best.unit) === normalizeUnit(referenceUnit);
    const hasCheaperAlternative = Boolean(
      best && referencePrice != null && referenceSupplierId != null &&
      best.supplierId !== referenceSupplierId && best.bestUnitPrice < referencePrice && sameUnit
    );
    const priceComparisonNote = hasCheaperAlternative
      ? `Menor preço histórico: ${best.supplierName} — ${formatMoney(best.bestUnitPrice)} em ${brDate(best.bestPriceDate)}`
      : null;
    return {
      supplierPriceOptions: options,
      bestPriceSupplierId: best.supplierId,
      bestPriceSupplierName: best.supplierName,
      bestUnitPrice: best.bestUnitPrice,
      bestPriceDate: best.bestPriceDate,
      lastPurchaseSupplierId: last?.supplierId ?? null,
      lastPurchaseSupplierName: last?.supplierName ?? null,
      lastUnitPrice: last?.price ?? null,
      lastPurchaseDate: last?.date ?? null,
      preferredSupplierId,
      preferredSupplierName,
      hasCheaperAlternative,
      priceComparisonNote,
      conversionMissing
    };
  }


  return derivePriceIntel;
}
