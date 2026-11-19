// Rotas do histórico, relatórios, fundo de reserva e registro dos fechamentos da gorjeta.
// Montado em tip-commission.routes.ts (mesmo prefixo /payroll/tip).

import { Router } from "express";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { podeVerDadosPessoais } from "./dados-pessoais.js";
import { distribuirReserva, evolucaoMensal, extratoReserva, lancarAjusteReserva, listarMudancas, motivoParaNaoRetirar, saldoReserva, travarFundo } from "./tip-historico.service.js";
import { detalheFechamento, listarFechamentos } from "./tip-fechamento.service.js";
import { parseDateUTC, barrouPorFechamento, numOrNull, textoOuNull, hojeSaoPaulo } from "./tip-routes-comum.js";

export const tipReservaRouter = Router();
const router = tipReservaRouter;

// ─── Histórico e relatórios ─────────────────────────────────────────────────
router.get("/team/:employeeId/history", async (request, response) => {
  response.json(await listarMudancas({ employeeId: request.params.employeeId }));
});

router.get("/reports/changes", async (request, response) => {
  const q = request.query as Record<string, unknown>;
  response.json(await listarMudancas({ de: parseDateUTC(q.de) ?? undefined, ate: parseDateUTC(q.ate) ?? undefined }));
});

// ?de=AAAA-MM&ate=AAAA-MM
router.get("/reports/evolution", async (request, response) => {
  const q = request.query as Record<string, unknown>;
  const mes = (v: unknown, padrao: { ano: number; mes: number }) => {
    const m = /^(\d{4})-(\d{2})$/.exec(String(v ?? ""));
    return m ? { ano: Number(m[1]), mes: Number(m[2]) } : padrao;
  };
  const hoje = new Date();
  const ate = mes(q.ate, { ano: hoje.getFullYear(), mes: hoje.getMonth() + 1 });
  const de = mes(q.de, { ano: ate.ano - 1, mes: ate.mes });
  response.json(await evolucaoMensal(de, ate));
});

// ─── Fundo de reserva ───────────────────────────────────────────────────────
router.get("/reserve", async (_request, response) => {
  response.json(await extratoReserva());
});

// Ajuste manual (saldo inicial, correção). Valor positivo entra, negativo sai.
router.post("/reserve/adjustments", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const b = request.body as Record<string, unknown>;
  const amount = numOrNull(b.amount);
  const notes = textoOuNull(b.notes);
  if (amount == null || amount === 0) return response.status(422).json({ message: "Informe um valor diferente de zero." });
  if (!notes) return response.status(422).json({ message: "Descreva o ajuste (ex.: saldo inicial guardado até set/2026)." });
  const mov = await lancarAjusteReserva(amount, parseDateUTC(b.date) ?? hojeSaoPaulo(), notes, user.id);
  await auditLog({
    userId: user.id, action: "TIP_RESERVE_ADJUSTMENT", entity: "TipReserveMovement", entityId: mov.id,
    newValue: { amount, notes }, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.status(201).json({ ok: true });
});

router.delete("/reserve/adjustments/:id", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const mov = await prisma.tipReserveMovement.findUnique({ where: { id: request.params.id } });
  if (!mov || mov.type !== "AJUSTE") return response.status(404).json({ message: "Só ajustes manuais podem ser apagados aqui." });
  // Apagar um ajuste de entrada que já foi usado em distribuições deixaria o fundo negativo.
  try {
    await prisma.$transaction(async (tx) => {
      await travarFundo(tx);
      const bloqueio = motivoParaNaoRetirar(await saldoReserva(tx), Number(mov.amount), "este ajuste");
      if (bloqueio) throw new Error(bloqueio.replace("Apague créditos de distribuição em período aberto ou lance um ajuste no fundo antes de reabrir.", "Lance outro ajuste antes de apagar este."));
      await tx.tipReserveMovement.delete({ where: { id: mov.id } });
    });
  } catch (err) {
    return response.status(422).json({ message: (err as Error).message });
  }
  await auditLog({
    userId: user.id, action: "DELETE_TIP_RESERVE_ADJUSTMENT", entity: "TipReserveMovement", entityId: mov.id,
    previousValue: { amount: String(mov.amount), notes: mov.notes }, newValue: null,
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.json({ ok: true });
});

// body: { periodId, items: [{ employeeId, amount, notes? }] }
router.post("/reserve/distribute", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const b = request.body as { periodId?: unknown; items?: unknown };
  const periodId = String(b.periodId ?? "");
  if (!periodId) return response.status(400).json({ message: "Informe o período." });
  if (await barrouPorFechamento(periodId, response, "Distribuir a reserva")) return;
  const itens = Array.isArray(b.items) ? (b.items as Array<Record<string, unknown>>).map((i) => ({
    employeeId: String(i.employeeId ?? ""), amount: numOrNull(i.amount) ?? 0, notes: textoOuNull(i.notes),
  })).filter((i) => i.employeeId && i.amount > 0) : [];
  if (itens.length === 0) return response.status(422).json({ message: "Informe ao menos um funcionário e um valor." });
  try {
    const r = await distribuirReserva(periodId, itens, user.id);
    await auditLog({
      userId: user.id, action: "TIP_RESERVE_DISTRIBUTION", entity: "TipPeriod", entityId: periodId,
      newValue: { itens, ...r }, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
    });
    response.status(201).json(r);
  } catch (err) {
    response.status(422).json({ message: (err as Error).message });
  }
});

// ─── Registro dos fechamentos ───────────────────────────────────────────────
router.get("/closings", async (request, response) => {
  const ano = Number((request.query as Record<string, unknown>).ano) || undefined;
  response.json(await listarFechamentos(ano));
});

router.get("/closings/:id", async (request, response) => {
  const detalhe = await detalheFechamento(request.params.id);
  if (!detalhe) return response.status(404).json({ message: "Registro de fechamento não encontrado." });
  if (await podeVerDadosPessoais(request)) return response.json(detalhe);
  // Sem a permissão de Funcionários: some o que mistura salário (proporcional, adiantamento,
  // 1ª quinzena e total a pagar).
  // A gorjeta informada pelo teto (teto − salário) e o teto também revelam o salário.
  const participants = (detalhe.participants as Array<Record<string, unknown>>).map(
    ({ salarioProporcional: _s, adiantamentoSalarial: _a, primeiraQuinzena: _q, totalAPagar: _t, diasSalario: _d, tetoIrGorjeta: _teto, ...resto }) => {
      if (resto.gorjetaInformadaPeloTeto !== true) return resto;
      const { gorjetaInformada: _gi, ...semInformada } = resto;
      return semInformada;
    },
  );
  const { adiantamentos: _ad, primeirasQuinzenas: _pq, ...totals } = (detalhe.totals ?? {}) as Record<string, unknown>;
  response.json({ ...detalhe, participants, totals, salariosOcultos: true });
});

