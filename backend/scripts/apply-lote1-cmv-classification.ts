import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Assignment = {
  externalCode: string;
  categoryName: string;
  sectorName: string;
};

const assignments: Assignment[] = [
  {
    externalCode: "1197",
    categoryName: "Descartáveis / Delivery",
    sectorName: "Corredores",
  },
  {
    externalCode: "1196",
    categoryName: "Descartáveis / Delivery",
    sectorName: "Corredores",
  },
  {
    externalCode: "1200",
    categoryName: "Bebidas",
    sectorName: "Bar",
  },
  {
    externalCode: "1198",
    categoryName: "Custo de Alimentos",
    sectorName: "Freezer",
  },
  {
    externalCode: "1203",
    categoryName: "Material de Limpeza",
    sectorName: "Corredores",
  },
  {
    externalCode: "1199",
    categoryName: "Custo de Alimentos",
    sectorName: "Estoque",
  },
  {
    externalCode: "1204",
    categoryName: "Custo de Alimentos",
    sectorName: "Estoque",
  },
];

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

async function main() {
  const categoryNames = [...new Set(assignments.map((item) => item.categoryName))];
  const sectorNames = [...new Set(assignments.map((item) => item.sectorName))];

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
  const sectorByNormalizedName = new Map(
    sectors.map((item) => [item.normalizedName, item]),
  );

  for (const assignment of assignments) {
    if (!categoryByName.has(assignment.categoryName)) {
      throw new Error(`Categoria DRE não encontrada: ${assignment.categoryName}`);
    }
    if (!sectorByNormalizedName.has(normalizeName(assignment.sectorName))) {
      throw new Error(`Setor não encontrado: ${assignment.sectorName}`);
    }
  }

  const updates = await prisma.$transaction(
    assignments.map((assignment) => {
      const category = categoryByName.get(assignment.categoryName)!;
      const sector = sectorByNormalizedName.get(normalizeName(assignment.sectorName))!;

      return prisma.product.update({
        where: { externalCode: assignment.externalCode },
        data: {
          dreCategoryId: category.id,
          inventorySectorId: sector.id,
        },
        select: {
          externalCode: true,
          name: true,
          controlsStock: true,
          dreCategory: {
            select: {
              name: true,
              dreGroup: true,
            },
          },
          inventorySector: {
            select: {
              name: true,
            },
          },
        },
      });
    }),
  );

  console.log("");
  console.log("LOTE 1 CMV APLICADO");
  console.log("===================");
  for (const row of updates) {
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
