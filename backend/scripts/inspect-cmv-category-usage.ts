import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRaw<
    Array<{
      dreCategoryName: string;
      dreGroup: string;
      activeProducts: bigint;
      stockTrue: bigint;
      stockFalse: bigint;
    }>
  >`
    SELECT
      dc."name" AS "dreCategoryName",
      dc."dreGroup" AS "dreGroup",
      COUNT(*) FILTER (WHERE p."isActive" = true) AS "activeProducts",
      COUNT(*) FILTER (WHERE p."isActive" = true AND p."controlsStock" = true) AS "stockTrue",
      COUNT(*) FILTER (WHERE p."isActive" = true AND p."controlsStock" = false) AS "stockFalse"
    FROM "DRECategory" dc
    LEFT JOIN "Product" p ON p."dreCategoryId" = dc."id"
    WHERE dc."name" IN ('Material de Limpeza', 'Descartáveis', 'Descartáveis / Delivery')
    GROUP BY dc."name", dc."dreGroup"
    ORDER BY dc."name" ASC
  `;

  console.log("");
  console.log("USO DE CATEGORIAS DRE");
  console.log("=====================");
  for (const row of rows) {
    console.log(
      `${row.dreCategoryName} | grupo=${row.dreGroup} | ` +
      `ativos=${Number(row.activeProducts)} | estoque_sim=${Number(row.stockTrue)} | estoque_nao=${Number(row.stockFalse)}`,
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
