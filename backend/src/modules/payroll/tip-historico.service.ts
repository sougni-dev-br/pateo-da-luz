// Histórico de função/pontos, fundo de reserva e relatórios da gorjeta.
//
// Histórico: toda mudança de função, ponto extra ou participação de um
// funcionário vira uma linha com a data a partir da qual vale. Mudança nos pontos
// de uma função também registra uma linha para cada funcionário cuja base mudou.
//
// Fundo de reserva: extrato com entradas (reserva e saldo de cada fechamento,
// ajustes) e saídas (distribuição, que vira crédito na gorjeta de alguém).

import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { round2 } from "./vt-calc.js";

type Tx = Prisma.TransactionClient;

export type SituacaoGorjeta = {
  participaGorjeta: boolean;
  tipFunctionId: string | null;
  pontosExtra: number | null;
  pontosExtraMotivo?: string | null;
};

const num = (v: unknown): number | null => (v == null ? null : Number(v));

// Grava a situação atual do funcionário no histórico, com a vigência informada.
export async function registrarHistorico(
  tx: Tx, employeeId: string, validFrom: Date, userId: string, reason: string | null,
) {
  const e = await tx.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: { participaGorjeta: true, tipFunctionId: true, pontosExtra: true, pontosExtraMotivo: true, tipFunction: { select: { name: true, points: true } } },
  });
  const pontosFuncao = num(e.tipFunction?.points);
  const extra = num(e.pontosExtra);
  await tx.employeeTipHistory.create({
    data: {
      id: crypto.randomUUID(),
      employeeId, validFrom,
      participaGorjeta: e.participaGorjeta,
      tipFunctionId: e.tipFunctionId,
      functionName: e.tipFunction?.name ?? null,
      functionPoints: pontosFuncao,
      pontosExtra: extra,
      pontosExtraMotivo: e.pontosExtraMotivo,
      basePoints: pontosFuncao == null && extra == null ? null : Math.max(0, round2((pontosFuncao ?? 0) + (extra ?? 0))),
      reason, changedById: userId,
    },
  });
}

// Uma trava só para tudo que mexe no saldo do fundo (distribuir, reabrir, refechar):
// duas operações ao mesmo tempo esperam uma pela outra em vez de ler o mesmo saldo.
const TRAVA_FUNDO = 740_2026;
export async function travarFundo(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TRAVA_FUNDO})`;
}

// Tirar do fundo o que um fechamento tinha guardado não pode deixar o saldo
// negativo: se a reserva daquele mês já foi distribuída, o dinheiro já saiu.
export function motivoParaNaoRetirar(saldoAtual: number, retirada: number, rotulo: string): string | null {
  const depois = round2(saldoAtual - retirada);
  if (retirada <= 0.005 || depois >= -0.005) return null;
  return `A reserva de ${rotulo} (${retirada.toFixed(2)}) já foi usada em distribuições: o fundo tem ${saldoAtual.toFixed(2)} e ficaria em ${depois.toFixed(2)}. `
    + "Apague créditos de distribuição em período aberto ou lance um ajuste no fundo antes de reabrir.";
}

export function mudouSituacao(antes: SituacaoGorjeta, depois: SituacaoGorjeta): boolean {
  return antes.participaGorjeta !== depois.participaGorjeta
    || antes.tipFunctionId !== depois.tipFunctionId
    || (antes.pontosExtra ?? null) !== (depois.pontosExtra ?? null)
    || ((antes.pontosExtraMotivo ?? null) !== (depois.pontosExtraMotivo ?? null) && depois.pontosExtra != null);
}

// ─── Relatório: mudanças de função e pontos ─────────────────────────────────
export type Mudanca = {
  id: string;
  employeeId: string;
  employeeName: string;
  validFrom: string;
  tipo: "INICIAL" | "PROMOCAO" | "REDUCAO" | "TROCA_DE_FUNCAO" | "ENTRADA" | "SAIDA" | "OUTRA";
  funcaoAntes: string | null;
  funcaoDepois: string | null;
  baseAntes: number | null;
  baseDepois: number | null;
  diferenca: number | null;
  participa: boolean;
  motivo: string | null;
  registradoEm: string;
};

export async function listarMudancas(opts: { de?: Date; ate?: Date; employeeId?: string }): Promise<Mudanca[]> {
  // Traz tudo do(s) funcionário(s) para saber o "antes" de cada linha, e filtra a vigência no fim.
  const linhas = await prisma.employeeTipHistory.findMany({
    where: { employeeId: opts.employeeId },
    orderBy: [{ employeeId: "asc" }, { validFrom: "asc" }, { createdAt: "asc" }],
    include: { employee: { select: { firstName: true, lastName: true, displayName: true } } },
  });
  const resultado: Mudanca[] = [];
  let anterior: (typeof linhas)[number] | null = null;
  for (const l of linhas) {
    const antes = anterior && anterior.employeeId === l.employeeId ? anterior : null;
    const baseAntes = antes ? num(antes.basePoints) : null;
    const baseDepois = num(l.basePoints);
    let tipo: Mudanca["tipo"] = "OUTRA";
    if (!antes) tipo = "INICIAL";
    else if (!antes.participaGorjeta && l.participaGorjeta) tipo = "ENTRADA";
    else if (antes.participaGorjeta && !l.participaGorjeta) tipo = "SAIDA";
    else if (baseAntes != null && baseDepois != null && baseDepois > baseAntes) tipo = "PROMOCAO";
    else if (baseAntes != null && baseDepois != null && baseDepois < baseAntes) tipo = "REDUCAO";
    else if (antes.tipFunctionId !== l.tipFunctionId) tipo = "TROCA_DE_FUNCAO";
    const dentro = (!opts.de || l.validFrom >= opts.de) && (!opts.ate || l.validFrom <= opts.ate);
    if (dentro) {
      resultado.push({
        id: l.id,
        employeeId: l.employeeId,
        employeeName: (l.employee.displayName || `${l.employee.firstName} ${l.employee.lastName}`).trim(),
        validFrom: l.validFrom.toISOString(),
        tipo,
        funcaoAntes: antes?.functionName ?? null,
        funcaoDepois: l.functionName,
        baseAntes, baseDepois,
        diferenca: baseAntes != null && baseDepois != null ? round2(baseDepois - baseAntes) : null,
        participa: l.participaGorjeta,
        motivo: l.reason,
        registradoEm: l.createdAt.toISOString(),
      });
    }
    anterior = l;
  }
  return resultado.sort((a, b) => b.validFrom.localeCompare(a.validFrom) || b.registradoEm.localeCompare(a.registradoEm));
}

// ─── Relatório: evolução mês a mês (retratos dos períodos) ──────────────────
export type Evolucao = {
  competencias: Array<{ ano: number; mes: number; status: "OPEN" | "CLOSED"; pointValue: number }>;
  linhas: Array<{
    employeeId: string;
    employeeName: string;
    meses: Record<string, { funcao: string | null; base: number | null; pontos: number | null; gorjeta: number | null } | undefined>;
  }>;
};

export async function evolucaoMensal(de: { ano: number; mes: number }, ate: { ano: number; mes: number }): Promise<Evolucao> {
  const chave = (a: number, m: number) => a * 100 + m;
  const periodos = await prisma.tipPeriod.findMany({
    where: { competenceYear: { gte: de.ano, lte: ate.ano } },
    orderBy: [{ competenceYear: "asc" }, { competenceMonth: "asc" }],
    include: {
      participants: {
        select: {
          employeeId: true, functionName: true, basePoints: true, points: true, rateioAmount: true,
          employee: { select: { firstName: true, lastName: true, displayName: true } },
        },
      },
    },
  });
  const noIntervalo = periodos.filter((p) => {
    const k = chave(p.competenceYear, p.competenceMonth);
    return k >= chave(de.ano, de.mes) && k <= chave(ate.ano, ate.mes);
  });
  const porFuncionario = new Map<string, Evolucao["linhas"][number]>();
  for (const p of noIntervalo) {
    const k = `${p.competenceYear}-${String(p.competenceMonth).padStart(2, "0")}`;
    const fechado = p.status === "CLOSED";
    for (const r of p.participants) {
      const linha = porFuncionario.get(r.employeeId) ?? {
        employeeId: r.employeeId,
        employeeName: (r.employee.displayName || `${r.employee.firstName} ${r.employee.lastName}`).trim(),
        meses: {},
      };
      // Em apuração ainda não há pontos finais nem valor gravados.
      linha.meses[k] = {
        funcao: r.functionName,
        base: num(r.basePoints),
        pontos: fechado ? num(r.points) : null,
        gorjeta: fechado ? Number(r.rateioAmount) : null,
      };
      porFuncionario.set(r.employeeId, linha);
    }
  }
  return {
    competencias: noIntervalo.map((p) => ({ ano: p.competenceYear, mes: p.competenceMonth, status: p.status, pointValue: Number(p.pointValue) })),
    linhas: [...porFuncionario.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName, "pt-BR")),
  };
}

// ─── Fundo de reserva ───────────────────────────────────────────────────────
export async function extratoReserva() {
  const movimentos = await prisma.tipReserveMovement.findMany({
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    include: {
      employee: { select: { firstName: true, lastName: true, displayName: true } },
      period: { select: { competenceYear: true, competenceMonth: true } },
    },
  });
  let saldo = 0;
  const linhas = movimentos.map((m) => {
    saldo = round2(saldo + Number(m.amount));
    return {
      id: m.id,
      date: m.date.toISOString(),
      type: m.type,
      amount: Number(m.amount),
      saldo,
      competencia: m.period ? `${String(m.period.competenceMonth).padStart(2, "0")}/${m.period.competenceYear}` : null,
      employeeName: m.employee ? (m.employee.displayName || `${m.employee.firstName} ${m.employee.lastName}`).trim() : null,
      notes: m.notes,
      removivel: m.type === "AJUSTE",
    };
  });
  return { saldo, movimentos: linhas.reverse() };
}

export async function saldoReserva(tx: Tx | typeof prisma = prisma): Promise<number> {
  const agg = await tx.tipReserveMovement.aggregate({ _sum: { amount: true } });
  return round2(Number(agg._sum.amount ?? 0));
}

export async function lancarAjusteReserva(amount: number, date: Date, notes: string, userId: string) {
  return prisma.tipReserveMovement.create({
    data: { id: crypto.randomUUID(), date, type: "AJUSTE", amount: round2(amount), notes, createdById: userId },
  });
}

// Distribui parte do fundo: cada item vira um crédito na gorjeta do funcionário
// no período (aberto) e uma saída no extrato. Apagar o crédito devolve ao fundo
// (o lançamento do extrato cai junto, pela ligação com o vale).
export async function distribuirReserva(
  periodId: string, itens: Array<{ employeeId: string; amount: number; notes?: string | null }>, userId: string,
) {
  const total = round2(itens.reduce((a, i) => a + i.amount, 0));
  return prisma.$transaction(async (tx) => {
    await travarFundo(tx);
    const saldo = await saldoReserva(tx);
    if (total > saldo + 0.005) {
      throw new Error(`O fundo tem ${saldo.toFixed(2)} e a distribuição soma ${total.toFixed(2)}.`);
    }
    const periodo = await tx.tipPeriod.findUniqueOrThrow({ where: { id: periodId }, select: { periodEnd: true, competenceMonth: true, competenceYear: true } });
    const rotulo = `${String(periodo.competenceMonth).padStart(2, "0")}/${periodo.competenceYear}`;
    // No extrato, a saída tem a data em que a distribuição foi feita.
    const agora = new Date();
    const hoje = new Date(Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate()));
    for (const item of itens) {
      const participante = await tx.tipParticipant.findUnique({
        where: { periodId_employeeId: { periodId, employeeId: item.employeeId } }, select: { id: true },
      });
      if (!participante) throw new Error("Funcionário não está neste período. Inclua-o na apuração antes de distribuir.");
      const nota = item.notes?.trim() || `Distribuição da reserva (${rotulo})`;
      const vale = await tx.tipVale.create({
        data: {
          id: crypto.randomUUID(), participantId: participante.id, type: "CREDITO", amount: round2(item.amount),
          date: periodo.periodEnd, notes: nota, createdById: userId,
        },
      });
      await tx.tipReserveMovement.create({
        data: {
          id: crypto.randomUUID(), date: hoje, type: "DISTRIBUICAO", amount: -round2(item.amount),
          periodId, employeeId: item.employeeId, valeId: vale.id, notes: nota, createdById: userId,
        },
      });
    }
    return { total, saldoDepois: round2(saldo - total) };
  });
}
