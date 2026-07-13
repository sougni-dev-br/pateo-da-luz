import { PrismaClient, Prisma } from "@prisma/client";
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const rows = await prisma.$queryRaw<
    Array<{ id: string; name: string; document: string | null; mainCategory: string | null; isActive: boolean }>
  >(Prisma.sql`
    SELECT id, name, document, "mainCategory", "isActive"
    FROM "Supplier"
    WHERE UPPER(name) LIKE '%ACS%' OR UPPER(name) LIKE '%REFRIG%' OR UPPER(name) LIKE '%TONINHO%'
    ORDER BY name
  `);
  console.log("Candidatos ACS/REFRIG/TONINHO:");
  for (const r of rows) console.log(`  - ${r.name} | doc=${r.document ?? "-"} | cat=${r.mainCategory ?? "-"} | active=${r.isActive}`);
  if (rows.length === 0) console.log("  (nenhum)");

  const purchases = await prisma.$queryRaw<
    Array<{ supplier: string; competenceYear: number; competenceMonth: number; count: bigint; total: Prisma.Decimal }>
  >(Prisma.sql`
    SELECT s.name AS supplier, p."competenceYear", p."competenceMonth",
      COUNT(*) AS count, SUM(p."totalAmount") AS total
    FROM "Purchase" p
    JOIN "Supplier" s ON s.id = p."supplierId"
    WHERE (UPPER(s.name) LIKE '%ACS%' OR UPPER(s.name) LIKE '%REFRIG%' OR UPPER(s.name) LIKE '%TONINHO%')
      AND p.status = 'ACTIVE'
    GROUP BY s.name, p."competenceYear", p."competenceMonth"
    ORDER BY p."competenceYear" DESC, p."competenceMonth" DESC
  `);
  console.log("\nCompras vinculadas:");
  for (const p of purchases) {
    console.log(`  ${p.supplier} | ${p.competenceYear}-${String(p.competenceMonth).padStart(2, "0")} | ${Number(p.count)} compras | R$ ${Number(p.total).toFixed(2)}`);
  }
  if (purchases.length === 0) console.log("  (nenhuma)");

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
