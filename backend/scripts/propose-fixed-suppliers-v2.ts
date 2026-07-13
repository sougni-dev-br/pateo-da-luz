/**
 * propose-fixed-suppliers-v2.ts
 *
 * V2 — cobre TODOS os fornecedores, incluindo serviços/manutenção/despesas sem item de estoque,
 * e traz TaxPayment (impostos recorrentes) num bloco separado.
 *
 * Classificação por fornecedor, em ordem:
 *   1. Se tem PurchaseItem → categoria DRE dominante (via Product.dreCategoryId)
 *   2. Senão, ExpenseTypeMaster (name) dominante
 *   3. Senão, enum Purchase.expenseType dominante
 *   4. Senão, "(indefinido)"
 *
 * Uso:
 *   npx tsx scripts/propose-fixed-suppliers-v2.ts --window 12 --min 6 --out ../exports/fornecedores-fixos-v2-2026-07-09.md
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const prisma = new PrismaClient();

interface CliArgs {
  window: number;
  min: number;
  out: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { window: 12, min: 6, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--window") args.window = Number(argv[++i]);
    else if (a === "--min") args.min = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
  }
  return args;
}

interface SupplierRow {
  supplierId: string;
  supplierName: string;
  document: string | null;
  mainCategory: string | null;
  months: number;
  purchaseCount: number;
  totalAmount: number;
  classification: string;
  classificationSource: "DRE_ITEM" | "EXPENSE_TYPE_MASTER" | "EXPENSE_ENUM" | "SMALL_EXPENSE" | "UNCLASSIFIED";
  classificationShare: number;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth() - args.window + 1, 1);
  const sYear = startMonth.getFullYear();
  const sMonth = startMonth.getMonth() + 1;
  const startKey = sYear * 100 + sMonth;

  console.log(
    `\nJanela: ${args.window} meses (a partir de ${sYear}-${String(sMonth).padStart(2, "0")}) | mínimo: ${args.min} meses`,
  );

  // Base: todos os fornecedores com pelo menos 1 compra na janela
  const suppliers = await prisma.$queryRaw<
    Array<{
      supplierId: string;
      supplierName: string;
      document: string | null;
      mainCategory: string | null;
      months: bigint;
      purchaseCount: bigint;
      totalAmount: Prisma.Decimal;
    }>
  >(Prisma.sql`
    SELECT
      s.id                                                             AS "supplierId",
      s.name                                                           AS "supplierName",
      s.document                                                       AS "document",
      s."mainCategory"                                                 AS "mainCategory",
      COUNT(DISTINCT (p."competenceYear" * 100 + p."competenceMonth")) AS "months",
      COUNT(p.id)                                                      AS "purchaseCount",
      COALESCE(SUM(p."totalAmount"), 0)                                AS "totalAmount"
    FROM "Purchase" p
    JOIN "Supplier" s ON s.id = p."supplierId"
    WHERE p.status = 'ACTIVE'
      AND (p."competenceYear" * 100 + p."competenceMonth") >= ${startKey}
    GROUP BY s.id, s.name, s.document, s."mainCategory"
    ORDER BY "months" DESC, "totalAmount" DESC
  `);

  // Classificação via DRE (PurchaseItem → Product → DRECategory)
  const byDre = await prisma.$queryRaw<
    Array<{ supplierId: string; label: string; amount: Prisma.Decimal }>
  >(Prisma.sql`
    WITH t AS (
      SELECT
        p."supplierId" AS "supplierId",
        dc.name        AS label,
        SUM(pi."totalPrice") AS amount
      FROM "PurchaseItem" pi
      JOIN "Purchase" p ON p.id = pi."purchaseId"
      LEFT JOIN "Product" pr ON pr.id = pi."productId"
      LEFT JOIN "DRECategory" dc ON dc.id = pr."dreCategoryId"
      WHERE p.status = 'ACTIVE'
        AND (p."competenceYear" * 100 + p."competenceMonth") >= ${startKey}
        AND dc.name IS NOT NULL
      GROUP BY p."supplierId", dc.name
    ),
    r AS (
      SELECT "supplierId", label, amount,
        ROW_NUMBER() OVER (PARTITION BY "supplierId" ORDER BY amount DESC NULLS LAST) rn
      FROM t
    )
    SELECT "supplierId", label, amount FROM r WHERE rn = 1
  `);

  // Fallback ExpenseTypeMaster
  const byMaster = await prisma.$queryRaw<
    Array<{ supplierId: string; label: string; amount: Prisma.Decimal }>
  >(Prisma.sql`
    WITH t AS (
      SELECT
        p."supplierId" AS "supplierId",
        et.name        AS label,
        SUM(p."totalAmount") AS amount
      FROM "Purchase" p
      JOIN "ExpenseTypeMaster" et ON et.id = p."expenseTypeId"
      WHERE p.status = 'ACTIVE'
        AND (p."competenceYear" * 100 + p."competenceMonth") >= ${startKey}
      GROUP BY p."supplierId", et.name
    ),
    r AS (
      SELECT "supplierId", label, amount,
        ROW_NUMBER() OVER (PARTITION BY "supplierId" ORDER BY amount DESC) rn
      FROM t
    )
    SELECT "supplierId", label, amount FROM r WHERE rn = 1
  `);

  // Fallback enum ExpenseType
  const byEnum = await prisma.$queryRaw<
    Array<{ supplierId: string; label: string; amount: Prisma.Decimal }>
  >(Prisma.sql`
    WITH t AS (
      SELECT
        p."supplierId"       AS "supplierId",
        p."expenseType"::text AS label,
        SUM(p."totalAmount")  AS amount
      FROM "Purchase" p
      WHERE p.status = 'ACTIVE'
        AND (p."competenceYear" * 100 + p."competenceMonth") >= ${startKey}
      GROUP BY p."supplierId", p."expenseType"
    ),
    r AS (
      SELECT "supplierId", label, amount,
        ROW_NUMBER() OVER (PARTITION BY "supplierId" ORDER BY amount DESC) rn
      FROM t
    )
    SELECT "supplierId", label, amount FROM r WHERE rn = 1
  `);

  // Fallback SmallExpenseType (pequenas despesas)
  const bySmall = await prisma.$queryRaw<
    Array<{ supplierId: string; label: string; amount: Prisma.Decimal }>
  >(Prisma.sql`
    WITH t AS (
      SELECT
        p."supplierId"         AS "supplierId",
        st.name                AS label,
        SUM(p."totalAmount")   AS amount
      FROM "Purchase" p
      JOIN "SmallExpenseType" st ON st.id = p."smallExpenseTypeId"
      WHERE p.status = 'ACTIVE'
        AND (p."competenceYear" * 100 + p."competenceMonth") >= ${startKey}
      GROUP BY p."supplierId", st.name
    ),
    r AS (
      SELECT "supplierId", label, amount,
        ROW_NUMBER() OVER (PARTITION BY "supplierId" ORDER BY amount DESC) rn
      FROM t
    )
    SELECT "supplierId", label, amount FROM r WHERE rn = 1
  `);

  const dreMap = new Map(byDre.map((r) => [r.supplierId, { label: r.label, amount: Number(r.amount ?? 0) }]));
  const masterMap = new Map(byMaster.map((r) => [r.supplierId, { label: r.label, amount: Number(r.amount ?? 0) }]));
  const enumMap = new Map(byEnum.map((r) => [r.supplierId, { label: r.label, amount: Number(r.amount ?? 0) }]));
  const smallMap = new Map(bySmall.map((r) => [r.supplierId, { label: r.label, amount: Number(r.amount ?? 0) }]));

  const enriched: SupplierRow[] = suppliers.map((s) => {
    const total = Number(s.totalAmount ?? 0);
    const dre = dreMap.get(s.supplierId);
    const master = masterMap.get(s.supplierId);
    const small = smallMap.get(s.supplierId);
    const en = enumMap.get(s.supplierId);

    let classification: string;
    let source: SupplierRow["classificationSource"];
    let shareAmount: number;

    if (dre && dre.amount > 0) {
      classification = `DRE: ${dre.label}`;
      source = "DRE_ITEM";
      shareAmount = dre.amount;
    } else if (small && small.amount > 0) {
      classification = `Pequena despesa: ${small.label}`;
      source = "SMALL_EXPENSE";
      shareAmount = small.amount;
    } else if (master && master.amount > 0) {
      classification = `Despesa: ${master.label}`;
      source = "EXPENSE_TYPE_MASTER";
      shareAmount = master.amount;
    } else if (en) {
      classification = `Enum: ${en.label}`;
      source = "EXPENSE_ENUM";
      shareAmount = en.amount;
    } else {
      classification = "(indefinido)";
      source = "UNCLASSIFIED";
      shareAmount = 0;
    }

    return {
      supplierId: s.supplierId,
      supplierName: s.supplierName,
      document: s.document,
      mainCategory: s.mainCategory,
      months: Number(s.months),
      purchaseCount: Number(s.purchaseCount),
      totalAmount: total,
      classification,
      classificationSource: source,
      classificationShare: total > 0 ? shareAmount / total : 0,
    };
  });

  // TaxPayment recorrente (impostos)
  const taxes = await prisma.$queryRaw<
    Array<{
      documentType: string;
      dreCategory: string | null;
      months: bigint;
      count: bigint;
      totalAmount: Prisma.Decimal;
    }>
  >(Prisma.sql`
    SELECT
      tp."documentType"                                             AS "documentType",
      dc.name                                                        AS "dreCategory",
      COUNT(DISTINCT DATE_TRUNC('month', COALESCE(tp."competenceDate", tp."dueDate"))) AS "months",
      COUNT(*)                                                       AS "count",
      COALESCE(SUM(tp.amount), 0)                                    AS "totalAmount"
    FROM "TaxPayment" tp
    LEFT JOIN "DRECategory" dc ON dc.id = tp."dreCategoryId"
    WHERE tp."deletedAt" IS NULL
      AND COALESCE(tp."competenceDate", tp."dueDate") >= ${new Date(sYear, sMonth - 1, 1)}
    GROUP BY tp."documentType", dc.name
    ORDER BY "months" DESC, "totalAmount" DESC
  `);

  // Filtrar fixos e agrupar
  const fixed = enriched.filter((r) => r.months >= args.min);
  const byClass = new Map<string, SupplierRow[]>();
  for (const row of fixed) {
    if (!byClass.has(row.classification)) byClass.set(row.classification, []);
    byClass.get(row.classification)!.push(row);
  }

  const brl = (n: number): string =>
    n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const lines: string[] = [];
  lines.push(`# Fornecedores fixos + impostos recorrentes — v2`);
  lines.push("");
  lines.push(
    `Janela: últimos ${args.window} meses (competência) · critério fixo: >= ${args.min} meses distintos com Purchase ACTIVE.`,
  );
  lines.push(`Fornecedores fixos: **${fixed.length}** de ${enriched.length} totais na janela.`);
  lines.push("");

  const sortedCats = Array.from(byClass.keys()).sort();
  for (const cat of sortedCats) {
    const rows = byClass.get(cat)!.sort((a, b) => b.months - a.months || b.totalAmount - a.totalAmount);
    lines.push(`## ${cat}`);
    lines.push("");
    lines.push(`| Fornecedor | Documento | Meses | Compras | Total | Share | Fonte |`);
    lines.push(`|---|---|---|---|---|---|---|`);
    for (const r of rows) {
      lines.push(
        `| ${r.supplierName} | ${r.document ?? "-"} | ${r.months}/${args.window} | ${r.purchaseCount} | ${brl(r.totalAmount)} | ${(r.classificationShare * 100).toFixed(0)}% | ${r.classificationSource} |`,
      );
    }
    lines.push("");
  }

  lines.push(`## Impostos recorrentes (TaxPayment)`);
  lines.push("");
  if (taxes.length === 0) {
    lines.push(`Nenhum registro de imposto na janela.`);
  } else {
    lines.push(`| Documento | Categoria DRE | Meses | Guias | Total janela |`);
    lines.push(`|---|---|---|---|---|`);
    for (const t of taxes) {
      lines.push(
        `| ${t.documentType} | ${t.dreCategory ?? "-"} | ${Number(t.months)}/${args.window} | ${Number(t.count)} | ${brl(Number(t.totalAmount ?? 0))} |`,
      );
    }
  }
  lines.push("");

  const report = lines.join("\n");
  console.log("\n" + report);

  if (args.out) {
    const outPath = resolve(args.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, report, "utf8");
    console.log(`\n>>> Arquivo salvo em: ${outPath}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
