import crypto from "node:crypto";
import { Router } from "express";
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
  { name: "Uniformes",            dreGroup: "DESPESAS_GERAIS",   sortOrder: 77 },
  { name: "Descartáveis",         dreGroup: "DESPESAS_GERAIS",   sortOrder: 78 },
  { name: "Publicidade",          dreGroup: "DESPESAS_GERAIS",   sortOrder: 79 },
  { name: "Outras Despesas Gerais", dreGroup: "DESPESAS_GERAIS", sortOrder: 80 },
  // PLANEJAMENTO
  { name: "Provisão 13° Salário", dreGroup: "PLANEJAMENTO",      sortOrder: 81 },
  { name: "Marketing",            dreGroup: "PLANEJAMENTO",      sortOrder: 82 },
  { name: "Investimentos",        dreGroup: "PLANEJAMENTO",      sortOrder: 83 },
];

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function parseRange(query: Record<string, unknown>): { from: Date; to: Date } | null {
  const year = query.year ? Number(query.year) : null;
  const month = query.month ? Number(query.month) : null;
  const from = query.from ? new Date(String(query.from)) : null;
  const to = query.to ? new Date(String(query.to)) : null;

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
  // ── Revenue ──────────────────────────────────
  const revenueRows = await prisma.$queryRaw<Array<{
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
  `;

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

  // ── CMV on-the-fly ────────────────────────────
  // Estoque inicial: snapshot mais recente do tipo INVENTARIO_INICIAL/FINAL antes do período
  const snapInitial = await prisma.$queryRaw<Array<{ totalValue: string }>>`
    SELECT SUM(si."totalCost") AS "totalValue"
    FROM "InventorySnapshotItem" si
    JOIN "InventorySnapshot" s ON s.id = si."snapshotId"
    WHERE s.status = 'ACTIVE'
      AND s."countDate" < ${from}
      AND s.type IN ('INVENTARIO_INICIAL', 'INVENTARIO_FINAL', 'CONTAGEM_PARCIAL')
    ORDER BY s."countDate" DESC
    LIMIT 1
  `;

  // Para snapshot inicial: pegar o valor do snapshot mais recente ANTES do período
  const snapInitialValue = await prisma.$queryRaw<Array<{ totalValue: string | null }>>`
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
  `;

  // Estoque final: snapshot mais recente dentro ou logo após o período
  const snapFinalValue = await prisma.$queryRaw<Array<{ totalValue: string | null }>>`
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
  `;

  // Compras no período
  const purchasesInPeriod = await prisma.$queryRaw<Array<{ total: string | null }>>`
    SELECT SUM("totalAmount") AS total
    FROM "Purchase"
    WHERE status = 'ACTIVE'
      AND "purchaseDate" >= ${from}
      AND "purchaseDate" <= ${to}
  `;

  const estoqueInicial = Number(snapInitialValue[0]?.totalValue ?? 0);
  const estoqueFinal = Number(snapFinalValue[0]?.totalValue ?? 0);
  const compras = Number(purchasesInPeriod[0]?.total ?? 0);
  const cmvReal = estoqueInicial + compras - estoqueFinal;
  const cmvPercent = totalGross > 0 ? (cmvReal / totalGross) * 100 : null;
  const lucroBruto = totalNet - cmvReal;

  // ── Despesas operacionais ─────────────────────
  // Usa dueDate para competência (regime de competência) para parcelas não pagas
  // e paidDate para parcelas pagas
  const expenseRows = await prisma.$queryRaw<Array<{
    dreCategory: string | null;
    dreCategoryName: string | null;
    dreSortOrder: number | null;
    dreGroup: string | null;
    total: string;
    count: number;
  }>>`
    SELECT
      pi."dreCategory",
      dc.name AS "dreCategoryName",
      dc."sortOrder" AS "dreSortOrder",
      dc."dreGroup" AS "dreGroup",
      SUM(COALESCE(pi."paidAmount", pi.amount, 0)) AS total,
      COUNT(*) AS count
    FROM "PaymentInstallment" pi
    LEFT JOIN "DRECategory" dc ON dc.id = pi."dreCategory"
    JOIN "Purchase" p ON p.id = pi."purchaseId"
    WHERE p.status = 'ACTIVE'
      AND pi.status NOT IN ('CANCELLED')
      AND (
        (pi."paidDate" IS NOT NULL AND pi."paidDate" >= ${from} AND pi."paidDate" <= ${to})
        OR (pi."paidDate" IS NULL AND pi."dueDate" IS NOT NULL AND pi."dueDate" >= ${from} AND pi."dueDate" <= ${to})
      )
    GROUP BY pi."dreCategory", dc.name, dc."sortOrder", dc."dreGroup"
    ORDER BY COALESCE(dc."sortOrder", 999), COALESCE(dc.name, 'ZZZ')
  `;

  const expenses = expenseRows.map((r) => ({
    dreCategoryId: r.dreCategory ?? null,
    dreCategoryName: r.dreCategoryName ?? "Não categorizadas",
    dreGroup: r.dreGroup ?? "DESPESAS_OPERACIONAIS",
    sortOrder: r.dreSortOrder ?? 999,
    total: Number(r.total),
    count: Number(r.count)
  }));

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
    : "CMV calculado por compras do período. Inventário inicial ou final não localizado — não reflete consumo real.";

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

// Seed: cria categorias padrão baseadas na planilha gerencial (ADMIN)
dreRouter.post("/categories/seed", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN"]);
  if (!user) return;

  let created = 0;
  let skipped = 0;
  for (const seed of SEED_CATEGORIES) {
    const existing = await prisma.dRECategory.findFirst({ where: { name: seed.name } });
    if (existing) { skipped++; continue; }
    await prisma.dRECategory.create({
      data: {
        id: crypto.randomUUID(),
        name: seed.name,
        dreGroup: seed.dreGroup,
        sortOrder: seed.sortOrder,
        notes: null
      }
    });
    created++;
  }

  await auditLog({ userId: user.id, action: "CREATE", entity: "DRECategory", entityId: "seed", newValue: { created, skipped } });
  response.json({ ok: true, created, skipped });
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
  const pdf = createDrePdf(data);

  response.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="dre-${range.from.toISOString().slice(0, 10)}.pdf"`
  });
  response.send(pdf);
});
