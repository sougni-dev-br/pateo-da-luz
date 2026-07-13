import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type DesiredState = {
  externalCode: string;
  categoryName?: string;
  sectorName?: string;
  controlsStock?: boolean;
};

const desiredStates: DesiredState[] = [
  { externalCode: "1196", categoryName: "Descartaveis / Delivery", sectorName: "Corredores" },
  { externalCode: "1197", categoryName: "Descartaveis / Delivery", sectorName: "Corredores" },
  { externalCode: "1198", categoryName: "Custo de Alimentos", sectorName: "Freezer" },
  { externalCode: "1199", categoryName: "Custo de Alimentos", sectorName: "Estoque" },
  { externalCode: "1200", categoryName: "Bebidas", sectorName: "Bar" },
  { externalCode: "1203", categoryName: "Material de Limpeza", sectorName: "Corredores", controlsStock: false },
  { externalCode: "1204", categoryName: "Custo de Alimentos", sectorName: "Estoque" },

  { externalCode: "323", controlsStock: false },
  { externalCode: "433", controlsStock: false },
  { externalCode: "434", controlsStock: false },
  { externalCode: "435", controlsStock: false },
  { externalCode: "436", controlsStock: false },
  { externalCode: "437", controlsStock: false },
  { externalCode: "438", controlsStock: false },
  { externalCode: "439", controlsStock: false },
  { externalCode: "440", controlsStock: false },
  { externalCode: "441", controlsStock: false },
  { externalCode: "442", controlsStock: false },
  { externalCode: "443", controlsStock: false },
  { externalCode: "444", controlsStock: false },
  { externalCode: "583", controlsStock: false },
  { externalCode: "647", controlsStock: false },
  { externalCode: "650", controlsStock: false },
  { externalCode: "651", controlsStock: false },
  { externalCode: "652", controlsStock: false },
  { externalCode: "697", controlsStock: false },
  { externalCode: "698", controlsStock: false },
  { externalCode: "699", controlsStock: false },
  { externalCode: "700", controlsStock: false },
  { externalCode: "709", controlsStock: false },
  { externalCode: "715", controlsStock: false },
  { externalCode: "718", controlsStock: false },
  { externalCode: "719", controlsStock: false },
  { externalCode: "758", controlsStock: false },
  { externalCode: "759", controlsStock: false },
  { externalCode: "783", controlsStock: false },
  { externalCode: "788", controlsStock: false },
  { externalCode: "870", sectorName: "Bar" },
  { externalCode: "964", controlsStock: false },
  { externalCode: "965", controlsStock: false },
  { externalCode: "974", controlsStock: false },
  { externalCode: "1022", controlsStock: false },
  { externalCode: "1102", controlsStock: false },
  { externalCode: "1120", controlsStock: false },
  { externalCode: "1190", controlsStock: false },

  { externalCode: "768", categoryName: "Outras Despesas Gerais", controlsStock: false },
  { externalCode: "793", categoryName: "Custo de Alimentos", sectorName: "Estoque", controlsStock: true },
  { externalCode: "942", categoryName: "Embalagens", sectorName: "Corredores", controlsStock: true },
  { externalCode: "947", categoryName: "Descartaveis", controlsStock: false },
  { externalCode: "954", categoryName: "Custo de Alimentos", sectorName: "Estoque", controlsStock: true },
  { externalCode: "1074", categoryName: "Custo de Alimentos", sectorName: "Estoque", controlsStock: true },
  { externalCode: "1076", categoryName: "Custo de Alimentos", sectorName: "Estoque", controlsStock: true },
];

type CurrentRow = {
  id: string;
  externalCode: string | null;
  name: string;
  controlsStock: boolean;
  dreCategoryId: string | null;
  inventorySectorId: string | null;
  dreCategory: { name: string; dreGroup: string } | null;
  inventorySector: { name: string } | null;
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  return {
    apply: args.has("--apply"),
  };
}

function summarizeChanges(current: CurrentRow, desired: DesiredState, categoryIdByName: Map<string, string>, sectorIdByName: Map<string, string>) {
  const changes: string[] = [];

  if (desired.categoryName) {
    const desiredCategoryId = categoryIdByName.get(normalizeText(desired.categoryName));
    if (!desiredCategoryId) {
      throw new Error(`Categoria DRE nao encontrada: ${desired.categoryName}`);
    }
    if (current.dreCategoryId !== desiredCategoryId) {
      changes.push(`categoria: ${current.dreCategory?.name ?? "-"} -> ${desired.categoryName}`);
    }
  }

  if (desired.sectorName) {
    const desiredSectorId = sectorIdByName.get(normalizeText(desired.sectorName));
    if (!desiredSectorId) {
      throw new Error(`Setor nao encontrado: ${desired.sectorName}`);
    }
    if (current.inventorySectorId !== desiredSectorId) {
      changes.push(`setor: ${current.inventorySector?.name ?? "-"} -> ${desired.sectorName}`);
    }
  }

  if (typeof desired.controlsStock === "boolean" && current.controlsStock !== desired.controlsStock) {
    changes.push(`estoque: ${current.controlsStock ? "sim" : "nao"} -> ${desired.controlsStock ? "sim" : "nao"}`);
  }

  return changes;
}

async function main() {
  const { apply } = parseArgs();

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

  const pending = desiredStates
    .map((desired) => {
      const current = productByCode.get(desired.externalCode)!;
      const changes = summarizeChanges(current, desired, categoryIdByName, sectorIdByName);
      return { desired, current, changes };
    })
    .filter((item) => item.changes.length > 0);

  console.log("");
  console.log(apply ? "CMV SANITIZATION APPLY" : "CMV SANITIZATION DRY RUN");
  console.log("========================");
  console.log(`Produtos no pacote: ${desiredStates.length}`);
  console.log(`Produtos com mudanca pendente: ${pending.length}`);

  if (!pending.length) {
    console.log("");
    console.log("Nenhuma alteracao pendente. A base ja esta alinhada com o pacote de saneamento.");
    return;
  }

  console.log("");
  for (const item of pending) {
    console.log(`${item.current.externalCode} | ${item.current.name}`);
    for (const change of item.changes) {
      console.log(`  - ${change}`);
    }
  }

  if (!apply) {
    console.log("");
    console.log("Modo somente leitura. Rode com --apply para gravar.");
    return;
  }

  await prisma.$transaction(
    pending.map(({ desired, current }) => {
      const data: {
        dreCategoryId?: string;
        inventorySectorId?: string;
        controlsStock?: boolean;
      } = {};

      if (desired.categoryName) {
        data.dreCategoryId = categoryIdByName.get(normalizeText(desired.categoryName))!;
      }
      if (desired.sectorName) {
        data.inventorySectorId = sectorIdByName.get(normalizeText(desired.sectorName))!;
      }
      if (typeof desired.controlsStock === "boolean") {
        data.controlsStock = desired.controlsStock;
      }

      return prisma.product.update({
        where: { id: current.id },
        data,
      });
    }),
  );

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
