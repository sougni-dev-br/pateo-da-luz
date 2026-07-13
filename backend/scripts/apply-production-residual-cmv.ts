import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type DesiredState = {
  externalCode: string;
  categoryName?: string;
  sectorName?: string;
  controlsStock?: boolean;
};

const desiredStates: DesiredState[] = [
  { externalCode: "001196", controlsStock: false },
  { externalCode: "785", controlsStock: true },
  { externalCode: "969", categoryName: "Material de Escritório", controlsStock: false },
  { externalCode: "1034", categoryName: "Custo de Alimentos", controlsStock: true, sectorName: "Estoque" },
  { externalCode: "1059", categoryName: "Descartáveis", controlsStock: false, sectorName: "Corredores" },
  { externalCode: "683", categoryName: "Embalagens", controlsStock: true, sectorName: "Corredores" },
  { externalCode: "946", categoryName: "Descartáveis / Delivery", controlsStock: true, sectorName: "Corredores" },
  { externalCode: "976", categoryName: "Embalagens", controlsStock: true, sectorName: "Corredores" },
];

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

async function main() {
  const categoryNames = [...new Set(desiredStates.map((item) => item.categoryName).filter(Boolean) as string[])];
  const sectorNames = [...new Set(desiredStates.map((item) => item.sectorName).filter(Boolean) as string[])];
  const externalCodes = desiredStates.map((item) => item.externalCode);

  const [products, categories, sectors] = await Promise.all([
    prisma.product.findMany({
      where: { externalCode: { in: externalCodes } },
      select: {
        id: true,
        externalCode: true,
        name: true,
        controlsStock: true,
        dreCategoryId: true,
        inventorySectorId: true,
        dreCategory: { select: { name: true, dreGroup: true } },
        inventorySector: { select: { name: true } },
      },
      orderBy: [{ externalCode: "asc" }],
    }),
    prisma.dRECategory.findMany({
      select: { id: true, name: true },
    }),
    prisma.inventorySector.findMany({
      where: { normalizedName: { in: sectorNames.map(normalizeText) } },
      select: { id: true, name: true, normalizedName: true },
    }),
  ]);

  const productByCode = new Map(products.map((item) => [item.externalCode ?? "", item]));
  const categoryIdByName = new Map(categories.map((item) => [normalizeText(item.name), item.id]));
  const sectorIdByName = new Map(sectors.map((item) => [item.normalizedName, item.id]));

  const missingProducts = externalCodes.filter((code) => !productByCode.has(code));
  if (missingProducts.length > 0) {
    throw new Error(`Produtos nao encontrados: ${missingProducts.join(", ")}`);
  }

  console.log("");
  console.log("RESIDUAL CMV APPLY");
  console.log("==================");

  const operations = desiredStates.map((desired) => {
    const current = productByCode.get(desired.externalCode)!;
    const data: {
      dreCategoryId?: string;
      inventorySectorId?: string;
      controlsStock?: boolean;
    } = {};

    if (desired.categoryName) {
      const categoryId = categoryIdByName.get(normalizeText(desired.categoryName));
      if (!categoryId) {
        throw new Error(`Categoria DRE nao encontrada: ${desired.categoryName}`);
      }
      data.dreCategoryId = categoryId;
    }

    if (desired.sectorName) {
      const sectorId = sectorIdByName.get(normalizeText(desired.sectorName));
      if (!sectorId) {
        throw new Error(`Setor nao encontrado: ${desired.sectorName}`);
      }
      data.inventorySectorId = sectorId;
    }

    if (typeof desired.controlsStock === "boolean") {
      data.controlsStock = desired.controlsStock;
    }

    console.log(
      `${current.externalCode ?? "-"} | ${current.name} | ` +
      `categoria=${current.dreCategory?.name ?? "-"} -> ${desired.categoryName ?? current.dreCategory?.name ?? "-"} | ` +
      `setor=${current.inventorySector?.name ?? "-"} -> ${desired.sectorName ?? current.inventorySector?.name ?? "-"} | ` +
      `estoque=${current.controlsStock ? "sim" : "nao"} -> ${typeof desired.controlsStock === "boolean" ? (desired.controlsStock ? "sim" : "nao") : (current.controlsStock ? "sim" : "nao")}`,
    );

    return prisma.product.update({
      where: { id: current.id },
      data,
    });
  });

  await prisma.$transaction(operations);

  console.log("");
  console.log("Aplicacao concluida.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
