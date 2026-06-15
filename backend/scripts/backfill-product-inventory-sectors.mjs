import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const dataRoot = "C:/Arquivos testes_Projeto_Eli";
const shouldApply = process.argv.includes("--apply");

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function display(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function cellText(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("text" in value) return String(value.text ?? "");
    if ("richText" in value) return value.richText.map((item) => item.text).join("");
    if ("result" in value) return String(value.result ?? "");
    if ("formula" in value) return String(value.result ?? "");
  }
  return String(value);
}

function workbookPathByPrefix(directory, prefix) {
  const file = fs.readdirSync(directory).find((name) => name.startsWith(prefix) && name.endsWith(".xlsx"));
  if (!file) {
    throw new Error(`Arquivo com prefixo "${prefix}" nao encontrado em ${directory}`);
  }
  return path.join(directory, file);
}

async function readSectorSources() {
  const sources = [];
  const estoqueFile = workbookPathByPrefix(dataRoot, "ESTOQUE");
  sources.push({
    file: estoqueFile,
    sheetStartsWith: "ESTOQUE",
    codeColumn: 1,
    productColumn: 2,
    sectorColumn: 3,
    firstDataRow: 2,
  });

  const countDir = path.join(dataRoot, "Contagem de estoque", "Abril_2026");
  for (const file of fs.readdirSync(countDir).filter((name) => name.endsWith(".xlsx"))) {
    sources.push({
      file: path.join(countDir, file),
      sheetStartsWith: null,
      codeColumn: 1,
      productColumn: 2,
      sectorColumn: 8,
      firstDataRow: 2,
    });
  }

  const byCode = new Map();
  for (const source of sources) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(source.file);
    const worksheet = source.sheetStartsWith
      ? workbook.worksheets.find((sheet) => normalize(sheet.name).startsWith(normalize(source.sheetStartsWith))) ??
        workbook.worksheets[0]
      : workbook.worksheets[0];

    for (let rowNumber = source.firstDataRow; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const code = normalize(cellText(row.getCell(source.codeColumn).value));
      const productName = display(cellText(row.getCell(source.productColumn).value));
      const sectorName = display(cellText(row.getCell(source.sectorColumn).value));
      const sectorKey = normalize(sectorName);
      if (!code || !sectorKey || code === "CODIGO" || code === "CD. PRODUTO") continue;

      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code).push({
        code,
        productName,
        sectorName,
        sectorKey,
        sourceFile: path.basename(source.file),
        sourceSheet: worksheet.name,
        sourceRow: rowNumber,
      });
    }
  }

  return byCode;
}

function pickUniqueSector(product, hits) {
  if (!hits?.length) return { kind: "missing", product };
  const distinct = [...new Map(hits.map((hit) => [hit.sectorKey, hit])).values()];
  if (distinct.length > 1) {
    return { kind: "conflict", product, hits: distinct };
  }
  return { kind: "identified", product, hit: distinct[0] };
}

async function main() {
  const sourceByCode = await readSectorSources();
  const products = await prisma.product.findMany({
    where: { isActive: true, controlsStock: true },
    select: {
      id: true,
      externalCode: true,
      name: true,
      inventorySectorId: true,
      inventorySector: { select: { name: true } },
    },
    orderBy: [{ externalCode: "asc" }, { name: "asc" }],
  });
  const existingSectors = await prisma.inventorySector.findMany({
    select: { id: true, name: true, normalizedName: true, isActive: true },
  });
  const sectorsByKey = new Map(existingSectors.map((sector) => [normalize(sector.name), sector]));

  const missingProducts = products.filter((product) => !product.inventorySectorId);
  const identified = [];
  const missing = [];
  const conflicts = [];

  for (const product of missingProducts) {
    const result = pickUniqueSector(product, sourceByCode.get(normalize(product.externalCode)));
    if (result.kind === "identified") identified.push(result);
    if (result.kind === "missing") missing.push(result.product);
    if (result.kind === "conflict") conflicts.push(result);
  }

  const distinctSectorEntries = [...new Map(identified.map(({ hit }) => [hit.sectorKey, hit.sectorName])).entries()].sort(
    (left, right) => left[1].localeCompare(right[1], "pt-BR"),
  );
  const sectorsToCreate = distinctSectorEntries.filter(([key]) => !sectorsByKey.has(key)).map(([key, name]) => ({ key, name }));
  const sectorsToReuse = distinctSectorEntries
    .filter(([key]) => sectorsByKey.has(key))
    .map(([key, name]) => ({ name, existingName: sectorsByKey.get(key).name }));

  const report = {
    mode: shouldApply ? "apply" : "dry-run",
    totals: {
      activeControlledProducts: products.length,
      withInventorySectorId: products.length - missingProducts.length,
      withoutInventorySectorId: missingProducts.length,
      identifiedFromSources: identified.length,
      stillWithoutSectorSource: missing.length,
      conflicts: conflicts.length,
      distinctIdentifiedSectors: distinctSectorEntries.length,
    },
    sectorsToReuse,
    sectorsToCreate: sectorsToCreate.map((sector) => sector.name),
    examplesIdentified: identified.slice(0, 10).map(({ product, hit }) => ({
      code: product.externalCode,
      product: product.name,
      sector: hit.sectorName,
      source: `${hit.sourceFile} / ${hit.sourceSheet} / linha ${hit.sourceRow}`,
    })),
    examplesMissing: missing.slice(0, 10).map((product) => ({ code: product.externalCode, product: product.name })),
    conflictExamples: conflicts.slice(0, 10).map(({ product, hits }) => ({
      code: product.externalCode,
      product: product.name,
      sectors: hits.map((hit) => `${hit.sectorName} (${hit.sourceFile}:${hit.sourceRow})`),
    })),
  };

  if (conflicts.length > 0) {
    console.log(JSON.stringify(report, null, 2));
    throw new Error("Correcao abortada: existem produtos com setores conflitantes nas fontes.");
  }

  if (!shouldApply) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const sectorIdByKey = new Map(existingSectors.map((sector) => [normalize(sector.name), sector.id]));
    const createdSectors = [];

    for (const sector of sectorsToCreate) {
      const created = await tx.inventorySector.create({
        data: {
          name: sector.name,
          normalizedName: sector.key,
          isActive: true,
          notes: "Criado por backfill a partir das planilhas reais de estoque/contagem.",
        },
        select: { id: true, name: true },
      });
      sectorIdByKey.set(sector.key, created.id);
      createdSectors.push(created.name);
    }

    let updatedProducts = 0;
    for (const { product, hit } of identified) {
      const sectorId = sectorIdByKey.get(hit.sectorKey);
      if (!sectorId) throw new Error(`Setor nao encontrado para ${hit.sectorName}`);
      const updated = await tx.product.updateMany({
        where: { id: product.id, inventorySectorId: null },
        data: { inventorySectorId: sectorId },
      });
      updatedProducts += updated.count;
    }

    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        action: "BACKFILL_PRODUCT_INVENTORY_SECTOR",
        entity: "Product",
        entityId: "bulk",
        previousValue: {
          withoutInventorySectorId: missingProducts.length,
          sourceFiles: [
            "ESTOQUE & APURAÇÃO DO CMV.xlsx",
            "Final_Abril_e_Inicio_de_Maio_30042026.xlsx",
            "Final_Março_e_Inicio_de_abril_02042026.xlsx",
          ],
        },
        newValue: {
          updatedProducts,
          createdSectors,
          reusedSectors: sectorsToReuse.map((sector) => sector.existingName),
          stillWithoutSectorSource: missing.length,
        },
      },
    });

    return { updatedProducts, createdSectors };
  });

  console.log(JSON.stringify({ ...report, applied: result }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
