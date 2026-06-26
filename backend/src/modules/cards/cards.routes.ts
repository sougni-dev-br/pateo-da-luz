import { Router } from "express";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { parseDate } from "../../shared/utils/parse-date.js";
import { createSimplePdf } from "../../shared/utils/simple-pdf.js";
import { auditLog, requestIp, requireAdmin, requireRole } from "../security/security-utils.js";
import {
  createCardStatementPurchase,
  ensureCardSupplier,
  getCardStatementPeriod,
  getNextPurchaseNumber,
  syncCardStatementItemForPurchase
} from "./cards.service.js";
import { normalizeText } from "../../shared/utils/normalize-text.js";

export const cardsRouter = Router();

type CreditCardStatementStatus = "OPEN" | "CHECKED" | "CLOSED" | "PAID" | "CANCELLED";

function wrapAsync<T extends (...args: any[]) => any>(handler: T) {
  return (request: Parameters<T>[0], response: Parameters<T>[1], next: Parameters<T>[2]) =>
    Promise.resolve(handler(request, response, next)).catch(next);
}

for (const method of ["get", "post", "patch", "put", "delete"] as const) {
  const original = (cardsRouter as any)[method].bind(cardsRouter);
  (cardsRouter as any)[method] = (path: string, ...handlers: Array<(...args: any[]) => any>) =>
    original(path, ...handlers.map((handler) => wrapAsync(handler)));
}

function asText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function asNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function localDate(value: unknown) {
  return parseDate(value) ?? new Date(String(value ?? ""));
}

function formatDateValue(value: unknown) {
  if (!value) return "-";
  return new Date(String(value)).toLocaleDateString("pt-BR");
}

function formatCurrency(value: unknown) {
  return Number(value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

async function cardStatementDetail(id: string) {
  const statement = await prisma.creditCardStatement.findUnique({
    where: { id },
    include: {
      creditCard: true,
      items: {
        include: {
          purchase: { include: { supplier: true } },
          purchaseItem: { include: { product: true } },
          smallExpenseType: true
        },
        orderBy: { createdAt: "asc" }
      }
    }
  });
  if (!statement) return null;
  return statement;
}

cardsRouter.get("/", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;

  const search = request.query.search ? String(request.query.search) : undefined;
  const where: Prisma.CreditCardWhereInput = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { bankName: { contains: search, mode: "insensitive" } },
          { last4Digits: { contains: search, mode: "insensitive" } }
        ]
      }
    : {};

  const cards = await prisma.creditCard.findMany({
    where,
    include: {
      _count: { select: { statements: true, purchases: true } }
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }]
  });

  response.json(cards);
});

cardsRouter.post("/", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const name = String(request.body.name ?? "").trim();
  const bankName = String(request.body.bankName ?? "").trim();
  const last4Digits = String(request.body.last4Digits ?? "").trim();
  const closingDay = Math.max(1, Math.min(31, Number(request.body.closingDay ?? 1)));
  const dueDay = Math.max(1, Math.min(31, Number(request.body.dueDay ?? 1)));

  if (!name || !bankName || !last4Digits) {
    response.status(400).json({ message: "Nome, banco e ultimos 4 digitos sao obrigatorios." });
    return;
  }

  const previous = request.body.id ? await prisma.creditCard.findUnique({ where: { id: String(request.body.id) } }) : null;
  const card = request.body.id
    ? await prisma.creditCard.update({
        where: { id: String(request.body.id) },
        data: {
          name,
          bankName,
          last4Digits,
          closingDay,
          dueDay,
          notes: request.body.notes || null,
          isActive: request.body.isActive ?? true
        }
      })
    : await prisma.creditCard.create({
        data: {
          id: crypto.randomUUID(),
          name,
          bankName,
          last4Digits,
          closingDay,
          dueDay,
          notes: request.body.notes || null,
          isActive: request.body.isActive ?? true
        }
      });

  await auditLog({
    userId: user.id,
    action: request.body.id ? "UPDATE_CREDIT_CARD" : "CREATE_CREDIT_CARD",
    entity: "CreditCard",
    entityId: card.id,
    previousValue: previous,
    newValue: card,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.status(request.body.id ? 200 : 201).json(card);
});

cardsRouter.patch("/:id/status", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const previous = await prisma.creditCard.findUnique({ where: { id: request.params.id } });
  if (!previous) {
    response.status(404).json({ message: "Cartao nao encontrado." });
    return;
  }
  const card = await prisma.creditCard.update({
    where: { id: request.params.id },
    data: { isActive: Boolean(request.body.isActive) }
  });
  await auditLog({
    userId: user.id,
    action: card.isActive ? "REACTIVATE_CREDIT_CARD" : "INACTIVATE_CREDIT_CARD",
    entity: "CreditCard",
    entityId: card.id,
    previousValue: previous,
    newValue: card,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });
  response.json(card);
});

cardsRouter.get("/statements", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;

  const creditCardId = request.query.creditCardId ? String(request.query.creditCardId) : undefined;
  const status = request.query.status ? String(request.query.status).toUpperCase() : undefined;
  const startDate = request.query.startDate ? localDate(request.query.startDate) : null;
  const endDate = request.query.endDate ? localDate(request.query.endDate) : null;
  if (endDate) endDate.setHours(23, 59, 59, 999);

  const where: Prisma.CreditCardStatementWhereInput = {
    ...(creditCardId ? { creditCardId } : {}),
    ...(status ? { status: status as CreditCardStatementStatus } : {}),
    ...((startDate || endDate)
      ? {
          closingDate: {
            ...(startDate ? { gte: startDate } : {}),
            ...(endDate ? { lte: endDate } : {})
          }
        }
      : {})
  };

  const statements = await prisma.creditCardStatement.findMany({
    where,
    include: {
      creditCard: true,
      _count: { select: { items: true } }
    },
    orderBy: [{ closingDate: "desc" }, { createdAt: "desc" }]
  });

  response.json(statements);
});

cardsRouter.get("/statements/:id", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;

  const statement = await cardStatementDetail(request.params.id);
  if (!statement) {
    response.status(404).json({ message: "Fatura nao encontrada." });
    return;
  }

  response.json(statement);
});

cardsRouter.post("/statements", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const creditCardId = asText(request.body.creditCardId);
  const name = asText(request.body.name);
  const competenceYear = Number(request.body.competenceYear);
  const competenceMonth = Number(request.body.competenceMonth);
  if (!creditCardId || !Number.isFinite(competenceYear) || !Number.isFinite(competenceMonth)) {
    response.status(400).json({ message: "Cartao e competencia sao obrigatorios." });
    return;
  }

  const card = await prisma.creditCard.findUnique({ where: { id: creditCardId } });
  if (!card) {
    response.status(404).json({ message: "Cartao nao encontrado." });
    return;
  }

  const closingDateInput = parseDate(request.body.closingDate);
  const closingDate = closingDateInput ?? getCardStatementPeriod(card, new Date(competenceYear, competenceMonth - 1, 1)).closingDate;
  const dueDateInput = parseDate(request.body.dueDate);
  const dueDate = dueDateInput ?? getCardStatementPeriod(card, closingDate).dueDate;
  const id = request.body.id ? String(request.body.id) : crypto.randomUUID();
  const statement = request.body.id
    ? await prisma.creditCardStatement.update({
        where: { id },
        data: {
          creditCardId,
          name: name || null,
          competenceYear,
          competenceMonth,
          closingDate,
          dueDate,
          notes: request.body.notes || null,
          status: request.body.status ?? undefined
        }
      })
    : await prisma.creditCardStatement.create({
        data: {
          id,
          creditCardId,
          name: name || null,
          competenceYear,
          competenceMonth,
          closingDate,
          dueDate,
          notes: request.body.notes || null,
          status: request.body.status ?? "OPEN"
        }
      });

  await auditLog({
    userId: user.id,
    action: request.body.id ? "UPDATE_CREDIT_CARD_STATEMENT" : "CREATE_CREDIT_CARD_STATEMENT",
    entity: "CreditCardStatement",
    entityId: statement.id,
    newValue: statement,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.status(request.body.id ? 200 : 201).json(statement);
});

cardsRouter.patch("/statements/:id/status", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const status = String(request.body.status ?? "").toUpperCase();
  if (!["OPEN", "CHECKED", "CLOSED", "PAID", "CANCELLED"].includes(status)) {
    response.status(400).json({ message: "Status invalido." });
    return;
  }

  const previous = await cardStatementDetail(request.params.id);
  if (!previous) {
    response.status(404).json({ message: "Fatura nao encontrada." });
    return;
  }

  const statement = await prisma.creditCardStatement.update({
    where: { id: request.params.id },
    data: { status: status as CreditCardStatementStatus }
  });
  await auditLog({
    userId: user.id,
    action: "UPDATE_CREDIT_CARD_STATEMENT_STATUS",
    entity: "CreditCardStatement",
    entityId: statement.id,
    previousValue: previous,
    newValue: statement,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });
  response.json(statement);
});

cardsRouter.post("/statements/:id/items", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const statement = await prisma.creditCardStatement.findUnique({ where: { id: request.params.id } });
  if (!statement) {
    response.status(404).json({ message: "Fatura nao encontrada." });
    return;
  }
  if (["CLOSED", "PAID", "CANCELLED"].includes(statement.status)) {
    response.status(400).json({ message: "Fatura fechada nao pode receber itens novos." });
    return;
  }

  const purchaseId = asText(request.body.purchaseId);
  const purchaseItemId = asText(request.body.purchaseItemId);
  const description = String(request.body.description ?? "").trim();
  const supplierName = String(request.body.supplierName ?? "").trim();
  const value = asNumber(request.body.value);
  if (!description || value <= 0) {
    response.status(400).json({ message: "Descricao e valor sao obrigatorios." });
    return;
  }

  if (purchaseId) {
    await prisma.creditCardStatementItem.deleteMany({ where: { statementId: statement.id, purchaseId } });
  }

  const item = await prisma.creditCardStatementItem.create({
    data: {
      id: crypto.randomUUID(),
      statementId: statement.id,
      purchaseId: purchaseId || null,
      purchaseItemId: purchaseItemId || null,
      itemDate: request.body.itemDate ? localDate(request.body.itemDate) : null,
      description,
      supplierName: supplierName || null,
      value: new Prisma.Decimal(value),
      installment: request.body.installment == null ? null : Number(request.body.installment),
      totalInstallments: request.body.totalInstallments == null ? null : Number(request.body.totalInstallments),
      categoryName: asText(request.body.categoryName),
      smallExpenseTypeId: asText(request.body.smallExpenseTypeId),
      responsibleName: asText(request.body.responsibleName),
      checked: Boolean(request.body.checked),
      hasDivergence: Boolean(request.body.hasDivergence),
      notes: asText(request.body.notes)
    }
  });

  const [totalRow] = await prisma.$queryRaw<Array<{ total: Prisma.Decimal | number | string | null }>>`
    SELECT COALESCE(SUM("value"), 0) AS "total"
    FROM "CreditCardStatementItem"
    WHERE "statementId" = ${statement.id}
  `;
  await prisma.creditCardStatement.update({
    where: { id: statement.id },
    data: {
      totalAmount: new Prisma.Decimal(Number(totalRow?.total ?? 0))
    }
  });

  await auditLog({
    userId: user.id,
    action: "ADD_CREDIT_CARD_STATEMENT_ITEM",
    entity: "CreditCardStatementItem",
    entityId: item.id,
    newValue: item,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.status(201).json(item);
});

cardsRouter.patch("/statements/:id/items/:itemId", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const previous = await prisma.creditCardStatementItem.findUnique({ where: { id: request.params.itemId } });
  if (!previous) {
    response.status(404).json({ message: "Item nao encontrado." });
    return;
  }
  const currentStatement = await prisma.creditCardStatement.findUnique({ where: { id: request.params.id } });
  if (!currentStatement || ["CLOSED", "PAID", "CANCELLED"].includes(currentStatement.status)) {
    response.status(400).json({ message: "Fatura fechada nao pode ser alterada." });
    return;
  }

  const item = await prisma.creditCardStatementItem.update({
    where: { id: request.params.itemId },
    data: {
      checked: request.body.checked ?? previous.checked,
      hasDivergence: request.body.hasDivergence ?? previous.hasDivergence,
      notes: request.body.notes === undefined ? previous.notes : asText(request.body.notes),
      responsibleName: request.body.responsibleName === undefined ? previous.responsibleName : asText(request.body.responsibleName),
      categoryName: request.body.categoryName === undefined ? previous.categoryName : asText(request.body.categoryName)
    }
  });

  await auditLog({
    userId: user.id,
    action: "UPDATE_CREDIT_CARD_STATEMENT_ITEM",
    entity: "CreditCardStatementItem",
    entityId: item.id,
    previousValue: previous,
    newValue: item,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.json(item);
});

cardsRouter.patch("/statements/:id/items/:itemId/check", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const previous = await prisma.creditCardStatementItem.findUnique({ where: { id: request.params.itemId } });
  if (!previous) {
    response.status(404).json({ message: "Item nao encontrado." });
    return;
  }

  const item = await prisma.creditCardStatementItem.update({
    where: { id: request.params.itemId },
    data: {
      checked: Boolean(request.body.checked),
      hasDivergence: Boolean(request.body.hasDivergence ?? previous.hasDivergence),
      notes: request.body.notes === undefined ? previous.notes : asText(request.body.notes)
    }
  });

  await auditLog({
    userId: user.id,
    action: item.hasDivergence ? "REGISTER_CREDIT_CARD_STATEMENT_DIVERGENCE" : "CHECK_CREDIT_CARD_STATEMENT_ITEM",
    entity: "CreditCardStatementItem",
    entityId: item.id,
    previousValue: previous,
    newValue: item,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.json(item);
});

cardsRouter.post("/statements/items/:itemId/reallocate", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const itemId = request.params.itemId;
  const targetStatementId = asText(request.body.targetStatementId);
  const reason = String(request.body.reason ?? "").trim();

  if (!targetStatementId) {
    response.status(400).json({ message: "Fatura de destino e obrigatoria." });
    return;
  }
  if (reason.length < 5) {
    response.status(400).json({ message: "Motivo e obrigatorio (minimo 5 caracteres)." });
    return;
  }

  const item = await prisma.creditCardStatementItem.findUnique({
    where: { id: itemId },
    include: { statement: true }
  });
  if (!item) {
    response.status(404).json({ message: "Item nao encontrado." });
    return;
  }

  const sourceStatement = item.statement;
  const BLOCKED_STATUSES: CreditCardStatementStatus[] = ["CLOSED", "PAID", "CANCELLED"];

  if (BLOCKED_STATUSES.includes(sourceStatement.status as CreditCardStatementStatus)) {
    response.status(400).json({ message: "Fatura de origem esta fechada, paga ou cancelada. Nao e possivel realocar." });
    return;
  }
  if (sourceStatement.generatedPurchaseId) {
    response.status(400).json({ message: "Esta fatura ja foi fechada e possui titulo a pagar gerado. Nao e possivel realocar itens diretamente." });
    return;
  }
  if (sourceStatement.id === targetStatementId) {
    response.status(400).json({ message: "Fatura de origem e destino sao iguais." });
    return;
  }

  const targetStatement = await prisma.creditCardStatement.findUnique({ where: { id: targetStatementId } });
  if (!targetStatement) {
    response.status(404).json({ message: "Fatura de destino nao encontrada." });
    return;
  }
  if (BLOCKED_STATUSES.includes(targetStatement.status as CreditCardStatementStatus)) {
    response.status(400).json({ message: "Fatura de destino esta fechada, paga ou cancelada." });
    return;
  }
  if (targetStatement.generatedPurchaseId) {
    response.status(400).json({ message: "Fatura de destino ja possui titulo a pagar gerado. Nao e possivel receber novos itens." });
    return;
  }
  if (targetStatement.creditCardId !== sourceStatement.creditCardId) {
    response.status(400).json({ message: "Fatura de destino pertence a outro cartao." });
    return;
  }

  const previousItem = { ...item, statement: undefined };

  const updatedItem = await prisma.creditCardStatementItem.update({
    where: { id: itemId },
    data: { statementId: targetStatementId }
  });

  const [sourceTotalRow] = await prisma.$queryRaw<Array<{ total: Prisma.Decimal | number | string | null }>>`
    SELECT COALESCE(SUM("value"), 0) AS "total"
    FROM "CreditCardStatementItem"
    WHERE "statementId" = ${sourceStatement.id}
  `;
  await prisma.creditCardStatement.update({
    where: { id: sourceStatement.id },
    data: { totalAmount: new Prisma.Decimal(Number(sourceTotalRow?.total ?? 0)) }
  });

  const [targetTotalRow] = await prisma.$queryRaw<Array<{ total: Prisma.Decimal | number | string | null }>>`
    SELECT COALESCE(SUM("value"), 0) AS "total"
    FROM "CreditCardStatementItem"
    WHERE "statementId" = ${targetStatementId}
  `;
  await prisma.creditCardStatement.update({
    where: { id: targetStatementId },
    data: { totalAmount: new Prisma.Decimal(Number(targetTotalRow?.total ?? 0)) }
  });

  await auditLog({
    userId: user.id,
    action: "REALLOCATE_CREDIT_CARD_STATEMENT_ITEM",
    entity: "CreditCardStatementItem",
    entityId: itemId,
    previousValue: {
      ...previousItem,
      sourceStatementId: sourceStatement.id,
      sourceStatementName: sourceStatement.name,
      sourceStatementCompetence: `${String(sourceStatement.competenceMonth).padStart(2, "0")}/${sourceStatement.competenceYear}`,
      reason
    },
    newValue: {
      ...updatedItem,
      targetStatementId,
      targetStatementName: targetStatement.name,
      targetStatementCompetence: `${String(targetStatement.competenceMonth).padStart(2, "0")}/${targetStatement.competenceYear}`,
      reason
    },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.json({ item: updatedItem, reason });
});

cardsRouter.post("/statements/:id/close", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const statement = await cardStatementDetail(request.params.id);
  if (!statement) {
    response.status(404).json({ message: "Fatura nao encontrada." });
    return;
  }

  const totalAmount = statement.items.reduce((sum, item) => sum + Number(item.value ?? 0), 0);
  const period = getCardStatementPeriod({
    id: statement.creditCard.id,
    name: statement.creditCard.name,
    bankName: statement.creditCard.bankName,
    last4Digits: statement.creditCard.last4Digits,
    closingDay: statement.creditCard.closingDay,
    dueDay: statement.creditCard.dueDay
  }, statement.closingDate);

  await prisma.$transaction(async (tx) => {
    await tx.creditCardStatement.update({
      where: { id: statement.id },
      data: {
        totalAmount: new Prisma.Decimal(totalAmount),
        status: "CLOSED"
      }
    });

    if (!statement.generatedPurchaseId) {
      await createCardStatementPurchase(tx, {
        statementId: statement.id,
        card: {
          id: statement.creditCard.id,
          name: statement.creditCard.name,
          bankName: statement.creditCard.bankName,
          last4Digits: statement.creditCard.last4Digits,
          closingDay: statement.creditCard.closingDay,
          dueDay: statement.creditCard.dueDay
        },
        closingDate: statement.closingDate,
        dueDate: statement.dueDate,
        totalAmount
      });
    } else {
      await tx.purchase.update({
        where: { id: statement.generatedPurchaseId },
        data: {
          totalAmount: new Prisma.Decimal(totalAmount)
        }
      });
      await tx.paymentInstallment.updateMany({
        where: { purchaseId: statement.generatedPurchaseId },
        data: {
          amount: new Prisma.Decimal(totalAmount)
        }
      });
    }
  });

  const updated = await cardStatementDetail(statement.id);
  await auditLog({
    userId: user.id,
    action: "CLOSE_CREDIT_CARD_STATEMENT",
    entity: "CreditCardStatement",
    entityId: statement.id,
    previousValue: statement,
    newValue: updated,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.json(updated);
});

cardsRouter.patch("/statements/:id/pay", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const statement = await cardStatementDetail(request.params.id);
  if (!statement) {
    response.status(404).json({ message: "Fatura nao encontrada." });
    return;
  }
  if (!statement.generatedPurchaseId) {
    response.status(400).json({ message: "Fatura ainda nao gerou conta a pagar." });
    return;
  }

  const paidDate = request.body.paidDate ? localDate(request.body.paidDate) : new Date();
  const paymentMethodName = asText(request.body.paymentMethodName) ?? "Cartao de credito/fatura";
  const paidAmount = Number(request.body.paidAmount ?? statement.totalAmount ?? 0);

  const [installment] = await prisma.paymentInstallment.findMany({
    where: { purchaseId: statement.generatedPurchaseId },
    orderBy: { installment: "asc" }
  });
  if (!installment) {
    response.status(400).json({ message: "Conta a pagar da fatura nao encontrada." });
    return;
  }

  const status = paidDate.getTime() > new Date(String(installment.dueDate ?? paidDate)).getTime() ? "PAID_LATE" : "PAID";
  await prisma.paymentInstallment.update({
    where: { id: installment.id },
    data: {
      paidDate,
      paidAmount: new Prisma.Decimal(paidAmount),
      paidPaymentMethodName: paymentMethodName,
      status
    }
  });
  await prisma.creditCardStatement.update({
    where: { id: statement.id },
    data: { status: "PAID" }
  });

  await auditLog({
    userId: user.id,
    action: "PAY_CREDIT_CARD_STATEMENT",
    entity: "CreditCardStatement",
    entityId: statement.id,
    previousValue: statement,
    newValue: { paidDate, paidAmount, paymentMethodName, status },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.json({ id: statement.id, status: "PAID" });
});

cardsRouter.get("/statements/:id/pdf", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;

  const statement = await cardStatementDetail(request.params.id);
  if (!statement) {
    response.status(404).json({ message: "Fatura nao encontrada." });
    return;
  }

  const pdf = createSimplePdf("Fatura de cartao", [
    {
      heading: "Resumo",
      lines: [
        `Cartao: ${statement.creditCard.name} - ${statement.creditCard.bankName} final ${statement.creditCard.last4Digits}`,
        `Competencia: ${String(statement.competenceMonth).padStart(2, "0")}/${statement.competenceYear}`,
        `Fechamento: ${formatDateValue(statement.closingDate)}`,
        `Vencimento: ${formatDateValue(statement.dueDate)}`,
        `Status: ${statement.status}`,
        `Total: ${formatCurrency(statement.totalAmount)}`
      ]
    },
    {
      heading: "Lancamentos",
      table: {
        headers: ["Data", "Descricao", "Fornecedor/Local", "Valor", "Parc.", "Conferido", "Divergencia", "Obs."],
        rows: statement.items.map((item) => [
          formatDateValue(item.itemDate),
          item.description,
          item.supplierName ?? item.purchase?.supplier?.name ?? "-",
          formatCurrency(item.value),
          item.installment ? `${item.installment}/${item.totalInstallments ?? "-"}` : "-",
          item.checked ? "Sim" : "Nao",
          item.hasDivergence ? "Sim" : "Nao",
          item.notes ?? "-"
        ])
      }
    }
  ]);

  await auditLog({
    userId: user.id,
    action: "GENERATE_CREDIT_CARD_STATEMENT_PDF",
    entity: "Report",
    entityId: statement.id,
    newValue: {
      creditCardId: statement.creditCardId,
      statementId: statement.id,
      totalItems: statement.items.length
    },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", "attachment; filename=fatura-cartao.pdf");
  response.send(pdf);
});

// LEGADO — módulo Pequenos Gastos descontinuado. Rotas mantidas por compatibilidade; nunca foram usadas em produção (zero registros). Remover na Fase 2 de limpeza.
cardsRouter.get("/small-expenses", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;

  const startDate = request.query.startDate ? localDate(request.query.startDate) : null;
  const endDate = request.query.endDate ? localDate(request.query.endDate) : null;
  if (endDate) endDate.setHours(23, 59, 59, 999);
  const employee = request.query.employee ? normalizeText(String(request.query.employee)) : null;
  const authorizedBy = request.query.authorizedBy ? normalizeText(String(request.query.authorizedBy)) : null;
  const origin = request.query.origin ? normalizeText(String(request.query.origin)) : null;
  const type = request.query.type ? String(request.query.type) : null;
  const supplier = request.query.supplier ? normalizeText(String(request.query.supplier)) : null;
  const paymentMethod = request.query.paymentMethod ? normalizeText(String(request.query.paymentMethod)) : null;
  const category = request.query.category ? normalizeText(String(request.query.category)) : null;
  const product = request.query.product ? normalizeText(String(request.query.product)) : null;

  const purchases = await prisma.purchase.findMany({
    where: {
      isSmallExpense: true,
      status: { not: "CANCELLED" },
      ...(startDate || endDate
        ? {
            purchaseDate: {
              ...(startDate ? { gte: startDate } : {}),
              ...(endDate ? { lte: endDate } : {})
            }
          }
        : {})
    },
    include: {
      supplier: true,
      paymentMethodRef: true,
      smallExpenseType: true,
      creditCard: true,
      items: { include: { product: { include: { category: true } } } }
    },
    orderBy: [{ purchaseDate: "desc" }, { createdAt: "desc" }]
  });

  const rows = purchases
    .map((purchase) => {
      const firstItem = purchase.items[0];
      const impactCmv = purchase.items.some((item) => item.product?.controlsStock !== false);
      const itemSummary = purchase.items.length > 1 ? `${firstItem?.rawProductName ?? firstItem?.product?.name ?? "-"} (+${purchase.items.length - 1})` : firstItem?.rawProductName ?? firstItem?.product?.name ?? "-";
      return {
        id: purchase.id,
        purchaseNumber: purchase.purchaseNumber,
        purchaseDate: purchase.purchaseDate,
        supplierName: purchase.supplier.name,
        supplierDocument: purchase.supplier.document,
        invoiceNumber: purchase.invoiceNumber,
        employee: purchase.smallExpenseResponsibleName ?? "-",
        authorizedBy: purchase.smallExpenseAuthorizedBy ?? "-",
        origin: purchase.smallExpenseMoneyOrigin ?? "-",
        smallExpenseType: purchase.smallExpenseType?.name ?? "-",
        item: itemSummary,
        category: firstItem?.product?.category?.name ?? firstItem?.rawCategory ?? "-",
        product: firstItem?.rawProductName ?? firstItem?.product?.name ?? "-",
        paymentMethod: purchase.paymentMethodRef?.name ?? purchase.paymentMethod ?? "-",
        notes: purchase.smallExpenseNotes ?? purchase.noInvoiceReason ?? "-",
        totalAmount: Number(purchase.totalAmount),
        impactCmv,
        controlsStock: impactCmv
      };
    })
    .filter((row) => {
      if (employee && !normalizeText(row.employee).includes(employee)) return false;
      if (authorizedBy && !normalizeText(row.authorizedBy).includes(authorizedBy)) return false;
      if (origin && !normalizeText(row.origin).includes(origin)) return false;
      if (type && normalizeText(row.smallExpenseType) !== normalizeText(type)) return false;
      if (supplier && !normalizeText(row.supplierName).includes(supplier)) return false;
      if (paymentMethod && !normalizeText(row.paymentMethod).includes(paymentMethod)) return false;
      if (category && !normalizeText(row.category).includes(category)) return false;
      if (product && !normalizeText(row.product).includes(product)) return false;
      return true;
    });

  const total = rows.reduce((sum, row) => sum + row.totalAmount, 0);
  const byOrigin = new Map<string, number>();
  const byEmployee = new Map<string, number>();
  const byType = new Map<string, number>();
  let impactCmvTotal = 0;
  let administrativeTotal = 0;
  for (const row of rows) {
    byOrigin.set(row.origin, (byOrigin.get(row.origin) ?? 0) + row.totalAmount);
    byEmployee.set(row.employee, (byEmployee.get(row.employee) ?? 0) + row.totalAmount);
    byType.set(row.smallExpenseType, (byType.get(row.smallExpenseType) ?? 0) + row.totalAmount);
    if (row.impactCmv) impactCmvTotal += row.totalAmount;
    else administrativeTotal += row.totalAmount;
  }

  response.json({
    rows,
    summary: {
      total,
      byOrigin: [...byOrigin.entries()].map(([label, amount]) => ({ label, amount })),
      byEmployee: [...byEmployee.entries()].map(([label, amount]) => ({ label, amount })),
      byType: [...byType.entries()].map(([label, amount]) => ({ label, amount })),
      impactCmvTotal,
      administrativeTotal
    }
  });
});

cardsRouter.get("/small-expenses.pdf", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA", "VISUALIZACAO"]);
  if (!user) return;

  const startDate = request.query.startDate ? localDate(request.query.startDate) : null;
  const endDate = request.query.endDate ? localDate(request.query.endDate) : null;
  if (endDate) endDate.setHours(23, 59, 59, 999);
  const data = await prisma.purchase.findMany({
    where: {
      isSmallExpense: true,
      status: { not: "CANCELLED" },
      ...(startDate || endDate
        ? {
            purchaseDate: {
              ...(startDate ? { gte: startDate } : {}),
              ...(endDate ? { lte: endDate } : {})
            }
          }
        : {})
    },
    include: {
      supplier: true,
      paymentMethodRef: true,
      smallExpenseType: true,
      items: { include: { product: { include: { category: true } } } }
    },
    orderBy: [{ purchaseDate: "desc" }, { createdAt: "desc" }]
  });

  const total = data.reduce((sum, purchase) => sum + Number(purchase.totalAmount), 0);
  const pdf = createSimplePdf("Pequenos gastos", [
    {
      heading: "Resumo",
      lines: [
        `Periodo: ${startDate ? formatDateValue(startDate) : "Inicio"} ate ${endDate ? formatDateValue(endDate) : "Hoje"}`,
        `Total: ${formatCurrency(total)}`,
        `Lancamentos: ${data.length}`
      ]
    },
    {
      heading: "Lancamentos",
      table: {
        headers: ["Data", "Pedido", "Fornecedor/Local", "Funcionario", "Autorizado por", "Origem", "Tipo", "Item", "Valor", "CMV"],
        rows: data.map((purchase) => {
          const firstItem = purchase.items[0];
          const impactCmv = purchase.items.some((item) => item.product?.controlsStock !== false);
          const itemSummary = purchase.items.length > 1 ? `${firstItem?.rawProductName ?? firstItem?.product?.name ?? "-"} (+${purchase.items.length - 1})` : firstItem?.rawProductName ?? firstItem?.product?.name ?? "-";
          return [
            formatDateValue(purchase.purchaseDate),
            purchase.purchaseNumber ?? "-",
            purchase.supplier.name,
            purchase.smallExpenseResponsibleName ?? "-",
            purchase.smallExpenseAuthorizedBy ?? "-",
            purchase.smallExpenseMoneyOrigin ?? "-",
            purchase.smallExpenseType?.name ?? "-",
            itemSummary,
            formatCurrency(purchase.totalAmount),
            impactCmv ? "Sim" : "Nao"
          ];
        })
      }
    }
  ]);

  await auditLog({
    userId: user.id,
    action: "GENERATE_SMALL_EXPENSES_PDF",
    entity: "Report",
    newValue: {
      startDate,
      endDate,
      rows: data.length,
      total
    },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", "attachment; filename=pequenos-gastos.pdf");
  response.send(pdf);
});

cardsRouter.post("/link-purchase", async (request, response) => {
  const user = await requireRole(request, response, ["ADMIN", "GESTAO_COMPLETA"]);
  if (!user) return;

  const purchaseId = asText(request.body.purchaseId);
  if (!purchaseId) {
    response.status(400).json({ message: "Compra obrigatoria." });
    return;
  }

  const [purchase] = await prisma.$queryRaw<Array<{
    id: string;
    purchaseDate: Date;
    creditCardId: string | null;
    smallExpenseMoneyOrigin: string | null;
    smallExpenseResponsibleName: string | null;
    smallExpenseAuthorizedBy: string | null;
    smallExpenseNotes: string | null;
    smallExpenseTypeId: string | null;
    totalAmount: Prisma.Decimal;
    supplierName: string;
    invoiceNumber: string | null;
    purchaseNumber: string | null;
  }>>`
    SELECT p."id", p."purchaseDate", p."creditCardId", p."smallExpenseMoneyOrigin", p."smallExpenseResponsibleName", p."smallExpenseAuthorizedBy",
           p."smallExpenseNotes", p."smallExpenseTypeId", p."totalAmount", s."name" AS "supplierName", p."invoiceNumber", p."purchaseNumber"
    FROM "Purchase" p
    JOIN "Supplier" s ON s."id" = p."supplierId"
    WHERE p."id" = ${purchaseId}
    LIMIT 1
  `;
  if (!purchase) {
    response.status(404).json({ message: "Compra nao encontrada." });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await syncCardStatementItemForPurchase(tx, {
      purchaseId: purchase.id,
      cardId: purchase.creditCardId,
      purchaseDate: purchase.purchaseDate,
      description: purchase.invoiceNumber ?? purchase.purchaseNumber ?? "Lancamento de cartao",
      supplierName: purchase.supplierName,
      value: Number(purchase.totalAmount),
      smallExpenseTypeId: purchase.smallExpenseTypeId,
      responsibleName: purchase.smallExpenseResponsibleName,
      notes: purchase.smallExpenseNotes
    });
  });

  await auditLog({
    userId: user.id,
    action: "LINK_PURCHASE_TO_CREDIT_CARD",
    entity: "Purchase",
    entityId: purchaseId,
    newValue: { purchaseId },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.json({ id: purchaseId });
});
