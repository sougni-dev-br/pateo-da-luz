// Folha da Gorjeta (Comissão) — motor de cálculo (Fase A).
//
// Regra (travada com o Eli em 28/07/2026):
//   pool bruto (serviço, 26→25)
//   − 20%                          → pool líquido
//   − cotas fixas (saem do pool)   → pool para pontos
//   ÷ Σ pontos                     → valor do ponto
//   × pontos                       → rateio de cada um
//   − vales (por dentro, não vão ao holerite)
//   = comissão líquida
//
// Trava de ouro: Σ cotas fixas + Σ rateios = pool líquido (garantida ao centavo).

import crypto from "node:crypto";
import { prisma } from "../../config/database.js";
import { round2 } from "./vt-calc.js";

// ─── Período 26→25 ──────────────────────────────────────────────────────────
// Competência 07/2026 (julho) = 26/06/2026 → 25/07/2026.
export function tipPeriodBounds(year: number, month: number) {
  // 26 do mês ANTERIOR (Date.UTC normaliza mês negativo p/ dezembro do ano anterior)
  const start = new Date(Date.UTC(year, month - 2, 26));
  // 25 do mês da competência
  const end = new Date(Date.UTC(year, month - 1, 25));
  // fim exclusivo p/ query de receita: 26 do mês da competência
  const endExclusive = new Date(Date.UTC(year, month - 1, 26));
  const label = `Gorjeta ${fmt(start)}–${fmt(end)}`;
  return { start, end, endExclusive, label };
}

function fmt(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ─── Pool bruto vindo do Faturamento Salão (RevenueEntry.serviceAmount) ──────
// Soma o serviço no intervalo [start, endExclusive).
export async function getServicePoolByRange(start: Date, endExclusive: Date): Promise<number> {
  const agg = await prisma.revenueEntry.aggregate({
    _sum: { serviceAmount: true },
    where: { date: { gte: start, lt: endExclusive }, status: "ACTIVE" },
  });
  return round2(Number(agg._sum.serviceAmount ?? 0));
}

export async function getServicePool(year: number, month: number): Promise<number> {
  const { start, endExclusive } = tipPeriodBounds(year, month);
  return getServicePoolByRange(start, endExclusive);
}

// ─── Controle de duplicidade: períodos não podem ter datas sobrepostas ──────
// Dois intervalos [aStart,aEnd] e [bStart,bEnd] se sobrepõem quando aStart <= bEnd && bStart <= aEnd.
// Impede contar o mesmo serviço / pagar a mesma gorjeta em dois períodos.
export async function findOverlappingPeriod(start: Date, end: Date, excludePeriodId?: string) {
  return prisma.tipPeriod.findFirst({
    where: {
      id: excludePeriodId ? { not: excludePeriodId } : undefined,
      periodStart: { lte: end },
      periodEnd: { gte: start },
    },
    select: { id: true, label: true, competenceYear: true, competenceMonth: true, periodStart: true, periodEnd: true, status: true },
  });
}

// ─── Tipos de saída ─────────────────────────────────────────────────────────
export type ComputedVale = { id: string; type: string; amount: number; date: string | null; notes: string | null };

export type ComputedParticipant = {
  participantId: string | null;
  employeeId: string;
  employeeName: string;
  companyId: string | null;
  companyName: string | null;
  kind: "FIXO" | "PONTOS";
  points: number | null;
  fixedAmount: number | null;
  rateioAmount: number;   // cota fixa OU rateio por pontos
  valesTotal: number;     // soma dos vales
  netCommission: number;  // rateio − vales (vai no holerite)
  horaExtra: string | null;
  adicionalNoturno: string | null;
  faltas: number | null;
  justificada: boolean;
  vales: ComputedVale[];
};

export type TipComputation = {
  year: number;
  month: number;
  label: string;
  periodId: string | null;
  status: "OPEN" | "CLOSED" | null;
  periodStart: string;
  periodEnd: string;
  grossPool: number;
  deductionPercent: number;
  netPool: number;
  fixedTotal: number;
  pointsPool: number;
  pointsBudget: number;         // total de pontos configurado no período (denominador do rateio)
  totalPoints: number;          // soma dos pontos efetivamente distribuídos aos participantes
  pointsRemaining: number;      // pointsBudget − totalPoints (>0 faltam, <0 excede)
  undistributedAmount: number;  // R$ do pool que ficaria sem distribuir quando faltam pontos
  overAllocated: boolean;       // soma distribuída ultrapassou o total definido
  pointValue: number;
  participants: ComputedParticipant[];
  totals: { rateio: number; vales: number; netCommission: number };
  check: { expectedNetPool: number; sumRateios: number; ok: boolean; diff: number };
  warnings: string[];
};

// ─── Cálculo (sem persistir) ────────────────────────────────────────────────
export async function computeTipCommission(year: number, month: number): Promise<TipComputation> {
  const bounds = tipPeriodBounds(year, month);

  const period = await prisma.tipPeriod.findUnique({
    where: { competenceYear_competenceMonth: { competenceYear: year, competenceMonth: month } },
    include: {
      participants: {
        include: {
          vales: true,
          employee: { select: { firstName: true, lastName: true, displayName: true, companyId: true, company: { select: { tradeName: true } } } },
        },
      },
    },
  });

  // Datas e rótulo: usa os salvos no período (podem ter sido editados); senão, o padrão 26→25.
  const start = period ? period.periodStart : bounds.start;
  const end = period ? period.periodEnd : bounds.end;
  const label = period ? period.label : bounds.label;

  const warnings: string[] = [];

  // Pool: se o período existe usa o grossPool salvo; senão puxa do faturamento.
  const grossPool = period ? round2(Number(period.grossPool)) : await getServicePool(year, month);
  const deductionPercent = period ? Number(period.deductionPercent) : 20;
  const netPool = round2(grossPool * (1 - deductionPercent / 100));

  const rows = period?.participants ?? [];

  // Total de pontos configurado no período (denominador do rateio). Default 100.
  const pointsBudget = period ? Number(period.pointsTotal) : 100;

  // Cotas fixas saem do pool primeiro.
  const fixedTotal = round2(
    rows.filter((p) => p.kind === "FIXO").reduce((acc, p) => acc + Number(p.fixedAmount ?? 0), 0),
  );
  const pointsPool = round2(netPool - fixedTotal);
  if (pointsPool < 0) {
    warnings.push(`As cotas fixas (R$ ${fixedTotal.toFixed(2)}) somam mais que o pool líquido (R$ ${netPool.toFixed(2)}). Revise os valores fixos.`);
  }

  const pointRows = rows.filter((p) => p.kind === "PONTOS");
  // Soma dos pontos efetivamente distribuídos entre os participantes.
  const totalPoints = pointRows.reduce((acc, p) => acc + (p.points ?? 0), 0);
  const pointsRemaining = pointsBudget - totalPoints;
  const overAllocated = totalPoints > pointsBudget;
  // Valor do ponto usa o TOTAL DEFINIDO como denominador (não a soma distribuída).
  const pointValue = pointsBudget > 0 ? pointsPool / pointsBudget : 0;

  // Rateio de cada participante por pontos (arredondado).
  const participants: ComputedParticipant[] = rows.map((p) => {
    const valesTotal = round2(p.vales.reduce((acc, v) => acc + Number(v.amount), 0));
    const rateio =
      p.kind === "FIXO"
        ? round2(Number(p.fixedAmount ?? 0))
        : round2(pointValue * (p.points ?? 0));
    return {
      participantId: p.id,
      employeeId: p.employeeId,
      employeeName: (p.employee.displayName || `${p.employee.firstName} ${p.employee.lastName}`).trim(),
      companyId: p.employee.companyId ?? null,
      companyName: p.employee.company?.tradeName ?? null,
      kind: p.kind,
      points: p.points,
      fixedAmount: p.fixedAmount == null ? null : Number(p.fixedAmount),
      rateioAmount: rateio,
      valesTotal,
      netCommission: round2(rateio - valesTotal),
      horaExtra: p.horaExtra ?? null,
      adicionalNoturno: p.adicionalNoturno ?? null,
      faltas: p.faltas ?? null,
      justificada: Boolean(p.justificada),
      vales: p.vales.map((v) => ({
        id: v.id, type: v.type, amount: Number(v.amount),
        date: v.date ? v.date.toISOString() : null, notes: v.notes ?? null,
      })),
    };
  });

  // Valor que corresponde aos pontos efetivamente distribuídos (base do rateio por pontos).
  // Se a soma distribuída = total definido, isto é o pointsPool inteiro; se faltam pontos, é menor.
  const expectedPointsAmount = round2(pointValue * totalPoints);

  // Ajuste de arredondamento: garante Σ rateios (pontos) = expectedPointsAmount ao centavo.
  // O resíduo dos arredondamentos vai para quem tem mais pontos.
  const pontos = participants.filter((p) => p.kind === "PONTOS");
  if (pontos.length > 0 && totalPoints > 0) {
    const sumPontos = round2(pontos.reduce((acc, p) => acc + p.rateioAmount, 0));
    const residual = round2(expectedPointsAmount - sumPontos);
    if (residual !== 0) {
      const target = pontos.reduce((a, b) => ((b.points ?? 0) > (a.points ?? 0) ? b : a));
      target.rateioAmount = round2(target.rateioAmount + residual);
      target.netCommission = round2(target.rateioAmount - target.valesTotal);
    }
  }

  // Quanto do pool de pontos ficaria SEM distribuir (só ocorre quando faltam pontos).
  const undistributedAmount = round2(Math.max(pointsPool - expectedPointsAmount, 0));

  if (overAllocated) {
    warnings.push(`A soma dos pontos distribuídos (${totalPoints}) ultrapassa o total definido (${pointsBudget}). A soma não pode passar de ${pointsBudget} — ajuste os pontos antes de salvar ou fechar.`);
  } else if (period && rows.length > 0 && pointsRemaining > 0 && pointsPool > 0) {
    warnings.push(`Faltam ${pointsRemaining} ponto(s) para completar o total de ${pointsBudget}: R$ ${undistributedAmount.toFixed(2)} do pool ainda não foram distribuídos. Complete a distribuição (ou ajuste o total/percentual de dedução).`);
  }

  for (const p of participants) {
    if (p.netCommission < 0) {
      warnings.push(`${p.employeeName}: os vales (R$ ${p.valesTotal.toFixed(2)}) passaram do rateio (R$ ${p.rateioAmount.toFixed(2)}) — comissão líquida negativa.`);
    }
  }

  const sumRateios = round2(participants.reduce((acc, p) => acc + p.rateioAmount, 0));
  const diff = round2(sumRateios - netPool);
  // Fecha SOMENTE quando: não excede o total, não faltam pontos, e a soma bate ao centavo.
  const ok = !overAllocated && pointsRemaining === 0 && pointsPool >= 0 && Math.abs(diff) < 0.005;

  return {
    year, month, label,
    periodId: period?.id ?? null,
    status: period?.status ?? null,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    grossPool, deductionPercent, netPool, fixedTotal, pointsPool,
    pointsBudget, totalPoints, pointsRemaining, undistributedAmount, overAllocated,
    pointValue: round2(pointValue),
    participants,
    totals: {
      rateio: sumRateios,
      vales: round2(participants.reduce((acc, p) => acc + p.valesTotal, 0)),
      netCommission: round2(participants.reduce((acc, p) => acc + p.netCommission, 0)),
    },
    check: { expectedNetPool: netPool, sumRateios, ok, diff },
    warnings,
  };
}

// ─── Abrir/garantir o período (puxa o pool do faturamento) ──────────────────
export async function ensureTipPeriod(year: number, month: number, userId: string) {
  const existing = await prisma.tipPeriod.findUnique({
    where: { competenceYear_competenceMonth: { competenceYear: year, competenceMonth: month } },
  });
  if (existing) return existing;

  const { start, end, label } = tipPeriodBounds(year, month);
  const grossPool = await getServicePool(year, month);
  const netPool = round2(grossPool * 0.8);
  const period = await prisma.tipPeriod.create({
    data: {
      id: crypto.randomUUID(),
      competenceYear: year, competenceMonth: month,
      periodStart: start, periodEnd: end, label,
      grossPool, poolSource: "REVENUE", deductionPercent: 20, netPool,
      createdById: userId,
    },
  });
  // Auto-carga: inclui quem participa da gorjeta no cadastro (inclusive desligados; exclui só os soft-deleted).
  await syncParticipantsFromCadastro(period.id);
  return period;
}

// Adiciona ao período os funcionários com participaGorjeta=true que ainda não estão nele.
// Inclui desligados (isActive=false), pois recebem a gorjeta do período. Não remove ninguém.
export async function syncParticipantsFromCadastro(periodId: string): Promise<number> {
  const elegiveis = await prisma.employee.findMany({
    where: { participaGorjeta: true, deletedAt: null },
    select: { id: true, tipoGorjeta: true, pontosPadrao: true, cotaFixaGorjeta: true },
  });
  const existing = await prisma.tipParticipant.findMany({ where: { periodId }, select: { employeeId: true } });
  const have = new Set(existing.map((e) => e.employeeId));
  const toAdd = elegiveis.filter((e) => !have.has(e.id));
  if (toAdd.length > 0) {
    await prisma.tipParticipant.createMany({
      data: toAdd.map((e) => ({
        id: crypto.randomUUID(),
        periodId,
        employeeId: e.id,
        kind: e.tipoGorjeta,
        points: e.tipoGorjeta === "PONTOS" ? (e.pontosPadrao ?? 0) : null,
        fixedAmount: e.tipoGorjeta === "FIXO" ? (e.cotaFixaGorjeta ?? 0) : null,
      })),
      skipDuplicates: true,
    });
  }
  return toAdd.length;
}

// ─── Fechar: recalcula, persiste os valores nos participantes e trava ───────
export async function closeTipPeriod(year: number, month: number, userId: string) {
  const comp = await computeTipCommission(year, month);
  if (!comp.check.ok) {
    if (comp.overAllocated) {
      throw new Error(`A soma dos pontos (${comp.totalPoints}) ultrapassa o total definido (${comp.pointsBudget}). Ajuste os pontos antes de fechar.`);
    }
    if (comp.pointsRemaining > 0) {
      throw new Error(`Faltam ${comp.pointsRemaining} ponto(s) para completar o total de ${comp.pointsBudget}: R$ ${comp.undistributedAmount.toFixed(2)} ainda não distribuído. Complete a distribuição antes de fechar.`);
    }
    throw new Error(`Conferência falhou: Σ rateios (R$ ${comp.check.sumRateios.toFixed(2)}) ≠ pool líquido (R$ ${comp.netPool.toFixed(2)}). Diferença R$ ${comp.check.diff.toFixed(2)}.`);
  }

  await prisma.$transaction(async (tx) => {
    for (const p of comp.participants) {
      if (!p.participantId) continue;
      await tx.tipParticipant.update({
        where: { id: p.participantId },
        data: { rateioAmount: p.rateioAmount, valesTotal: p.valesTotal, netCommission: p.netCommission },
      });
    }
    await tx.tipPeriod.update({
      where: { competenceYear_competenceMonth: { competenceYear: year, competenceMonth: month } },
      data: { netPool: comp.netPool, pointValue: comp.pointValue, status: "CLOSED", closedAt: new Date(), updatedById: userId },
    });
  });

  return comp;
}

// ─── Reabrir: destrava um período fechado para correções (RH/rateio) ────────
// Só volta o status para OPEN; os valores gravados nos participantes permanecem
// até um novo fechamento. Não altera o rateio — apenas permite editar de novo.
export async function reopenTipPeriod(year: number, month: number, userId: string) {
  const period = await prisma.tipPeriod.findUnique({
    where: { competenceYear_competenceMonth: { competenceYear: year, competenceMonth: month } },
  });
  if (!period) throw new Error("Período não encontrado.");
  if (period.status !== "CLOSED") throw new Error("O período não está fechado.");

  await prisma.tipPeriod.update({
    where: { competenceYear_competenceMonth: { competenceYear: year, competenceMonth: month } },
    data: { status: "OPEN", closedAt: null, updatedById: userId },
  });

  return computeTipCommission(year, month);
}
