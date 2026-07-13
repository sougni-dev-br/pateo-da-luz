import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function logGroup(title: string, contains: string[]) {
  const rows = await prisma.product.findMany({
    where: {
      isActive: true,
      OR: contains.map((term) => ({
        name: { contains: term, mode: "insensitive" as const },
      })),
    },
    select: {
      externalCode: true,
      name: true,
      controlsStock: true,
      inventorySector: { select: { name: true } },
      category: { select: { name: true } },
      subcategory: { select: { name: true } },
      dreCategory: { select: { name: true, dreGroup: true } },
    },
    orderBy: [{ name: "asc" }],
  });

  console.log("");
  console.log(title);
  console.log("=".repeat(title.length));
  for (const row of rows) {
    console.log(
      `${row.externalCode ?? "-"} | ${row.name} | estoque=${row.controlsStock ? "sim" : "nao"} | ` +
      `setor=${row.inventorySector?.name ?? "-"} | categoria=${row.category?.name ?? "-"} | ` +
      `subcategoria=${row.subcategory?.name ?? "-"} | dre=${row.dreCategory?.name ?? "-"} | grupo=${row.dreCategory?.dreGroup ?? "-"}`,
    );
  }
}

async function main() {
  await logGroup("PAES E BRIOCHE", ["BRIOCHE", "PAO", "PÃO"]);
  await logGroup("SALGADINHOS E SNACKS", ["DORITOS", "BISCOITO", "SALGAD", "SNACK"]);
  await logGroup("MERENGUE E REFRESCOS", ["MERENGUE", "TANG", "REFRESCO", "XAROPE", "SUCO"]);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
