import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const residualCodes = ["785", "969", "1059", "976", "946", "1034", "683", "001196"];

async function main() {
  const residuals = await prisma.product.findMany({
    where: { externalCode: { in: residualCodes } },
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

  const similar = await prisma.product.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: "PÃO DE FORMA", mode: "insensitive" } },
        { name: { contains: "PÃO DE MILHO", mode: "insensitive" } },
        { name: { contains: "BOBINA", mode: "insensitive" } },
        { name: { contains: "COPO", mode: "insensitive" } },
        { name: { contains: "FORMINHA", mode: "insensitive" } },
        { name: { contains: "PALITO", mode: "insensitive" } },
        { name: { contains: "SACO AMOSTRA", mode: "insensitive" } },
        { name: { contains: "SACO LIXO", mode: "insensitive" } },
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
  console.log("RESIDUOS PRODUCAO");
  console.log("=================");
  for (const row of residuals) {
    console.log(
      `${row.externalCode ?? "-"} | ${row.name} | estoque=${row.controlsStock ? "sim" : "nao"} | ` +
      `categoria=${row.category?.name ?? "-"} | subcategoria=${row.subcategory?.name ?? "-"} | ` +
      `dre=${row.dreCategory?.name ?? "-"} | grupo=${row.dreCategory?.dreGroup ?? "-"} | setor=${row.inventorySector?.name ?? "-"}`,
    );
  }

  console.log("");
  console.log("SEMELHANTES");
  console.log("===========");
  for (const row of similar) {
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
