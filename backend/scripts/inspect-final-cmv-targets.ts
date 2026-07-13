import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const targetCodes = ["768", "947", "954", "942", "793", "1074", "1076"];

async function main() {
  const targets = await prisma.product.findMany({
    where: { externalCode: { in: targetCodes } },
    select: {
      externalCode: true,
      name: true,
      controlsStock: true,
      category: { select: { name: true } },
      subcategory: { select: { name: true } },
      inventorySector: { select: { name: true } },
      dreCategory: { select: { name: true, dreGroup: true } },
    },
    orderBy: { externalCode: "asc" },
  });

  const comparisonProducts = await prisma.product.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: "BRIOCHE", mode: "insensitive" } },
        { name: { contains: "FORMINHA", mode: "insensitive" } },
        { name: { contains: "DORITOS", mode: "insensitive" } },
        { name: { contains: "MERENGUE", mode: "insensitive" } },
        { name: { contains: "TANG", mode: "insensitive" } },
        { name: { contains: "EMBALAG", mode: "insensitive" } },
        { name: { contains: "CO2", mode: "insensitive" } },
        { subcategory: { name: "SALGADINHO" } },
        { subcategory: { name: "EMBALAGEM" } },
        { subcategory: { name: "PADARIA" } },
      ],
    },
    select: {
      externalCode: true,
      name: true,
      controlsStock: true,
      category: { select: { name: true } },
      subcategory: { select: { name: true } },
      inventorySector: { select: { name: true } },
      dreCategory: { select: { name: true, dreGroup: true } },
    },
    orderBy: [{ name: "asc" }],
  });

  console.log("");
  console.log("ALVOS");
  console.log("=====");
  for (const row of targets) {
    console.log(
      `${row.externalCode ?? "-"} | ${row.name} | estoque=${row.controlsStock ? "sim" : "nao"} | ` +
      `categoria=${row.category?.name ?? "-"} | subcategoria=${row.subcategory?.name ?? "-"} | ` +
      `dre=${row.dreCategory?.name ?? "-"} | grupo=${row.dreCategory?.dreGroup ?? "-"} | setor=${row.inventorySector?.name ?? "-"}`,
    );
  }

  console.log("");
  console.log("SEMELHANTES");
  console.log("===========");
  for (const row of comparisonProducts) {
    console.log(
      `${row.externalCode ?? "-"} | ${row.name} | estoque=${row.controlsStock ? "sim" : "nao"} | ` +
      `categoria=${row.category?.name ?? "-"} | subcategoria=${row.subcategory?.name ?? "-"} | ` +
      `dre=${row.dreCategory?.name ?? "-"} | grupo=${row.dreCategory?.dreGroup ?? "-"} | setor=${row.inventorySector?.name ?? "-"}`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
