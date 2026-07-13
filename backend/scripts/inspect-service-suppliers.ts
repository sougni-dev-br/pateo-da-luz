import { PrismaClient, Prisma } from "@prisma/client";
const prisma = new PrismaClient();

const KEYWORDS = [
  "TONINHO", "NUTRIC", "ALUGUEL", "ENERG", "ELETRO", "ELETROP", "AGUA", "SABESP",
  "CONTAD", "FOLHA", "SALARI", "FUNCION", "GAS", "ULTRAG", "COPAG", "CO2",
  "INTERNET", "TIM", "VIVO", "CLARO", "OI", "TELEF",
  "IPTU", "ISS", "DAS", "SIMPLES", "INSS", "FGTS", "IMPOST",
  "MANUTEN", "TÉCNICO", "TECNIC", "SERVIC",
  "MARKET", "IFOOD", "UBER", "RAPPI",
  "ADVOG", "JURID", "CONSULT",
  "SEGURO",
];

async function main(): Promise<void> {
  console.log("Buscando fornecedores por palavras-chave (nutricionista, manutencao, servicos, impostos...):\n");
  for (const k of KEYWORDS) {
    const rows = await prisma.$queryRaw<
      Array<{ id: string; name: string; mainCategory: string | null; document: string | null; totalCount: bigint; totalAmount: Prisma.Decimal | null }>
    >(Prisma.sql`
      SELECT s.id, s.name, s."mainCategory", s.document,
        COUNT(p.id) AS "totalCount",
        COALESCE(SUM(p."totalAmount"), 0) AS "totalAmount"
      FROM "Supplier" s
      LEFT JOIN "Purchase" p ON p."supplierId" = s.id AND p.status = 'ACTIVE'
      WHERE UPPER(s.name) LIKE ${"%" + k + "%"}
      GROUP BY s.id, s.name, s."mainCategory", s.document
      HAVING COUNT(p.id) > 0
      ORDER BY "totalCount" DESC
      LIMIT 5
    `);
    if (rows.length > 0) {
      console.log(`[${k}]`);
      for (const r of rows) {
        console.log(
          `  - ${r.name} (${r.document ?? "-"}) | cat=${r.mainCategory ?? "-"} | ${Number(r.totalCount)} compras | R$ ${Number(r.totalAmount ?? 0).toFixed(2)}`,
        );
      }
    }
  }

  // Contar despesas nao-CMV (Purchase sem PurchaseItem)
  const noItems = await prisma.$queryRaw<Array<{ total: bigint; amount: Prisma.Decimal }>>(Prisma.sql`
    SELECT COUNT(*) AS total, COALESCE(SUM(p."totalAmount"), 0) AS amount
    FROM "Purchase" p
    WHERE p.status = 'ACTIVE'
      AND NOT EXISTS (SELECT 1 FROM "PurchaseItem" pi WHERE pi."purchaseId" = p.id)
  `);
  console.log(`\nPurchases sem items (despesa avulsa/servico): ${Number(noItems[0].total)} | R$ ${Number(noItems[0].amount).toFixed(2)}`);

  // ExpenseTypeMaster mais usados
  const masters = await prisma.$queryRaw<
    Array<{ label: string | null; group: string | null; count: bigint; amount: Prisma.Decimal }>
  >(Prisma.sql`
    SELECT et.name AS label, et."group" AS group, COUNT(p.id) AS count, COALESCE(SUM(p."totalAmount"), 0) AS amount
    FROM "Purchase" p
    JOIN "ExpenseTypeMaster" et ON et.id = p."expenseTypeId"
    WHERE p.status = 'ACTIVE'
    GROUP BY et.name, et."group"
    ORDER BY count DESC
    LIMIT 30
  `);
  console.log(`\nTop ExpenseTypeMaster usados:`);
  for (const m of masters) {
    console.log(`  - ${m.label} [${m.group ?? "-"}] | ${Number(m.count)} compras | R$ ${Number(m.amount).toFixed(2)}`);
  }

  // SmallExpenseType mais usados
  const smalls = await prisma.$queryRaw<
    Array<{ label: string | null; count: bigint; amount: Prisma.Decimal }>
  >(Prisma.sql`
    SELECT st.name AS label, COUNT(p.id) AS count, COALESCE(SUM(p."totalAmount"), 0) AS amount
    FROM "Purchase" p
    JOIN "SmallExpenseType" st ON st.id = p."smallExpenseTypeId"
    WHERE p.status = 'ACTIVE'
    GROUP BY st.name
    ORDER BY count DESC
    LIMIT 30
  `);
  console.log(`\nTop SmallExpenseType usados:`);
  for (const m of smalls) {
    console.log(`  - ${m.label} | ${Number(m.count)} compras | R$ ${Number(m.amount).toFixed(2)}`);
  }

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
