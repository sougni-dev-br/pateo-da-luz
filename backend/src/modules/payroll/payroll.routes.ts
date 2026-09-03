import crypto from "node:crypto";
import { assertPeriodWritableForDate } from "../cmv-real/cmv-real.service.js";
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { PAYROLL_KINDS, computePayroll, computeStatus, generatePayroll, getOrDefaultSettings, type PayrollKind, type PayrollOverride } from "./payroll.service.js";
import { round2 } from "./vt-calc.js";

export const payrollRouter = Router();

function parseYearMonth(q: { year?: unknown; month?: unknown }) {
  const now = new Date();
  const year = parseInt(String(q.year ?? ""), 10) || now.getFullYear();
  let month = parseInt(String(q.month ?? ""), 10) || now.getMonth() + 1;
  if (month < 1) month = 1;
  if (month > 12) month = 12;
  return { year, month };
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
payrollRouter.get("/settings", async (_request, response) => {
  const settings = await getOrDefaultSettings();
  response.json(settings);
});

payrollRouter.put("/settings", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const b = request.body as Record<string, unknown>;
  await getOrDefaultSettings();
  const updated = await prisma.payrollSettings.update({
    where: { id: "singleton" },
    data: {
      busFare: numOrNull(b.busFare) ?? undefined,
      metroFare: numOrNull(b.metroFare) ?? undefined,
      integratedFare: numOrNull(b.integratedFare) ?? undefined,
      monthlyPassBus: numOrNull(b.monthlyPassBus) ?? undefined,
      monthlyPassIntegrated: numOrNull(b.monthlyPassIntegrated) ?? undefined,
      advancePercent: numOrNull(b.advancePercent) ?? undefined,
      advanceDueDay: numOrNull(b.advanceDueDay) ?? undefined,
      salaryDueDay: numOrNull(b.salaryDueDay) ?? undefined,
      bufferDays: numOrNull(b.bufferDays) ?? undefined,
      updatedById: user.id,
    },
  });

  await auditLog({
    userId: user.id, action: "UPDATE_PAYROLL_SETTINGS", entity: "PayrollSettings", entityId: "singleton",
    newValue: updated, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });

  response.json(updated);
});

// ─── LIST (itens da competência + resumo) ───────────────────────────────────────
payrollRouter.get("/", async (request, response) => {
  const { year, month } = parseYearMonth(request.query as { year?: unknown; month?: unknown });
  const rows = await prisma.payrollItem.findMany({
    where: { competenceYear: year, competenceMonth: month, deletedAt: null },
    include: { employee: { select: { firstName: true, lastName: true, displayName: true, sector: true } } },
    orderBy: [{ employee: { sector: "asc" } }, { employee: { firstName: "asc" } }, { type: "asc" }, { periodLabel: "asc" }],
  });

  const items = rows.map((r) => ({
    ...r,
    employeeName: `${r.employee.firstName} ${r.employee.lastName}`.trim(),
    employeeDisplayName: r.employee.displayName,
    sector: r.employee.sector,
    status: r.paymentDate ? "PAID" : (r.dueDate < new Date() ? "OVERDUE" : "PENDING"),
  }));

  const sum = (predicate: (i: (typeof items)[number]) => boolean) =>
    items.filter(predicate).reduce((acc, i) => acc + Number(i.amount), 0);

  response.json({
    year, month, items,
    summary: {
      total: sum(() => true),
      vt: sum((i) => i.type === "VALE_TRANSPORTE"),
      advance: sum((i) => i.type === "ADIANTAMENTO"),
      salary: sum((i) => i.type === "SALARIO"),
      ferias: sum((i) => i.type === "FERIAS"),
      paid: sum((i) => i.status === "PAID"),
      pending: sum((i) => i.status === "PENDING"),
      overdue: sum((i) => i.status === "OVERDUE"),
      count: items.length,
    },
  });
});

// ─── PREVIEW (calcula sem persistir) ────────────────────────────────────────────
payrollRouter.post("/preview", async (request, response) => {
  const { year, month } = parseYearMonth(request.body as { year?: unknown; month?: unknown });
  const result = await computePayroll(year, month);
  response.json(result);
});

// ─── GENERATE (cria os itens ainda inexistentes) ────────────────────────────────
payrollRouter.post("/generate", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const body = request.body as { year?: unknown; month?: unknown; kind?: unknown; overrides?: unknown };
  const { year, month } = parseYearMonth(body);
  // O DRE posiciona a folha pela competencia (competenceYear/Month), entao gerar folha
  // de um mes travado ou com CMV fechado alteraria um periodo ja encerrado.
  try {
    await assertPeriodWritableForDate(new Date(year, month - 1, 1), "Geracao de folha");
  } catch (error) {
    return response.status(400).json({ message: error instanceof Error ? error.message : "Periodo fechado." });
  }

  const kind = PAYROLL_KINDS.includes(String(body.kind) as PayrollKind) ? (String(body.kind) as PayrollKind) : "ALL";

  // Ajustes manuais feitos na prévia (valor diferente do calculado).
  const overrides: PayrollOverride[] = (Array.isArray(body.overrides) ? body.overrides : [])
    .map((raw) => raw as Record<string, unknown>)
    .map((o) => ({
      employeeId: String(o.employeeId ?? ""),
      type: String(o.type ?? ""),
      periodLabel: String(o.periodLabel ?? ""),
      amount: Number(o.amount),
    }))
    .filter((o) => o.employeeId && o.type && o.periodLabel && Number.isFinite(o.amount) && o.amount > 0);

  const result = await generatePayroll(year, month, user.id, kind, overrides);

  await auditLog({
    userId: user.id, action: "GENERATE_PAYROLL", entity: "PayrollItem",
    newValue: result, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });

  response.json(result);
});

// ─── RESCISÃO — preview do que o sistema tem para descontar ──────────────────────
// Contabilidade manda o valor bruto; o sistema mostra o crédito de VT (float pago
// adiantado) a descontar + os VTs recentes para conferência.
payrollRouter.get("/termination/:employeeId", async (request, response) => {
  const emp = await prisma.employee.findFirst({ where: { id: request.params.employeeId, deletedAt: null } });
  if (!emp) return response.status(404).json({ message: "Funcionário não encontrado." });

  const term = emp.terminationDate ? new Date(emp.terminationDate) : new Date();
  const ty = term.getUTCFullYear();
  const tm = term.getUTCMonth() + 1;
  const vtItems = await prisma.payrollItem.findMany({
    where: {
      employeeId: emp.id, type: "VALE_TRANSPORTE", deletedAt: null,
      OR: [{ competenceYear: { gt: ty } }, { competenceYear: ty, competenceMonth: { gte: tm } }],
    },
    orderBy: [{ competenceYear: "desc" }, { competenceMonth: "desc" }, { periodLabel: "asc" }],
  });
  const already = await prisma.payrollItem.findFirst({ where: { employeeId: emp.id, type: "RESCISAO", deletedAt: null } });

  response.json({
    employee: { id: emp.id, name: `${emp.firstName} ${emp.lastName}`.trim(), terminationDate: emp.terminationDate, terminationReason: emp.terminationReason },
    vtCreditBalance: Number(emp.vtCreditBalance),
    vtItems: vtItems.map((i) => ({ id: i.id, periodLabel: i.periodLabel, competenceYear: i.competenceYear, competenceMonth: i.competenceMonth, amount: i.amount, status: i.paymentDate ? "PAID" : "PENDING", dueDate: i.dueDate })),
    alreadyReleased: Boolean(already),
    rescisaoId: already?.id ?? null,
  });
});

// Parcelamento de rescisão/acordo: divide em centavos com soma exata; a 1ª parcela
// absorve o resto para nunca perder/criar centavos no total.
function splitCents(totalCents: number, parts: number): number[] {
  const base = Math.floor(totalCents / parts);
  const remainder = totalCents - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i === 0 ? remainder : 0));
}

// Soma meses mantendo o dia do vencimento, com clamp para o último dia do mês destino
// (ex.: 31/01 + 1 mês → 28/02).
function addMonthsUTC(date: Date, months: number): Date {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return target;
}

// ─── RESCISÃO — liberar para Contas a Pagar ──────────────────────────────────────
payrollRouter.post("/termination/:employeeId", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const emp = await prisma.employee.findFirst({ where: { id: request.params.employeeId, deletedAt: null } });
  if (!emp) return response.status(404).json({ message: "Funcionário não encontrado." });

  const existing = await prisma.payrollItem.findFirst({ where: { employeeId: emp.id, type: "RESCISAO", deletedAt: null } });
  if (existing) return response.status(400).json({ message: "Rescisão já lançada para este funcionário." });

  const b = request.body as Record<string, unknown>;
  const gross = numOrNull(b.grossAmount) ?? 0;
  const vtDiscount = numOrNull(b.vtDiscount) ?? 0;
  const otherDiscount = numOrNull(b.otherDiscount) ?? 0;
  if (gross <= 0) return response.status(400).json({ message: "Valor da rescisão (bruto) é obrigatório." });
  const net = round2(gross - vtDiscount - otherDiscount);

  const firstDue = b.dueDate ? new Date(String(b.dueDate)) : new Date();
  const term = emp.terminationDate ? new Date(emp.terminationDate) : new Date();
  const dre = await prisma.dRECategory.findFirst({ where: { name: "Rescisão" } });

  // Parcelamento (acordo/art. 484-A): 1 = título único; N = N títulos mensais em Contas a
  // Pagar. Só parcela quando há líquido positivo a dividir.
  const requested = Math.trunc(numOrNull(b.installments) ?? 1);
  const n = net > 0 ? Math.max(1, Math.min(requested, 12)) : 1;
  const baseDetails = { grossAmount: gross, vtDiscount, otherDiscount, otherDiscountLabel: (b.otherDiscountLabel as string) || null };
  const parcelas = splitCents(Math.round(net * 100), n).map((cents, i) => ({
    id: crypto.randomUUID(),
    number: i + 1,
    amount: round2(cents / 100),
    due: addMonthsUTC(firstDue, i),
  }));

  await prisma.$transaction([
    ...parcelas.map((p) =>
      prisma.payrollItem.create({
        data: {
          id: p.id,
          employeeId: emp.id,
          type: "RESCISAO",
          competenceYear: term.getUTCFullYear(),
          competenceMonth: term.getUTCMonth() + 1,
          periodLabel: n > 1 ? `Parcela ${p.number}/${n}` : "Rescisão",
          dueDate: p.due,
          amount: p.amount,
          status: computeStatus(p.due, null),
          dreCategoryId: dre?.id ?? null,
          source: "MANUAL",
          notes: (b.notes as string) || null,
          // A 1ª parcela carrega o detalhamento (bruto/descontos); todas guardam o índice.
          details: n > 1
            ? { ...(p.number === 1 ? baseDetails : {}), installmentNumber: p.number, installmentTotal: n, netTotal: net }
            : baseDetails,
          createdById: user.id,
        },
      })
    ),
    // O crédito de VT é acertado na rescisão — zera para não arrastar saldo.
    prisma.employee.update({ where: { id: emp.id }, data: { vtCreditBalance: 0, updatedById: user.id } }),
  ]);

  await auditLog({
    userId: user.id, action: "RELEASE_TERMINATION", entity: "PayrollItem", entityId: parcelas[0].id,
    newValue: { employeeId: emp.id, gross, vtDiscount, otherDiscount, net, installments: n, dueDates: parcelas.map((p) => p.due.toISOString().slice(0, 10)) },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });

  response.status(201).json({
    id: parcelas[0].id,
    amount: net,
    installments: n,
    items: parcelas.map((p) => ({ id: p.id, amount: p.amount, dueDate: p.due.toISOString(), installmentNumber: p.number })),
  });
});

// ─── FÉRIAS — lançar (contabilidade manda o valor; sistema agenda + marca na escala) ──
// Vira um PayrollItem type FERIAS com o período (início/fim). A escala sombreia esses
// dias e o VT para neles; o pagamento entra em Contas a Pagar + DRE (categoria Férias).
payrollRouter.post("/vacation", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const b = request.body as Record<string, unknown>;
  const emp = await prisma.employee.findFirst({ where: { id: String(b.employeeId ?? ""), deletedAt: null } });
  if (!emp) return response.status(404).json({ message: "Funcionário não encontrado." });

  const start = b.startDate ? new Date(String(b.startDate)) : null;
  const end = b.endDate ? new Date(String(b.endDate)) : null;
  if (!start || isNaN(start.getTime()) || !end || isNaN(end.getTime())) {
    return response.status(400).json({ message: "Início e fim das férias são obrigatórios." });
  }
  if (end < start) return response.status(400).json({ message: "Fim das férias não pode ser antes do início." });

  const amount = numOrNull(b.amount) ?? 0;
  if (amount <= 0) return response.status(400).json({ message: "Valor das férias (informado pela contabilidade) é obrigatório." });

  // Vencimento: informado ou, por padrão, 2 dias antes do início (regra CLT de antecipação).
  const dueDate = b.dueDate ? new Date(String(b.dueDate)) : new Date(start.getTime() - 2 * 24 * 60 * 60 * 1000);
  const dre = await prisma.dRECategory.findFirst({ where: { name: "Férias" } });

  const item = await prisma.payrollItem.create({
    data: {
      id: crypto.randomUUID(),
      employeeId: emp.id,
      type: "FERIAS",
      competenceYear: start.getUTCFullYear(),
      competenceMonth: start.getUTCMonth() + 1,
      periodLabel: "Férias",
      periodStart: start,
      periodEnd: end,
      dueDate,
      amount: round2(amount),
      status: computeStatus(dueDate, null),
      dreCategoryId: dre?.id ?? null,
      source: "MANUAL",
      notes: (b.notes as string) || null,
      createdById: user.id,
    },
  });

  await auditLog({
    userId: user.id, action: "RELEASE_VACATION", entity: "PayrollItem", entityId: item.id,
    newValue: { employeeId: emp.id, startDate: b.startDate, endDate: b.endDate, amount }, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });

  response.status(201).json({ id: item.id, amount: round2(amount) });
});

// ─── PAGAR ───────────────────────────────────────────────────────────────────────
payrollRouter.patch("/:id/pay", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const existing = await prisma.payrollItem.findFirst({ where: { id: request.params.id, deletedAt: null } });
  if (!existing) return response.status(404).json({ message: "Lançamento não encontrado." });

  const b = request.body as Record<string, unknown>;
  const asText = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return s.length ? s : null; };
  const paymentDate = b.paymentDate ? new Date(String(b.paymentDate)) : new Date();
  const paidAmount = numOrNull(b.paidAmount) ?? Number(existing.amount);
  const paidPaymentMethodId = asText(b.paidPaymentMethodId);
  const paidPaymentMethodNameInput = asText(b.paidPaymentMethodName);
  const differenceReason = asText(b.differenceReason);
  const paymentNotes = asText(b.paymentNotes ?? b.notes);
  const payingCompanyId = asText(b.payingCompanyId);
  const companyBankAccountId = asText(b.companyBankAccountId);

  if (isNaN(paymentDate.getTime()) || paidAmount <= 0) {
    return response.status(400).json({ message: "Data e valor pago (> 0) são obrigatórios." });
  }
  // Paridade com títulos normais: forma de pagamento obrigatória.
  if (!paidPaymentMethodId && !paidPaymentMethodNameInput) {
    return response.status(400).json({ message: "Forma de pagamento é obrigatória." });
  }
  // Diferença em relação ao valor do título exige justificativa.
  const difference = Number((paidAmount - Number(existing.amount)).toFixed(2));
  if (Math.abs(difference) > 0.009 && !differenceReason) {
    return response.status(400).json({ message: "Justificativa obrigatória quando o valor pago difere do valor do título." });
  }
  // Conta bancária tem que pertencer à empresa pagadora e estar ativa.
  if (payingCompanyId && companyBankAccountId) {
    const owned = await prisma.companyBankAccount.findFirst({ where: { id: companyBankAccountId, companyId: payingCompanyId, isActive: true } });
    if (!owned) return response.status(400).json({ message: "Conta bancária não pertence à empresa selecionada ou está inativa." });
  }
  const method = paidPaymentMethodId ? await prisma.paymentMethod.findUnique({ where: { id: paidPaymentMethodId } }) : null;
  const paidPaymentMethodName = method?.name ?? paidPaymentMethodNameInput;

  const updated = await prisma.payrollItem.update({
    where: { id: request.params.id },
    data: {
      paymentDate, paidAmount, status: "PAID",
      paidPaymentMethodId, paidPaymentMethodName,
      paidByCompanyId: payingCompanyId, companyBankAccountId,
      differenceReason, paymentNotes,
      updatedById: user.id,
    },
  });

  await auditLog({
    userId: user.id, action: "PAY_PAYROLL_ITEM", entity: "PayrollItem", entityId: updated.id,
    previousValue: existing, newValue: updated, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });

  response.json({ id: updated.id, status: updated.status });
});

// ─── ESTORNAR ──────────────────────────────────────────────────────────────────
payrollRouter.patch("/:id/reverse", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const existing = await prisma.payrollItem.findFirst({ where: { id: request.params.id, deletedAt: null } });
  if (!existing) return response.status(404).json({ message: "Lançamento não encontrado." });
  if (!existing.paymentDate) return response.status(400).json({ message: "Este lançamento ainda não foi pago." });

  const updated = await prisma.payrollItem.update({
    where: { id: request.params.id },
    data: {
      paymentDate: null, paidAmount: null, status: computeStatus(existing.dueDate, null),
      paidPaymentMethodId: null, paidPaymentMethodName: null, paidByCompanyId: null,
      companyBankAccountId: null, differenceReason: null, paymentNotes: null,
      updatedById: user.id,
    },
  });

  await auditLog({
    userId: user.id, action: "REVERSE_PAYROLL_ITEM", entity: "PayrollItem", entityId: updated.id,
    previousValue: existing, newValue: updated, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });

  response.json({ id: updated.id, status: updated.status });
});

// ─── RESTAURAR (desfazer exclusão) ──────────────────────────────────────────────
payrollRouter.patch("/:id/restore", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const existing = await prisma.payrollItem.findFirst({ where: { id: request.params.id, deletedAt: { not: null } } });
  if (!existing) return response.status(404).json({ message: "Lançamento excluído não encontrado (talvez já restaurado)." });

  const updated = await prisma.payrollItem.update({
    where: { id: existing.id },
    data: { deletedAt: null, deletedById: null, status: computeStatus(existing.dueDate, existing.paymentDate), updatedById: user.id },
  });

  await auditLog({
    userId: user.id, action: "RESTORE_PAYROLL_ITEM", entity: "PayrollItem", entityId: updated.id,
    newValue: { restored: true }, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });

  response.json({ id: updated.id, status: updated.status });
});

// ─── EDITAR (valor/vencimento; período p/ férias) ───────────────────────────────
// Pagamento é feito no Contas a Pagar — aqui só ajusta o lançamento (não pago).
payrollRouter.patch("/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const existing = await prisma.payrollItem.findFirst({ where: { id: request.params.id, deletedAt: null } });
  if (!existing) return response.status(404).json({ message: "Lançamento não encontrado." });
  // Alterar/excluir um lancamento muda o total da folha daquela competencia no DRE.
  try {
    await assertPeriodWritableForDate(new Date(existing.competenceYear, existing.competenceMonth - 1, 1), "Edicao de lancamento de folha");
  } catch (error) {
    return response.status(400).json({ message: error instanceof Error ? error.message : "Periodo fechado." });
  }

  if (existing.paymentDate) return response.status(400).json({ message: "Lançamento já pago — estorne no Contas a Pagar antes de editar." });

  const b = request.body as Record<string, unknown>;
  const amount = numOrNull(b.amount);
  if (amount == null || amount <= 0) return response.status(400).json({ message: "Valor (maior que zero) é obrigatório." });
  const dueDate = b.dueDate ? new Date(String(b.dueDate)) : existing.dueDate;
  if (isNaN(dueDate.getTime())) return response.status(400).json({ message: "Vencimento inválido." });

  const data: Prisma.PayrollItemUpdateInput = {
    amount: round2(amount),
    dueDate,
    status: computeStatus(dueDate, null),
    updatedById: user.id,
  };
  if (existing.type === "FERIAS" && b.startDate) {
    const s = new Date(String(b.startDate));
    if (!isNaN(s.getTime())) { data.periodStart = s; data.competenceYear = s.getUTCFullYear(); data.competenceMonth = s.getUTCMonth() + 1; }
  }
  if (existing.type === "FERIAS" && b.endDate) {
    const e = new Date(String(b.endDate));
    if (!isNaN(e.getTime())) data.periodEnd = e;
  }
  if (b.notes !== undefined) data.notes = (b.notes as string) || null;

  const updated = await prisma.payrollItem.update({ where: { id: existing.id }, data });

  await auditLog({
    userId: user.id, action: "EDIT_PAYROLL_ITEM", entity: "PayrollItem", entityId: updated.id,
    previousValue: { amount: existing.amount, dueDate: existing.dueDate },
    newValue: { amount: round2(amount), dueDate }, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });

  response.json({ id: updated.id, status: updated.status });
});

// ─── DELETE (soft) ────────────────────────────────────────────────────────────────
payrollRouter.delete("/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const existing = await prisma.payrollItem.findFirst({ where: { id: request.params.id, deletedAt: null } });
  if (!existing) return response.status(404).json({ message: "Lançamento não encontrado." });
  // Alterar/excluir um lancamento muda o total da folha daquela competencia no DRE.
  try {
    await assertPeriodWritableForDate(new Date(existing.competenceYear, existing.competenceMonth - 1, 1), "Exclusao de lancamento de folha");
  } catch (error) {
    return response.status(400).json({ message: error instanceof Error ? error.message : "Periodo fechado." });
  }


  const reason = String((request.body as { reason?: unknown })?.reason ?? "").trim();
  if (reason.length < 3) return response.status(400).json({ message: "Informe a justificativa da exclusão (mín. 3 caracteres)." });

  await prisma.payrollItem.update({
    where: { id: request.params.id },
    data: { deletedAt: new Date(), deletedById: user.id },
  });

  await auditLog({
    userId: user.id, action: "DELETE_PAYROLL_ITEM", entity: "PayrollItem", entityId: request.params.id,
    previousValue: existing, newValue: { reason },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });

  response.json({ ok: true });
});
