// Painel de Fechamento Mensal (CMV v2 — 2026-07-15)
//
// Consolida o status de fechamento de um mes contabil especifico:
// faturamento, compras, fornecedores obrigatorios, impostos, inventario final,
// CMV real do ciclo (rateado por dias) e justificativas registradas.
//
// Ver docs/arquitetura-cmv-dre-v2.md — dimensao A (mes contabil rigido).

import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import crypto from "node:crypto";
import { REVENUE_CHANNEL_EVENTS } from "../monthly/revenue-channels.js";
import { excludeAggregatorsSql } from "../purchases/purchase-aggregators.js";
import {
  avaliarExigencias,
  fornecedorPresenteComExigencias,
  pendenciasDasExigencias,
  type ExigenciaAvaliada,
  type ExigenciaCadastrada,
  type LancamentoDoProduto
} from "./exigencias-do-fornecedor.js";
import { anexarNomes } from "./justificativas-com-nome.js";
import { avaliarCartoesDoMes, type CartaoDoMes, type FaturaDoMes } from "./cartoes-do-fechamento.js";
import {
  avaliarCanaisDeDelivery,
  diasEsperadosDoMes,
  type FaturamentoDoCanal,
  avaliarFaturamentoDeEventos,
  avaliarFolhaLancada,
  avaliarGorjetaDoMes,
} from "./pendencias-do-mes.js";

export type ClosingBlockKey =
  | `supplier:${string}`
  | "block:taxes"
  | "block:finalInventory"
  | "block:revenue"
  | `block:${string}`;

export type ClosureJustification = {
  blockKey: string;
  reason: string;
  justifiedByUserId: string;
  justifiedByName?: string | null;
  justifiedAt: string;
};

type CmvContribution = {
  cmvPeriodId: string;
  code: string | null;
  cycleStart: string;
  cycleEnd: string;
  cmvReal: number;
  daysInMonth: number;
  totalDays: number;
  contribution: number;
};

function daysInclusive(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.floor(ms / 86400000) + 1;
}

function monthRange(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { start, end };
}

function toIsoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function toNumber(v: any): number {
  if (v == null) return 0;
  if (typeof v === "bigint") return Number(v);
  return Number(v);
}

// Rateio de CMV dos ciclos que interceptam o mes, por dias corridos (decisao Eli 2026-07-14).
export async function getCmvAttributedToMonth(year: number, month: number) {
  const { start: monthStart, end: monthEnd } = monthRange(year, month);
  const cycles = await prisma.$queryRaw<Array<{
    id: string;
    code: string | null;
    dataInicial: Date;
    dataFinal: Date;
    cmvReal: any;
  }>>`
    SELECT id, code, "dataInicial", "dataFinal", "cmvReal"
    FROM "CmvPeriod"
    WHERE "dataInicial" <= ${monthEnd} AND "dataFinal" >= ${monthStart}
    ORDER BY "dataInicial" ASC
  `;

  const contributions: CmvContribution[] = [];
  let total = 0;
  for (const c of cycles) {
    const cycleStart = new Date(c.dataInicial);
    const cycleEnd = new Date(c.dataFinal);
    const overlapStart = cycleStart > monthStart ? cycleStart : monthStart;
    const overlapEnd = cycleEnd < monthEnd ? cycleEnd : monthEnd;
    const daysInMonth = daysInclusive(overlapStart, overlapEnd);
    const totalDays = daysInclusive(cycleStart, cycleEnd);
    const cmvReal = toNumber(c.cmvReal);
    const contribution = totalDays > 0 ? (cmvReal * daysInMonth) / totalDays : 0;
    contributions.push({
      cmvPeriodId: c.id,
      code: c.code,
      cycleStart: toIsoDate(cycleStart),
      cycleEnd: toIsoDate(cycleEnd),
      cmvReal,
      daysInMonth,
      totalDays,
      contribution,
    });
    total += contribution;
  }
  return { total, breakdown: contributions };
}

// O razao e a fonte unica do faturamento do mes: ele ja contem salao E delivery,
// com o delivery conciliado contra o repasse da plataforma.
//
// Ate 18/09/2026 `salon` era um SELECT sobre TODO o RevenueEntry (sem filtrar
// origem) e o total somava `salon + ifood + noventaNove` — contando o delivery
// duas vezes, R$ [valor] entre abril e setembro. Ver faturamento-do-mes.ts.
async function getRevenueSummary(year: number, month: number) {
  const { start, end } = monthRange(year, month);

  const [salon] = await prisma.$queryRaw<Array<{
    grossAmount: any; netAmount: any; daysCount: any; entryCount: any;
  }>>`
    SELECT COALESCE(SUM("grossAmount"), 0) AS "grossAmount",
           COALESCE(SUM("netAmount"), 0) AS "netAmount",
           COUNT(DISTINCT DATE("date" AT TIME ZONE 'UTC')) AS "daysCount",
           COUNT(*) AS "entryCount"
    FROM "RevenueEntry"
    WHERE "status" <> 'CANCELLED'
      AND "channel" = 'Salão'
      AND "date" >= ${start} AND "date" <= ${end}
  `;

  // Uma linha por plataforma, do MESMO razao — para a tela mostrar a composicao
  // sem inventar uma segunda base.
  const plataformas = await prisma.$queryRaw<Array<{ sourcePlatform: string | null; grossAmount: any; netAmount: any; tickets: any }>>`
    SELECT "sourcePlatform",
           COALESCE(SUM("grossAmount"), 0) AS "grossAmount",
           COALESCE(SUM("netAmount"), 0) AS "netAmount",
           COALESCE(SUM("tickets"), 0) AS "tickets"
    FROM "RevenueEntry"
    WHERE "status" <> 'CANCELLED'
      AND "channel" <> 'Salão'
      AND "channel" <> ${REVENUE_CHANNEL_EVENTS}
      AND "date" >= ${start} AND "date" <= ${end}
    GROUP BY "sourcePlatform"
  `;

  const [total] = await prisma.$queryRaw<Array<{ grossAmount: any; netAmount: any }>>`
    SELECT COALESCE(SUM("grossAmount"), 0) AS "grossAmount",
           COALESCE(SUM("netAmount"), 0) AS "netAmount"
    FROM "RevenueEntry"
    WHERE "status" <> 'CANCELLED'
      AND "date" >= ${start} AND "date" <= ${end}
  `;

  const porPlataforma = (nome: string) => {
    const linha = plataformas.find((row) => row.sourcePlatform === nome);
    return {
      grossAmount: toNumber(linha?.grossAmount),
      count: toNumber(linha?.tickets),
    };
  };

  const conhecidas = new Set(["iFood", "NOVENTA_NOVE"]);
  const outras = plataformas.filter((row) => !conhecidas.has(row.sourcePlatform ?? ""));

  return {
    salon: {
      grossAmount: toNumber(salon?.grossAmount),
      netAmount: toNumber(salon?.netAmount),
      daysCount: toNumber(salon?.daysCount),
      entryCount: toNumber(salon?.entryCount),
    },
    ifood: porPlataforma("iFood"),
    noventaNove: porPlataforma("NOVENTA_NOVE"),
    outrosDelivery: {
      grossAmount: outras.reduce((soma, row) => soma + toNumber(row.grossAmount), 0),
      count: outras.reduce((soma, row) => soma + toNumber(row.tickets), 0),
      plataformas: outras.map((row) => row.sourcePlatform ?? "(sem origem)"),
    },
    total: {
      grossAmount: toNumber(total?.grossAmount),
      netAmount: toNumber(total?.netAmount),
    },
  };
}

// Nota lancada pelo total, sem itemizar. O financeiro usa Purchase.totalAmount
// e o CMV soma PurchaseItem.totalPrice — entao a nota sem item entra em contas
// a pagar e no DRE, e vale ZERO no CMV. Em jun/jul/ago de 2026 isso escondeu
// R$ [valor] de hortifruti, entre 7,6% e 10,3% das compras do mes.
//
// Fatura de cartao entra aqui com total zero e sem item por desenho, entao o
// filtro exige totalAmount > 0.
// Imposto sem competenceDate nao pertence a mes nenhum: o DRE exige
// competenceDate IS NOT NULL, entao ele some do relatorio, e como nao cai em
// nenhum mes, nenhum checklist mensal o acusa. Fica invisivel nas duas pontas.
//
// Medido em producao 09/2026: 5 lancamentos vivos e PAGOS, somando R$ [valor].
// Os dois maiores sao DAS do Simples pagos em 19/05/2026 (R$ [valor] e
// R$ [valor]). Dinheiro que saiu do banco e nao aparece em DRE nenhum.
//
// Nao da para deduzir a competencia da data de pagamento: imposto costuma se
// referir ao mes anterior ao vencimento, entao chutar erraria o mes. Por isso a
// pendencia pede que alguem informe, em vez de o sistema inventar.
export async function impostosSemCompetencia() {
  return prisma.$queryRaw<Array<{ documentType: string | null; amount: any; dueDate: Date | null }>>`
    SELECT "documentType" AS "documentType", "amount" AS "amount", "dueDate" AS "dueDate"
    FROM "TaxPayment"
    WHERE "deletedAt" IS NULL
      AND "status" <> 'CANCELED'
      AND "competenceDate" IS NULL
    ORDER BY "dueDate" ASC
  `;
}

// Item contado com custo zero nao soma nada no inventario, e o inventario e uma
// das tres pernas do CMV (inicial + compras - final). O snapshot e gravado com
// unitCost NULL quando o produto nao tem custo na contagem, o total e calculado
// e o mes fecha sem ninguem ver — a contagem parece completa porque os itens
// ESTAO la, so valem zero.
//
// Medido em producao 09/2026: o inventario final de junho tinha 62 itens assim,
// valendo cerca de R$ 19 mil (20% do proprio inventario) quando valorados pelo
// custo que o sistema atribui ao mesmo produto na mesma unidade em outra
// contagem. Julho, 39 itens e ~18%. Quase todos bebida.
export async function itensDeInventarioSemCusto(year: number, month: number) {
  return prisma.$queryRaw<Array<{ productName: string | null; unit: string | null; quantity: any }>>`
    SELECT i."productName" AS "productName", i."unit" AS "unit", i."quantity" AS "quantity"
    FROM "InventorySnapshotItem" i
    JOIN "InventorySnapshot" s ON s."id" = i."snapshotId"
    WHERE s."competenceYear" = ${year} AND s."competenceMonth" = ${month}
      AND s."type" = 'INVENTARIO_FINAL'
      AND s."status" IN ('ACTIVE', 'APPROVED')
      AND COALESCE(i."unitCost", 0) = 0
      AND i."quantity" > 0
    ORDER BY i."quantity" DESC
  `;
}

// A folha vincula a categoria de DRE por NOME ("Folha de Pagamento", "Vale-Transporte",
// "Rescisão", "Férias"). Renomear ou apagar a categoria na tela nao quebra nada visivel:
// o lancamento nasce com dreCategoryId null e some do grupo PESSOAL do DRE, caindo em
// "Sem categoria". O gasto continua no caixa e no Contas a Pagar — so a LINHA do DRE muda.
// Por isso a verificacao mora aqui, no fechamento: pega os quatro nomes de uma vez e
// tambem os lancamentos ja gravados, nao so os novos.
export async function folhaSemCategoriaDre(year: number, month: number) {
  return prisma.$queryRaw<Array<{ tipo: string; quantidade: bigint; total: any }>>`
    SELECT p."type" AS "tipo", COUNT(*) AS "quantidade", SUM(p."amount") AS "total"
    FROM "PayrollItem" p
    WHERE p."competenceYear" = ${year} AND p."competenceMonth" = ${month}
      AND p."deletedAt" IS NULL
      AND p."dreCategoryId" IS NULL
    GROUP BY p."type"
    ORDER BY SUM(p."amount") DESC
  `;
}

// Este sistema tem DUAS dimensoes por desenho: competencia (DRE, fechamento) e
// purchaseDate (CMV Real, consumo entre duas contagens fisicas). Divergir em um mes e
// normal — nota emitida na virada, mercadoria do mes anterior faturada agora. Dois
// meses ou mais nao e: e erro de digitacao no mes ou no ano.
//
// Custa caro porque cada dimensao le um campo. A nota entra no DRE pela competencia
// (certa) e no CMV Real pela purchaseDate (errada), entao o consumo aparece num
// periodo em que a mercadoria nao foi comprada e falta no periodo em que foi.
//
// Medido em 11/09/2026: de 814 compras ativas, 16 divergem, e 15 sao de um mes so.
// A unica com dois meses ou mais era a NF de uma peixaria — 31 kg de tilapia
// congelada com purchaseDate em 02/03 e competencia 09/2026, criada em 04/09 com
// parcela vencendo em 24/09. Marco no lugar de setembro.
//
// Avisa em vez de bloquear a escrita: nota antiga lancada depois e legitima na carga
// historica, e so quem ve a nota sabe qual das duas datas esta certa.
export async function comprasComDataLongeDaCompetencia(year: number, month: number) {
  return prisma.$queryRaw<Array<{ invoiceNumber: string | null; supplierName: string | null; purchaseDate: Date; totalAmount: any; defasagem: number }>>`
    SELECT pu."invoiceNumber" AS "invoiceNumber",
           s."name" AS "supplierName",
           pu."purchaseDate" AS "purchaseDate",
           pu."totalAmount" AS "totalAmount",
           ((pu."competenceYear" * 12 + pu."competenceMonth")
             - (EXTRACT(YEAR FROM pu."purchaseDate")::int * 12 + EXTRACT(MONTH FROM pu."purchaseDate")::int)) AS "defasagem"
    FROM "Purchase" pu
    LEFT JOIN "Supplier" s ON s."id" = pu."supplierId"
    WHERE pu."status" = 'ACTIVE'
      AND pu."competenceYear" = ${year} AND pu."competenceMonth" = ${month}
      AND ABS((pu."competenceYear" * 12 + pu."competenceMonth")
            - (EXTRACT(YEAR FROM pu."purchaseDate")::int * 12 + EXTRACT(MONTH FROM pu."purchaseDate")::int)) >= 2
    ORDER BY pu."totalAmount" DESC
  `;
}

export async function comprasSemItem(year: number, month: number) {
  return prisma.$queryRaw<Array<{ purchaseNumber: string | null; supplierName: string | null; totalAmount: any }>>`
    SELECT p."purchaseNumber" AS "purchaseNumber",
           s."name" AS "supplierName",
           p."totalAmount" AS "totalAmount"
    FROM "Purchase" p
    LEFT JOIN "Supplier" s ON s."id" = p."supplierId"
    WHERE p."competenceYear" = ${year} AND p."competenceMonth" = ${month}
      AND p."status" = 'ACTIVE'
      AND p."totalAmount" > 0
      AND NOT EXISTS (SELECT 1 FROM "PurchaseItem" pi WHERE pi."purchaseId" = p."id")
      -- Agregador nao e nota sem itemizacao: e veiculo de pagamento. O ciclo de
      -- fornecedor e a fatura de cartao geram uma Purchase sem item de proposito,
      -- porque a despesa ja esta nas compras individuais que eles agrupam.
      -- Conferido em producao: nos 7 ciclos fechados o total do ciclo bate
      -- exatamente com a soma das compras ativas dele, e essas compras carregam
      -- os itens de produto (316, 200, 154, 104, 84, 57 e 41 itens). Marcar o
      -- agregador como pendencia mandava itemizar o que ja estava itemizado, e
      -- itemiza-lo de fato DOBRARIA a despesa no CMV.
      AND NOT EXISTS (SELECT 1 FROM "SupplierBillingCycle" cy WHERE cy."generatedPurchaseId" = p."id")
      AND NOT EXISTS (SELECT 1 FROM "CreditCardStatement" cs WHERE cs."generatedPurchaseId" = p."id")
      AND NOT EXISTS (SELECT 1 FROM "ReimbursementReport" rr WHERE rr."generatedPurchaseId" = p."id")
      AND COALESCE(p."workflowStatus", '') <> 'REIMBURSEMENT'
    ORDER BY p."totalAmount" DESC
  `;
}

async function getPurchasesSummary(year: number, month: number) {
  // O mesmo agregador que comprasSemItem (logo acima) ja sabia nao ser nota
  // precisa sair tambem daqui: somar o totalAmount dele repete a despesa que as
  // compras individuais do ciclo ja trouxeram. Ver purchase-aggregators.ts.
  const [total] = await prisma.$queryRaw<Array<{ total: any; count: any }>>`
    SELECT COALESCE(SUM("totalAmount"), 0) AS "total", COUNT(*) AS "count"
    FROM "Purchase"
    WHERE "competenceYear" = ${year} AND "competenceMonth" = ${month} AND "status" = 'ACTIVE'
      AND ${excludeAggregatorsSql()}
  `;
  const byCategory = await prisma.$queryRaw<Array<{ categoryName: string | null; total: any; count: any }>>`
    SELECT COALESCE(dc."name", 'Sem categoria DRE') AS "categoryName",
           COALESCE(SUM(pi."totalPrice"), 0) AS "total",
           COUNT(DISTINCT p."id") AS "count"
    FROM "Purchase" p
    JOIN "PurchaseItem" pi ON pi."purchaseId" = p."id"
    JOIN "Product" pr ON pr."id" = pi."productId"
    LEFT JOIN "DRECategory" dc ON dc."id" = pr."dreCategoryId"
    WHERE p."competenceYear" = ${year} AND p."competenceMonth" = ${month} AND p."status" = 'ACTIVE'
    GROUP BY dc."name"
    ORDER BY COALESCE(SUM(pi."totalPrice"), 0) DESC
  `;
  return {
    total: toNumber(total?.total),
    count: toNumber(total?.count),
    byCategory: byCategory.map(c => ({
      categoryName: c.categoryName ?? "Sem categoria DRE",
      total: toNumber(c.total),
      count: toNumber(c.count),
    })),
  };
}

// Verifica se um fornecedor obrigatorio precisa aparecer neste mes conforme frequencia.
// MONTHLY: sempre cobra
// QUARTERLY: cobra mes 1,4,7,10 (jan/abr/jul/out) — heuristica simples
// ANNUAL: cobra so em janeiro (heuristica; ajustavel via dados historicos futuros)
function frequencyRequiresThisMonth(freq: string, month: number): boolean {
  if (freq === "MONTHLY") return true;
  if (freq === "QUARTERLY") return [1, 4, 7, 10].includes(month);
  if (freq === "ANNUAL") return month === 1;
  return true;
}

// Exigências mensais dos fornecedores obrigatórios (ex.: condomínio do mês + parcela
// do acordo), cada uma reconhecida pelo PRODUTO dos itens das compras do mês — toda
// compra manual tem itens com produto, então nenhuma tela de lançamento muda.
async function getExigenciasAvaliadas(year: number, month: number, supplierIds: string[]) {
  const resultado = new Map<string, ExigenciaAvaliada[]>();
  if (supplierIds.length === 0) return resultado;

  const cadastradas = await prisma.$queryRaw<Array<ExigenciaCadastrada & { supplierId: string }>>`
    SELECT r."id" AS "id", r."supplierId" AS "supplierId", r."label" AS "label",
           r."productId" AS "productId", pr."name" AS "productName",
           r."settledAt" AS "settledAt"
    FROM "SupplierClosingRequirement" r
    JOIN "Product" pr ON pr."id" = r."productId"
    WHERE r."supplierId" = ANY(${supplierIds})
    ORDER BY r."createdAt" ASC
  `;
  if (cadastradas.length === 0) return resultado;

  const lancados = await prisma.$queryRaw<Array<{ supplierId: string; productId: string; total: any; count: any }>>`
    SELECT p."supplierId" AS "supplierId", pi."productId" AS "productId",
           COALESCE(SUM(pi."totalPrice"), 0) AS "total", COUNT(DISTINCT p."id") AS "count"
    FROM "Purchase" p
    JOIN "PurchaseItem" pi ON pi."purchaseId" = p."id"
    WHERE p."competenceYear" = ${year} AND p."competenceMonth" = ${month}
      AND p."status" = 'ACTIVE'
      AND p."supplierId" = ANY(${supplierIds})
      AND pi."productId" IN (SELECT r."productId" FROM "SupplierClosingRequirement" r WHERE r."supplierId" = ANY(${supplierIds}))
      AND ${excludeAggregatorsSql("p")}
    GROUP BY p."supplierId", pi."productId"
  `;

  for (const supplierId of new Set(cadastradas.map((c) => c.supplierId))) {
    const doFornecedor = cadastradas.filter((c) => c.supplierId === supplierId);
    const lancamentos: LancamentoDoProduto[] = lancados
      .filter((l) => l.supplierId === supplierId)
      .map((l) => ({ productId: l.productId, total: toNumber(l.total), count: toNumber(l.count) }));
    resultado.set(supplierId, avaliarExigencias(doFornecedor, lancamentos));
  }
  return resultado;
}

async function getRequiredSuppliersStatus(year: number, month: number) {
  const suppliers = await prisma.$queryRaw<Array<{
    id: string; name: string; group: string | null; frequency: string;
  }>>`
    SELECT "id", "name",
           "closingChecklistGroup" AS "group",
           "expectedClosingFrequency"::text AS "frequency"
    FROM "Supplier"
    WHERE "requiredInMonthlyClosing" = true AND "isActive" = true
    ORDER BY "closingChecklistGroup" NULLS LAST, "name"
  `;

  const totalsBySupplier = await prisma.$queryRaw<Array<{ supplierId: string; total: any; count: any }>>`
    SELECT "supplierId",
           COALESCE(SUM("totalAmount"), 0) AS "total",
           COUNT(*) AS "count"
    FROM "Purchase"
    WHERE "competenceYear" = ${year} AND "competenceMonth" = ${month}
      AND "status" = 'ACTIVE'
      AND "supplierId" = ANY(${suppliers.map(s => s.id)})
      -- Sem o filtro, o fornecedor de ciclo aparecia no checklist com o dobro do
      -- que forneceu. A presenca dele continua detectada pelas notas individuais,
      -- que sao justamente o que o ciclo agrupa.
      AND ${excludeAggregatorsSql()}
    GROUP BY "supplierId"
  `;
  const totalMap = new Map<string, { total: number; count: number }>();
  for (const t of totalsBySupplier) totalMap.set(t.supplierId, { total: toNumber(t.total), count: toNumber(t.count) });

  const exigenciasPorFornecedor = await getExigenciasAvaliadas(year, month, suppliers.map((s) => s.id));

  return suppliers.map(s => {
    const appliesThisMonth = frequencyRequiresThisMonth(s.frequency, month);
    const t = totalMap.get(s.id);
    const requirements = exigenciasPorFornecedor.get(s.id) ?? [];
    // Com exigências ativas, "presente" = TODAS lançadas; sem elas, a regra antiga:
    // qualquer compra do mês.
    const presenteComExigencias = fornecedorPresenteComExigencias(requirements);
    return {
      id: s.id,
      name: s.name,
      group: s.group ?? "Outros",
      frequency: s.frequency,
      appliesThisMonth,
      present: presenteComExigencias ?? (t?.count ?? 0) > 0,
      total: t?.total ?? 0,
      purchaseCount: t?.count ?? 0,
      requirements,
      usaExigencias: presenteComExigencias !== null,
    };
  });
}

// Cartões ativos (existentes até o fim do mês) e a fatura de cada um na competência.
// A competência da fatura é o mês da data de fechamento (ver getCardStatementPeriod).
async function getCardsStatus(year: number, month: number) {
  const { end } = monthRange(year, month);
  const cartoes = await prisma.$queryRaw<CartaoDoMes[]>`
    SELECT cc."id" AS "id", cc."name" AS "name", cc."last4Digits" AS "last4Digits"
    FROM "CreditCard" cc
    WHERE cc."isActive" = true
      AND (
        cc."createdAt" <= ${end}
        -- Cartao cadastrado depois do mes, mas com fatura dele (carga de historico):
        -- a fatura existe e precisa ser conferida.
        OR EXISTS (
          SELECT 1 FROM "CreditCardStatement" cs
          WHERE cs."creditCardId" = cc."id"
            AND cs."competenceYear" = ${year} AND cs."competenceMonth" = ${month}
        )
      )
    ORDER BY cc."name" ASC
  `;
  const faturas = await prisma.$queryRaw<Array<{ creditCardId: string; status: string; itensComDivergencia: any }>>`
    SELECT cs."creditCardId" AS "creditCardId",
           cs."status"::text AS "status",
           COUNT(i."id") FILTER (WHERE i."hasDivergence" = true) AS "itensComDivergencia"
    FROM "CreditCardStatement" cs
    LEFT JOIN "CreditCardStatementItem" i ON i."statementId" = cs."id"
    WHERE cs."competenceYear" = ${year} AND cs."competenceMonth" = ${month}
    GROUP BY cs."id"
  `;
  return {
    cartoes,
    faturas: faturas.map((f): FaturaDoMes => ({
      creditCardId: f.creditCardId,
      status: f.status,
      itensComDivergencia: toNumber(f.itensComDivergencia)
    }))
  };
}

async function contarSalariosLancados(year: number, month: number): Promise<number> {
  const [row] = await prisma.$queryRaw<Array<{ total: any }>>`
    SELECT COUNT(*) AS "total"
    FROM "PayrollItem"
    WHERE "competenceYear" = ${year} AND "competenceMonth" = ${month}
      AND "type" = 'SALARIO' AND "deletedAt" IS NULL AND "status" <> 'CANCELED'
  `;
  return toNumber(row?.total);
}

async function contarApuracoesDeGorjeta(year: number, month: number) {
  const [row] = await prisma.$queryRaw<Array<{ total: any; abertas: any }>>`
    SELECT COUNT(*) AS "total",
           COUNT(*) FILTER (WHERE "status" = 'OPEN') AS "abertas"
    FROM "TipPeriod"
    WHERE "competenceYear" = ${year} AND "competenceMonth" = ${month}
  `;
  return { total: toNumber(row?.total), abertas: toNumber(row?.abertas) };
}

// Evento/empreitada nao passa pelo Agile: a rotina "Lancar evento", em Faturamento,
// grava um RevenueEntry no canal "Eventos / Empreitada" (sourcePlatform = tipo do evento).
async function faturamentoDeEventos(year: number, month: number) {
  const { start, end } = monthRange(year, month);
  const [row] = await prisma.$queryRaw<Array<{ lancamentos: any; valor: any }>>`
    SELECT COUNT(*) AS "lancamentos", COALESCE(SUM("grossAmount"), 0) AS "valor"
    FROM "RevenueEntry"
    WHERE "status" <> 'CANCELLED'
      AND "date" >= ${start} AND "date" <= ${end}
      AND "channel" = ${REVENUE_CHANNEL_EVENTS}
  `;
  return { lancamentos: toNumber(row?.lancamentos), valor: toNumber(row?.valor) };
}

// Faturamento de cada plataforma de delivery no mes: dias com lancamento, valores e
// quantidade. Origem e canal do razao aparecem com grafias diferentes (iFood/IFOOD,
// 99Food/NOVENTA_NOVE, Keeta/KEETA): compara em maiusculas e junta as duas da 99.
async function faturamentoPorPlataforma(year: number, month: number): Promise<FaturamentoDoCanal[]> {
  const { start, end } = monthRange(year, month);
  const linhas = await prisma.$queryRaw<Array<{ id: string; lancamentos: any; dias: any; bruto: any; liquido: any }>>`
    SELECT x."id" AS "id", COUNT(*) AS "lancamentos",
           COUNT(DISTINCT DATE(x."date" AT TIME ZONE 'UTC')) AS "dias",
           COALESCE(SUM(x."grossAmount"), 0) AS "bruto", COALESCE(SUM(x."netAmount"), 0) AS "liquido"
    FROM (
      SELECT "date", "grossAmount", "netAmount",
             CASE
               WHEN UPPER("sourcePlatform") = 'IFOOD' OR UPPER("channel") = 'IFOOD' THEN 'IFOOD'
               WHEN UPPER("sourcePlatform") = 'KEETA' OR UPPER("channel") = 'KEETA' THEN 'KEETA'
               WHEN UPPER("sourcePlatform") IN ('NOVENTA_NOVE', '99FOOD') OR UPPER("channel") IN ('NOVENTA_NOVE', '99FOOD') THEN 'NOVENTA_NOVE'
             END AS "id"
      FROM "RevenueEntry"
      WHERE "status" <> 'CANCELLED'
        AND "date" >= ${start} AND "date" <= ${end}
    ) x
    WHERE x."id" IS NOT NULL
    GROUP BY x."id"
  `;
  return linhas.map((l) => ({
    id: l.id,
    lancamentos: toNumber(l.lancamentos),
    dias: toNumber(l.dias),
    bruto: toNumber(l.bruto),
    liquido: toNumber(l.liquido),
  }));
}

async function getTaxesStatus(year: number, month: number) {
  const { start, end } = monthRange(year, month);
  const taxes = await prisma.$queryRaw<Array<{
    id: string; documentType: string; description: string | null;
    amount: any; dueDate: Date; paymentDate: Date | null; status: string;
  }>>`
    SELECT "id", "documentType", "description", "amount", "dueDate", "paymentDate", "status"::text AS "status"
    FROM "TaxPayment"
    WHERE "competenceDate" >= ${start} AND "competenceDate" <= ${end}
      AND "deletedAt" IS NULL
    ORDER BY "dueDate" ASC
  `;
  return taxes.map(t => ({
    id: t.id,
    documentType: t.documentType,
    description: t.description,
    amount: toNumber(t.amount),
    dueDate: t.dueDate.toISOString(),
    paymentDate: t.paymentDate?.toISOString() ?? null,
    status: t.status,
  }));
}

async function getFinalInventoryStatus(year: number, month: number) {
  const [snap] = await prisma.$queryRaw<Array<{
    id: string; countDate: Date; totalValue: any; totalItems: number;
  }>>`
    SELECT "id", "countDate", "totalValue", "totalItems"
    FROM "InventorySnapshot"
    WHERE "competenceYear" = ${year} AND "competenceMonth" = ${month}
      AND type = 'INVENTARIO_FINAL'
      -- APPROVED e o status de todo inventario gerado pelo sistema; so os
      -- importados de planilha ficam ACTIVE. Filtrar so por ACTIVE fazia a tela
      -- cobrar inventario final de meses que tinham um, e a pendencia fantasma
      -- travava o fechamento. A consulta irma (itensDeInventarioSemCusto) ja
      -- aceitava os dois.
      AND status IN ('ACTIVE', 'APPROVED')
    ORDER BY "countDate" DESC
    LIMIT 1
  `;
  if (!snap) return { hasSnapshot: false as const };
  return {
    hasSnapshot: true as const,
    snapshotId: snap.id,
    countDate: snap.countDate.toISOString(),
    totalValue: toNumber(snap.totalValue),
    totalItems: snap.totalItems,
  };
}

async function getMonthlyCmvRow(year: number, month: number) {
  return prisma.monthlyCmv.findUnique({ where: { competenceYear_competenceMonth: { competenceYear: year, competenceMonth: month } } });
}

async function ensureMonthlyCmvRow(year: number, month: number) {
  const existing = await getMonthlyCmvRow(year, month);
  if (existing) return existing;
  const id = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "MonthlyCmv" ("id", "competenceYear", "competenceMonth", "status", "updatedAt")
    VALUES (${id}, ${year}, ${month}, CAST('OPEN' AS "MonthlyCloseStatus"), CURRENT_TIMESTAMP)
    ON CONFLICT ("competenceYear", "competenceMonth") DO NOTHING
  `;
  return getMonthlyCmvRow(year, month);
}

function parseJustifications(raw: any): ClosureJustification[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as ClosureJustification[];
  return [];
}

export async function getMonthlyClosure(year: number, month: number) {
  const { start: monthStart, end: monthEnd } = monthRange(year, month);
  const [revenue, purchases, requiredSuppliers, taxes, finalInventory, cmvAttribution, monthlyCmv, cards] = await Promise.all([
    getRevenueSummary(year, month),
    getPurchasesSummary(year, month),
    getRequiredSuppliersStatus(year, month),
    getTaxesStatus(year, month),
    getFinalInventoryStatus(year, month),
    getCmvAttributedToMonth(year, month),
    getMonthlyCmvRow(year, month),
    getCardsStatus(year, month),
  ]);

  const justificativasBrutas = parseJustifications(monthlyCmv?.justifications);
  // Nome de quem justificou e de quem travou: o resumo impresso precisa do "quem".
  const idsDeUsuario = [...new Set([
    ...justificativasBrutas.map((j) => j.justifiedByUserId),
    ...(monthlyCmv?.closedByUserId ? [monthlyCmv.closedByUserId] : [])
  ].filter(Boolean))];
  const usuarios = idsDeUsuario.length > 0
    ? await prisma.user.findMany({ where: { id: { in: idsDeUsuario } }, select: { id: true, name: true } })
    : [];
  const justifications = anexarNomes(justificativasBrutas, usuarios);
  const closedByName = usuarios.find((u) => u.id === monthlyCmv?.closedByUserId)?.name ?? null;
  const justificationByKey = new Map<string, ClosureJustification>();
  for (const j of justifications) justificationByKey.set(j.blockKey, j);

  // Compute pending blocks
  const pending: Array<{ key: string; label: string }> = [];

  // Fornecedores obrigatorios pendentes
  for (const s of requiredSuppliers) {
    // Fornecedor com exigências (ex.: condomínio): cada lançamento obrigatório é
    // cobrado por si, em vez de bastar "qualquer compra do mês".
    if (s.usaExigencias) {
      const faltando = pendenciasDasExigencias({
        supplierId: s.id, supplierName: s.name, aplicaNoMes: s.appliesThisMonth, exigencias: s.requirements
      });
      for (const p of faltando) if (!justificationByKey.has(p.key)) pending.push(p);
      continue;
    }
    if (!s.appliesThisMonth) continue;
    if (s.present) continue;
    if (justificationByKey.has(`supplier:${s.id}`)) continue;
    pending.push({ key: `supplier:${s.id}`, label: `Fornecedor: ${s.name}` });
  }

  // Cartao de credito: nao se fecha o mes sem conferir a fatura de cada cartao ativo
  // contra o extrato. A saida de quem nao usou o cartao e a justificativa.
  const [salarios, gorjeta, faturamentoDelivery, eventos] = await Promise.all([
    contarSalariosLancados(year, month),
    contarApuracoesDeGorjeta(year, month),
    faturamentoPorPlataforma(year, month),
    faturamentoDeEventos(year, month),
  ]);
  const regrasDoMes = [
    ...avaliarCartoesDoMes(cards.cartoes, cards.faturas),
    ...avaliarFaturamentoDeEventos(eventos),
    ...avaliarFolhaLancada(salarios),
    ...avaliarGorjetaDoMes(gorjeta),
    ...avaliarCanaisDeDelivery(faturamentoDelivery, { diasEsperados: diasEsperadosDoMes(year, month, new Date()) }),
  ];
  for (const p of regrasDoMes) {
    if (justificationByKey.has(p.key)) continue;
    pending.push(p);
  }

  // Impostos: soft-warn (nao gera pending se ausente — cada operacao tem impostos diferentes)
  if (taxes.length === 0 && !justificationByKey.has("block:taxes")) {
    pending.push({ key: "block:taxes", label: "Impostos: nenhum lancamento registrado" });
  }

  // Inventario final ausente → pending
  if (!finalInventory.hasSnapshot && !justificationByKey.has("block:finalInventory")) {
    pending.push({ key: "block:finalInventory", label: "Inventario final do mes ausente" });
  }

  // Faturamento salao com <25 dias no mes → aviso soft
  if (revenue.salon.daysCount < 25 && !justificationByKey.has("block:revenue")) {
    pending.push({ key: "block:revenue", label: `Faturamento salao com apenas ${revenue.salon.daysCount} dias (esperado >= 25)` });
  }

  // Nota sem item nao chega ao CMV. E a divergencia mais silenciosa que existe
  // aqui: o valor aparece em contas a pagar e no DRE, entao nada parece faltar,
  // mas o custo da mercadoria fica de fora e o CMV sai menor do que e.
  const semItem = await comprasSemItem(year, month);
  if (semItem.length > 0 && !justificationByKey.has("block:purchasesWithoutItems")) {
    const valor = semItem.reduce((soma, c) => soma + Number(c.totalAmount ?? 0), 0);
    const exemplos = semItem.slice(0, 3).map((c) => c.supplierName ?? c.purchaseNumber ?? "?").join(", ");
    pending.push({
      key: "block:purchasesWithoutItems",
      label: `${semItem.length} compra(s) sem itens, somando ${valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} — nao entram no CMV (${exemplos}${semItem.length > 3 ? ", ..." : ""})`
    });
  }

  // Diferente das outras pendencias, esta nao e do mes: e global. Aparece em
  // qualquer mes que se tente fechar justamente porque o lancamento nao pertence
  // a nenhum — e some de todos assim que a competencia for informada.
  const semCompetencia = await impostosSemCompetencia();
  if (semCompetencia.length > 0 && !justificationByKey.has("block:taxesWithoutCompetence")) {
    const valor = semCompetencia.reduce((soma, t) => soma + Number(t.amount ?? 0), 0);
    const exemplos = semCompetencia.slice(0, 2).map((t) => t.documentType ?? "?").join(", ");
    pending.push({
      key: "block:taxesWithoutCompetence",
      label: `${semCompetencia.length} imposto(s) sem competencia informada, somando ${valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} — nao aparecem em DRE nenhum (${exemplos}${semCompetencia.length > 2 ? ", ..." : ""})`
    });
  }

  // Mesma logica da nota sem item, do outro lado do CMV: la falta custo de
  // compra, aqui falta custo de estoque. Subvalorizar o inventario final INFLA
  // o CMV do mes (CMV = inicial + compras - final) e SUBTRAI do mes seguinte,
  // que herda esse final como inicial. Erra dois meses de uma vez.
  const semCusto = await itensDeInventarioSemCusto(year, month);
  if (semCusto.length > 0 && !justificationByKey.has("block:inventoryItemsWithoutCost")) {
    const exemplos = semCusto.slice(0, 3).map((i) => i.productName ?? "?").join(", ");
    pending.push({
      key: "block:inventoryItemsWithoutCost",
      label: `${semCusto.length} item(ns) do inventario final contados com custo zero — nao somam no estoque e distorcem o CMV deste mes e do proximo (${exemplos}${semCusto.length > 3 ? ", ..." : ""})`
    });
  }

  const folhaSemDre = await folhaSemCategoriaDre(year, month);
  if (folhaSemDre.length > 0 && !justificationByKey.has("block:payrollWithoutDreCategory")) {
    const qtd = folhaSemDre.reduce((acc, r) => acc + Number(r.quantidade ?? 0), 0);
    const total = folhaSemDre.reduce((acc, r) => acc + Number(r.total ?? 0), 0);
    const tipos = folhaSemDre.map((r) => r.tipo).join(", ");
    pending.push({
      key: "block:payrollWithoutDreCategory",
      label: `${qtd} lancamento(s) de folha sem categoria de DRE, somando ${total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} — saem do grupo PESSOAL e caem em "Sem categoria" (${tipos})`
    });
  }

  const dataLonge = await comprasComDataLongeDaCompetencia(year, month);
  if (dataLonge.length > 0 && !justificationByKey.has("block:purchaseDateFarFromCompetence")) {
    const exemplos = dataLonge.slice(0, 3).map((c) => `NF ${c.invoiceNumber ?? "?"} (${c.supplierName ?? "?"}, ${Math.abs(Number(c.defasagem))} meses)`).join(", ");
    pending.push({
      key: "block:purchaseDateFarFromCompetence",
      label: `${dataLonge.length} nota(s) com data de compra a 2 meses ou mais da competencia — entram no DRE por um mes e no CMV Real por outro (${exemplos}${dataLonge.length > 3 ? ", ..." : ""})`
    });
  }

  const canLock = pending.length === 0;
  const status = monthlyCmv?.status ?? "OPEN";

  return {
    competenceYear: year,
    competenceMonth: month,
    monthStart: monthStart.toISOString(),
    monthEnd: monthEnd.toISOString(),
    status,
    closedAt: monthlyCmv?.closedAt?.toISOString() ?? null,
    closedByUserId: monthlyCmv?.closedByUserId ?? null,
    closedByName,
    reopenReason: monthlyCmv?.reopenReason ?? null,
    revenue: { ...revenue, eventos },
    purchases,
    requiredSuppliers,
    taxes,
    cards,
    finalInventory,
    cmvAttribution: {
      total: cmvAttribution.total,
      breakdown: cmvAttribution.breakdown,
    },
    justifications,
    summary: {
      pendingCount: pending.length,
      pending,
      canLock,
    },
  };
}

export async function justifyClosureBlock(input: { year: number; month: number; blockKey: string; reason: string; userId: string }) {
  if (!input.reason.trim()) throw new Error("Motivo obrigatorio.");
  const row = await ensureMonthlyCmvRow(input.year, input.month);
  if (!row) throw new Error("Nao foi possivel iniciar fechamento mensal.");
  if (row.status === "CLOSED") throw new Error("Fechamento ja travado. Reabra antes de justificar novos itens.");

  const current = parseJustifications((row as any).justifications);
  const filtered = current.filter(j => j.blockKey !== input.blockKey);
  filtered.push({
    blockKey: input.blockKey,
    reason: input.reason.trim(),
    justifiedByUserId: input.userId,
    justifiedAt: new Date().toISOString(),
  });
  await prisma.$executeRaw`
    UPDATE "MonthlyCmv"
    SET "justifications" = ${JSON.stringify(filtered)}::jsonb,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "competenceYear" = ${input.year} AND "competenceMonth" = ${input.month}
  `;
  return getMonthlyClosure(input.year, input.month);
}

export async function removeClosureJustification(input: { year: number; month: number; blockKey: string }) {
  const row = await getMonthlyCmvRow(input.year, input.month);
  if (!row) return getMonthlyClosure(input.year, input.month);
  if (row.status === "CLOSED") throw new Error("Fechamento travado. Reabra antes de remover justificativas.");
  const current = parseJustifications((row as any).justifications);
  const filtered = current.filter(j => j.blockKey !== input.blockKey);
  await prisma.$executeRaw`
    UPDATE "MonthlyCmv"
    SET "justifications" = ${JSON.stringify(filtered)}::jsonb,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "competenceYear" = ${input.year} AND "competenceMonth" = ${input.month}
  `;
  return getMonthlyClosure(input.year, input.month);
}

export async function lockMonthlyClosure(input: { year: number; month: number; userId: string }) {
  const state = await getMonthlyClosure(input.year, input.month);
  if (state.status === "CLOSED") throw new Error("Fechamento ja esta travado.");
  if (!state.summary.canLock) {
    throw new Error(`Existem ${state.summary.pendingCount} pendencia(s) sem justificativa. Justifique todas antes de travar.`);
  }
  await ensureMonthlyCmvRow(input.year, input.month);
  const cmvAttribution = state.cmvAttribution;
  await prisma.$executeRaw`
    UPDATE "MonthlyCmv"
    SET "status" = CAST('CLOSED' AS "MonthlyCloseStatus"),
        "closedByUserId" = ${input.userId},
        "closedAt" = CURRENT_TIMESTAMP,
        "cmvAttributedValue" = ${cmvAttribution.total},
        "attributionBreakdown" = ${JSON.stringify(cmvAttribution.breakdown)}::jsonb,
        "revenueGrossValue" = ${state.revenue.total.grossAmount},
        "revenueNetValue" = ${state.revenue.total.netAmount},
        "purchasesValue" = ${state.purchases.total},
        "finalInventoryValue" = ${state.finalInventory.hasSnapshot ? state.finalInventory.totalValue : 0},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "competenceYear" = ${input.year} AND "competenceMonth" = ${input.month}
  `;
  return getMonthlyClosure(input.year, input.month);
}

export async function unlockMonthlyClosure(input: { year: number; month: number; reason: string; userId: string }) {
  if (!input.reason.trim()) throw new Error("Motivo obrigatorio para reabrir.");
  const row = await getMonthlyCmvRow(input.year, input.month);
  if (!row) throw new Error("Fechamento nao encontrado.");
  if (row.status !== "CLOSED") throw new Error("Fechamento nao esta travado.");
  await prisma.$executeRaw`
    UPDATE "MonthlyCmv"
    SET "status" = CAST('OPEN' AS "MonthlyCloseStatus"),
        "reopenedByUserId" = ${input.userId},
        "reopenedAt" = CURRENT_TIMESTAMP,
        "reopenReason" = ${input.reason.trim()},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "competenceYear" = ${input.year} AND "competenceMonth" = ${input.month}
  `;
  return getMonthlyClosure(input.year, input.month);
}

// Suppress unused warning on Prisma import (kept for future typed queries).
void Prisma;
