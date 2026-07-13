import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type ProductReviewRow = {
  id: string;
  externalCode: string | null;
  name: string;
  controlsStock: boolean;
  dreCategoryName: string | null;
  dreGroup: string | null;
  sectorName: string | null;
  purchaseItems: bigint | number;
  totalPurchased: unknown;
  lastPurchaseDate: Date | null;
};

type MonthlyDeltaRow = {
  competenceYear: number;
  competenceMonth: number;
  categoryBasedTotal: unknown;
  currentLogicTotal: unknown;
  delta: unknown;
};

type MixedPurchaseRow = {
  purchaseId: string;
  purchaseNumber: string | null;
  invoiceNumber: string | null;
  competenceYear: number;
  competenceMonth: number;
  purchaseDate: Date;
  supplierName: string | null;
  cmvItems: bigint | number;
  nonCmvItems: bigint | number;
  uncategorizedItems: bigint | number;
  totalAmount: unknown;
};

function toNumber(value: unknown) {
  if (value == null) return 0;
  if (typeof value === "bigint") return Number(value);
  return Number(value);
}

function fmtMoney(value: unknown) {
  return toNumber(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(value: Date | null) {
  if (!value) return "-";
  return value.toISOString().slice(0, 10);
}

function fmtMonth(year: number, month: number) {
  return `${String(month).padStart(2, "0")}/${year}`;
}

function mdTable(headers: string[], rows: string[][]) {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
  return [head, sep, body].filter(Boolean).join("\n");
}

async function main() {
  const [
    uncategorizedProducts,
    cmvButNoStockProducts,
    stockButNonCmvProducts,
    monthlyDelta,
    mixedPurchases,
  ] = await Promise.all([
    prisma.$queryRaw<ProductReviewRow[]>`
      SELECT
        p."id",
        p."externalCode",
        p."name",
        p."controlsStock",
        dc."name" AS "dreCategoryName",
        dc."dreGroup",
        s."name" AS "sectorName",
        COUNT(pi."id") AS "purchaseItems",
        COALESCE(SUM(pi."totalPrice"), 0) AS "totalPurchased",
        MAX(pu."purchaseDate") AS "lastPurchaseDate"
      FROM "Product" p
      LEFT JOIN "DRECategory" dc ON dc."id" = p."dreCategoryId"
      LEFT JOIN "InventorySector" s ON s."id" = p."inventorySectorId"
      LEFT JOIN "PurchaseItem" pi ON pi."productId" = p."id"
      LEFT JOIN "Purchase" pu ON pu."id" = pi."purchaseId" AND pu."status" <> 'CANCELLED'
      WHERE p."isActive" = true
        AND p."dreCategoryId" IS NULL
      GROUP BY p."id", dc."name", dc."dreGroup", s."name"
      ORDER BY COALESCE(SUM(pi."totalPrice"), 0) DESC, p."name" ASC
    `,
    prisma.$queryRaw<ProductReviewRow[]>`
      SELECT
        p."id",
        p."externalCode",
        p."name",
        p."controlsStock",
        dc."name" AS "dreCategoryName",
        dc."dreGroup",
        s."name" AS "sectorName",
        COUNT(pi."id") AS "purchaseItems",
        COALESCE(SUM(pi."totalPrice"), 0) AS "totalPurchased",
        MAX(pu."purchaseDate") AS "lastPurchaseDate"
      FROM "Product" p
      JOIN "DRECategory" dc ON dc."id" = p."dreCategoryId"
      LEFT JOIN "InventorySector" s ON s."id" = p."inventorySectorId"
      LEFT JOIN "PurchaseItem" pi ON pi."productId" = p."id"
      LEFT JOIN "Purchase" pu ON pu."id" = pi."purchaseId" AND pu."status" <> 'CANCELLED'
      WHERE p."isActive" = true
        AND dc."dreGroup" = 'CMV_COMPRAS'
        AND p."controlsStock" = false
      GROUP BY p."id", dc."name", dc."dreGroup", s."name"
      ORDER BY COALESCE(SUM(pi."totalPrice"), 0) DESC, p."name" ASC
    `,
    prisma.$queryRaw<ProductReviewRow[]>`
      SELECT
        p."id",
        p."externalCode",
        p."name",
        p."controlsStock",
        dc."name" AS "dreCategoryName",
        dc."dreGroup",
        s."name" AS "sectorName",
        COUNT(pi."id") AS "purchaseItems",
        COALESCE(SUM(pi."totalPrice"), 0) AS "totalPurchased",
        MAX(pu."purchaseDate") AS "lastPurchaseDate"
      FROM "Product" p
      JOIN "DRECategory" dc ON dc."id" = p."dreCategoryId"
      LEFT JOIN "InventorySector" s ON s."id" = p."inventorySectorId"
      LEFT JOIN "PurchaseItem" pi ON pi."productId" = p."id"
      LEFT JOIN "Purchase" pu ON pu."id" = pi."purchaseId" AND pu."status" <> 'CANCELLED'
      WHERE p."isActive" = true
        AND p."controlsStock" = true
        AND dc."dreGroup" <> 'CMV_COMPRAS'
      GROUP BY p."id", dc."name", dc."dreGroup", s."name"
      ORDER BY COALESCE(SUM(pi."totalPrice"), 0) DESC, p."name" ASC
    `,
    prisma.$queryRaw<MonthlyDeltaRow[]>`
      SELECT
        p."competenceYear",
        p."competenceMonth",
        COALESCE(SUM(pi."totalPrice") FILTER (WHERE dc."dreGroup" = 'CMV_COMPRAS'), 0) AS "categoryBasedTotal",
        COALESCE(SUM(pi."totalPrice") FILTER (WHERE pr."controlsStock" = true), 0) AS "currentLogicTotal",
        COALESCE(SUM(pi."totalPrice") FILTER (WHERE pr."controlsStock" = true), 0)
          - COALESCE(SUM(pi."totalPrice") FILTER (WHERE dc."dreGroup" = 'CMV_COMPRAS'), 0) AS "delta"
      FROM "Purchase" p
      JOIN "PurchaseItem" pi ON pi."purchaseId" = p."id"
      LEFT JOIN "Product" pr ON pr."id" = pi."productId"
      LEFT JOIN "DRECategory" dc ON dc."id" = pr."dreCategoryId"
      WHERE p."status" <> 'CANCELLED'
      GROUP BY p."competenceYear", p."competenceMonth"
      ORDER BY p."competenceYear" DESC, p."competenceMonth" DESC
      LIMIT 12
    `,
    prisma.$queryRaw<MixedPurchaseRow[]>`
      SELECT
        p."id" AS "purchaseId",
        p."purchaseNumber",
        p."invoiceNumber",
        p."competenceYear",
        p."competenceMonth",
        p."purchaseDate",
        s."name" AS "supplierName",
        COUNT(*) FILTER (WHERE dc."dreGroup" = 'CMV_COMPRAS') AS "cmvItems",
        COUNT(*) FILTER (WHERE dc."dreGroup" IS NOT NULL AND dc."dreGroup" <> 'CMV_COMPRAS') AS "nonCmvItems",
        COUNT(*) FILTER (WHERE pr."dreCategoryId" IS NULL) AS "uncategorizedItems",
        p."totalAmount"
      FROM "Purchase" p
      JOIN "PurchaseItem" pi ON pi."purchaseId" = p."id"
      LEFT JOIN "Product" pr ON pr."id" = pi."productId"
      LEFT JOIN "DRECategory" dc ON dc."id" = pr."dreCategoryId"
      LEFT JOIN "Supplier" s ON s."id" = p."supplierId"
      WHERE p."status" <> 'CANCELLED'
      GROUP BY p."id", s."name"
      HAVING COUNT(*) FILTER (WHERE dc."dreGroup" = 'CMV_COMPRAS') > 0
         AND (
           COUNT(*) FILTER (WHERE dc."dreGroup" IS NOT NULL AND dc."dreGroup" <> 'CMV_COMPRAS') > 0
           OR COUNT(*) FILTER (WHERE pr."dreCategoryId" IS NULL) > 0
         )
      ORDER BY p."purchaseDate" DESC
      LIMIT 20
    `,
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const reportPath = path.resolve("..", "exports", `cmv-base-sanitization-report-${today}.md`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });

  const lines: string[] = [];
  lines.push("# Saneamento da Base CMV");
  lines.push("");
  lines.push(`Gerado em ${today}.`);
  lines.push("");
  lines.push("## Regra assumida");
  lines.push("");
  lines.push("- Produto entra no CMV quando sua `dreCategory` pertence ao grupo `CMV_COMPRAS`.");
  lines.push("- `controlsStock` continua relevante para inventario, mas nao deve ser a regra contabil principal do CMV.");
  lines.push("");
  lines.push("## Prioridades");
  lines.push("");
  lines.push(`1. Classificar ${uncategorizedProducts.length} produto(s) sem categoria DRE.`);
  lines.push(`2. Revisar ${stockButNonCmvProducts.length} produto(s) que controlam estoque, mas estao fora de \`CMV_COMPRAS\`.`);
  lines.push(`3. Revisar ${cmvButNoStockProducts.length} produto(s) em \`CMV_COMPRAS\` com \`controlsStock=false\`.`);
  lines.push(`4. Tratar compras mistas (${mixedPurchases.length} amostras listadas) para impedir soma de nota inteira no CMV.`);
  lines.push("");

  lines.push("## Impacto mensal da logica atual vs regra correta");
  lines.push("");
  lines.push(mdTable(
    ["Competencia", "Criterio por categoria", "Logica atual", "Delta"],
    monthlyDelta.map((row) => [
      fmtMonth(row.competenceYear, row.competenceMonth),
      fmtMoney(row.categoryBasedTotal),
      fmtMoney(row.currentLogicTotal),
      fmtMoney(row.delta),
    ]),
  ));
  lines.push("");

  lines.push("## Lote 1 - Produtos sem categoria DRE");
  lines.push("");
  lines.push("Acao recomendada: classificacao manual imediata. Sem isso, o item nao consegue entrar nem sair corretamente do CMV.");
  lines.push("");
  lines.push(mdTable(
    ["Codigo", "Produto", "Estoque", "Setor", "Itens comprados", "Total comprado", "Ultima compra"],
    uncategorizedProducts.map((row) => [
      row.externalCode ?? "-",
      row.name,
      row.controlsStock ? "Sim" : "Nao",
      row.sectorName ?? "-",
      String(toNumber(row.purchaseItems)),
      fmtMoney(row.totalPurchased),
      fmtDate(row.lastPurchaseDate),
    ]),
  ));
  lines.push("");

  lines.push("## Lote 2 - Produtos em CMV_COMPRAS com controlsStock=false");
  lines.push("");
  lines.push("Acao recomendada: revisar se o produto deve controlar estoque ou se a categoria DRE dele esta errada.");
  lines.push("");
  lines.push(mdTable(
    ["Codigo", "Produto", "Categoria DRE", "Setor", "Itens comprados", "Total comprado", "Ultima compra"],
    cmvButNoStockProducts.map((row) => [
      row.externalCode ?? "-",
      row.name,
      row.dreCategoryName ?? "-",
      row.sectorName ?? "-",
      String(toNumber(row.purchaseItems)),
      fmtMoney(row.totalPurchased),
      fmtDate(row.lastPurchaseDate),
    ]),
  ));
  lines.push("");

  lines.push("## Lote 3 - Produtos com controlsStock=true fora de CMV_COMPRAS");
  lines.push("");
  lines.push("Acao recomendada: revisar se devem sair do estoque ou se a categoria DRE deveria migrar para `CMV_COMPRAS`.");
  lines.push("");
  lines.push(mdTable(
    ["Codigo", "Produto", "Grupo DRE", "Categoria DRE", "Setor", "Itens comprados", "Total comprado", "Ultima compra"],
    stockButNonCmvProducts.map((row) => [
      row.externalCode ?? "-",
      row.name,
      row.dreGroup ?? "-",
      row.dreCategoryName ?? "-",
      row.sectorName ?? "-",
      String(toNumber(row.purchaseItems)),
      fmtMoney(row.totalPurchased),
      fmtDate(row.lastPurchaseDate),
    ]),
  ));
  lines.push("");

  lines.push("## Compras mistas");
  lines.push("");
  lines.push("Essas compras misturam itens CMV e nao-CMV, ou itens sem categoria. Elas sao o motivo tecnico pelo qual nao se deve somar `Purchase.totalAmount` inteiro para CMV.");
  lines.push("");
  lines.push(mdTable(
    ["Competencia", "Data", "Pedido", "NF", "Fornecedor", "Itens CMV", "Itens nao-CMV", "Sem categoria", "Total"],
    mixedPurchases.map((row) => [
      fmtMonth(row.competenceYear, row.competenceMonth),
      fmtDate(row.purchaseDate),
      row.purchaseNumber ?? "-",
      row.invoiceNumber ?? "-",
      row.supplierName ?? "-",
      String(toNumber(row.cmvItems)),
      String(toNumber(row.nonCmvItems)),
      String(toNumber(row.uncategorizedItems)),
      fmtMoney(row.totalAmount),
    ]),
  ));
  lines.push("");

  lines.push("## Sequencia sugerida");
  lines.push("");
  lines.push("1. Corrigir os produtos sem categoria DRE.");
  lines.push("2. Corrigir conflitos entre `CMV_COMPRAS` e `controlsStock`.");
  lines.push("3. Congelar a regra de apuracao usando somente `dreGroup = CMV_COMPRAS`.");
  lines.push("4. Depois da limpeza, refatorar `CMV Real`, `MonthlyCmv` e `DRE` para consumir a mesma query.");
  lines.push("");

  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
  console.log(`Relatorio gerado em: ${reportPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
