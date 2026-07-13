import { PrismaClient, Prisma } from "@prisma/client";
const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log("=== MANUTENCAO (ExpenseTypeMaster) — quem sao os fornecedores? ===\n");
  const manut = await prisma.$queryRaw<
    Array<{ supplier: string; document: string | null; count: bigint; total: Prisma.Decimal; months: string }>
  >(Prisma.sql`
    SELECT s.name AS supplier, s.document AS document,
      COUNT(p.id) AS count,
      COALESCE(SUM(p."totalAmount"), 0) AS total,
      STRING_AGG(DISTINCT (p."competenceYear" || '-' || LPAD(p."competenceMonth"::text, 2, '0')), ', ' ORDER BY (p."competenceYear" || '-' || LPAD(p."competenceMonth"::text, 2, '0'))) AS months
    FROM "Purchase" p
    JOIN "Supplier" s ON s.id = p."supplierId"
    JOIN "ExpenseTypeMaster" et ON et.id = p."expenseTypeId"
    WHERE p.status = 'ACTIVE' AND et.name = 'MANUTENÇÃO'
    GROUP BY s.name, s.document
    ORDER BY count DESC
  `);
  for (const r of manut) {
    console.log(`  ${r.supplier} (${r.document ?? "-"}) | ${Number(r.count)} compras | R$ ${Number(r.total).toFixed(2)} | meses: ${r.months}`);
  }

  console.log("\n=== ACESSONUTRI (nutricionista) — distribuicao por mes ===\n");
  const nutric = await prisma.$queryRaw<
    Array<{ competenceMonth: number; competenceYear: number; count: bigint; total: Prisma.Decimal; expenseType: string; expenseTypeMaster: string | null }>
  >(Prisma.sql`
    SELECT p."competenceMonth", p."competenceYear",
      COUNT(*) AS count,
      SUM(p."totalAmount") AS total,
      p."expenseType"::text AS "expenseType",
      MAX(et.name) AS "expenseTypeMaster"
    FROM "Purchase" p
    JOIN "Supplier" s ON s.id = p."supplierId"
    LEFT JOIN "ExpenseTypeMaster" et ON et.id = p."expenseTypeId"
    WHERE p.status = 'ACTIVE' AND UPPER(s.name) LIKE '%ACESSONUTRI%'
    GROUP BY p."competenceYear", p."competenceMonth", p."expenseType"
    ORDER BY p."competenceYear" DESC, p."competenceMonth" DESC
  `);
  for (const r of nutric) {
    console.log(`  ${r.competenceYear}-${String(r.competenceMonth).padStart(2, "0")} | ${Number(r.count)} compras | R$ ${Number(r.total).toFixed(2)} | enum=${r.expenseType} | master=${r.expenseTypeMaster ?? "-"}`);
  }

  console.log("\n=== CAFE FUNCIONARIOS e Assinaturas/Licencas — quem sao os fornecedores? ===\n");
  const cafe = await prisma.$queryRaw<
    Array<{ label: string; supplier: string; count: bigint; total: Prisma.Decimal; months: string }>
  >(Prisma.sql`
    SELECT et.name AS label, s.name AS supplier,
      COUNT(p.id) AS count,
      COALESCE(SUM(p."totalAmount"), 0) AS total,
      STRING_AGG(DISTINCT (p."competenceYear" || '-' || LPAD(p."competenceMonth"::text, 2, '0')), ', ' ORDER BY (p."competenceYear" || '-' || LPAD(p."competenceMonth"::text, 2, '0'))) AS months
    FROM "Purchase" p
    JOIN "Supplier" s ON s.id = p."supplierId"
    JOIN "ExpenseTypeMaster" et ON et.id = p."expenseTypeId"
    WHERE p.status = 'ACTIVE' AND et.name IN ('CAFÉ FUNCIONÁRIOS', 'Assinaturas e Licenças', 'MATERIAL DE ESCRITÓRIO', 'UTENSÍLIOS')
    GROUP BY et.name, s.name
    ORDER BY et.name, count DESC
  `);
  for (const r of cafe) {
    console.log(`  [${r.label}] ${r.supplier} | ${Number(r.count)} compras | R$ ${Number(r.total).toFixed(2)} | meses: ${r.months}`);
  }

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
