import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [missingSectorProducts, beverageProducts] = await Promise.all([
    prisma.product.findMany({
      where: {
        isActive: true,
        controlsStock: true,
        inventorySectorId: null,
      },
      select: {
        externalCode: true,
        name: true,
        category: { select: { name: true } },
        subcategory: { select: { name: true } },
        dreCategory: { select: { name: true, dreGroup: true } },
      },
      orderBy: [{ name: "asc" }],
    }),
    prisma.product.findMany({
      where: {
        isActive: true,
        category: {
          name: "BEBIDAS",
        },
      },
      select: {
        externalCode: true,
        name: true,
        inventorySector: { select: { name: true } },
        subcategory: { select: { name: true } },
        dreCategory: { select: { name: true, dreGroup: true } },
      },
      orderBy: [{ subcategory: { name: "asc" } }, { name: "asc" }],
    }),
  ]);

  console.log("");
  console.log("PRODUTOS CONTROLADOS SEM SETOR");
  console.log("==============================");
  for (const row of missingSectorProducts) {
    console.log(
      `${row.externalCode ?? "-"} | ${row.name} | categoria=${row.category?.name ?? "-"} | ` +
      `subcategoria=${row.subcategory?.name ?? "-"} | dre=${row.dreCategory?.name ?? "-"} | grupo=${row.dreCategory?.dreGroup ?? "-"}`,
    );
  }

  console.log("");
  console.log("BEBIDAS ATIVAS");
  console.log("==============");
  for (const row of beverageProducts) {
    console.log(
      `${row.externalCode ?? "-"} | ${row.name} | setor=${row.inventorySector?.name ?? "-"} | ` +
      `subcategoria=${row.subcategory?.name ?? "-"} | dre=${row.dreCategory?.name ?? "-"} | grupo=${row.dreCategory?.dreGroup ?? "-"}`,
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
