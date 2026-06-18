import { Router } from "express";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { normalizeText } from "../../shared/utils/normalize-text.js";
import { auditLog, requestIp, requireRole } from "../security/security-utils.js";
import { OFFICIAL_INVENTORY_SECTORS, officialInventorySectorName } from "../master-data/inventory-sector-utils.js";

export const productRouter = Router();

type ProductConversionPayload = {
  id?: string;
  fromUnit?: string | null;
  toUnit?: string | null;
  factor?: string | number | null;
  averagePackageWeight?: string | number | null;
  notes?: string | null;
  isActive?: boolean;
};

function asText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function parseDecimalInput(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).replace(/\./g, "").replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function normalizeUnit(value: unknown): string | null {
  const text = asText(value);
  return text ? text.toUpperCase() : null;
}

async function hydrateProductConversionFields<T extends { id: string }>(products: T[]) {
  if (products.length === 0) return [];

  const ids = products.map((product) => product.id);
  const [details, conversions] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        id: string;
        stockUnit: string | null;
        purchaseUnit: string | null;
        baseUnit: string | null;
        conversionFactor: string | null;
        packageWeight: string | null;
        conversionNotes: string | null;
        logisticsNotes: string | null;
        storageLocation: string | null;
        storageCorridor: string | null;
        storageShelf: string | null;
        storagePosition: string | null;
        storageNotes: string | null;
        estoqueMinimo: string | null;
        estoqueIdeal: string | null;
        leadTimeCompraDias: number | null;
        fornecedorPrincipalId: string | null;
      }>
    >`
      SELECT
        "id",
        "stockUnit",
        "purchaseUnit",
        "baseUnit",
        "conversionFactor"::text AS "conversionFactor",
        "packageWeight"::text AS "packageWeight",
        "conversionNotes",
        "logisticsNotes",
        "storageLocation",
        "storageCorridor",
        "storageShelf",
        "storagePosition",
        "storageNotes",
        "estoqueMinimo"::text AS "estoqueMinimo",
        "estoqueIdeal"::text AS "estoqueIdeal",
        "leadTimeCompraDias",
        "fornecedorPrincipalId"
      FROM "Product"
      WHERE "id" IN (${Prisma.join(ids)})
    `,
    prisma.$queryRaw<
      Array<{
        id: string;
        productId: string;
        fromUnit: string;
        toUnit: string;
        factor: string;
        averagePackageWeight: string | null;
        notes: string | null;
        isActive: boolean;
      }>
    >`
      SELECT
        "id",
        "productId",
        "fromUnit",
        "toUnit",
        "factor"::text AS "factor",
        "averagePackageWeight"::text AS "averagePackageWeight",
        "notes",
        "isActive"
      FROM "ProductUnitConversion"
      WHERE "productId" IN (${Prisma.join(ids)})
      ORDER BY "fromUnit" ASC, "toUnit" ASC
    `
  ]);

  const detailById = new Map(details.map((detail) => [detail.id, detail]));
  const conversionsByProduct = new Map<string, typeof conversions>();
  for (const conversion of conversions) {
    const current = conversionsByProduct.get(conversion.productId) ?? [];
    current.push(conversion);
    conversionsByProduct.set(conversion.productId, current);
  }

  return products.map((product) => ({
    ...product,
    ...(detailById.get(product.id) ?? {}),
    unitConversions: conversionsByProduct.get(product.id) ?? []
  }));
}

async function updateProductConversionDefaults(productId: string, body: Record<string, unknown>) {
  const stockUnit = normalizeUnit(body.stockUnit ?? body.baseUnit);
  const purchaseUnit = normalizeUnit(body.purchaseUnit ?? body.unit);
  const baseUnit = normalizeUnit(body.baseUnit);
  const conversionFactor = parseDecimalInput(body.conversionFactor);
  const packageWeight = parseDecimalInput(body.packageWeight);
  const conversionNotes = asText(body.conversionNotes);
  const logisticsNotes = asText(body.logisticsNotes);
  const storageLocation = asText(body.storageLocation);
  const storageCorridor = asText(body.storageCorridor);
  const storageShelf = asText(body.storageShelf);
  const storagePosition = asText(body.storagePosition);
  const storageNotes = asText(body.storageNotes);

  await prisma.$executeRaw`
    UPDATE "Product"
    SET
      "stockUnit" = ${stockUnit},
      "purchaseUnit" = ${purchaseUnit},
      "baseUnit" = ${baseUnit},
      "conversionFactor" = ${conversionFactor},
      "packageWeight" = ${packageWeight},
      "conversionNotes" = ${conversionNotes},
      "logisticsNotes" = ${logisticsNotes},
      "storageLocation" = ${storageLocation},
      "storageCorridor" = ${storageCorridor},
      "storageShelf" = ${storageShelf},
      "storagePosition" = ${storagePosition},
      "storageNotes" = ${storageNotes}
    WHERE "id" = ${productId}
  `;
}

async function syncProductPurchaseParameters(productId: string, body: Record<string, unknown>) {
  const estoqueMinimo = parseDecimalInput(body.estoqueMinimo);
  const estoqueIdeal = parseDecimalInput(body.estoqueIdeal);
  const leadTimeCompraDias = body.leadTimeCompraDias === "" || body.leadTimeCompraDias == null ? null : Number(body.leadTimeCompraDias);
  const fornecedorPrincipalId = asText(body.fornecedorPrincipalId);

  await prisma.$executeRaw`
    UPDATE "Product"
    SET
      "estoqueMinimo" = ${estoqueMinimo},
      "estoqueIdeal" = ${estoqueIdeal},
      "leadTimeCompraDias" = ${Number.isFinite(leadTimeCompraDias) ? leadTimeCompraDias : null},
      "fornecedorPrincipalId" = ${fornecedorPrincipalId}
    WHERE "id" = ${productId}
  `;

  await prisma.$executeRaw`
    UPDATE "InventoryStock"
    SET "minQuantity" = ${estoqueMinimo}, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "productId" = ${productId}
  `;
}

async function replaceProductUnitConversions(productId: string, conversions: ProductConversionPayload[] = []) {
  await prisma.$executeRaw`DELETE FROM "ProductUnitConversion" WHERE "productId" = ${productId}`;

  for (const conversion of conversions) {
    const fromUnit = normalizeUnit(conversion.fromUnit);
    const toUnit = normalizeUnit(conversion.toUnit);
    const factor = parseDecimalInput(conversion.factor);
    if (!fromUnit || !toUnit || !factor || factor <= 0) continue;

    await prisma.$executeRaw`
      INSERT INTO "ProductUnitConversion"
        ("id", "productId", "fromUnit", "toUnit", "factor", "averagePackageWeight", "notes", "isActive", "updatedAt")
      VALUES
        (${crypto.randomUUID()}, ${productId}, ${fromUnit}, ${toUnit}, ${factor},
         ${parseDecimalInput(conversion.averagePackageWeight)}, ${asText(conversion.notes)},
         ${conversion.isActive ?? true}, CURRENT_TIMESTAMP)
    `;
  }
}

async function findOrCreateCategory(name?: string | null) {
  const cleanName = String(name ?? "").trim();
  if (!cleanName) return null;

  return prisma.category.upsert({
    where: { name: cleanName },
    create: { name: cleanName },
    update: {}
  });
}

async function findOrCreateSubcategory(name?: string | null, categoryId?: string) {
  const cleanName = String(name ?? "").trim();
  if (!cleanName || !categoryId) return null;

  return prisma.subcategory.upsert({
    where: { categoryId_name: { categoryId, name: cleanName } },
    create: { categoryId, name: cleanName },
    update: {}
  });
}

async function findOrCreateSector(name?: string | null) {
  const cleanName = officialInventorySectorName(name);
  if (!cleanName) return null;
  const [sector] = await prisma.$queryRaw<Array<{ id: string; name: string; normalizedName: string }>>`
    INSERT INTO "InventorySector" ("id", "name", "normalizedName", "updatedAt")
    VALUES (${crypto.randomUUID()}, ${cleanName}, ${normalizeText(cleanName)}, CURRENT_TIMESTAMP)
    ON CONFLICT ("normalizedName") DO UPDATE SET
      "name" = EXCLUDED."name",
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "id", "name", "normalizedName"
  `;
  return sector;
}

async function nextProductCode() {
  const [row] = await prisma.$queryRaw<Array<{ nextSequence: bigint | number | null }>>`
    SELECT COALESCE(MAX("externalCode"::int), 0) + 1 AS "nextSequence"
    FROM "Product"
    WHERE "externalCode" ~ '^[0-9]+$'
  `;
  return String(Number(row?.nextSequence ?? 1)).padStart(6, "0");
}

async function ensureUniqueProductCode() {
  let code = await nextProductCode();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const existing = await prisma.product.findFirst({ where: { externalCode: code }, select: { id: true } });
    if (!existing) return code;
    code = String(Number(code) + 1).padStart(6, "0");
  }
  throw new Error("Nao foi possivel gerar codigo automatico do produto.");
}

async function unitCodeFromId(unitMeasureId?: unknown) {
  const id = asText(unitMeasureId);
  if (!id) return null;
  const unit = await prisma.unitMeasure.findFirst({ where: { id, isActive: true }, select: { id: true, code: true } });
  return unit ? { id: unit.id, code: unit.code.toUpperCase() } : null;
}

const beverageAdegaTerms = [
  "VINHO",
  "ESPUMANTE",
  "SAQUE",
  "LICOR",
  "WHISKY",
  "VODKA",
  "GIN",
  "RUM",
  "CACHACA",
  "TEQUILA",
  "VERMUTE",
  "APEROL",
  "CAMPARI"
];

const beverageBarTerms = [
  "CERVEJA",
  "CHOPP"
];

function productAuditSectorSuggestion(productName: string) {
  const normalizedName = normalizeText(productName);
  if (["taca", "caneca", "copo"].some((term) => normalizedName.includes(term))) return null;
  const tokens = new Set(normalizedName.split(" "));
  const hasTerm = (term: string) => {
    const normalizedTerm = normalizeText(term);
    if (normalizedTerm.includes(" ")) return normalizedName.includes(normalizedTerm);
    return tokens.has(normalizedTerm);
  };
  if (beverageAdegaTerms.some((term) => hasTerm(term))) return "ADEGA";
  if (beverageBarTerms.some((term) => hasTerm(term))) return "BAR";
  return null;
}

productRouter.get("/next-code", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;
  response.json({ code: await nextProductCode() });
});

productRouter.get("/", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA", "VISUALIZACAO"]);
  if (!user) return;

  const search = request.query.search ? normalizeText(String(request.query.search)) : undefined;
  const category = request.query.category ? String(request.query.category) : undefined;
  const sector = request.query.sector ? String(request.query.sector) : undefined;
  const controlsStock = request.query.controlsStock ? String(request.query.controlsStock) === "true" : undefined;
  const isActive = request.query.isActive == null ? undefined : String(request.query.isActive) === "true";
  const semDreCategoria = request.query.semDreCategoria === "true";

  const where: Prisma.ProductWhereInput = {
    ...(search
      ? {
          OR: [
            { externalCode: { contains: String(request.query.search), mode: "insensitive" } },
            { normalizedName: { contains: search, mode: "insensitive" } },
            { name: { contains: String(request.query.search), mode: "insensitive" } }
          ]
        }
      : {}),
    ...(category ? { category: { name: category } } : {}),
    ...(sector ? { inventorySector: { name: sector } } : {}),
    ...(controlsStock === undefined ? {} : { controlsStock }),
    ...(isActive === undefined ? {} : { isActive }),
    ...(semDreCategoria ? { dreCategoryId: null } : {})
  };

  const products = await prisma.product.findMany({
    where,
    include: { category: true, subcategory: true, inventorySector: true, aliases: true, dreCategory: true },
    orderBy: { name: "asc" }
  });
  response.json(await hydrateProductConversionFields(products));
});

productRouter.get("/audit/inventory-integrity", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const [products, countSessionItems] = await Promise.all([
    prisma.product.findMany({
      include: {
        inventorySector: true,
        category: true,
        subcategory: true
      },
      orderBy: [{ name: "asc" }]
    }),
    prisma.stockCountSessionItem.findMany({
      select: { productId: true }
    })
  ]);

  const officialSectors = new Set(OFFICIAL_INVENTORY_SECTORS.map((sector) => normalizeText(sector)));
  const countedProductIds = new Set(countSessionItems.map((item) => item.productId).filter(Boolean));
  const activeProducts = products.filter((product) => product.isActive !== false);
  const controlledProducts = products.filter((product) => product.controlsStock === true);
  const activeControlledProducts = products.filter((product) => product.isActive !== false && product.controlsStock === true);
  const productsWithoutSector = products.filter((product) => !product.inventorySector?.name);
  const productsInInvalidSectors = products.filter((product) => {
    const sectorName = product.inventorySector?.name ? normalizeText(product.inventorySector.name) : "";
    return sectorName && !officialSectors.has(sectorName);
  });
  const activeControlledWithoutCount = activeControlledProducts.filter((product) => !countedProductIds.has(product.id));
  const beverageLikeOutsideAdegaBar = products.filter((product) => {
    const suggestedSector = productAuditSectorSuggestion(product.name);
    const currentSector = normalizeText(product.inventorySector?.name ?? "");
    return Boolean(suggestedSector) && !["adega", "bar"].includes(currentSector);
  });
  const suggestions = products
    .map((product) => {
      const targetSectorName = productAuditSectorSuggestion(product.name);
      if (!targetSectorName) return null;
      const currentSectorName = officialInventorySectorName(product.inventorySector?.name);
      if (currentSectorName && ["ADEGA", "BAR"].includes(currentSectorName)) return null;
      if (currentSectorName === targetSectorName) return null;
      return {
        productId: product.id,
        externalCode: product.externalCode,
        productName: product.name,
        currentSectorName: product.inventorySector?.name ?? null,
        targetSectorName,
        reason: `Classificacao sugerida por nome do produto (${targetSectorName}).`
      };
    })
    .filter(Boolean);

  response.json({
    generatedAt: new Date().toISOString(),
    totals: {
      realProducts: products.length,
      dashboardProducts: products.length,
      activeProducts: activeProducts.length,
      controlsStockTrue: controlledProducts.length,
      activeControlsStockTrue: activeControlledProducts.length,
      productsAppearingInCounting: countedProductIds.size,
      activeControlledMissingFromCounting: activeControlledWithoutCount.length,
      productsWithoutSector: productsWithoutSector.length,
      productsInInvalidSectors: productsInInvalidSectors.length,
      beverageLikeOutsideAdegaBar: beverageLikeOutsideAdegaBar.length
    },
    sectorsOfActiveControlled: activeControlledProducts.reduce<Array<{ sectorName: string; count: number }>>((rows, product) => {
      const sectorName = product.inventorySector?.name ?? "Sem setor";
      const current = rows.find((entry) => entry.sectorName === sectorName);
      if (current) current.count += 1;
      else rows.push({ sectorName, count: 1 });
      return rows;
    }, []).sort((left, right) => right.count - left.count || left.sectorName.localeCompare(right.sectorName)),
    productsWithoutSector: productsWithoutSector.map((product) => ({
      id: product.id,
      externalCode: product.externalCode,
      name: product.name,
      controlsStock: product.controlsStock,
      isActive: product.isActive
    })),
    productsInInvalidSectors: productsInInvalidSectors.map((product) => ({
      id: product.id,
      externalCode: product.externalCode,
      name: product.name,
      sectorName: product.inventorySector?.name ?? null,
      controlsStock: product.controlsStock,
      isActive: product.isActive
    })),
    activeControlledWithoutCount: activeControlledWithoutCount.map((product) => ({
      id: product.id,
      externalCode: product.externalCode,
      name: product.name,
      sectorName: product.inventorySector?.name ?? null
    })),
    beverageLikeOutsideAdegaBar: beverageLikeOutsideAdegaBar.map((product) => ({
      id: product.id,
      externalCode: product.externalCode,
      name: product.name,
      sectorName: product.inventorySector?.name ?? null,
      suggestedSectorName: productAuditSectorSuggestion(product.name)
    })),
    focusedChecks: {
      vinhoBrancoSecoRandon46L: products
        .filter((product) => normalizeText(product.name).includes(normalizeText("VINHO BRANCO SECO RANDON")))
        .map((product) => ({
          id: product.id,
          externalCode: product.externalCode,
          name: product.name,
          sectorName: product.inventorySector?.name ?? null,
          controlsStock: product.controlsStock,
          isActive: product.isActive
        }))
    },
    suggestions
  });
});

productRouter.post("/audit/inventory-integrity/apply", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const suggestions = Array.isArray(request.body?.suggestions) ? request.body.suggestions : [];
  if (suggestions.length === 0) {
    response.status(400).json({ message: "Informe ao menos uma sugestao para aplicar." });
    return;
  }

  const uniqueTargets = new Map<string, { targetSectorName: string }>();
  for (const suggestion of suggestions) {
    const targetSectorName = officialInventorySectorName(suggestion?.targetSectorName);
    if (!suggestion?.productId || !targetSectorName) {
      response.status(400).json({ message: "Sugestao invalida. Revise productId e targetSectorName." });
      return;
    }
    uniqueTargets.set(String(suggestion.productId), { targetSectorName });
  }

  const sectorByName = new Map<string, { id: string; name: string }>();
  for (const name of new Set([...uniqueTargets.values()].map((item) => item.targetSectorName))) {
    const sector = await findOrCreateSector(name);
    if (!sector) {
      response.status(400).json({ message: `Setor oficial invalido: ${name}` });
      return;
    }
    sectorByName.set(name, sector);
  }

  const productIds = [...uniqueTargets.keys()];
  const currentProducts = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: { inventorySector: true }
  });
  const currentById = new Map(currentProducts.map((product) => [product.id, product]));

  const applied = [];
  for (const [productId, suggestion] of uniqueTargets.entries()) {
    const current = currentById.get(productId);
    const sector = sectorByName.get(suggestion.targetSectorName);
    if (!current || !sector) continue;
    if (current.inventorySectorId === sector.id) continue;

    await prisma.product.update({
      where: { id: productId },
      data: { inventorySectorId: sector.id }
    });

    applied.push({
      productId,
      externalCode: current.externalCode,
      productName: current.name,
      previousSectorName: current.inventorySector?.name ?? null,
      targetSectorName: sector.name
    });
  }

  await auditLog({
    userId: user.id,
    action: "APPLY_PRODUCT_INVENTORY_INTEGRITY_SUGGESTIONS",
    entity: "Product",
    entityId: null,
    previousValue: { requestedSuggestions: suggestions.length },
    newValue: { appliedCount: applied.length, applied },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.json({
    appliedCount: applied.length,
    applied
  });
});

// Deve ficar ANTES de qualquer rota /:id para não ser capturado pelo param
productRouter.patch("/bulk-dre", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const { ids, dreCategoryId } = request.body as { ids: string[]; dreCategoryId: string | null };

  if (!Array.isArray(ids) || ids.length === 0) {
    response.status(400).json({ message: "ids deve ser um array não vazio." });
    return;
  }
  if (dreCategoryId !== null && typeof dreCategoryId !== "string") {
    response.status(400).json({ message: "dreCategoryId deve ser uma string ou null." });
    return;
  }

  // Verificar que a categoria existe (quando não for null)
  if (dreCategoryId) {
    const cat = await prisma.dRECategory.findUnique({ where: { id: dreCategoryId } });
    if (!cat) {
      response.status(400).json({ message: "Categoria DRE não encontrada." });
      return;
    }
  }

  const result = await prisma.product.updateMany({
    where: { id: { in: ids } },
    data: { dreCategoryId: dreCategoryId ?? null }
  });

  await auditLog({
    userId: user.id,
    action: "BULK_SET_DRE_CATEGORY",
    entity: "Product",
    entityId: null,
    newValue: { ids, dreCategoryId, updated: result.count },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.json({ ok: true, updated: result.count });
});

productRouter.post("/", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const name = String(request.body.name ?? "").trim();
  if (!name) {
    response.status(400).json({ message: "Descricao do produto obrigatoria." });
    return;
  }
  const externalCode = await ensureUniqueProductCode();
  const unitMeasure = await unitCodeFromId(request.body.unitMeasureId);
  const category = await findOrCreateCategory(request.body.categoryName);
  const subcategory = await findOrCreateSubcategory(request.body.subcategoryName, category?.id);
  const sector = request.body.inventorySectorId ? null : await findOrCreateSector(request.body.sectorName);

  const product = await prisma.product.create({
    data: {
      externalCode,
      name,
      normalizedName: normalizeText(name),
      unit: unitMeasure?.code ?? null,
      unitMeasureId: unitMeasure?.id ?? null,
      accountType: request.body.accountType || null,
      controlsStock: request.body.controlsStock ?? true,
      dreCategoryId: request.body.dreCategoryId || null,
      notes: request.body.notes || null,
      isActive: request.body.isActive ?? true,
      categoryId: category?.id,
      subcategoryId: subcategory?.id,
      inventorySectorId: request.body.inventorySectorId || sector?.id,
      aliases: {
        create: {
          alias: name,
          normalizedAlias: normalizeText(name)
        }
      }
    },
    include: { category: true, subcategory: true, inventorySector: true, aliases: true, dreCategory: true }
  });
  await updateProductConversionDefaults(product.id, request.body);
  await syncProductPurchaseParameters(product.id, request.body);
  await replaceProductUnitConversions(product.id, request.body.unitConversions);
  await auditLog({
    userId: user.id,
    action: "CREATE_PRODUCT",
    entity: "Product",
    entityId: product.id,
    newValue: { ...request.body, externalCode },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.status(201).json((await hydrateProductConversionFields([product]))[0]);
});

productRouter.put("/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const name = String(request.body.name ?? "").trim();
  if (!name) {
    response.status(400).json({ message: "Descricao do produto obrigatoria." });
    return;
  }
  const category = await findOrCreateCategory(request.body.categoryName);
  const subcategory = await findOrCreateSubcategory(request.body.subcategoryName, category?.id);
  const sector = request.body.inventorySectorId ? null : await findOrCreateSector(request.body.sectorName);

  const [previous] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      "id", "inventorySectorId", "categoryId", "subcategoryId", "unit", "accountType", "controlsStock",
      "externalCode", "estoqueMinimo", "estoqueIdeal", "leadTimeCompraDias", "fornecedorPrincipalId",
      "storageLocation", "storageCorridor", "storageShelf", "storagePosition", "storageNotes"
    FROM "Product"
    WHERE "id" = ${request.params.id}
  `;
  if (!previous) {
    response.status(404).json({ message: "Produto nao encontrado." });
    return;
  }
  const incomingCode = asText(request.body.externalCode);
  if (incomingCode && previous.externalCode && incomingCode !== previous.externalCode) {
    await auditLog({
      userId: user.id,
      action: "BLOCK_PRODUCT_CODE_CHANGE",
      entity: "Product",
      entityId: request.params.id,
      previousValue: { externalCode: previous.externalCode },
      newValue: { attemptedExternalCode: incomingCode },
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "")
    });
    response.status(400).json({ message: "Codigo do produto e gerado pelo sistema e nao pode ser alterado." });
    return;
  }
  const persistedExternalCode = previous.externalCode ? String(previous.externalCode) : await ensureUniqueProductCode();
  const unitMeasure = await unitCodeFromId(request.body.unitMeasureId);

  const product = await prisma.product.update({
    where: { id: request.params.id },
    data: {
      externalCode: persistedExternalCode,
      name,
      normalizedName: normalizeText(name),
      unit: unitMeasure?.code ?? null,
      unitMeasureId: unitMeasure?.id ?? null,
      accountType: request.body.accountType || null,
      controlsStock: request.body.controlsStock ?? true,
      dreCategoryId: request.body.dreCategoryId || null,
      notes: request.body.notes || null,
      isActive: request.body.isActive ?? true,
      categoryId: category?.id,
      subcategoryId: subcategory?.id,
      inventorySectorId: request.body.inventorySectorId || sector?.id || null
    },
    include: { category: true, subcategory: true, inventorySector: true, aliases: true, dreCategory: true }
  });

  const locationChanged =
    previous?.storageLocation !== asText(request.body.storageLocation) ||
    previous?.storageCorridor !== asText(request.body.storageCorridor) ||
    previous?.storageShelf !== asText(request.body.storageShelf) ||
    previous?.storagePosition !== asText(request.body.storagePosition) ||
    previous?.storageNotes !== asText(request.body.storageNotes);
  const classificationChanged =
    previous?.inventorySectorId !== product.inventorySectorId ||
    previous?.categoryId !== product.categoryId ||
    previous?.subcategoryId !== product.subcategoryId ||
    locationChanged;

  if (classificationChanged) {
    await prisma.$executeRaw`
      INSERT INTO "AuditLog" ("id", "userId", "action", "entity", "entityId", "previousValue", "newValue")
      VALUES (
        ${crypto.randomUUID()}, ${user.id}, 'RECLASSIFY_PRODUCT', 'Product', ${product.id},
        CAST(${JSON.stringify(previous)} AS jsonb),
        CAST(${JSON.stringify({
          inventorySectorId: product.inventorySectorId,
          categoryId: product.categoryId,
          subcategoryId: product.subcategoryId,
          storageLocation: asText(request.body.storageLocation),
          storageCorridor: asText(request.body.storageCorridor),
          storageShelf: asText(request.body.storageShelf),
          storagePosition: asText(request.body.storagePosition),
          storageNotes: asText(request.body.storageNotes)
        })} AS jsonb)
      )
    `;
  }

  await prisma.productAlias
    .upsert({
      where: { normalizedAlias: normalizeText(name) },
      create: { alias: name, normalizedAlias: normalizeText(name), productId: product.id },
      update: { alias: name, productId: product.id }
    })
    .catch(() => undefined);
  await updateProductConversionDefaults(product.id, request.body);
  const purchaseParamsChanged =
    String(previous?.estoqueMinimo ?? "") !== String(parseDecimalInput(request.body.estoqueMinimo) ?? "") ||
    String(previous?.estoqueIdeal ?? "") !== String(parseDecimalInput(request.body.estoqueIdeal) ?? "") ||
    String(previous?.leadTimeCompraDias ?? "") !== String(request.body.leadTimeCompraDias ?? "") ||
    String(previous?.fornecedorPrincipalId ?? "") !== String(asText(request.body.fornecedorPrincipalId) ?? "");
  await syncProductPurchaseParameters(product.id, request.body);
  if (purchaseParamsChanged) {
    await auditLog({
      userId: user.id,
      action: "UPDATE_PRODUCT_PURCHASE_PARAMETERS",
      entity: "Product",
      entityId: product.id,
      previousValue: {
        estoqueMinimo: previous?.estoqueMinimo,
        estoqueIdeal: previous?.estoqueIdeal,
        leadTimeCompraDias: previous?.leadTimeCompraDias,
        fornecedorPrincipalId: previous?.fornecedorPrincipalId
      },
      newValue: {
        estoqueMinimo: parseDecimalInput(request.body.estoqueMinimo),
        estoqueIdeal: parseDecimalInput(request.body.estoqueIdeal),
        leadTimeCompraDias: request.body.leadTimeCompraDias,
        fornecedorPrincipalId: asText(request.body.fornecedorPrincipalId)
      },
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "")
    });
  }
  await replaceProductUnitConversions(product.id, request.body.unitConversions);
  await auditLog({
    userId: user.id,
    action: "UPDATE_PRODUCT",
    entity: "Product",
    entityId: product.id,
    previousValue: previous,
    newValue: {
      ...request.body,
      externalCode: product.externalCode,
      unitMeasureId: product.unitMeasureId,
      controlsStock: product.controlsStock
    },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.json((await hydrateProductConversionFields([product]))[0]);
});

productRouter.get("/:id/history", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA", "VISUALIZACAO"]);
  if (!user) return;

  const product = await prisma.product.findFirst({
    where: { id: request.params.id },
    include: { category: true, subcategory: true, inventorySector: true }
  });
  if (!product) {
    response.status(404).json({ message: "Produto nao encontrado." });
    return;
  }

  const [counts, purchases, cmvUsage] = await Promise.all([
    prisma.$queryRaw<Array<{
      date: Date;
      inventoryCode: string;
      inventoryType: string;
      inventoryStatus: string;
      countedQuantity: Prisma.Decimal | null;
      notes: string | null;
      itemStatus: string;
    }>>`
      SELECT inv."date", inv."code" AS "inventoryCode", inv."type" AS "inventoryType", inv."status" AS "inventoryStatus",
             item."countedQuantity", item."notes", item."status" AS "itemStatus"
      FROM "OperationalInventoryItem" item
      JOIN "OperationalInventory" inv ON inv."id" = item."inventoryId"
      WHERE item."productId" = ${request.params.id}
      ORDER BY inv."date" DESC, inv."createdAt" DESC
      LIMIT 120
    `,
    prisma.$queryRaw<Array<{
      date: Date;
      supplierName: string;
      quantity: Prisma.Decimal;
      unit: string | null;
      unitPrice: Prisma.Decimal;
      totalPrice: Prisma.Decimal;
      purchaseNumber: string | null;
      invoiceNumber: string | null;
    }>>`
      SELECT pu."purchaseDate" AS "date", s."name" AS "supplierName", item."quantity", item."unit",
             item."unitPrice", item."totalPrice", pu."purchaseNumber", pu."invoiceNumber"
      FROM "PurchaseItem" item
      JOIN "Purchase" pu ON pu."id" = item."purchaseId"
      JOIN "Supplier" s ON s."id" = pu."supplierId"
      WHERE item."productId" = ${request.params.id}
        AND pu."status" <> 'CANCELLED'
      ORDER BY pu."purchaseDate" DESC
      LIMIT 120
    `,
    prisma.$queryRaw<Array<{
      periodCode: string | null;
      startDate: Date;
      endDate: Date;
      initialInventory: string | null;
      finalInventory: string | null;
      initialQuantity: Prisma.Decimal | null;
      finalQuantity: Prisma.Decimal | null;
      purchaseQuantity: Prisma.Decimal | null;
      consumptionEstimated: Prisma.Decimal | null;
      averageDailyConsumption: Prisma.Decimal | null;
      coverageDays: Prisma.Decimal | null;
      variation: Prisma.Decimal | null;
    }>>`
      WITH purchase_period AS (
        SELECT p."id" AS "periodId", SUM(COALESCE(item."convertedQuantity", item."quantity", 0)) AS "purchaseQuantity"
        FROM "CmvPeriod" p
        JOIN "Purchase" purchase ON purchase."purchaseDate" >= p."dataInicial" AND purchase."purchaseDate" <= p."dataFinal"
        JOIN "PurchaseItem" item ON item."purchaseId" = purchase."id" AND item."productId" = ${request.params.id}
        WHERE purchase."status" <> 'CANCELLED'
        GROUP BY p."id"
      )
      SELECT p."code" AS "periodCode", p."dataInicial" AS "startDate", p."dataFinal" AS "endDate",
             i."originalFileName" AS "initialInventory", f."originalFileName" AS "finalInventory",
             ii."quantity" AS "initialQuantity", fi."quantity" AS "finalQuantity",
             COALESCE(pp."purchaseQuantity", 0) AS "purchaseQuantity",
             CASE
              WHEN ii."quantity" IS NOT NULL AND fi."quantity" IS NOT NULL
              THEN ii."quantity" + COALESCE(pp."purchaseQuantity", 0) - fi."quantity"
              ELSE NULL
             END AS "consumptionEstimated",
             CASE
              WHEN ii."quantity" IS NOT NULL AND fi."quantity" IS NOT NULL
              THEN (ii."quantity" + COALESCE(pp."purchaseQuantity", 0) - fi."quantity") / GREATEST(EXTRACT(DAY FROM (p."dataFinal" - p."dataInicial")) + 1, 1)
              ELSE NULL
             END AS "averageDailyConsumption",
             CASE
              WHEN ii."quantity" IS NOT NULL AND fi."quantity" IS NOT NULL
                AND ((ii."quantity" + COALESCE(pp."purchaseQuantity", 0) - fi."quantity") / GREATEST(EXTRACT(DAY FROM (p."dataFinal" - p."dataInicial")) + 1, 1)) > 0
              THEN fi."quantity" / ((ii."quantity" + COALESCE(pp."purchaseQuantity", 0) - fi."quantity") / GREATEST(EXTRACT(DAY FROM (p."dataFinal" - p."dataInicial")) + 1, 1))
              ELSE NULL
             END AS "coverageDays",
             (fi."quantity" - ii."quantity") AS "variation"
      FROM "CmvPeriod" p
      LEFT JOIN "InventorySnapshot" i ON i."id" = p."estoqueInicialSnapshotId"
      LEFT JOIN "InventorySnapshot" f ON f."id" = p."estoqueFinalSnapshotId"
      LEFT JOIN "InventorySnapshotItem" ii ON ii."snapshotId" = i."id" AND ii."productId" = ${request.params.id}
      LEFT JOIN "InventorySnapshotItem" fi ON fi."snapshotId" = f."id" AND fi."productId" = ${request.params.id}
      LEFT JOIN purchase_period pp ON pp."periodId" = p."id"
      WHERE ii."id" IS NOT NULL OR fi."id" IS NOT NULL
      ORDER BY p."dataInicial" DESC
      LIMIT 60
    `
  ]);

  response.json({
    product,
    counts: counts.map((row) => ({
      ...row,
      countedQuantity: row.countedQuantity == null ? null : Number(row.countedQuantity)
    })),
    purchases: purchases.map((row) => ({
      ...row,
      quantity: Number(row.quantity),
      unitPrice: Number(row.unitPrice),
      totalPrice: Number(row.totalPrice)
    })),
    cmvUsage: cmvUsage.map((row) => ({
      ...row,
      initialQuantity: row.initialQuantity == null ? null : Number(row.initialQuantity),
      finalQuantity: row.finalQuantity == null ? null : Number(row.finalQuantity),
      purchaseQuantity: row.purchaseQuantity == null ? null : Number(row.purchaseQuantity),
      consumptionEstimated: row.consumptionEstimated == null ? null : Number(row.consumptionEstimated),
      averageDailyConsumption: row.averageDailyConsumption == null ? null : Number(row.averageDailyConsumption),
      coverageDays: row.coverageDays == null ? null : Number(row.coverageDays),
      variation: row.variation == null ? null : Number(row.variation)
    }))
  });
});

productRouter.post("/:id/aliases", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const alias = String(request.body.alias ?? "").trim();
  const productAlias = await prisma.productAlias.upsert({
    where: { normalizedAlias: normalizeText(alias) },
    create: { alias, normalizedAlias: normalizeText(alias), productId: request.params.id },
    update: { alias, productId: request.params.id }
  });

  response.status(201).json(productAlias);
});

productRouter.patch("/:id/status", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const product = await prisma.product.update({
    where: { id: request.params.id },
    data: { isActive: Boolean(request.body.isActive) },
    include: { category: true, subcategory: true, inventorySector: true, aliases: true, dreCategory: true }
  });
  await auditLog({
    userId: user.id,
    action: Boolean(request.body.isActive) ? "REACTIVATE_PRODUCT" : "INACTIVATE_PRODUCT",
    entity: "Product",
    entityId: product.id,
    newValue: { isActive: product.isActive },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.json(product);
});
