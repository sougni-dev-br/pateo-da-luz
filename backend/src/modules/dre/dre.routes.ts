import crypto from "node:crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { auditLog, requireRole } from "../security/security-utils.js";
import { createDrePdf } from "./dre-pdf.js";

export const dreRouter = Router();

dreRouter.use(async (request, response, next) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA", "VISUALIZACAO"]);
  if (!user) return;
  next();
});

// ─────────────────────────────────────────────
// GROUP META (ordem da planilha RESU 0000)
// ─────────────────────────────────────────────

const GROUP_META = [
  { key: "CMV_COMPRAS",           label: "CMV / Compras sem NF", sortOrder: 5  },
  { key: "PESSOAL",               label: "Pessoal",             sortOrder: 10 },
  { key: "VALE_TRANSPORTE",       label: "Vale-Transporte",     sortOrder: 20 },
  { key: "LOCACAO",               label: "Ocupação e Locação",  sortOrder: 30 },
  { key: "TARIFAS_BANCARIAS",     label: "Tarifas Bancárias",   sortOrder: 40 },
  { key: "TARIFAS_PUBLICAS",      label: "Tarifas Públicas",    sortOrder: 50 },
  { key: "IMPOSTOS",              label: "Impostos",            sortOrder: 60 },
  { key: "DESPESAS_GERAIS",       label: "Despesas Gerais",     sortOrder: 70 },
  { key: "PLANEJAMENTO",          label: "Planejamento",        sortOrder: 80 },
  { key: "DESPESAS_OPERACIONAIS", label: "Despesas Diversas",   sortOrder: 90 },
  { key: "DEDUCOES",              label: "Deduções de Receita", sortOrder: 100 },
];

const SEED_CATEGORIES = [
  // CMV_COMPRAS
  { name: "Custo de Alimentos",      dreGroup: "CMV_COMPRAS", sortOrder: 1 },
  { name: "Bebidas",                 dreGroup: "CMV_COMPRAS", sortOrder: 2 },
  { name: "Insumos",                 dreGroup: "CMV_COMPRAS", sortOrder: 3 },
  { name: "Embalagens",              dreGroup: "CMV_COMPRAS", sortOrder: 4 },
  { name: "Descartáveis / Delivery", dreGroup: "CMV_COMPRAS", sortOrder: 5 },
  { name: "Compras sem NF - Outros", dreGroup: "CMV_COMPRAS", sortOrder: 6 },
  // PESSOAL
  { name: "Folha de Pagamento",   dreGroup: "PESSOAL",           sortOrder: 11 },
  { name: "Hora Extra",           dreGroup: "PESSOAL",           sortOrder: 12 },
  { name: "Comissões",            dreGroup: "PESSOAL",           sortOrder: 13 },
  { name: "Férias",               dreGroup: "PESSOAL",           sortOrder: 14 },
  { name: "Rescisão",             dreGroup: "PESSOAL",           sortOrder: 15 },
  { name: "Pró-labore",           dreGroup: "PESSOAL",           sortOrder: 16 },
  { name: "INSS",                 dreGroup: "PESSOAL",           sortOrder: 17 },
  { name: "FGTS",                 dreGroup: "PESSOAL",           sortOrder: 18 },
  { name: "Prêmios / Gratificações", dreGroup: "PESSOAL",        sortOrder: 19 },
  // VALE_TRANSPORTE
  { name: "Vale-Transporte",      dreGroup: "VALE_TRANSPORTE",   sortOrder: 21 },
  // LOCACAO
  { name: "Aluguel",              dreGroup: "LOCACAO",           sortOrder: 31 },
  { name: "Condomínio",           dreGroup: "LOCACAO",           sortOrder: 32 },
  { name: "Fundo de Promoção",    dreGroup: "LOCACAO",           sortOrder: 33 },
  { name: "IPTU",                 dreGroup: "LOCACAO",           sortOrder: 34 },
  { name: "Exaustão / Renovação", dreGroup: "LOCACAO",           sortOrder: 35 },
  { name: "Seguro",               dreGroup: "LOCACAO",           sortOrder: 36 },
  { name: "Fundo de Reserva",     dreGroup: "LOCACAO",           sortOrder: 37 },
  // TARIFAS_BANCARIAS
  { name: "Tarifa PIX / TEF",     dreGroup: "TARIFAS_BANCARIAS", sortOrder: 41 },
  { name: "Juros e IOF",          dreGroup: "TARIFAS_BANCARIAS", sortOrder: 42 },
  // TARIFAS_PUBLICAS
  { name: "Energia Elétrica",     dreGroup: "TARIFAS_PUBLICAS",  sortOrder: 51 },
  { name: "Gás",                  dreGroup: "TARIFAS_PUBLICAS",  sortOrder: 52 },
  { name: "Ar-Condicionado",      dreGroup: "TARIFAS_PUBLICAS",  sortOrder: 53 },
  { name: "Água e Esgoto",        dreGroup: "TARIFAS_PUBLICAS",  sortOrder: 54 },
  { name: "Telefonia / Internet", dreGroup: "TARIFAS_PUBLICAS",  sortOrder: 55 },
  { name: "Streaming / TV",       dreGroup: "TARIFAS_PUBLICAS",  sortOrder: 56 },
  // IMPOSTOS
  { name: "Simples Nacional",     dreGroup: "IMPOSTOS",          sortOrder: 61 },
  { name: "IRRF / DARF",          dreGroup: "IMPOSTOS",          sortOrder: 62 },
  { name: "GARE / ICMS",          dreGroup: "IMPOSTOS",          sortOrder: 63 },
  // DESPESAS_GERAIS
  { name: "Equipamentos",         dreGroup: "DESPESAS_GERAIS",   sortOrder: 71 },
  { name: "Contador",             dreGroup: "DESPESAS_GERAIS",   sortOrder: 72 },
  { name: "Sistema / Software",   dreGroup: "DESPESAS_GERAIS",   sortOrder: 73 },
  { name: "Plano de Saúde",       dreGroup: "DESPESAS_GERAIS",   sortOrder: 74 },
  { name: "Material de Limpeza",  dreGroup: "DESPESAS_GERAIS",   sortOrder: 75 },
  { name: "Manutenção",           dreGroup: "DESPESAS_GERAIS",   sortOrder: 76 },
  { name: "Uniformes",             dreGroup: "DESPESAS_GERAIS",   sortOrder: 77 },
  { name: "Descartáveis",          dreGroup: "DESPESAS_GERAIS",   sortOrder: 78 },
  { name: "Material de Escritório",dreGroup: "DESPESAS_GERAIS",   sortOrder: 78 },
  { name: "Publicidade",           dreGroup: "DESPESAS_GERAIS",   sortOrder: 79 },
  { name: "Outras Despesas Gerais",dreGroup: "DESPESAS_GERAIS",   sortOrder: 80 },
  { name: "Utensílios Operacionais",dreGroup: "DESPESAS_GERAIS",  sortOrder: 81 },
  { name: "Transporte / Mobilidade",dreGroup: "DESPESAS_GERAIS",  sortOrder: 90 },
  { name: "Serviços de Terceiros", dreGroup: "DESPESAS_GERAIS",   sortOrder: 91 },
  // PLANEJAMENTO
  { name: "Provisão 13° Salário", dreGroup: "PLANEJAMENTO",      sortOrder: 81 },
  { name: "Marketing",            dreGroup: "PLANEJAMENTO",      sortOrder: 82 },
  { name: "Investimentos",        dreGroup: "PLANEJAMENTO",      sortOrder: 83 },
];

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function parseLocalDate(s: string): Date | null {
  // Parse YYYY-MM-DD as LOCAL midnight (not UTC) so date display matches input.
  // new Date("2026-05-01") creates UTC midnight, which in UTC-3 is April 30 — wrong.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function parseRange(query: Record<string, unknown>): { from: Date; to: Date } | null {
  const year = query.year ? Number(query.year) : null;
  const month = query.month ? Number(query.month) : null;
  const from = query.from ? parseLocalDate(String(query.from)) : null;
  const to   = query.to   ? parseLocalDate(String(query.to))   : null;

  if (year && month) {
    return {
      from: new Date(year, month - 1, 1),
      to: new Date(year, month, 0, 23, 59, 59, 999)
    };
  }
  if (from && to) {
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }
  return null;
}

function prevMonth(from: Date, to: Date): { from: Date; to: Date } {
  const d = new Date(from);
  d.setMonth(d.getMonth() - 1);
  const dTo = new Date(to);
  dTo.setMonth(dTo.getMonth() - 1);
  return { from: d, to: dTo };
}

function prevYear(from: Date, to: Date): { from: Date; to: Date } {
  const d = new Date(from);
  d.setFullYear(d.getFullYear() - 1);
  const dTo = new Date(to);
  dTo.setFullYear(dTo.getFullYear() - 1);
  return { from: d, to: dTo };
}

async function calcDRE(from: Date, to: Date) {
  // Todas as queries são independentes entre si — rodam em paralelo
  const [revenueRows, snapInitialValue, snapFinalValue, cmvComprasRows, expenseRows, taxExpenseRows] = await Promise.all([
    // ── Receita por canal ──
    prisma.$queryRaw<Array<{
      channel: string;
      grossAmount: string;
      discounts: string;
      platformFees: string;
      netAmount: string;
      serviceAmount: string;
      tickets: number;
    }>>`
      SELECT
        channel,
        SUM("grossAmount")   AS "grossAmount",
        SUM(discounts)       AS "discounts",
        SUM("platformFees")  AS "platformFees",
        SUM("netAmount")     AS "netAmount",
        SUM("serviceAmount") AS "serviceAmount",
        SUM(tickets)         AS tickets
      FROM "RevenueEntry"
      WHERE status = 'ACTIVE'
        AND date >= ${from} AND date <= ${to}
      GROUP BY channel
      ORDER BY channel
    `,
    // ── Estoque inicial: snapshot mais recente ANTES do período ──
    prisma.$queryRaw<Array<{ totalValue: string | null }>>`
      SELECT SUM(si."totalCost") AS "totalValue"
      FROM "InventorySnapshotItem" si
      JOIN "InventorySnapshot" s ON s.id = si."snapshotId"
      WHERE s.id = (
        SELECT id FROM "InventorySnapshot"
        WHERE status = 'ACTIVE'
          AND "countDate" < ${from}
          AND type IN ('INVENTARIO_INICIAL', 'INVENTARIO_FINAL', 'CONTAGEM_PARCIAL')
        ORDER BY "countDate" DESC
        LIMIT 1
      )
    `,
    // ── Estoque final: snapshot mais recente ATÉ o final do período ──
    prisma.$queryRaw<Array<{ totalValue: string | null }>>`
      SELECT SUM(si."totalCost") AS "totalValue"
      FROM "InventorySnapshotItem" si
      JOIN "InventorySnapshot" s ON s.id = si."snapshotId"
      WHERE s.id = (
        SELECT id FROM "InventorySnapshot"
        WHERE status = 'ACTIVE'
          AND "countDate" <= ${to}
          AND type IN ('INVENTARIO_INICIAL', 'INVENTARIO_FINAL', 'CONTAGEM_PARCIAL')
        ORDER BY "countDate" DESC
        LIMIT 1
      )
    `,
    // ── CMV Compras: apenas itens de produtos que controlam estoque (controlsStock=true).
    // Compatibilidade retroativa: compras sem itens com expenseType alimentar também entram.
    // Isso evita que insumos de não-estoque (limpeza, utensílios, etc.) inflacionem o CMV.
    prisma.$queryRaw<Array<{ total: string | null }>>`
      SELECT COALESCE(SUM(sub.total), 0) AS total FROM (
        SELECT pitem."totalPrice" AS total
        FROM "PurchaseItem" pitem
        JOIN "Purchase" p   ON p.id   = pitem."purchaseId"
        JOIN "Product"  prod ON prod.id = pitem."productId"
        WHERE p.status = 'ACTIVE'
          AND prod."controlsStock" = true
          AND p."purchaseDate" >= ${from}
          AND p."purchaseDate" <= ${to}
        UNION ALL
        SELECT p."totalAmount" AS total
        FROM "Purchase" p
        WHERE p.status = 'ACTIVE'
          AND p."purchaseDate" >= ${from}
          AND p."purchaseDate" <= ${to}
          AND p."expenseType" IN ('FOOD', 'BEVERAGE', 'PACKAGING')
          AND NOT EXISTS (SELECT 1 FROM "PurchaseItem" px WHERE px."purchaseId" = p.id)
      ) sub
    `,
    // ── Despesas por categoria DRE — nova lógica em duas partes (UNION):
    // Parte A: parcelas de compras SEM itens de produto → usa pi.dreCategory (manual).
    // Parte B: itens de produto com controlsStock=false → usa Product.dreCategoryId.
    // Compras de estoque (controlsStock=true) são excluídas das despesas: já estão no CMV.
    prisma.$queryRaw<Array<{
      dreCategory: string | null;
      dreCategoryName: string | null;
      dreSortOrder: number | null;
      dreGroup: string | null;
      total: string;
      count: number;
    }>>`
      SELECT
        sub."dreCategory",
        sub."dreCategoryName",
        sub."dreSortOrder",
        sub."dreGroup",
        SUM(sub.total)::text      AS total,
        SUM(sub.cnt)::int         AS count
      FROM (
        -- Parte A: parcelas de compras sem itens de produto (despesas operacionais puras)
        SELECT
          pi."dreCategory",
          dc.name        AS "dreCategoryName",
          dc."sortOrder" AS "dreSortOrder",
          dc."dreGroup"  AS "dreGroup",
          SUM(COALESCE(pi."paidAmount", pi.amount, 0)) AS total,
          COUNT(*)::bigint AS cnt
        FROM "PaymentInstallment" pi
        JOIN "Purchase" p ON p.id = pi."purchaseId"
        LEFT JOIN "DRECategory" dc ON dc.id = pi."dreCategory"
        WHERE p.status = 'ACTIVE'
          AND pi.status NOT IN ('CANCELLED')
          AND NOT EXISTS (SELECT 1 FROM "PurchaseItem" px WHERE px."purchaseId" = p.id)
          AND (
            (pi."paidDate" IS NOT NULL AND pi."paidDate" >= ${from} AND pi."paidDate" <= ${to})
            OR (pi."paidDate" IS NULL AND pi."dueDate" IS NOT NULL AND pi."dueDate" >= ${from} AND pi."dueDate" <= ${to})
          )
        GROUP BY pi."dreCategory", dc.name, dc."sortOrder", dc."dreGroup"

        UNION ALL

        -- Parte B: itens de produto sem controle de estoque → categoria DRE do produto
        SELECT
          prod."dreCategoryId" AS "dreCategory",
          dc.name              AS "dreCategoryName",
          dc."sortOrder"       AS "dreSortOrder",
          dc."dreGroup"        AS "dreGroup",
          SUM(pitem."totalPrice")      AS total,
          COUNT(DISTINCT p.id)::bigint AS cnt
        FROM "PurchaseItem" pitem
        JOIN "Purchase" p   ON p.id   = pitem."purchaseId"
        JOIN "Product"  prod ON prod.id = pitem."productId"
        LEFT JOIN "DRECategory" dc ON dc.id = prod."dreCategoryId"
        WHERE p.status = 'ACTIVE'
          AND prod."controlsStock" = false
          AND p."purchaseDate" >= ${from}
          AND p."purchaseDate" <= ${to}
        GROUP BY prod."dreCategoryId", dc.name, dc."sortOrder", dc."dreGroup"
      ) sub
      GROUP BY sub."dreCategory", sub."dreCategoryName", sub."dreSortOrder", sub."dreGroup"
      ORDER BY COALESCE(sub."dreSortOrder", 999), COALESCE(sub."dreCategoryName", 'ZZZ')
    `,
    // ── Impostos e Guias por competência ──
    // TaxPayments entram no DRE pela competenceDate (não pela data de pagamento).
    // Registros sem competenceDate são ignorados do DRE (entram apenas no fluxo de caixa).
    prisma.$queryRaw<Array<{
      dreCategory: string | null;
      dreCategoryName: string | null;
      dreSortOrder: number | null;
      dreGroup: string | null;
      total: string;
      count: number;
    }>>`
      SELECT
        tp."dreCategoryId"  AS "dreCategory",
        dc.name             AS "dreCategoryName",
        dc."sortOrder"      AS "dreSortOrder",
        dc."dreGroup"       AS "dreGroup",
        SUM(tp.amount)::text AS total,
        COUNT(*)::int        AS count
      FROM "TaxPayment" tp
      LEFT JOIN "DRECategory" dc ON dc.id = tp."dreCategoryId"
      WHERE tp."deletedAt" IS NULL
        AND tp.status NOT IN ('CANCELED')
        AND tp."competenceDate" IS NOT NULL
        AND tp."competenceDate" >= ${from}
        AND tp."competenceDate" <= ${to}
      GROUP BY tp."dreCategoryId", dc.name, dc."sortOrder", dc."dreGroup"
    `,
  ]);

  // ── Agregar receita ──
  const grossByChannel: Record<string, number> = {};
  let totalGross = 0, totalDiscounts = 0, totalPlatformFees = 0, totalNet = 0, totalService = 0, totalTickets = 0;
  for (const row of revenueRows) {
    const g = Number(row.grossAmount);
    grossByChannel[row.channel] = g;
    totalGross += g;
    totalDiscounts += Number(row.discounts);
    totalPlatformFees += Number(row.platformFees);
    totalNet += Number(row.netAmount);
    totalService += Number(row.serviceAmount);
    totalTickets += Number(row.tickets);
  }

  const estoqueInicial = Number(snapInitialValue[0]?.totalValue ?? 0);
  const estoqueFinal = Number(snapFinalValue[0]?.totalValue ?? 0);
  const compras = Number(cmvComprasRows[0]?.total ?? 0);
  const cmvReal = estoqueInicial + compras - estoqueFinal;
  const cmvPercent = totalGross > 0 ? (cmvReal / totalGross) * 100 : null;
  const lucroBruto = totalNet - cmvReal;

  // Mesclar despesas de compras com impostos por categoria
  const allExpenseRows = [...expenseRows, ...taxExpenseRows];
  const expenseByCategory = new Map<string, { dreCategoryId: string | null; dreCategoryName: string; dreGroup: string; sortOrder: number; total: number; count: number }>();
  for (const r of allExpenseRows) {
    const key = r.dreCategory ?? "__none__";
    const existing = expenseByCategory.get(key);
    if (existing) {
      existing.total += Number(r.total);
      existing.count += Number(r.count);
    } else {
      expenseByCategory.set(key, {
        dreCategoryId: r.dreCategory ?? null,
        dreCategoryName: r.dreCategoryName ?? "Não categorizadas",
        dreGroup: r.dreGroup ?? "DESPESAS_OPERACIONAIS",
        sortOrder: r.dreSortOrder ?? 999,
        total: Number(r.total),
        count: Number(r.count),
      });
    }
  }
  const expenses = Array.from(expenseByCategory.values()).sort((a, b) => a.sortOrder - b.sortOrder || a.dreCategoryName.localeCompare(b.dreCategoryName));

  // Agrupa despesas por dreGroup preservando a ordem da planilha
  const groupMap: Record<string, { total: number; lines: typeof expenses }> = {};
  for (const exp of expenses) {
    const g = exp.dreGroup;
    if (!groupMap[g]) groupMap[g] = { total: 0, lines: [] };
    groupMap[g].total += exp.total;
    groupMap[g].lines.push(exp);
  }
  const expenseGroups = GROUP_META
    .map((gm) => ({
      key: gm.key,
      label: gm.label,
      sortOrder: gm.sortOrder,
      total: groupMap[gm.key]?.total ?? 0,
      lines: groupMap[gm.key]?.lines ?? []
    }))
    .filter((g) => g.lines.length > 0);

  const totalExpenses = expenses.reduce((s, e) => s + e.total, 0);
  const ebitda = lucroBruto - totalExpenses;
  const ebitdaPercent = totalGross > 0 ? (ebitda / totalGross) * 100 : null;
  const margemBruta = totalGross > 0 ? (lucroBruto / totalGross) * 100 : null;

  // CMV: indica se há dados de inventário para cálculo real
  const hasInventoryData = estoqueInicial > 0 && estoqueFinal > 0;
  const cmvWarning = hasInventoryData
    ? null
    : "CMV estimado: não há inventário inicial e final fechado para este período. O valor exibido considera compras do período, não consumo real.";

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    revenue: {
      byChannel: grossByChannel,
      grossAmount: totalGross,
      discounts: totalDiscounts,
      platformFees: totalPlatformFees,
      deductions: totalDiscounts + totalPlatformFees,
      netAmount: totalNet,
      serviceAmount: totalService,
      tickets: totalTickets
    },
    cmv: {
      estoqueInicial,
      compras,
      estoqueFinal,
      cmvReal,
      cmvPercent,
      hasInventoryData,
      warning: cmvWarning
    },
    lucroBruto,
    margemBruta,
    expenses,
    expenseGroups,
    totalExpenses,
    ebitda,
    ebitdaPercent
  };
}

// ─────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────

dreRouter.get("/summary", async (request, response) => {
  const range = parseRange(request.query as Record<string, unknown>);
  if (!range) {
    response.status(400).json({ message: "Informe year+month ou from+to." });
    return;
  }

  const withComparatives = String(request.query.comparatives ?? "true") !== "false";

  const [current, prevM, prevY] = await Promise.all([
    calcDRE(range.from, range.to),
    withComparatives ? calcDRE(prevMonth(range.from, range.to).from, prevMonth(range.from, range.to).to) : Promise.resolve(null),
    withComparatives ? calcDRE(prevYear(range.from, range.to).from, prevYear(range.from, range.to).to) : Promise.resolve(null)
  ]);

  response.json({ current, prevMonth: prevM, prevYear: prevY });
});

dreRouter.get("/expense-drill", async (request, response) => {
  const range = parseRange(request.query as Record<string, unknown>);
  if (!range) {
    response.status(400).json({ message: "Informe year+month ou from+to." });
    return;
  }

  const dreCategoryId = request.query.dreCategoryId ? String(request.query.dreCategoryId) : null;

  type DrillRow = {
    installmentId: string;
    purchaseId: string;
    purchaseDate: Date;
    supplierName: string;
    invoiceNumber: string | null;
    purchaseNumber: string | null;
    expenseType: string;
    installment: number | null;
    dueDate: Date | null;
    paidDate: Date | null;
    amount: string | null;
    paidAmount: string | null;
    status: string;
    dreCategory: string | null;
    dreCategoryName: string | null;
  };

  let rows: DrillRow[];

  if (dreCategoryId) {
    rows = await prisma.$queryRaw<DrillRow[]>`
      SELECT
        pi.id             AS "installmentId",
        p.id              AS "purchaseId",
        p."purchaseDate",
        s.name            AS "supplierName",
        p."invoiceNumber",
        p."purchaseNumber",
        p."expenseType",
        pi.installment,
        pi."dueDate",
        pi."paidDate",
        pi.amount,
        pi."paidAmount",
        pi.status,
        pi."dreCategory",
        dc.name           AS "dreCategoryName"
      FROM "PaymentInstallment" pi
      JOIN "Purchase" p ON p.id = pi."purchaseId"
      JOIN "Supplier" s ON s.id = p."supplierId"
      LEFT JOIN "DRECategory" dc ON dc.id = pi."dreCategory"
      WHERE p.status = 'ACTIVE'
        AND pi.status NOT IN ('CANCELLED')
        AND pi."dreCategory" = ${dreCategoryId}
        AND (
          (pi."paidDate" IS NOT NULL AND pi."paidDate" >= ${range.from} AND pi."paidDate" <= ${range.to})
          OR (pi."paidDate" IS NULL AND pi."dueDate" IS NOT NULL AND pi."dueDate" >= ${range.from} AND pi."dueDate" <= ${range.to})
        )
      ORDER BY COALESCE(pi."paidDate", pi."dueDate") ASC
      LIMIT 200
    `;
  } else {
    rows = await prisma.$queryRaw<DrillRow[]>`
      SELECT
        pi.id             AS "installmentId",
        p.id              AS "purchaseId",
        p."purchaseDate",
        s.name            AS "supplierName",
        p."invoiceNumber",
        p."purchaseNumber",
        p."expenseType",
        pi.installment,
        pi."dueDate",
        pi."paidDate",
        pi.amount,
        pi."paidAmount",
        pi.status,
        pi."dreCategory",
        NULL::text        AS "dreCategoryName"
      FROM "PaymentInstallment" pi
      JOIN "Purchase" p ON p.id = pi."purchaseId"
      JOIN "Supplier" s ON s.id = p."supplierId"
      WHERE p.status = 'ACTIVE'
        AND pi.status NOT IN ('CANCELLED')
        AND pi."dreCategory" IS NULL
        AND (
          (pi."paidDate" IS NOT NULL AND pi."paidDate" >= ${range.from} AND pi."paidDate" <= ${range.to})
          OR (pi."paidDate" IS NULL AND pi."dueDate" IS NOT NULL AND pi."dueDate" >= ${range.from} AND pi."dueDate" <= ${range.to})
        )
      ORDER BY COALESCE(pi."paidDate", pi."dueDate") ASC
      LIMIT 200
    `;
  }

  response.json(rows.map((r) => ({
    installmentId: r.installmentId,
    purchaseId: r.purchaseId,
    purchaseDate: r.purchaseDate,
    supplierName: r.supplierName,
    invoiceNumber: r.invoiceNumber,
    purchaseNumber: r.purchaseNumber,
    expenseType: r.expenseType,
    installment: r.installment,
    dueDate: r.dueDate,
    paidDate: r.paidDate,
    amount: Number(r.amount ?? 0),
    paidAmount: r.paidAmount != null ? Number(r.paidAmount) : null,
    effectiveAmount: r.paidAmount != null ? Number(r.paidAmount) : Number(r.amount ?? 0),
    status: r.status,
    dreCategoryId: r.dreCategory,
    dreCategoryName: r.dreCategoryName ?? "Não categorizada"
  })));
});

// Atribuir dreCategory a uma parcela
dreRouter.patch("/installment/:id/category", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const { dreCategoryId } = request.body;
  await prisma.$executeRaw`
    UPDATE "PaymentInstallment"
    SET "dreCategory" = ${dreCategoryId ?? null}
    WHERE id = ${request.params.id}
  `;

  await auditLog({ userId: user.id, action: "UPDATE", entity: "PaymentInstallment", entityId: request.params.id, newValue: { dreCategory: dreCategoryId } });
  response.json({ ok: true });
});

// ─────────────────────────────────────────────
// CLASSIFICAÇÃO DE DESPESAS
// ─────────────────────────────────────────────

// Regras de sugestão automática de categoria por nome do fornecedor
const CATEGORY_SUGGESTIONS: Array<{ patterns: string[]; name: string }> = [
  { patterns: ["enel ", "cpfl", "energisa", "cemig", "celpe", "coelba", "eletropaulo"], name: "Energia Elétrica" },
  { patterns: ["sabesp", "sanepar", "copasa", "aegea", "embasa"], name: "Água e Esgoto" },
  { patterns: ["comgas", "comgás", "ultragaz", "supergasbras", "liquigas", "liqgás"], name: "Gás" },
  { patterns: ["claro", "vivo", "tim ", "oi ", "sky ", "algar", "net cabo", "brisanet", "vero "], name: "Telefonia / Internet" },
  { patterns: ["ifood", "99food", "keeta", "rappi", "uber eats", "ubereats"], name: "Marketing e Delivery" },
  { patterns: ["contabilidade", "escritorio de contab", "assessoria contab"], name: "Contador" },
  { patterns: ["simples nacional", " das ", "irrf", "darf", "gare", "icms ", "iss "], name: "Simples Nacional" },
  { patterns: ["inss patronal", "inss "], name: "INSS" },
  { patterns: ["fgts"], name: "FGTS" },
  { patterns: ["aluguel", "locacao", "locação"], name: "Aluguel" },
  { patterns: ["condominio", "condomínio", "fundo de promocao", "fundo de promoção"], name: "Condomínio" },
  { patterns: ["iptu"], name: "IPTU" },
  { patterns: ["seguro"], name: "Seguro" },
  { patterns: ["folha de pagamento", "folha pagamento", "rescisao", "rescisão", "ferias ", "férias "], name: "Folha de Pagamento" },
  { patterns: ["vale transporte", "vale-transporte"], name: "Vale-Transporte" },
  { patterns: ["plano de saude", "plano de saúde", "unimed", "sulamerica", "bradesco saude", "amil", "hapvida"], name: "Plano de Saúde" },
  { patterns: ["mr clean", "kativa", "limpeza", "higienizacao", "higienização", "descartav"], name: "Material de Limpeza" },
  { patterns: ["software", "sistema", "licenca", "licença", "saas", "chatgpt", "chat- gpt", "wix", "totvs", "linx"], name: "Sistema / Software" },
  { patterns: ["globo play", "netflix", "streaming", "spotify", "amazon prime", "disney"], name: "Streaming / TV" },
  { patterns: ["manutencao", "manutenção", "reparo", "reforma", "assistencia tecnica", "assistência técnica"], name: "Manutenção" },
  { patterns: ["marketing", "publicidade", "propaganda", "locacao de site", "locação de site"], name: "Marketing" },
  { patterns: ["frigo utensil", "equipamento", "eletrodomest"], name: "Equipamentos" },
  { patterns: ["papel plastico", "prafesta", "ricapel", "quality papel", "embalagen", "shopee", "kalunga"], name: "Descartáveis" },
  { patterns: ["banco", "tarifa bancaria", "tarifa bancária", "juros bancarios", "juros bancários", "iof bancario"], name: "Tarifa PIX / TEF" },
  { patterns: ["prolabore", "pró-labore", "pro-labore"], name: "Pró-labore" },
];

function normalizeSup(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function suggestCategory(supplierName: string): string | null {
  const n = normalizeSup(supplierName);
  for (const rule of CATEGORY_SUGGESTIONS) {
    if (rule.patterns.some((p) => n.includes(p))) return rule.name;
  }
  return null;
}

// Listar parcelas não categorizadas (com busca, ordenação, sugestão automática e filtro CMV)
dreRouter.get("/pending", async (request, response) => {
  const range = parseRange(request.query as Record<string, unknown>);
  if (!range) {
    response.status(400).json({ message: "Informe year+month ou from+to." });
    return;
  }

  const search  = request.query.search  ? String(request.query.search).trim()  : "";
  const sort    = request.query.sort    ? String(request.query.sort)            : "amount_desc";
  // type: "operational" = apenas despesas (não CMV); "cmv" = compras de estoque; "all" = todos
  const type    = request.query.type    ? String(request.query.type)            : "operational";
  const page    = Math.max(1, Number(request.query.page ?? 1));
  const perPage = Math.min(500, Math.max(1, Number(request.query.perPage ?? 200)));
  const offset  = (page - 1) * perPage;

  type PendingRow = {
    installmentId: string;
    purchaseId: string;
    purchaseDate: Date;
    supplierName: string;
    paymentMethod: string | null;
    invoiceNumber: string | null;
    purchaseNumber: string | null;
    dueDate: Date | null;
    paidDate: Date | null;
    amount: string | null;
    paidAmount: string | null;
    status: string;
    expenseType: string;
    includedInCmv: boolean;
  };

  type CountRow = { total: number; totalAmount: string };

  const searchPattern = `%${search}%`;

  // Fragmento SQL para filtrar por tipo (CMV vs operacional)
  const cmvFilter = type === "operational"
    ? Prisma.sql`AND NOT EXISTS (
        SELECT 1 FROM "PurchaseItem" pi2
        JOIN "Product" prod ON prod.id = pi2."productId"
        WHERE pi2."purchaseId" = p.id AND prod."controlsStock" = true
      )`
    : type === "cmv"
    ? Prisma.sql`AND EXISTS (
        SELECT 1 FROM "PurchaseItem" pi2
        JOIN "Product" prod ON prod.id = pi2."productId"
        WHERE pi2."purchaseId" = p.id AND prod."controlsStock" = true
      )`
    : Prisma.empty;

  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<PendingRow[]>`
      SELECT
        pi.id            AS "installmentId",
        p.id             AS "purchaseId",
        p."purchaseDate",
        s.name           AS "supplierName",
        p."paymentMethod",
        p."invoiceNumber",
        p."purchaseNumber",
        pi."dueDate",
        pi."paidDate",
        pi.amount,
        pi."paidAmount",
        pi.status,
        p."expenseType",
        EXISTS (
          SELECT 1 FROM "PurchaseItem" pi2
          JOIN "Product" prod ON prod.id = pi2."productId"
          WHERE pi2."purchaseId" = p.id AND prod."controlsStock" = true
        ) AS "includedInCmv"
      FROM "PaymentInstallment" pi
      JOIN "Purchase" p ON p.id = pi."purchaseId"
      JOIN "Supplier"  s ON s.id = p."supplierId"
      WHERE p.status = 'ACTIVE'
        AND pi.status NOT IN ('CANCELLED')
        AND pi."dreCategory" IS NULL
        AND (
          (pi."paidDate"  IS NOT NULL AND pi."paidDate"  >= ${range.from} AND pi."paidDate"  <= ${range.to})
          OR (pi."paidDate" IS NULL AND pi."dueDate" IS NOT NULL AND pi."dueDate" >= ${range.from} AND pi."dueDate" <= ${range.to})
        )
        AND (${search} = '' OR s.name ILIKE ${searchPattern})
        ${cmvFilter}
      ORDER BY
        CASE WHEN ${sort} = 'amount_desc' THEN COALESCE(pi."paidAmount", pi.amount, 0) END DESC,
        CASE WHEN ${sort} = 'amount_asc'  THEN COALESCE(pi."paidAmount", pi.amount, 0) END ASC,
        CASE WHEN ${sort} = 'date_desc'   THEN COALESCE(pi."paidDate", pi."dueDate") END DESC,
        CASE WHEN ${sort} = 'date_asc'    THEN COALESCE(pi."paidDate", pi."dueDate") END ASC,
        COALESCE(pi."paidAmount", pi.amount, 0) DESC
      LIMIT ${perPage} OFFSET ${offset}
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT
        COUNT(*) AS total,
        SUM(COALESCE(pi."paidAmount", pi.amount, 0)) AS "totalAmount"
      FROM "PaymentInstallment" pi
      JOIN "Purchase" p ON p.id = pi."purchaseId"
      JOIN "Supplier"  s ON s.id = p."supplierId"
      WHERE p.status = 'ACTIVE'
        AND pi.status NOT IN ('CANCELLED')
        AND pi."dreCategory" IS NULL
        AND (
          (pi."paidDate"  IS NOT NULL AND pi."paidDate"  >= ${range.from} AND pi."paidDate"  <= ${range.to})
          OR (pi."paidDate" IS NULL AND pi."dueDate" IS NOT NULL AND pi."dueDate" >= ${range.from} AND pi."dueDate" <= ${range.to})
        )
        AND (${search} = '' OR s.name ILIKE ${searchPattern})
        ${cmvFilter}
    `,
  ]);

  response.json({
    total: Number(countRows[0]?.total ?? 0),
    totalAmount: Number(countRows[0]?.totalAmount ?? 0),
    page,
    perPage,
    rows: rows.map((r) => {
      const includedInCmv = Boolean(r.includedInCmv);
      const origin: "cmv_purchase" | "operational" = includedInCmv ? "cmv_purchase" : "operational";
      const classificationRisk = includedInCmv
        ? "Já entra no CMV. Classificar como despesa operacional causará dupla contagem."
        : null;
      return {
        installmentId: r.installmentId,
        purchaseId: r.purchaseId,
        purchaseDate: r.purchaseDate,
        supplierName: r.supplierName,
        paymentMethod: r.paymentMethod,
        invoiceNumber: r.invoiceNumber,
        purchaseNumber: r.purchaseNumber,
        dueDate: r.dueDate,
        paidDate: r.paidDate,
        amount: Number(r.amount ?? 0),
        effectiveAmount: r.paidAmount != null ? Number(r.paidAmount) : Number(r.amount ?? 0),
        status: r.status,
        expenseType: r.expenseType,
        includedInCmv,
        origin,
        classificationRisk,
        suggestedCategoryName: includedInCmv ? null : suggestCategory(r.supplierName),
      };
    }),
  });
});

// Atribuir dreCategory em lote a múltiplas parcelas
dreRouter.patch("/installments/bulk-category", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const { installmentIds, dreCategoryId, allowCmvItems } = request.body as {
    installmentIds: string[];
    dreCategoryId: string | null;
    allowCmvItems?: boolean;
  };

  if (!Array.isArray(installmentIds) || installmentIds.length === 0) {
    response.status(400).json({ message: "installmentIds deve ser um array não vazio." });
    return;
  }
  if (installmentIds.length > 500) {
    response.status(400).json({ message: "Máximo de 500 parcelas por lote." });
    return;
  }

  // Guard: bloquear classificação de compras de estoque (CMV) sem confirmação explícita
  if (!allowCmvItems) {
    const [cmvCheck] = await prisma.$queryRaw<[{ cmvCount: number }]>`
      SELECT COUNT(*) AS "cmvCount"
      FROM "PaymentInstallment" pi
      JOIN "Purchase" p ON p.id = pi."purchaseId"
      WHERE pi.id = ANY(${installmentIds}::text[])
        AND EXISTS (
          SELECT 1 FROM "PurchaseItem" pi2
          JOIN "Product" prod ON prod.id = pi2."productId"
          WHERE pi2."purchaseId" = p.id AND prod."controlsStock" = true
        )
    `;
    const cmvCount = Number(cmvCheck?.cmvCount ?? 0);
    if (cmvCount > 0) {
      response.status(422).json({
        message: `${cmvCount} parcela(s) pertencem a compras de estoque (CMV). Classificá-las como despesa operacional causará dupla contagem no DRE. Confirme enviando allowCmvItems: true.`,
        cmvCount,
        requiresConfirmation: true,
      });
      return;
    }
  }

  await prisma.$executeRaw`
    UPDATE "PaymentInstallment"
    SET "dreCategory" = ${dreCategoryId ?? null}
    WHERE id = ANY(${installmentIds}::text[])
  `;

  await auditLog({
    userId: user.id,
    action: "BULK_UPDATE",
    entity: "PaymentInstallment",
    entityId: null,
    newValue: { dreCategory: dreCategoryId, count: installmentIds.length, ids: installmentIds, allowCmvItems: allowCmvItems ?? false },
  });

  response.json({ ok: true, updated: installmentIds.length });
});

// ─────────────────────────────────────────────
// DRE CATEGORIES CRUD
// ─────────────────────────────────────────────

dreRouter.get("/categories", async (_request, response) => {
  const rows = await prisma.dRECategory.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
  });
  response.json(rows);
});

dreRouter.get("/categories/all", async (_request, response) => {
  const rows = await prisma.dRECategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
  });
  response.json(rows);
});

dreRouter.post("/categories", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const name = String(request.body.name ?? "").trim();
  if (!name) {
    response.status(400).json({ message: "Nome é obrigatório." });
    return;
  }

  const existing = await prisma.dRECategory.findFirst({ where: { name } });
  if (existing) {
    response.status(400).json({ message: "Já existe uma categoria com este nome." });
    return;
  }

  const row = await prisma.dRECategory.create({
    data: {
      id: crypto.randomUUID(),
      name,
      dreGroup: String(request.body.dreGroup ?? "DESPESAS_OPERACIONAIS"),
      sortOrder: Number(request.body.sortOrder ?? 0),
      notes: String(request.body.notes ?? "").trim() || null
    }
  });

  await auditLog({ userId: user.id, action: "CREATE", entity: "DRECategory", entityId: row.id, newValue: row });
  response.json(row);
});

dreRouter.put("/categories/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const name = String(request.body.name ?? "").trim();
  if (!name) {
    response.status(400).json({ message: "Nome é obrigatório." });
    return;
  }

  const dup = await prisma.dRECategory.findFirst({ where: { name, NOT: { id: request.params.id } } });
  if (dup) {
    response.status(400).json({ message: "Já existe uma categoria com este nome." });
    return;
  }

  const row = await prisma.dRECategory.update({
    where: { id: request.params.id },
    data: {
      name,
      dreGroup: String(request.body.dreGroup ?? "DESPESAS_OPERACIONAIS"),
      sortOrder: Number(request.body.sortOrder ?? 0),
      notes: String(request.body.notes ?? "").trim() || null,
      isActive: request.body.isActive !== false
    }
  });

  await auditLog({ userId: user.id, action: "UPDATE", entity: "DRECategory", entityId: row.id, newValue: row });
  response.json(row);
});

// Lock para evitar execuções simultâneas do seed (duplo-clique / race condition)
let seedRunning = false;

// Normaliza nome para comparação: remove acentos, minúsculas, trim, espaços múltiplos
function normalizeName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

// Seed: cria categorias padrão baseadas na planilha gerencial (ADMIN)
dreRouter.post("/categories/seed", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN"]);
  if (!user) return;

  if (seedRunning) {
    response.status(409).json({ ok: false, message: "Seed já está em execução." });
    return;
  }
  seedRunning = true;

  try {
    // Busca todos os registros existentes de uma vez (evita N queries)
    const existingMap = new Map(
      (await prisma.dRECategory.findMany({ select: { id: true, name: true, dreGroup: true } }))
        .map(c => [normalizeName(c.name), { id: c.id, dreGroup: c.dreGroup }])
    );

    let created = 0;
    let moved = 0;
    let skipped = 0;
    for (const seed of SEED_CATEGORIES) {
      const key = normalizeName(seed.name);
      const existing = existingMap.get(key);
      if (existing) {
        if (existing.dreGroup !== seed.dreGroup) {
          // Categoria existe mas está no grupo errado — mover para o grupo correto
          await prisma.dRECategory.update({
            where: { id: existing.id },
            data: { dreGroup: seed.dreGroup, sortOrder: seed.sortOrder }
          });
          existingMap.set(key, { id: existing.id, dreGroup: seed.dreGroup });
          moved++;
        } else {
          skipped++;
        }
        continue;
      }
      await prisma.dRECategory.create({
        data: {
          id: crypto.randomUUID(),
          name: seed.name,
          dreGroup: seed.dreGroup,
          sortOrder: seed.sortOrder,
          notes: null
        }
      });
      existingMap.set(key, { id: "new", dreGroup: seed.dreGroup }); // evita duplicar dentro do mesmo loop
      created++;
    }

    await auditLog({ userId: user.id, action: "CREATE", entity: "DRECategory", entityId: "seed", newValue: { created, moved, skipped } });
    response.json({ ok: true, created, moved, skipped });
  } finally {
    seedRunning = false;
  }
});

// ─────────────────────────────────────────────
// PDF EXPORT
// ─────────────────────────────────────────────

dreRouter.get("/export/pdf", async (request, response) => {
  const range = parseRange(request.query as Record<string, unknown>);
  if (!range) {
    response.status(400).json({ message: "Informe year+month ou from+to." });
    return;
  }

  const data = await calcDRE(range.from, range.to);

  // Uncategorized operacional: despesas sem dreCategoryId na nova lógica (Parte A + B sem categoria)
  const uncatLine = data.expenses.find((e) => e.dreCategoryId === null);
  const operationalUncatCount = uncatLine?.count ?? 0;
  const operationalUncatTotal = uncatLine?.total ?? 0;
  const pdf = createDrePdf(data, { operationalUncatCount, operationalUncatTotal });

  const fromISO = range.from.toISOString().slice(0, 7); // YYYY-MM
  const filename = `dre-gerencial-${fromISO}.pdf`;
  response.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": String(pdf.length),
    "X-Content-Type-Options": "nosniff"
  });
  response.send(pdf);
});
