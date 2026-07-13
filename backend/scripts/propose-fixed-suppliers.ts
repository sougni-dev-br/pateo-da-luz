/**
 * propose-fixed-suppliers.ts
 *
 * Analisa os últimos N meses de compras e propõe fornecedores fixos por categoria DRE,
 * para preencher a §3.2 de docs/regra-fechamento-cmv-dre.md.
 *
 * Critério de "fixo": fornecedor com compra em >= FIXED_MIN_MONTHS de FIXED_WINDOW_MONTHS.
 * Categoria dominante: a categoria DRE com maior valor (R$) de itens do fornecedor na janela.
 *
 * Uso:
 *   cd backend
 *   npx tsx scripts/propose-fixed-suppliers.ts
 *   npx tsx scripts/propose-fixed-suppliers.ts --window 6 --min 4
 *   npx tsx scripts/propose-fixed-suppliers.ts --out ../exports/fornecedores-fixos-YYYY-MM-DD.md
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
  const args: CliArgs = { window: 6, min: 4, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--window") args.window = Number(argv[++i]);
    else if (a === "--min") args.min = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
  }
  return args;
}

interface AggregationRow {
  supplierId: string;
  supplierName: string;
  document: string | null;
  mainCategory: string | null;
  months: number;
  totalAmount: number;
  purchaseCount: number;
  dominantDreCategory: string | null;
  dominantDreGroup: string | null;
  dominantShare: number;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth() - args.window + 1, 1);
  const sYear = startMonth.getFullYear();
  const sMonth = startMonth.getMonth() + 1;

  console.log(
    `\nJanela: ${args.window} meses (a partir de ${sYear}-${String(sMonth).padStart(2, "0")}) | mínimo: ${args.min} meses`,
  );

  const rows = await prisma.$queryRaw<
    Array<{
      supplierId: string;
      supplierName: string;
      document: string | null;
      mainCategory: string | null;
      months: bigint;
      totalAmount: Prisma.Decimal;
      purchaseCount: bigint;
    }>
  >(Prisma.sql`
    SELECT
      s.id                                                   AS "supplierId",
      s.name                                                 AS "supplierName",
      s.document                                             AS "document",
      s."mainCategory"                                       AS "mainCategory",
      COUNT(DISTINCT (p."competenceYear" * 100 + p."competenceMonth")) AS "months",
      COALESCE(SUM(p."totalAmount"), 0)                      AS "totalAmount",
      COUNT(p.id)                                            AS "purchaseCount"
    FROM "Purchase" p
    JOIN "Supplier" s ON s.id = p."supplierId"
    WHERE p.status = 'ACTIVE'
      AND (p."competenceYear" * 100 + p."competenceMonth") >= ${sYear * 100 + sMonth}
    GROUP BY s.id, s.name, s.document, s."mainCategory"
    HAVING COUNT(DISTINCT (p."competenceYear" * 100 + p."competenceMonth")) >= ${args.min}
    ORDER BY "months" DESC, "totalAmount" DESC
  `);

  const dominant = await prisma.$queryRaw<
    Array<{
      supplierId: string;
      dreCategory: string | null;
      dreGroup: string | null;
      categoryAmount: Prisma.Decimal;
    }>
  >(Prisma.sql`
    WITH item_totals AS (
      SELECT
        p."supplierId"          AS "supplierId",
        dc.name                 AS "dreCategory",
        dc."dreGroup"           AS "dreGroup",
        SUM(pi."totalPrice")    AS "amount"
      FROM "PurchaseItem" pi
      JOIN "Purchase" p     ON p.id = pi."purchaseId"
      LEFT JOIN "Product" pr ON pr.id = pi."productId"
      LEFT JOIN "DRECategory" dc ON dc.id = pr."dreCategoryId"
      WHERE p.status = 'ACTIVE'
        AND (p."competenceYear" * 100 + p."competenceMonth") >= ${sYear * 100 + sMonth}
      GROUP BY p."supplierId", dc.name, dc."dreGroup"
    ),
    ranked AS (
      SELECT
        "supplierId",
        "dreCategory",
        "dreGroup",
        "amount" AS "categoryAmount",
        ROW_NUMBER() OVER (PARTITION BY "supplierId" ORDER BY "amount" DESC NULLS LAST) AS rn
      FROM item_totals
    )
    SELECT "supplierId", "dreCategory", "dreGroup", "categoryAmount"
    FROM ranked
    WHERE rn = 1
  `);

  const dominantMap = new Map<string, { dre: string | null; group: string | null; amount: number }>();
  for (const d of dominant) {
    dominantMap.set(d.supplierId, {
      dre: d.dreCategory,
      group: d.dreGroup,
      amount: Number(d.categoryAmount ?? 0),
    });
  }

  const enriched: AggregationRow[] = rows.map((r) => {
    const dm = dominantMap.get(r.supplierId);
    const total = Number(r.totalAmount ?? 0);
    return {
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      document: r.document,
      mainCategory: r.mainCategory,
      months: Number(r.months),
      totalAmount: total,
      purchaseCount: Number(r.purchaseCount),
      dominantDreCategory: dm?.dre ?? null,
      dominantDreGroup: dm?.group ?? null,
      dominantShare: dm && total > 0 ? dm.amount / total : 0,
    };
  });

  const byCategory = new Map<string, AggregationRow[]>();
  for (const row of enriched) {
    const key = row.dominantDreCategory ?? "(sem categoria DRE)";
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(row);
  }

  const lines: string[] = [];
  lines.push(`# Fornecedores fixos propostos`);
  lines.push("");
  lines.push(
    `Janela analisada: últimos ${args.window} meses (competência) · critério: >= ${args.min} meses distintos com compra ACTIVE.`,
  );
  lines.push(`Total de fornecedores fixos identificados: **${enriched.length}**`);
  lines.push("");

  const brl = (n: number): string =>
    n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const sortedCategories = Array.from(byCategory.keys()).sort();
  for (const cat of sortedCategories) {
    const suppliers = byCategory.get(cat)!.sort((a, b) => b.totalAmount - a.totalAmount);
    lines.push(`## ${cat}`);
    lines.push("");
    lines.push(`| Fornecedor | Documento | Meses c/ compra | Compras | Total janela | Share DRE dominante |`);
    lines.push(`|---|---|---|---|---|---|`);
    for (const s of suppliers) {
      lines.push(
        `| ${s.supplierName} | ${s.document ?? "-"} | ${s.months}/${args.window} | ${s.purchaseCount} | ${brl(s.totalAmount)} | ${(s.dominantShare * 100).toFixed(0)}% |`,
      );
    }
    lines.push("");
  }

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
