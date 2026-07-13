import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const disableStockExternalCodes = [
  "323",
  "433",
  "434",
  "435",
  "436",
  "437",
  "438",
  "439",
  "440",
  "441",
  "442",
  "443",
  "444",
  "583",
  "647",
  "650",
  "651",
  "652",
  "697",
  "698",
  "699",
  "700",
  "709",
  "715",
  "718",
  "719",
  "758",
  "759",
  "783",
  "788",
  "964",
  "965",
  "974",
  "1022",
  "1102",
  "1120",
  "1190",
  "1203",
];

async function main() {
  const barSector = await prisma.inventorySector.findUnique({
    where: { normalizedName: "bar" },
    select: { id: true, name: true },
  });

  if (!barSector) {
    throw new Error("Setor 'BAR' não encontrado.");
  }

  const [stockTargets, sakeProduct] = await Promise.all([
    prisma.product.findMany({
      where: {
        isActive: true,
        externalCode: { in: disableStockExternalCodes },
      },
      select: {
        id: true,
        externalCode: true,
        name: true,
        controlsStock: true,
        dreCategory: { select: { name: true, dreGroup: true } },
      },
      orderBy: [{ externalCode: "asc" }],
    }),
    prisma.product.findUnique({
      where: { externalCode: "870" },
      select: {
        id: true,
        externalCode: true,
        name: true,
        inventorySectorId: true,
        inventorySector: { select: { name: true } },
      },
    }),
  ]);

  const foundCodes = new Set(stockTargets.map((row) => row.externalCode).filter(Boolean));
  const missingCodes = disableStockExternalCodes.filter((code) => !foundCodes.has(code));
  if (missingCodes.length > 0) {
    throw new Error(`Produtos não encontrados para desligar estoque: ${missingCodes.join(", ")}`);
  }

  const invalidTargets = stockTargets.filter(
    (row) => row.dreCategory?.dreGroup !== "DESPESAS_GERAIS" || row.dreCategory?.name !== "Material de Limpeza",
  );
  if (invalidTargets.length > 0) {
    throw new Error(
      `Produtos fora do perfil esperado: ${invalidTargets.map((row) => row.externalCode).join(", ")}`,
    );
  }

  if (!sakeProduct) {
    throw new Error("Produto 870 não encontrado.");
  }

  await prisma.$transaction([
    prisma.product.updateMany({
      where: {
        id: { in: stockTargets.map((row) => row.id) },
      },
      data: {
        controlsStock: false,
      },
    }),
    prisma.product.update({
      where: { id: sakeProduct.id },
      data: {
        inventorySectorId: barSector.id,
      },
    }),
  ]);

  const [updatedStockTargets, updatedSakeProduct] = await Promise.all([
    prisma.product.findMany({
      where: {
        id: { in: stockTargets.map((row) => row.id) },
      },
      select: {
        externalCode: true,
        name: true,
        controlsStock: true,
        dreCategory: { select: { name: true, dreGroup: true } },
      },
      orderBy: [{ externalCode: "asc" }],
    }),
    prisma.product.findUnique({
      where: { id: sakeProduct.id },
      select: {
        externalCode: true,
        name: true,
        controlsStock: true,
        inventorySector: { select: { name: true } },
        dreCategory: { select: { name: true, dreGroup: true } },
      },
    }),
  ]);

  console.log("");
  console.log("LOTE 2 OPERACIONAL APLICADO");
  console.log("===========================");
  console.log(`Produtos com estoque desligado: ${updatedStockTargets.length}`);
  for (const row of updatedStockTargets) {
    console.log(
      `${row.externalCode ?? "-"} | ${row.name} | estoque=${row.controlsStock ? "sim" : "nao"} | ` +
      `categoria=${row.dreCategory?.name ?? "-"} | grupo=${row.dreCategory?.dreGroup ?? "-"}`,
    );
  }

  console.log("");
  console.log("SETOR AJUSTADO");
  console.log("==============");
  console.log(
    `${updatedSakeProduct?.externalCode ?? "-"} | ${updatedSakeProduct?.name ?? "-"} | ` +
    `estoque=${updatedSakeProduct?.controlsStock ? "sim" : "nao"} | ` +
    `categoria=${updatedSakeProduct?.dreCategory?.name ?? "-"} | ` +
    `grupo=${updatedSakeProduct?.dreCategory?.dreGroup ?? "-"} | ` +
    `setor=${updatedSakeProduct?.inventorySector?.name ?? "-"}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
