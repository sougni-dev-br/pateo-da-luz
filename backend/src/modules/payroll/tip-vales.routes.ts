// Vales da gorjeta: adiantamentos, refeição, retirada de caixa… lançados no
// restaurante e abatidos da gorjeta antes do envio à contabilidade (que recebe a
// gorjeta líquida). Tudo fica no banco: lançar, corrigir e cancelar deixam
// autor, data e motivo; cancelar não apaga — o vale só deixa de descontar.
// Montado dentro de tipCommissionRouter (/payroll/tip).
import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { computeTipCommission } from "./tip-commission.service.js";
import { saldoReserva, travarFundo } from "./tip-historico.service.js";

export const tipValesRouter = Router();

const TIPOS = ["ADIANTAMENTO", "REFEICAO", "VALE_CONSUMO", "RETIRADA_CAIXA", "OUTRO", "CREDITO"] as const;
type Tipo = (typeof TIPOS)[number];
const VALOR_MAXIMO = 100_000;

const nomeDe = (e: { displayName: string | null; firstName: string; lastName: string }) =>
  (e.displayName || `${e.firstName} ${e.lastName}`).trim();

function dataOuNull(v: unknown): Date | null | "invalida" {
  if (v == null || v === "") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v).slice(0, 10));
  if (!m) return "invalida";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? "invalida" : d;
}

// Lê e valida o corpo de um vale (lançar ou corrigir).
export function lerVale(b: Record<string, unknown>) {
  const type = TIPOS.includes(String(b.type) as Tipo) ? (String(b.type) as Tipo) : null;
  const amount = Number(b.amount);
  const date = dataOuNull(b.date);
  const notes = b.notes == null ? null : String(b.notes).trim().slice(0, 300) || null;
  if (!type) return { erro: "Escolha o tipo do vale." };
  if (!Number.isFinite(amount) || amount <= 0 || amount > VALOR_MAXIMO) return { erro: "Valor do vale inválido." };
  if (date === "invalida") return { erro: "Data do vale inválida." };
  return { dados: { type, amount: Math.round(amount * 100) / 100, date, notes } };
}

// Período fechado não aceita vale: mudaria a gorjeta líquida já conferida.
async function barradoPorFechamento(periodId: string, response: Response, acao: string) {
  const p = await prisma.tipPeriod.findUnique({ where: { id: periodId }, select: { status: true, competenceMonth: true, competenceYear: true } });
  if (p?.status !== "CLOSED") return false;
  response.status(409).json({
    message: `A gorjeta de ${String(p.competenceMonth).padStart(2, "0")}/${p.competenceYear} está fechada. ${acao} mudaria a gorjeta líquida já conferida — reabra o período antes.`,
  });
  return true;
}

function valeParaTela(v: {
  id: string; participantId: string; type: string; amount: unknown; date: Date | null; notes: string | null;
  createdAt: Date; createdByName: string | null; updatedAt: Date | null; canceledAt: Date | null; canceledByName: string | null;
  cancelReason: string | null; reserveMovement?: { id: string } | null;
}) {
  return {
    id: v.id, participantId: v.participantId, type: v.type, amount: Number(v.amount),
    date: v.date ? v.date.toISOString().slice(0, 10) : null, notes: v.notes,
    lancadoEm: v.createdAt.toISOString(), lancadoPor: v.createdByName, alteradoEm: v.updatedAt?.toISOString() ?? null,
    canceladoEm: v.canceledAt?.toISOString() ?? null, canceladoPor: v.canceledByName, motivoCancelamento: v.cancelReason,
    doFundo: Boolean(v.reserveMovement),
  };
}

// Vales do período (inclusive cancelados) e o resumo por pessoa: gorjeta, vales, líquida.
tipValesRouter.get("/periods/:year/:month/vales", async (request: Request, response: Response) => {
  const year = parseInt(request.params.year, 10);
  const month = parseInt(request.params.month, 10);
  const periodo = await prisma.tipPeriod.findUnique({ where: { competenceYear_competenceMonth: { competenceYear: year, competenceMonth: month } } });
  if (!periodo) return response.status(404).json({ message: "Período não encontrado." });
  const [vales, comp] = await Promise.all([
    prisma.tipVale.findMany({
      where: { participant: { periodId: periodo.id } },
      include: { reserveMovement: { select: { id: true } }, participant: { select: { employeeId: true, employee: { select: { displayName: true, firstName: true, lastName: true } } } } },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
    computeTipCommission(year, month),
  ]);
  response.json({
    code: periodo.code, status: periodo.status,
    vales: vales.map((v) => ({ ...valeParaTela(v), employeeId: v.participant.employeeId, nome: nomeDe(v.participant.employee) })),
    pessoas: comp.participants.filter((p) => p.tipoCalculo !== "FORA_DO_PERIODO").map((p) => ({
      participantId: p.participantId, employeeId: p.employeeId, nome: p.employeeName, semRegistro: p.semRegistro,
      gorjeta: p.rateioAmount, descontos: p.descontos, creditos: p.creditos, liquida: p.netCommission, pagoNaRescisao: p.pagoNaRescisao,
    })),
  });
});

tipValesRouter.post("/participants/:id/vales", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const lido = lerVale(request.body as Record<string, unknown>);
  if ("erro" in lido) return response.status(422).json({ message: lido.erro });
  const participante = await prisma.tipParticipant.findUnique({ where: { id: request.params.id }, select: { id: true, periodId: true, employeeId: true } });
  if (!participante) return response.status(404).json({ message: "Pessoa não está na apuração." });
  if (await barradoPorFechamento(participante.periodId, response, "Lançar um vale")) return;
  const vale = await prisma.tipVale.create({
    data: { id: crypto.randomUUID(), participantId: participante.id, ...lido.dados, createdById: user.id, createdByName: user.name },
  });
  await auditLog({
    userId: user.id, action: "CREATE_TIP_VALE", entity: "TipVale", entityId: vale.id,
    newValue: { periodId: participante.periodId, employeeId: participante.employeeId, ...lido.dados },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.status(201).json({ id: vale.id });
});

// Corrigir um vale (tipo, valor, data, descrição). Crédito do fundo não se corrige aqui.
tipValesRouter.put("/vales/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const lido = lerVale(request.body as Record<string, unknown>);
  if ("erro" in lido) return response.status(422).json({ message: lido.erro });
  const antes = await prisma.tipVale.findUnique({ where: { id: request.params.id }, include: { participant: { select: { periodId: true } }, reserveMovement: { select: { id: true } } } });
  if (!antes) return response.status(404).json({ message: "Vale não encontrado." });
  if (antes.canceledAt) return response.status(409).json({ message: "Este vale foi cancelado; lance um novo." });
  if (antes.reserveMovement) return response.status(409).json({ message: "Crédito da distribuição do fundo: corrija pela aba Relatórios → Fundo de reserva." });
  if (await barradoPorFechamento(antes.participant.periodId, response, "Corrigir um vale")) return;
  await prisma.tipVale.update({ where: { id: antes.id }, data: { ...lido.dados, updatedById: user.id, updatedAt: new Date() } });
  await auditLog({
    userId: user.id, action: "UPDATE_TIP_VALE", entity: "TipVale", entityId: antes.id,
    previousValue: { type: antes.type, amount: Number(antes.amount), date: antes.date, notes: antes.notes },
    newValue: lido.dados, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.json({ ok: true });
});

// Cancelar (com motivo). Crédito da distribuição do fundo devolve o valor ao fundo.
tipValesRouter.post("/vales/:id/cancelar", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const motivo = String((request.body as { motivo?: unknown } | undefined)?.motivo ?? "").trim().slice(0, 300);
  if (motivo.length < 5) return response.status(422).json({ message: "Escreva o motivo do cancelamento (pelo menos 5 letras)." });
  const antes = await prisma.tipVale.findUnique({ where: { id: request.params.id }, include: { participant: { select: { periodId: true, employeeId: true } }, reserveMovement: true } });
  if (!antes) return response.status(404).json({ message: "Vale não encontrado." });
  if (antes.canceledAt) return response.status(409).json({ message: "Este vale já está cancelado." });
  if (await barradoPorFechamento(antes.participant.periodId, response, "Cancelar um vale")) return;
  await prisma.$transaction(async (tx) => {
    if (antes.reserveMovement) {
      await travarFundo(tx);
      await tx.tipReserveMovement.delete({ where: { id: antes.reserveMovement.id } });
    }
    await tx.tipVale.update({
      where: { id: antes.id },
      data: { canceledAt: new Date(), canceledById: user.id, canceledByName: user.name, cancelReason: motivo },
    });
  });
  await auditLog({
    userId: user.id, action: "CANCEL_TIP_VALE", entity: "TipVale", entityId: antes.id,
    previousValue: { periodId: antes.participant.periodId, employeeId: antes.participant.employeeId, type: antes.type, amount: Number(antes.amount), date: antes.date, notes: antes.notes },
    newValue: { motivo, devolvidoAoFundo: Boolean(antes.reserveMovement), saldoFundo: antes.reserveMovement ? await saldoReserva(prisma) : undefined },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.json({ ok: true });
});

// Relatório: vales de um intervalo de competências (AAAA-MM), cancelados inclusive.
tipValesRouter.get("/reports/vales", async (request, response) => {
  const q = request.query as Record<string, unknown>;
  const mes = (v: unknown) => /^(\d{4})-(\d{2})$/.exec(String(v ?? ""));
  const de = mes(q.de);
  const ate = mes(q.ate);
  if (!de || !ate) return response.status(400).json({ message: "Informe o intervalo (de e até, AAAA-MM)." });
  const chave = (m: RegExpExecArray) => Number(m[1]) * 100 + Number(m[2]);
  const periodos = await prisma.tipPeriod.findMany({ select: { id: true, code: true, competenceYear: true, competenceMonth: true } });
  const noIntervalo = periodos.filter((p) => {
    const k = p.competenceYear * 100 + p.competenceMonth;
    return k >= chave(de) && k <= chave(ate);
  });
  const porId = new Map(noIntervalo.map((p) => [p.id, p]));
  const vales = await prisma.tipVale.findMany({
    where: { participant: { periodId: { in: [...porId.keys()] } } },
    include: { reserveMovement: { select: { id: true } }, participant: { select: { periodId: true, employeeId: true, employee: { select: { displayName: true, firstName: true, lastName: true } } } } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  response.json(vales.map((v) => {
    const p = porId.get(v.participant.periodId)!;
    return {
      ...valeParaTela(v), employeeId: v.participant.employeeId, nome: nomeDe(v.participant.employee),
      periodo: p.code, competencia: `${String(p.competenceMonth).padStart(2, "0")}/${p.competenceYear}`,
    };
  }));
});
