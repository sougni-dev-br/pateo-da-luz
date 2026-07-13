import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const categoryAssignments = [
  { externalCode: "768", categoryName: "Outras Despesas Gerais" },
  { externalCode: "947", categoryName: "Descartáveis" },
];

const stockAssignments = [
  { externalCode: "954", sectorName: "Estoque" },
  { externalCode: "942", sectorName: "Corredores" },
  { externalCode: "793", sectorName: "Estoque" },
  { externalCode: "1074", sectorName: "Estoque" },
  { externalCode: "1076", sectorName: "Estoque" },
];

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

async function main() {
  const categoryNames = [...new Set(categoryAssignments.map((item) => item.categoryName))];
  const sectorNames = [...new Set(stockAssignments.map((item) => item.sectorName))];

  const [categories, sectors] = await Promise.all([
    prisma.dRECategory.findMany({
      where: { name: { in: categoryNames } },
      select: { id: true, name: true, dreGroup: true },
    }),
    prisma.inventorySector.findMany({
      where: { normalizedName: { in: sectorNames.map(normalizeName) } },
      select: { id: true, name: true, normalizedName: true },
    }),
  ]);

  const categoryByName = new Map(categories.map((item) => [item.name, item]));
  const sectorByNormalizedName = new Map(sectors.map((item) => [item.normalizedName, item]));

  for (const assignment of categoryAssignments) {
    if (!categoryByName.has(assignment.categoryName)) {
      throw new Error(`Categoria DRE não encontrada: ${assignment.categoryName}`);
    }
  }

  for (const assignment of stockAssignments) {
    if (!sectorByNormalizedName.has(normalizeName(assignment.sectorName))) {
      throw new Error(`Setor não encontrado: ${assignment.sectorName}`);
    }
  }

  const operations = [
    ...categoryAssignments.map((assignment) => {
      const category = categoryByName.get(assignment.categoryName)!;
      return prisma.product.update({
        where: { externalCode: assignment.externalCode },
        data: {
          dreCategoryId: category.id,
          controlsStock: false,
        },
      });
    }),
    ...stockAssignments.map((assignment) => {
      const sector = sectorByNormalizedName.get(normalizeName(assignment.sectorName))!;
      return prisma.product.update({
        where: { externalCode: assignment.externalCode },
        data: {
          controlsStock: true,
          inventorySectorId: sector.id,
        },
      });
    }),
  ];

  await prisma.$transaction(operations);

  const updatedRows = await prisma.product.findMany({
    where: {
      externalCode: {
        in: [
          ...categoryAssignments.map((item) => item.externalCode),
          ...stockAssignments.map((item) => item.externalCode),
        ],
      },
    },
    select: {
      externalCode: true,
      name: true,
      controlsStock: true,
      dreCategory: { select: { name: true, dreGroup: true } },
      inventorySector: { select: { name: true } },
    },
    orderBy: { externalCode: "asc" },
  });

  console.log("");
  console.log("DECISOES FINAIS CMV APLICADAS");
  console.log("=============================");
  for (const row of updatedRows) {
    console.log(
      `${row.externalCode ?? "-"} | ${row.name} | estoque=${row.controlsStock ? "sim" : "nao"} | ` +
      `categoria=${row.dreCategory?.name ?? "-"} | grupo=${row.dreCategory?.dreGroup ?? "-"} | ` +
      `setor=${row.inventorySector?.name ?? "-"}`,
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
