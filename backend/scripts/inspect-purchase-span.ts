import { PrismaClient, Prisma } from "@prisma/client";
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const span = await prisma.$queryRaw<
    Array<{ minKey: number | null; maxKey: number | null; total: bigint }>
  >(Prisma.sql`
    SELECT
      MIN(p."competenceYear" * 100 + p."competenceMonth")::int AS "minKey",
      MAX(p."competenceYear" * 100 + p."competenceMonth")::int AS "maxKey",
      COUNT(*) AS total
    FROM "Purchase" p
    WHERE p.status = 'ACTIVE'
  `);
  console.log("Purchase span:", span);

  const distribution = await prisma.$queryRaw<
    Array<{ monthKey: number; count: bigint; total: Prisma.Decimal }>
  >(Prisma.sql`
    SELECT
      (p."competenceYear" * 100 + p."competenceMonth")::int AS "monthKey",
      COUNT(*) AS "count",
      COALESCE(SUM(p."totalAmount"), 0) AS "total"
    FROM "Purchase" p
    WHERE p.status = 'ACTIVE'
    GROUP BY "monthKey"
    ORDER BY "monthKey" DESC
  `);
  console.log("\nDistribuicao por mes de competencia:");
  for (const d of distribution) {
    console.log(`  ${d.monthKey}: ${Number(d.count)} compras, R$ ${Number(d.total).toFixed(2)}`);
  }

  const taxSpan = await prisma.$queryRaw<
    Array<{ minDate: Date | null; maxDate: Date | null; total: bigint }>
  >(Prisma.sql`
    SELECT
      MIN(COALESCE(tp."competenceDate", tp."dueDate")) AS "minDate",
      MAX(COALESCE(tp."competenceDate", tp."dueDate")) AS "maxDate",
      COUNT(*) AS total
    FROM "TaxPayment" tp
    WHERE tp."deletedAt" IS NULL
  `);
  console.log("\nTaxPayment span:", taxSpan);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
