import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.product.findMany({
    where: {
      isActive: true,
      dreCategory: {
        name: { in: ["Material de Limpeza", "Descartáveis"] },
      },
    },
    select: {
      externalCode: true,
      name: true,
      controlsStock: true,
      inventorySector: { select: { name: true } },
      dreCategory: { select: { name: true, dreGroup: true } },
    },
    orderBy: [{ dreCategory: { name: "asc" } }, { name: "asc" }],
  });

  console.log("");
  console.log("SETORES CATEGORIAS GERENCIAIS");
  console.log("=============================");
  for (const row of rows) {
    console.log(
      `${row.externalCode ?? "-"} | ${row.name} | estoque=${row.controlsStock ? "sim" : "nao"} | ` +
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
