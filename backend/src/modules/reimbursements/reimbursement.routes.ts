import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { parseDate } from "../../shared/utils/parse-date.js";
import { assertPeriodWritableForDate } from "../cmv-real/cmv-real.service.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { empresaDoCiclo } from "../suppliers/supplier-cycle-company.js";
import { getNextPurchaseNumber } from "../cards/cards.service.js";
import { REIMBURSEMENT_SOURCE, ReimbursementError, motivoParaNaoFechar } from "./reimbursement-rules.js";
import { reabrirReembolso } from "./reimbursement.service.js";

// Reembolsos a funcionario. O acesso (ver, conferir, fechar/reabrir = aprovar) vem
// do modulo "reimbursements" no controle de permissoes, aplicado pelo middleware.
export const reimbursementsRouter = Router();

const auditMeta = (request: Request) => ({ ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") });

async function usuario(request: Request, response: Response) {
  const user = await getSessionUser(request);
  if (!user) response.status(401).json({ message: "Sessao obrigatoria." });
  return user;
}

function responderErro(response: Response, error: unknown) {
  if (error instanceof ReimbursementError) {
    response.status(error.status).json({ message: error.message });
    return true;
  }
  return false;
}

reimbursementsRouter.get("/", async (request, response) => {
  if (!(await usuario(request, response))) return;
  const status = request.query.status ? String(request.query.status) : null;

  const reports = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT r."id", r."payeeSupplierId", s."name" AS "payeeName", r."status",
           r."totalAmount"::text AS "totalAmount", r."dueDate", r."closedAt", r."generatedPurchaseId",
           COUNT(i."id")::int AS "itemCount",
           COUNT(i."id") FILTER (WHERE i."checked")::int AS "checkedCount",
           MIN(i."purchaseDate") AS "firstPurchaseDate",
           MAX(i."purchaseDate") AS "lastPurchaseDate",
           r."createdAt"
    FROM "ReimbursementReport" r
    JOIN "Supplier" s ON s."id" = r."payeeSupplierId"
    LEFT JOIN "ReimbursementReportItem" i ON i."reportId" = r."id"
    WHERE ${status ? Prisma.sql`r."status" = ${status}` : Prisma.sql`r."status" <> 'CANCELLED'`}
    GROUP BY r."id", s."name"
    ORDER BY CASE r."status" WHEN 'OPEN' THEN 0 WHEN 'CLOSED' THEN 1 ELSE 2 END, r."createdAt" DESC
  `;
  response.json(reports);
});

async function detalhe(id: string) {
  const [report] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT r."id", r."payeeSupplierId", s."name" AS "payeeName",
           r."status", r."totalAmount"::text AS "totalAmount", r."dueDate", r."notes",
           r."closedAt", r."generatedPurchaseId", r."createdAt", r."updatedAt"
    FROM "ReimbursementReport" r
    JOIN "Supplier" s ON s."id" = r."payeeSupplierId"
    WHERE r."id" = ${id}
  `;
  if (!report) return null;

  const items = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT i."id", i."purchaseId", i."amount"::text AS "amount", i."purchaseDate", i."checked",
           p."purchaseNumber", p."invoiceNumber", p."isSmallExpense", p."status" AS "purchaseStatus",
           loja."name" AS "storeName",
           (SELECT pi."rawProductName" FROM "PurchaseItem" pi WHERE pi."purchaseId" = p."id" ORDER BY pi."id" LIMIT 1) AS "firstItemName",
           (SELECT COUNT(*)::int FROM "PurchaseItem" pi WHERE pi."purchaseId" = p."id") AS "itemLines"
    FROM "ReimbursementReportItem" i
    JOIN "Purchase" p ON p."id" = i."purchaseId"
    JOIN "Supplier" loja ON loja."id" = p."supplierId"
    WHERE i."reportId" = ${id}
    ORDER BY i."purchaseDate" ASC, i."createdAt" ASC
  `;

  const generatedPurchaseId = report.generatedPurchaseId as string | null;
  const installments = generatedPurchaseId
    ? await prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT pi."id", pi."amount"::text AS "amount", pi."dueDate", pi."status", pi."paidDate",
               pi."paidAmount"::text AS "paidAmount", COALESCE(pi."paymentMethodName", pm."name") AS "paymentMethodName"
        FROM "PaymentInstallment" pi
        LEFT JOIN "PaymentMethod" pm ON pm."id" = pi."paymentMethodId"
        WHERE pi."purchaseId" = ${generatedPurchaseId}
        ORDER BY pi."installment"
      `
    : [];

  return { ...report, items, installments };
}

reimbursementsRouter.get("/:id", async (request, response) => {
  if (!(await usuario(request, response))) return;
  const report = await detalhe(request.params.id);
  if (!report) {
    response.status(404).json({ message: "Reembolso nao encontrado." });
    return;
  }
  response.json(report);
});

async function exigirAberto(id: string, response: Response) {
  const [report] = await prisma.$queryRaw<Array<{ status: string }>>`SELECT "status" FROM "ReimbursementReport" WHERE "id" = ${id}`;
  if (!report) {
    response.status(404).json({ message: "Reembolso nao encontrado." });
    return false;
  }
  if (report.status !== "OPEN") {
    response.status(409).json({ message: "Reembolso fechado. Reabra para conferir de novo." });
    return false;
  }
  return true;
}

// Conferir = bater a compra com o comprovante. Fechar exige tudo conferido.
reimbursementsRouter.patch("/:id/items/:itemId", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  if (typeof request.body?.checked !== "boolean") {
    response.status(400).json({ message: "Informe se a compra foi conferida." });
    return;
  }
  if (!(await exigirAberto(request.params.id, response))) return;

  const updated = await prisma.$executeRaw`
    UPDATE "ReimbursementReportItem" SET "checked" = ${request.body.checked}, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${request.params.itemId} AND "reportId" = ${request.params.id}
  `;
  if (updated === 0) {
    response.status(404).json({ message: "Compra nao encontrada neste reembolso." });
    return;
  }
  await auditLog({ userId: user.id, action: "CHECK_REIMBURSEMENT_ITEM", entity: "ReimbursementReportItem", entityId: request.params.itemId, newValue: { checked: request.body.checked }, ...auditMeta(request) });
  response.json({ id: request.params.itemId, checked: request.body.checked });
});

reimbursementsRouter.post("/:id/check-all", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;
  if (!(await exigirAberto(request.params.id, response))) return;
  const count = await prisma.$executeRaw`
    UPDATE "ReimbursementReportItem" SET "checked" = true, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "reportId" = ${request.params.id} AND "checked" = false
  `;
  await auditLog({ userId: user.id, action: "CHECK_ALL_REIMBURSEMENT_ITEMS", entity: "ReimbursementReport", entityId: request.params.id, newValue: { count }, ...auditMeta(request) });
  response.json({ id: request.params.id, checked: count });
});

reimbursementsRouter.post("/:id/close", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;

  const paymentMethodId = String(request.body?.paymentMethodId ?? "").trim();
  const dueDate = request.body?.dueDate ? parseDate(request.body.dueDate) : null;
  const notes = String(request.body?.notes ?? "").trim().slice(0, 500) || null;

  const [method] = paymentMethodId
    ? await prisma.$queryRaw<Array<{ id: string; name: string; type: string }>>`
        SELECT "id", "name", "type"::text AS "type" FROM "PaymentMethod" WHERE "id" = ${paymentMethodId} AND "isActive" = true
      `
    : [];
  const closeDate = new Date();
  try {
    await assertPeriodWritableForDate(closeDate, "Fechamento de reembolso");
    if (dueDate && !Number.isNaN(dueDate.getTime())) await assertPeriodWritableForDate(dueDate, "Fechamento de reembolso (vencimento)");
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Periodo fechado." });
    return;
  }

  // Mesmo padrao do fechamento de ciclo: Purchase agregadora sem itens + um titulo.
  // O reembolso fica travado do comeco ao fim: as compras e o total sao lidos ja com
  // a trava, entao uma compra lancada ou editada no mesmo instante espera e cai no
  // reembolso seguinte, em vez de ficar fora do titulo ou entrar sem conferencia.
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Ordem das travas igual a do lancamento de compra (sequencia, depois reembolso):
      // invertida, um fechamento e uma compra nova ao mesmo tempo se travavam (deadlock).
      const purchaseNumber = await getNextPurchaseNumber(tx, closeDate.getFullYear());
      const [report] = await tx.$queryRaw<Array<{ id: string; payeeSupplierId: string; status: string }>>`
        SELECT "id", "payeeSupplierId", "status" FROM "ReimbursementReport" WHERE "id" = ${request.params.id} FOR UPDATE
      `;
      if (!report) throw new ReimbursementError("Reembolso nao encontrado.", 404);
      const items = await tx.$queryRaw<Array<{ checked: boolean; amount: string; companyId: string | null }>>`
        SELECT i."checked", i."amount"::text AS "amount", p."companyId"
        FROM "ReimbursementReportItem" i JOIN "Purchase" p ON p."id" = i."purchaseId"
        WHERE i."reportId" = ${report.id}
      `;
      const total = Math.round(items.reduce((sum, item) => sum + Number(item.amount), 0) * 100) / 100;
      const motivo = motivoParaNaoFechar({ status: report.status, itens: items, total, tipoDaFormaDePagamento: method?.type ?? null, vencimento: dueDate });
      if (motivo) throw new ReimbursementError(motivo);

      const companyId = empresaDoCiclo(items.map((item) => item.companyId));
      const purchaseId = crypto.randomUUID();
      await tx.$executeRaw`
        INSERT INTO "Purchase" (
          "id", "purchaseNumber", "purchaseDate", "competenceMonth", "competenceYear",
          "supplierId", "companyId", "invoiceNumber", "paymentMethod", "paymentMethodId",
          "totalAmount", "workflowStatus", "status", "rawRow", "createdAt", "updatedAt"
        ) VALUES (
          ${purchaseId}, ${purchaseNumber}, ${closeDate}, ${closeDate.getMonth() + 1}, ${closeDate.getFullYear()},
          ${report.payeeSupplierId}, ${companyId}, ${`REEMB-${report.id.slice(0, 8).toUpperCase()}`}, ${method!.name}, ${method!.id},
          ${new Prisma.Decimal(total)}, ${REIMBURSEMENT_SOURCE}, 'ACTIVE',
          ${JSON.stringify({ type: REIMBURSEMENT_SOURCE, reportId: report.id })}::jsonb,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `;
      await tx.$executeRaw`
        INSERT INTO "PaymentInstallment" (
          "id", "purchaseId", "installment", "amount", "dueDate",
          "paymentMethodId", "paymentMethodName", "sourceType", "status", "rawValue", "createdAt"
        ) VALUES (
          ${crypto.randomUUID()}, ${purchaseId}, 1, ${new Prisma.Decimal(total)}, ${dueDate},
          ${method!.id}, ${method!.name}, ${REIMBURSEMENT_SOURCE}, 'OPEN', ${`Reembolso ${report.id.slice(0, 8).toUpperCase()}`}, CURRENT_TIMESTAMP
        )
      `;
      await tx.$executeRaw`
        UPDATE "ReimbursementReport"
        SET "status" = 'CLOSED', "closedAt" = CURRENT_TIMESTAMP, "closedByUserId" = ${user.id},
            "generatedPurchaseId" = ${purchaseId}, "dueDate" = ${dueDate}, "notes" = ${notes},
            "totalAmount" = ${new Prisma.Decimal(total)}, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${report.id}
      `;
      return { reportId: report.id, purchaseId, purchaseNumber, total, companyId };
    });

    await auditLog({
      userId: user.id, action: "CLOSE_REIMBURSEMENT", entity: "ReimbursementReport", entityId: result.reportId,
      newValue: { ...result, dueDate, paymentMethod: method!.name } as Prisma.InputJsonValue, ...auditMeta(request)
    });
    response.status(201).json(await detalhe(result.reportId));
  } catch (error) {
    if (!responderErro(response, error)) throw error;
  }
});

reimbursementsRouter.post("/:id/reopen", async (request, response) => {
  const user = await usuario(request, response);
  if (!user) return;

  const [report] = await prisma.$queryRaw<Array<{ id: string; status: string; generatedPurchaseId: string | null; closedAt: Date | null; dueDate: Date | null }>>`
    SELECT "id", "status", "generatedPurchaseId", "closedAt", "dueDate" FROM "ReimbursementReport" WHERE "id" = ${request.params.id}
  `;
  if (!report) {
    response.status(404).json({ message: "Reembolso nao encontrado." });
    return;
  }
  if (report.status === "PAID") {
    response.status(409).json({ message: "Reembolso ja pago. Estorne o pagamento em Contas a Pagar antes de reabrir." });
    return;
  }
  if (report.status !== "CLOSED") {
    response.status(409).json({ message: "So e possivel reabrir um reembolso fechado." });
    return;
  }
  try {
    if (report.closedAt) await assertPeriodWritableForDate(new Date(report.closedAt), "Reabertura de reembolso");
    if (report.dueDate) await assertPeriodWritableForDate(new Date(report.dueDate), "Reabertura de reembolso (vencimento)");
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Periodo fechado." });
    return;
  }

  try {
    const reportId = await prisma.$transaction(async (tx) => {
      // Trava o titulo e o reembolso antes de olhar se foi pago: uma baixa feita no
      // mesmo instante espera esta transacao e encontra o titulo ja cancelado (e a
      // baixa recusa titulo cancelado), ou termina antes e esta checagem a ve.
      // Titulo primeiro, reembolso depois: a mesma ordem da baixa, senao as duas se travam.
      const parcelas = report.generatedPurchaseId
        ? await tx.$queryRaw<Array<{ status: string; paidDate: Date | null }>>`
            SELECT "status", "paidDate" FROM "PaymentInstallment" WHERE "purchaseId" = ${report.generatedPurchaseId} FOR UPDATE
          `
        : [];
      const [atual] = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT "status" FROM "ReimbursementReport" WHERE "id" = ${report.id} FOR UPDATE
      `;
      if (atual?.status !== "CLOSED") throw new ReimbursementError("O reembolso mudou de situacao agora ha pouco. Recarregue a tela.", 409);
      if (report.generatedPurchaseId) {
        if (parcelas.some((parcela) => parcela.status === "PAID" || parcela.status === "PAID_LATE" || parcela.paidDate)) {
          throw new ReimbursementError("O titulo deste reembolso ja foi baixado. Estorne o pagamento antes de reabrir.", 409);
        }
        await tx.$executeRaw`
          UPDATE "PaymentInstallment" SET "status" = 'CANCELLED'
          WHERE "purchaseId" = ${report.generatedPurchaseId} AND "status" NOT IN ('PAID', 'PAID_LATE', 'CANCELLED')
        `;
        await tx.$executeRaw`
          UPDATE "Purchase"
          SET "status" = 'CANCELLED', "cancelledAt" = CURRENT_TIMESTAMP, "cancellationReason" = 'Reembolso reaberto',
              "cancelledByUserId" = ${user.id}, "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${report.generatedPurchaseId}
        `;
      }
      return reabrirReembolso(tx, report.id);
    });

    await auditLog({ userId: user.id, action: "REOPEN_REIMBURSEMENT", entity: "ReimbursementReport", entityId: report.id, newValue: { openReportId: reportId, cancelledPurchaseId: report.generatedPurchaseId }, ...auditMeta(request) });
    response.json(await detalhe(reportId));
  } catch (error) {
    if (!responderErro(response, error)) throw error;
  }
});
