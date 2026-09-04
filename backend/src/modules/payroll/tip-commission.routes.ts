// Rotas da Folha da Gorjeta (Comissão) — Fase A.
// Registrada em app.ts como:  app.use("/payroll/tip", tipCommissionRouter);

import crypto from "node:crypto";
import { Router, type Response } from "express";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp, type SessionUser } from "../security/security-utils.js";
import { userHasPermission } from "../security/menu-permissions.js";
import {
  closeTipPeriod, computeTipCommission, ensureTipPeriod, findOverlappingPeriod,
  getServicePool, getServicePoolByRange, reopenTipPeriod, syncParticipantsFromCadastro, tipPeriodBounds,
} from "./tip-commission.service.js";
import fs from "node:fs";
import path from "node:path";
import { importExtrato, onlyDigits, parseExtratoMensal } from "./rh-extract.service.js";

// Formata dd/mm a partir de uma data UTC.
function fmtDay(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
// Converte "YYYY-MM-DD" em Date UTC à meia-noite; retorna null se inválida.
function parseDateUTC(v: unknown): Date | null {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isNaN(d.getTime()) ? null : d;
}

export const tipCommissionRouter = Router();

// ─── Trava de período fechado ───────────────────────────────────
// closeTipPeriod só sela o período depois de conferir que a soma dos rateios
// bate com o pool líquido e que os pontos estão completos. Mas nenhuma rota de
// escrita olhava esse selo: dava para apagar participante, lançar ou apagar
// vale e re-sincronizar o cadastro de um período já CLOSED, refazendo por baixo
// uma conferência que já tinha sido assinada — e sem deixar rastro, porque
// nenhuma dessas rotas auditava. Quem quiser mexer reabre antes, pela rota
// /periods/:year/:month/reopen, que registra a reabertura.
async function periodoDeGorjetaFechado(periodId: string) {
  const periodo = await prisma.tipPeriod.findUnique({
    where: { id: periodId },
    select: { status: true, competenceYear: true, competenceMonth: true },
  });
  if (!periodo || periodo.status !== "CLOSED") return null;
  return `${String(periodo.competenceMonth).padStart(2, "0")}/${periodo.competenceYear}`;
}

// Responde 409 e devolve true quando a escrita foi barrada.
async function barrouPorFechamento(periodId: string | null, response: Response, acao: string) {
  if (!periodId) return false;
  const mes = await periodoDeGorjetaFechado(periodId);
  if (!mes) return false;
  response.status(409).json({
    message: `A gorjeta de ${mes} está fechada. ${acao} mudaria um rateio já conferido — reabra o período antes.`,
  });
  return true;
}

// Sobe do participante (ou do vale) até o período dono.
async function periodIdDoParticipante(participantId: string) {
  const p = await prisma.tipParticipant.findUnique({
    where: { id: participantId }, select: { periodId: true },
  });
  return p?.periodId ?? null;
}

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

// ─── Prévia do cálculo (não persiste) ───────────────────────────────────────
tipCommissionRouter.get("/", async (request, response) => {
  const { year, month } = parseYearMonth(request.query as { year?: unknown; month?: unknown });
  const computation = await computeTipCommission(year, month);
  response.json(computation);
});

// Pool sugerido do faturamento, sem abrir o período (para pré-visualizar).
tipCommissionRouter.get("/pool", async (request, response) => {
  const { year, month } = parseYearMonth(request.query as { year?: unknown; month?: unknown });
  const { start, end, label } = tipPeriodBounds(year, month);
  const grossPool = await getServicePool(year, month);
  response.json({ year, month, label, periodStart: start, periodEnd: end, grossPool });
});

// ─── Abrir/garantir o período (puxa o pool do Faturamento Salão) ────────────
tipCommissionRouter.post("/periods", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const { year, month } = parseYearMonth(request.body as { year?: unknown; month?: unknown });
  const period = await ensureTipPeriod(year, month, user.id);
  await auditLog({
    userId: user.id, action: "OPEN_TIP_PERIOD", entity: "TipPeriod", entityId: period.id,
    newValue: period, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.status(201).json(period);
});

// Editar pool bruto / % de dedução do período.
tipCommissionRouter.put("/periods/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const b = request.body as Record<string, unknown>;
  const periodId = request.params.id;
  if (await barrouPorFechamento(periodId, response, "Alterar o período")) return;
  const gross = numOrNull(b.grossPool);
  const pointsTotalRaw = numOrNull(b.pointsTotal);
  const pointsTotal = pointsTotalRaw == null ? undefined : Math.max(1, Math.round(pointsTotalRaw));

  // ── Datas do período (opcionais). Se enviadas, controla duplicidade e recalcula o total. ──
  let periodStart: Date | undefined;
  let periodEnd: Date | undefined;
  let label: string | undefined;
  let grossFromRange: number | undefined;
  if (b.periodStart != null || b.periodEnd != null) {
    const current = await prisma.tipPeriod.findUnique({ where: { id: periodId } });
    if (!current) return response.status(404).json({ message: "Período não encontrado." });
    const s = b.periodStart != null ? parseDateUTC(b.periodStart) : current.periodStart;
    const e = b.periodEnd != null ? parseDateUTC(b.periodEnd) : current.periodEnd;
    if (!s || !e) return response.status(400).json({ message: "Datas do período inválidas (use AAAA-MM-DD)." });
    if (s.getTime() > e.getTime()) return response.status(422).json({ message: "A data inicial não pode ser posterior à data final." });

    // Controle de duplicidade: não permite sobreposição com outro período.
    const overlap = await findOverlappingPeriod(s, e, periodId);
    if (overlap) {
      return response.status(422).json({
        message: `Este intervalo (${fmtDay(s)}–${fmtDay(e)}) sobrepõe o período "${overlap.label}" (${String(overlap.competenceMonth).padStart(2, "0")}/${overlap.competenceYear}). Para não pagar em duplicidade, ajuste as datas.`,
      });
    }
    periodStart = s;
    periodEnd = e;
    label = `Gorjeta ${fmtDay(s)}–${fmtDay(e)}`;
    // Recalcula o total do Faturamento no novo intervalo, exceto se um total manual foi enviado.
    if (gross == null) {
      const endExclusive = new Date(e.getTime() + 24 * 60 * 60 * 1000);
      grossFromRange = await getServicePoolByRange(s, endExclusive);
    }
  }

  const grossFinal = gross ?? grossFromRange;
  const period = await prisma.tipPeriod.update({
    where: { id: periodId },
    data: {
      grossPool: grossFinal ?? undefined,
      poolSource: gross != null ? "MANUAL" : (grossFromRange != null ? "REVENUE" : undefined),
      deductionPercent: numOrNull(b.deductionPercent) ?? undefined,
      pointsTotal,
      periodStart,
      periodEnd,
      label,
      updatedById: user.id,
    },
  });
  response.json(period);
});

// ─── Participantes: upsert em lote (pontos / cota fixa) ─────────────────────
// body: { periodId, participants: [{ employeeId, kind, points?, fixedAmount? }] }
tipCommissionRouter.put("/periods/:id/participants", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const periodId = request.params.id;
  const list = (request.body as { participants?: unknown }).participants;
  if (!Array.isArray(list)) return response.status(400).json({ message: "participants deve ser uma lista." });

  const periodBefore = await prisma.tipPeriod.findUnique({ where: { id: periodId } });
  if (!periodBefore) return response.status(404).json({ message: "Período não encontrado." });
  if (await barrouPorFechamento(periodId, response, "Alterar os participantes")) return;

  // Bloqueio: a soma dos pontos distribuídos não pode ultrapassar o total definido no período.
  const budget = Number(periodBefore.pointsTotal);
  const sumPoints = (list as Array<Record<string, unknown>>).reduce((acc, raw) => {
    const kind = raw.kind === "FIXO" ? "FIXO" : "PONTOS";
    return acc + (kind === "PONTOS" ? (numOrNull(raw.points) ?? 0) : 0);
  }, 0);
  if (sumPoints > budget) {
    return response.status(422).json({
      message: `A soma dos pontos (${sumPoints}) ultrapassa o total definido (${budget}). Reduza os pontos ou aumente o total do rateio.`,
    });
  }

  await prisma.$transaction(async (tx) => {
    for (const raw of list as Array<Record<string, unknown>>) {
      const employeeId = String(raw.employeeId ?? "");
      if (!employeeId) continue;
      const kind = raw.kind === "FIXO" ? "FIXO" : "PONTOS";
      const points = kind === "PONTOS" ? (numOrNull(raw.points) ?? 0) : null;
      const fixedAmount = kind === "FIXO" ? (numOrNull(raw.fixedAmount) ?? 0) : null;
      // Dados do RH (texto livre / número / booleano).
      const horaExtra = raw.horaExtra != null && String(raw.horaExtra).trim() !== "" ? String(raw.horaExtra).trim() : null;
      const adicionalNoturno = raw.adicionalNoturno != null && String(raw.adicionalNoturno).trim() !== "" ? String(raw.adicionalNoturno).trim() : null;
      const faltas = numOrNull(raw.faltas);
      const justificada = Boolean(raw.justificada);
      await tx.tipParticipant.upsert({
        where: { periodId_employeeId: { periodId, employeeId } },
        create: { id: crypto.randomUUID(), periodId, employeeId, kind, points, fixedAmount, horaExtra, adicionalNoturno, faltas, justificada },
        update: { kind, points, fixedAmount, horaExtra, adicionalNoturno, faltas, justificada },
      });
    }
  });

  const period = await prisma.tipPeriod.findUniqueOrThrow({ where: { id: periodId } });
  const computation = await computeTipCommission(period.competenceYear, period.competenceMonth);
  response.json(computation);
});

// ─── Extrato Mensal do RH: leitura + conferência (não gera nada, só lê) ──────
tipCommissionRouter.post("/extrato/preview", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const b = request.body as { fileBase64?: unknown };
  if (typeof b.fileBase64 !== "string" || !b.fileBase64) {
    return response.status(400).json({ message: "Envie o PDF do extrato (fileBase64)." });
  }
  let parsed;
  try {
    const base64 = b.fileBase64.replace(/^data:[^,]*,/, "");
    parsed = await parseExtratoMensal(Buffer.from(base64, "base64"));
  } catch (err) {
    return response.status(422).json({ message: "Não foi possível ler o PDF do extrato. " + (err as Error).message });
  }
  if (parsed.funcionarios.length === 0) {
    return response.status(422).json({ message: "Nenhum funcionário foi lido do extrato. Confira se o arquivo é o Extrato Mensal do RH." });
  }
  const employees = await prisma.employee.findMany({
    where: { deletedAt: null },
    select: { id: true, firstName: true, lastName: true, displayName: true, cpf: true, isActive: true },
  });
  const byCpf = new Map(employees.map((e) => [onlyDigits(e.cpf), e]));
  const items = parsed.funcionarios.map((f) => {
    const emp = f.cpfNorm ? byCpf.get(f.cpfNorm) : undefined;
    return {
      nome: f.nome, cpf: f.cpf, liquido: f.liquido, gorjeta: f.gorjeta,
      matched: Boolean(emp),
      employeeId: emp?.id ?? null,
      employeeName: emp ? (emp.displayName || `${emp.firstName} ${emp.lastName}`).trim() : null,
      isActive: emp?.isActive ?? null,
    };
  });
  response.json({
    empresa: parsed.empresa, cnpj: parsed.cnpj,
    competenceYear: parsed.competenceYear, competenceMonth: parsed.competenceMonth,
    totalLiquido: Math.round(items.reduce((a, i) => a + i.liquido, 0) * 100) / 100,
    matchedCount: items.filter((i) => i.matched).length,
    items,
  });
});

// Importar o Extrato: gera os salários no Contas a Pagar + rastreabilidade (arquivo).
tipCommissionRouter.post("/extrato/import", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const b = request.body as { fileBase64?: unknown; fileName?: unknown; dueDay?: unknown };
  if (typeof b.fileBase64 !== "string" || !b.fileBase64) {
    return response.status(400).json({ message: "Envie o PDF do extrato (fileBase64)." });
  }
  try {
    const base64 = b.fileBase64.replace(/^data:[^,]*,/, "");
    const buffer = Buffer.from(base64, "base64");
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    // Guarda o PDF para rastreabilidade.
    const dir = path.resolve("uploads", "rh-extratos");
    fs.mkdirSync(dir, { recursive: true });
    const safeName = String(b.fileName ?? "extrato.pdf").replace(/[^\w.\-() ]/g, "_");
    const storagePath = path.join(dir, `${Date.now()}-${sha256.slice(0, 8)}-${safeName}`);
    fs.writeFileSync(storagePath, buffer);
    const result = await importExtrato({
      buffer, userId: user.id, fileName: safeName, storagePath, sha256,
      dueDay: numOrNull(b.dueDay) ?? undefined,
    });
    await auditLog({
      userId: user.id, action: "IMPORT_RH_EXTRATO", entity: "RhExtract", entityId: result.rhExtractId,
      newValue: result, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
    });
    response.status(201).json(result);
  } catch (err) {
    response.status(422).json({ message: (err as Error).message });
  }
});

// Recarregar participantes do cadastro (quem participa da gorjeta, inclusive desligados).
tipCommissionRouter.post("/periods/:id/sync", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const periodId = request.params.id;
  const period = await prisma.tipPeriod.findUnique({ where: { id: periodId } });
  if (!period) return response.status(404).json({ message: "Período não encontrado." });
  if (await barrouPorFechamento(periodId, response, "Recarregar os participantes")) return;
  const added = await syncParticipantsFromCadastro(periodId);
  const computation = await computeTipCommission(period.competenceYear, period.competenceMonth);
  response.json({ added, computation });
});

// Remover um participante do período.
tipCommissionRouter.delete("/participants/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const participantId = request.params.id;
  // Fotografa antes: sair do rateio muda o valor de todo mundo (o ponto do
  // removido volta para o bolo), e até aqui isso não deixava nenhum registro.
  const antes = await prisma.tipParticipant.findUnique({
    where: { id: participantId },
    select: {
      id: true, periodId: true, employeeId: true, kind: true, points: true,
      fixedAmount: true, netCommission: true,
      employee: { select: { displayName: true, firstName: true, lastName: true } },
    },
  });
  if (!antes) return response.status(404).json({ message: "Participante não encontrado." });
  if (await barrouPorFechamento(antes.periodId, response, "Remover um participante")) return;
  await prisma.tipParticipant.delete({ where: { id: participantId } });
  await auditLog({
    userId: user.id, action: "DELETE_TIP_PARTICIPANT", entity: "TipParticipant",
    entityId: participantId,
    previousValue: {
      periodId: antes.periodId,
      funcionario: antes.employee?.displayName || `${antes.employee?.firstName ?? ""} ${antes.employee?.lastName ?? ""}`.trim() || antes.employeeId,
      kind: antes.kind, points: antes.points,
      fixedAmount: antes.fixedAmount == null ? null : String(antes.fixedAmount),
      netCommission: antes.netCommission == null ? null : String(antes.netCommission),
    },
    newValue: null,
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.json({ ok: true });
});

// ─── Vales (descontos internos, não vão ao holerite) ────────────────────────
tipCommissionRouter.post("/participants/:id/vales", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const b = request.body as Record<string, unknown>;
  const amount = numOrNull(b.amount);
  if (amount == null || amount <= 0) return response.status(400).json({ message: "amount inválido." });
  if (await barrouPorFechamento(await periodIdDoParticipante(request.params.id), response, "Lançar um vale")) return;
  const type = ["REFEICAO", "VALE_CONSUMO", "RETIRADA_CAIXA", "ADIANTAMENTO", "OUTRO"].includes(String(b.type)) ? String(b.type) : "OUTRO";
  const vale = await prisma.tipVale.create({
    data: {
      id: crypto.randomUUID(),
      participantId: request.params.id,
      type: type as never,
      amount,
      date: b.date ? new Date(String(b.date)) : null,
      notes: b.notes ? String(b.notes) : null,
      createdById: user.id,
    },
  });
  response.status(201).json(vale);
});

tipCommissionRouter.delete("/vales/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const valeId = request.params.id;
  // O vale é abatido do rateio (netCommission = rateio − vales). Apagar um
  // devolve dinheiro ao participante, então precisa de trava e de rastro.
  const antes = await prisma.tipVale.findUnique({
    where: { id: valeId },
    select: {
      id: true, type: true, amount: true, date: true, notes: true,
      participant: { select: { id: true, periodId: true, employeeId: true } },
    },
  });
  if (!antes) return response.status(404).json({ message: "Vale não encontrado." });
  if (await barrouPorFechamento(antes.participant?.periodId ?? null, response, "Apagar um vale")) return;
  await prisma.tipVale.delete({ where: { id: valeId } });
  await auditLog({
    userId: user.id, action: "DELETE_TIP_VALE", entity: "TipVale", entityId: valeId,
    previousValue: {
      participantId: antes.participant?.id ?? null,
      periodId: antes.participant?.periodId ?? null,
      employeeId: antes.participant?.employeeId ?? null,
      type: antes.type, amount: String(antes.amount),
      date: antes.date, notes: antes.notes,
    },
    newValue: null,
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.json({ ok: true });
});

// ─── Fechar o período (recalcula, persiste e trava a conferência) ───────────
tipCommissionRouter.post("/periods/:year/:month/close", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const year = parseInt(request.params.year, 10);
  const month = parseInt(request.params.month, 10);
  try {
    const result = await closeTipPeriod(year, month, user.id);
    await auditLog({
      userId: user.id, action: "CLOSE_TIP_PERIOD", entity: "TipPeriod", entityId: `${year}-${month}`,
      newValue: result.totals, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
    });
    response.json(result);
  } catch (err) {
    response.status(422).json({ message: (err as Error).message });
  }
});

// ─── Reabrir um período fechado (correções de RH/rateio; exige novo fechamento) ──
tipCommissionRouter.post("/periods/:year/:month/reopen", async (request, response) => {
  // Reabrir é ação sensível (destrava um período selado) → continua restrita, mas por
  // PERMISSÃO e não por cargo: exige a ação "Administrar" em Fechamento de Gorjetas.
  // O ADMIN sempre a possui; assim o dono delega sem precisar promover ninguém a ADMIN.
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  if (!(await userHasPermission(user as SessionUser, "payroll-tips", "admin"))) {
    return response.status(403).json({ message: "Usuário sem permissão para reabrir um período fechado." });
  }
  const year = parseInt(request.params.year, 10);
  const month = parseInt(request.params.month, 10);
  try {
    const result = await reopenTipPeriod(year, month, user.id);
    await auditLog({
      userId: user.id, action: "REOPEN_TIP_PERIOD", entity: "TipPeriod", entityId: `${year}-${month}`,
      newValue: { competenceYear: year, competenceMonth: month }, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
    });
    response.json(result);
  } catch (err) {
    response.status(422).json({ message: (err as Error).message });
  }
});
