// Folha da Gorjeta (Comissão) — busca os dados e aplica o rateio de tip-rateio.ts.
//
// Método (planilha de apuração, set/2026 — ver tip-rateio.ts):
//   bruto (serviço 26→25) − 20% = líquido; valor do ponto = líquido ÷ 100 (fixo);
//   pontos = pontos-base da função × presença + ajuste do mês;
//   desligados usam o serviço até o desligamento; a sobra fica como saldo.
//
// Presença vem da Escala (falta, atestado, férias) quando o campo do participante
// está vazio; preenchido, o valor digitado prevalece. O serviço até o desligamento
// vem do faturamento quando não foi informado à mão.

import crypto from "node:crypto";
import { prisma } from "../../config/database.js";
import { round2 } from "./vt-calc.js";
import { motivoParaNaoRetirar, saldoReserva, travarFundo } from "./tip-historico.service.js";
import { proximoCodigoApuracao, registrarFechamento, registrarReabertura } from "./tip-fechamento.service.js";
import { calcularRateio, type ParticipanteEntrada, type RegrasPeriodo, type TipoCalculo, regraEfetiva } from "./tip-rateio.js";

const DIA_MS = 24 * 60 * 60 * 1000;

// ─── Período 26→25 ──────────────────────────────────────────────────────────
// Competência 07/2026 (julho) = 26/06/2026 → 25/07/2026.
export function tipPeriodBounds(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 2, 26));
  const end = new Date(Date.UTC(year, month - 1, 25));
  const endExclusive = new Date(Date.UTC(year, month - 1, 26));
  const label = `Gorjeta ${fmt(start)}–${fmt(end)}`;
  return { start, end, endExclusive, label };
}

function fmt(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ─── Serviço do Faturamento Salão (RevenueEntry.serviceAmount) ──────────────
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

// Pontos-base do cadastro: os da função mais o ponto extra (±) da pessoa.
export function pontosBaseDoCadastro(emp: { pontosExtra: unknown; tipFunction: { points: unknown } | null }): number {
  const funcao = emp.tipFunction ? Number(emp.tipFunction.points) : 0;
  const extra = emp.pontosExtra == null ? 0 : Number(emp.pontosExtra);
  return Math.max(0, Math.round((funcao + extra) * 100) / 100);
}

// ─── Tipos de saída ─────────────────────────────────────────────────────────
export type ReciboGravado = {
  fonte: "TRCT";
  arquivo: string;
  hash: string;
  gorjeta: number;
  liquido: number | null;
  admissao: string | null;
  afastamento: string | null;
  pagamento: string | null;
  importadoEm: string;
  importadoPor: string;
};
export type ComputedVale = { id: string; type: string; amount: number; date: string | null; notes: string | null };
export type Origem = "ESCALA" | "MANUAL";

export type RescisaoContasPagar = {
  valor: number | null;
  vencimento: string;
  status: "PENDING" | "PAID" | "OVERDUE";
  parcelas: number;
  // A gorjeta paga na apuração veio desta rescisão: só muda por lá.
  gorjetaDefinida: boolean;
};

export type ComputedParticipant = {
  participantId: string | null;
  employeeId: string;
  employeeName: string;
  companyId: string | null;
  companyName: string | null;
  functionName: string | null;
  isActive: boolean;
  semRegistro: boolean;
  admissionDate: string | null;
  terminationDate: string | null;
  kind: "FIXO" | "PONTOS";
  basePoints: number;
  pointsAdjustment: number;
  fixedAmount: number | null;
  // Presença (valor efetivo + de onde veio)
  faltas: number; faltasOrigem: Origem;
  atestados: number; atestadosOrigem: Origem;
  ferias: number; feriasOrigem: Origem;
  outrosDias: number;
  diasPrevistosOverride: number | null;
  diasElegiveis: number;
  diasPrevistos: number;
  diasReferencia: number;
  diasComputados: number;
  // Decisão de quem fecha para esta pessoa (null = regra do período) e o que vale no fim.
  regras: ParticipanteEntrada["regras"];
  regrasEfetivas: ReturnType<typeof regraEfetiva>;
  fatorPresenca: number;
  pontosApurados: number;
  points: number;          // pontos finais
  // Rescisão quitada: direito × o que a gorjeta paga vale em pontos.
  pontosDireito: number;
  pontosDevolvidos: number;
  extraRescisao: number;
  justificativaExtra: string | null;
  tipoCalculo: TipoCalculo;
  valorPonto: number;
  rescisaoServicoBruto: number | null;
  rescisaoServicoOrigem: "FATURAMENTO" | "MANUAL" | null;
  rescisaoValorFixo: number | null;
  rescisaoPendente: boolean;
  // Gorjeta quitada na rescisão: já foi paga pela contabilidade, não entra na lista a pagar.
  pagoNaRescisao: boolean;
  rescisaoRecibo: ReciboGravado | null;
  // Rescisão lançada em Contas a Pagar para quem saiu no período. O valor só com
  // permissão de Funcionários; saber que existe, sempre.
  rescisaoContasPagar: RescisaoContasPagar | null;
  rateioAmount: number;
  descontos: number;
  creditos: number;
  valesTotal: number;      // descontos − créditos
  netCommission: number;   // rateio − descontos + créditos
  diasSalarioOverride: number | null;
  diasSalario: number;
  salarioProporcional: number;
  totalAPagar: number;
  // Só com permissão de Funcionários (ficha com salário e PIX).
  baseSalary: number | null;
  pixKeyType: string | null;
  pixKey: string | null;
  horaExtra: string | null;
  adicionalNoturno: string | null;
  justificada: boolean;
  vales: ComputedVale[];
};

export type TipComputation = {
  year: number;
  month: number;
  label: string;
  periodId: string | null;
  code: string | null;
  // Versão vigente do registro de fechamento (null enquanto nunca fechou).
  fechamento: { id: string; code: string; version: number; closedAt: string; closedByName: string } | null;
  status: "OPEN" | "CLOSED" | null;
  periodStart: string;
  periodEnd: string;
  grossPool: number;
  // Serviço arrecadado = faturamento + ajuste manual (serviço fora do sistema).
  servicoFaturamento: number;
  ajusteServico: number;
  ajusteServicoMotivo: string | null;
  deductionPercent: number;
  netPool: number;
  fixedTotal: number;
  // O que as rescisões levam sai da apuração do mês: em reais e em pontos.
  rescisoes: { valor: number; pontos: number };
  pontosDisponiveis: number;
  pointsPool: number;
  pointsBudget: number;
  totalPoints: number;
  pointsRemaining: number;
  pointValue: number;
  diasPadrao: number;
  descontaFalta: boolean;
  descontaAtestado: boolean;
  descontaFerias: boolean;
  descontaOutros: boolean;
  proporcionalEntrada: boolean;
  distribuido: number;
  // De onde sai o distribuído: quem está no mês, quem saiu no período, a reserva e as cotas fixas.
  composicao: {
    mes: { valor: number; pontos: number; pessoas: number };
    rescisoes: { valor: number; pontos: number; pessoas: number; pendentes: number };
    reserva: { valor: number; pontos: number };
    fixos: { valor: number; pessoas: number };
  };
  saldo: number;
  reservaTotal: number;
  // Pontos do período que vão para o fundo de reserva e o saldo acumulado do fundo.
  reservaPontos: number;
  fundoReservaSaldo: number;
  participants: ComputedParticipant[];
  totals: { rateio: number; vales: number; netCommission: number; salarios: number; totalAPagar: number; pagoNaRescisao: number };
  check: { expectedNetPool: number; sumRateios: number; ok: boolean; diff: number };
  pendencias: string[];
  warnings: string[];
};

type ScheduleCounts = { faltas: number; atestados: number; ferias: number };

// Contagem de FALTA/ATESTADO/FERIAS da Escala no intervalo, por funcionário.
async function contarOcorrenciasDaEscala(employeeIds: string[], start: Date, end: Date): Promise<Map<string, ScheduleCounts>> {
  const map = new Map<string, ScheduleCounts>();
  if (employeeIds.length === 0) return map;
  const grupos = await prisma.employeeScheduleDay.groupBy({
    by: ["employeeId", "type"],
    where: { employeeId: { in: employeeIds }, date: { gte: start, lte: end }, type: { in: ["FALTA", "ATESTADO", "FERIAS"] } },
    _count: { _all: true },
  });
  for (const g of grupos) {
    const c = map.get(g.employeeId) ?? { faltas: 0, atestados: 0, ferias: 0 };
    if (g.type === "FALTA") c.faltas += g._count._all;
    if (g.type === "ATESTADO") c.atestados += g._count._all;
    if (g.type === "FERIAS") c.ferias += g._count._all;
    map.set(g.employeeId, c);
  }
  return map;
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtIso = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");

// Rescisões lançadas pela Folha (Contas a Pagar) na competência da saída de cada um.
// Cancelada não conta: é como se não tivesse sido lançada.
async function rescisoesEmContasAPagar(
  saidas: Array<{ employeeId: string; saida: Date } | null>,
): Promise<Map<string, RescisaoContasPagar & { valor: number }>> {
  const alvo = saidas.filter((s): s is { employeeId: string; saida: Date } => s != null);
  if (alvo.length === 0) return new Map();
  const itens = await prisma.payrollItem.findMany({
    where: {
      type: "RESCISAO", deletedAt: null, status: { not: "CANCELED" },
      OR: alvo.map((s) => ({
        employeeId: s.employeeId, competenceYear: s.saida.getUTCFullYear(), competenceMonth: s.saida.getUTCMonth() + 1,
      })),
    },
    select: { employeeId: true, amount: true, dueDate: true, status: true, details: true },
    orderBy: { dueDate: "asc" },
  });
  const porPessoa = new Map<string, RescisaoContasPagar & { valor: number }>();
  for (const it of itens) {
    const status = it.status === "CANCELED" ? "PENDING" : it.status;
    const definida = Boolean((it.details as { gorjetaNaApuracao?: unknown } | null)?.gorjetaNaApuracao);
    const atual = porPessoa.get(it.employeeId);
    if (!atual) {
      porPessoa.set(it.employeeId, { valor: round2(Number(it.amount)), vencimento: it.dueDate.toISOString(), status, parcelas: 1, gorjetaDefinida: definida });
      continue;
    }
    // Parcelado: soma, vence na primeira; paga só quando todas estão pagas.
    const juntos = [atual.status, status];
    porPessoa.set(it.employeeId, {
      valor: round2(atual.valor + Number(it.amount)),
      vencimento: atual.vencimento,
      status: juntos.includes("OVERDUE") ? "OVERDUE" : juntos.every((s) => s === "PAID") ? "PAID" : "PENDING",
      parcelas: atual.parcelas + 1,
      gorjetaDefinida: atual.gorjetaDefinida || definida,
    });
  }
  return porPessoa;
}

// ─── Cálculo (sem persistir) ────────────────────────────────────────────────
export async function computeTipCommission(
  year: number, month: number, opts: { incluirDadosPessoais?: boolean } = {},
): Promise<TipComputation> {
  const bounds = tipPeriodBounds(year, month);

  const period = await prisma.tipPeriod.findUnique({
    where: { competenceYear_competenceMonth: { competenceYear: year, competenceMonth: month } },
    include: {
      participants: {
        include: {
          // Vale cancelado fica no banco e nos relatórios, mas não desconta.
          vales: { where: { canceledAt: null } },
          employee: {
            select: {
              firstName: true, lastName: true, displayName: true, isActive: true,
              companyId: true, company: { select: { tradeName: true } },
              modality: true, baseSalary: true, pixKeyType: true, pixKey: true,
              admissionDate: true, terminationDate: true,
              pontosExtra: true, tipFunction: { select: { name: true, points: true, minPoints: true, maxPoints: true } },
            },
          },
        },
      },
    },
  });

  const start = period ? period.periodStart : bounds.start;
  const end = period ? period.periodEnd : bounds.end;
  const label = period ? period.label : bounds.label;
  const grossPool = period ? round2(Number(period.grossPool)) : await getServicePool(year, month);
  const servicoFaturamento = period ? round2(Number(period.servicoFaturamento)) : grossPool;
  const ajusteServico = period ? round2(Number(period.ajusteServico)) : 0;
  const deductionPercent = period ? Number(period.deductionPercent) : 20;
  const netPool = round2(grossPool * (1 - deductionPercent / 100));
  const pointsBudget = period ? Number(period.pointsTotal) : 100;
  const regras: RegrasPeriodo = {
    start, end, netPool, deductionPercent, pointsTotal: pointsBudget,
    diasPadrao: period?.diasPadrao ?? 26,
    descontaFalta: period?.descontaFalta ?? true,
    descontaAtestado: period?.descontaAtestado ?? true,
    descontaFerias: period?.descontaFerias ?? true,
    descontaOutros: period?.descontaOutros ?? false,
    proporcionalEntrada: period?.proporcionalEntrada ?? true,
  };

  const rows = period?.participants ?? [];
  const escala = await contarOcorrenciasDaEscala(rows.map((r) => r.employeeId), start, end);

  // Serviço até o desligamento, para quem saiu dentro do período (inclusive com a gorjeta
  // paga: é ele que dá o valor do ponto da saída para medir o que foi pago).
  const servicoAteSaida = new Map<string, number>();
  for (const r of rows) {
    const saida = r.employee.terminationDate;
    if (saida && saida >= start && saida <= end && r.rescisaoServicoBruto == null) {
      // Zero = faturamento ainda não importado: fica pendente em vez de pagar zero.
      const servico = await getServicePoolByRange(start, new Date(saida.getTime() + DIA_MS));
      if (servico > 0) servicoAteSaida.set(r.id, servico);
    }
  }

  const rescisoesLancadas = await rescisoesEmContasAPagar(rows.map((r) => r.employee.terminationDate
    && r.employee.terminationDate >= start && r.employee.terminationDate <= end
    ? { employeeId: r.employeeId, saida: r.employee.terminationDate } : null));

  const entradas: ParticipanteEntrada[] = rows.map((r) => {
    const e = escala.get(r.employeeId) ?? { faltas: 0, atestados: 0, ferias: 0 };
    return {
      kind: r.kind,
      basePoints: Number(r.basePoints ?? r.points ?? 0),
      ajuste: Number(r.pointsAdjustment ?? 0),
      fixedAmount: num(r.fixedAmount),
      admissao: r.employee.admissionDate,
      desligamento: r.employee.terminationDate,
      faltas: r.faltas ?? e.faltas,
      atestados: r.atestados ?? e.atestados,
      ferias: r.ferias ?? e.ferias,
      outrosDias: r.outrosDias ?? 0,
      diasPrevistosOverride: r.diasPrevistosOverride,
      regras: {
        descontaFalta: r.descontaFalta, descontaAtestado: r.descontaAtestado, descontaFerias: r.descontaFerias,
        descontaOutros: r.descontaOutros, proporcionalEntrada: r.proporcionalEntrada,
      },
      rescisaoServicoBruto: num(r.rescisaoServicoBruto) ?? servicoAteSaida.get(r.id) ?? null,
      rescisaoValorFixo: num(r.rescisaoValorFixo),
      semRegistro: r.employee.modality === "NAO_CLT",
      salarioBase: num(r.employee.baseSalary),
      diasSalarioOverride: r.diasSalarioOverride,
      rescisaoLancada: rescisoesLancadas.has(r.employeeId),
      vales: r.vales.map((v) => ({ type: v.type, amount: Number(v.amount) })),
    };
  });

  const rateio = calcularRateio(regras, entradas);
  const closed = period?.status === "CLOSED";
  const registro = period && closed
    ? await prisma.tipPeriodClosing.findFirst({
      where: { periodId: period.id, reopenedAt: null }, orderBy: { version: "desc" },
      select: { id: true, code: true, version: true, closedAt: true, closedByName: true },
    })
    : null;

  // Reserva da casa: pontos do período × valor do ponto do mês. Fechado, vale o
  // que entrou no fundo naquele fechamento.
  const reservaPontos = Number(period?.reservaPontos ?? 0);
  const movimentosDoPeriodo = period
    ? await prisma.tipReserveMovement.findMany({ where: { periodId: period.id, type: "FECHAMENTO_RESERVA" }, select: { amount: true } })
    : [];
  const reservaValor = closed && movimentosDoPeriodo.length > 0
    ? round2(movimentosDoPeriodo.reduce((a, m) => a + Number(m.amount), 0))
    : round2(reservaPontos * rateio.valorPontoBruto);
  const fundo = await prisma.tipReserveMovement.aggregate({ _sum: { amount: true } });
  const fundoReservaSaldo = round2(Number(fundo._sum.amount ?? 0));
  const dadosPessoais = opts.incluirDadosPessoais ?? false;

  const participants: ComputedParticipant[] = rows.map((r, i) => {
    const ent = entradas[i];
    const calc = rateio.linhas[i];
    // Fechado: vale o que foi gravado no fechamento, mesmo que escala ou faturamento mudem depois.
    const rateioAmount = closed ? Number(r.rateioAmount) : calc.rateio;
    const netCommission = closed ? Number(r.netCommission) : calc.comissaoLiquida;
    const salarioProporcional = closed ? Number(r.salarioProporcional) : calc.salarioProporcional;
    const pagoNaRescisao = calc.pagoNaRescisao;
    const totalAPagar = pagoNaRescisao ? 0 : closed ? Number(r.totalAPagar) : calc.totalAPagar;
    return {
      participantId: r.id,
      employeeId: r.employeeId,
      employeeName: (r.employee.displayName || `${r.employee.firstName} ${r.employee.lastName}`).trim(),
      companyId: r.employee.companyId ?? null,
      companyName: r.employee.company?.tradeName ?? null,
      functionName: closed ? (r.functionName ?? r.employee.tipFunction?.name ?? null) : (r.employee.tipFunction?.name ?? null),
      isActive: r.employee.isActive,
      semRegistro: ent.semRegistro,
      admissionDate: r.employee.admissionDate?.toISOString() ?? null,
      terminationDate: r.employee.terminationDate?.toISOString() ?? null,
      kind: r.kind,
      basePoints: ent.basePoints,
      pointsAdjustment: ent.ajuste,
      fixedAmount: ent.fixedAmount,
      faltas: ent.faltas, faltasOrigem: r.faltas == null ? "ESCALA" : "MANUAL",
      atestados: ent.atestados, atestadosOrigem: r.atestados == null ? "ESCALA" : "MANUAL",
      ferias: ent.ferias, feriasOrigem: r.ferias == null ? "ESCALA" : "MANUAL",
      outrosDias: ent.outrosDias,
      diasPrevistosOverride: r.diasPrevistosOverride,
      diasElegiveis: calc.diasElegiveis,
      diasPrevistos: calc.diasPrevistos,
      diasReferencia: calc.diasReferencia,
      diasComputados: calc.diasComputados,
      regras: ent.regras,
      regrasEfetivas: regraEfetiva(regras, ent),
      fatorPresenca: calc.fatorPresenca,
      pontosApurados: calc.pontosApurados,
      points: closed && r.points != null ? Number(r.points) : calc.pontosFinais,
      pontosDireito: calc.pontosDireito,
      pontosDevolvidos: calc.pontosDevolvidos,
      extraRescisao: calc.extraRescisao,
      justificativaExtra: calc.justificativaExtra,
      tipoCalculo: calc.tipoCalculo,
      valorPonto: calc.valorPonto,
      rescisaoServicoBruto: ent.rescisaoServicoBruto,
      rescisaoServicoOrigem: r.rescisaoServicoBruto != null ? "MANUAL" : servicoAteSaida.has(r.id) ? "FATURAMENTO" : null,
      rescisaoValorFixo: ent.rescisaoValorFixo,
      rescisaoPendente: !closed && calc.rescisaoPendente,
      pagoNaRescisao,
      rescisaoRecibo: (r.rescisaoRecibo as ReciboGravado | null) ?? null,
      rescisaoContasPagar: (() => {
        const lancada = rescisoesLancadas.get(r.employeeId);
        return lancada ? { ...lancada, valor: dadosPessoais ? lancada.valor : null } : null;
      })(),
      rateioAmount,
      descontos: calc.descontos,
      creditos: calc.creditos,
      valesTotal: round2(calc.descontos - calc.creditos),
      netCommission,
      diasSalarioOverride: r.diasSalarioOverride,
      diasSalario: calc.diasSalario,
      salarioProporcional,
      totalAPagar,
      baseSalary: dadosPessoais ? ent.salarioBase : null,
      pixKeyType: dadosPessoais ? r.employee.pixKeyType : null,
      pixKey: dadosPessoais ? r.employee.pixKey : null,
      horaExtra: r.horaExtra ?? null,
      adicionalNoturno: r.adicionalNoturno ?? null,
      justificada: Boolean(r.justificada),
      vales: r.vales.map((v) => ({
        id: v.id, type: v.type, amount: Number(v.amount),
        date: v.date ? v.date.toISOString() : null, notes: v.notes ?? null,
      })),
    };
  });

  // Distribuído = o que foi para as pessoas + a reserva da casa.
  const distribuido = round2(participants.reduce((a, p) => a + p.rateioAmount, 0) + reservaValor);
  const saldo = round2(netPool - distribuido);
  const totalPoints = round2(participants.reduce((a, p) => a + (p.kind === "PONTOS" ? p.points : 0), 0) + reservaPontos);
  const pointsPool = round2(netPool - rateio.totalCotasFixas);

  const pendencias: string[] = [];
  const warnings: string[] = [];
  const noPeriodo = participants.filter((p) => p.tipoCalculo !== "FORA_DO_PERIODO");
  // Um aviso por tipo de problema, com os nomes juntos — um por pessoa afoga a tela.
  const listar = (lista: ComputedParticipant[]) => lista.map((p) => p.employeeName).join(", ");

  for (const p of noPeriodo.filter((x) => x.rescisaoPendente)) {
    pendencias.push(`${p.employeeName}: saiu em ${fmtIso(p.terminationDate)} e falta o valor da rescisão. Em "Rescisões do período", digite a gorjeta paga (ou leia o termo da contabilidade) ou o serviço até a saída.`);
  }
  if (pointsPool < 0) {
    pendencias.push(`As cotas fixas (${brl(rateio.totalCotasFixas)}) passam do líquido do período (${brl(netPool)}).`);
  } else if (saldo < -0.005) {
    const extraRescisoes = round2(participants.reduce((a, p) => a + (p.extraRescisao ?? 0), 0));
    pendencias.push(`A distribuição (${brl(distribuido)}) passa do líquido (${brl(netPool)}) em ${brl(Math.abs(saldo))}.`
      + (extraRescisoes > 0
        ? ` Parte vem da gorjeta paga acima do direito nas rescisões (+${extraRescisoes.toLocaleString("pt-BR")} pts de extra automático). Reduza pontos ou ajustes da equipe, ou confira o valor pago.`
        : " Reduza pontos ou ajustes."));
  }

  const semBase = noPeriodo.filter((p) => p.kind === "PONTOS" && p.basePoints <= 0);
  if (semBase.length) warnings.push(`Sem pontos-base (defina a função em "Equipe e funções"): ${listar(semBase)}.`);
  const semSalario = participants.filter((p, i) =>
    p.semRegistro && p.tipoCalculo !== "FORA_DO_PERIODO" && entradas[i].salarioBase == null);
  if (semSalario.length) warnings.push(`Sem registro e sem salário no cadastro (a lista de pagamento sai só com a gorjeta): ${listar(semSalario)}.`);
  const saiuSemRescisao = noPeriodo.filter((p) =>
    (p.tipoCalculo === "RESCISAO" || p.tipoCalculo === "RESCISAO_QUITADA") && !p.rescisaoContasPagar);
  if (saiuSemRescisao.length) {
    warnings.push(`Saíram no período sem rescisão lançada em Contas a Pagar (lance em Folha → Rescisão): ${listar(saiuSemRescisao)}.`
      + (saiuSemRescisao.some((p) => p.semRegistro) ? " Sem registro sem rescisão lançada recebe salário e gorjeta na lista do mês." : ""));
  }
  const semAdmissao = noPeriodo.filter((p) => !p.admissionDate);
  if (semAdmissao.length) warnings.push(`Sem data de admissão (considerados no período inteiro): ${listar(semAdmissao)}.`);
  const valesDemais = noPeriodo.filter((p) => p.descontos > 0 && p.netCommission < 0);
  if (valesDemais.length) warnings.push(`Vales maiores que a gorjeta: ${listar(valesDemais)}.`);
  for (const r of rows) {
    const fn = r.employee.tipFunction;
    if (r.employee.pontosExtra == null || !fn) continue;
    const pontos = pontosBaseDoCadastro(r.employee);
    const min = num(fn.minPoints);
    const max = num(fn.maxPoints);
    if ((min != null && pontos < min) || (max != null && pontos > max)) {
      const nome = (r.employee.displayName || `${r.employee.firstName} ${r.employee.lastName}`).trim();
      warnings.push(`${nome}: ${pontos} pontos com o extra, fora da faixa de "${fn.name}" (${min ?? "—"} a ${max ?? "—"}).`);
    }
  }

  // Fechado: os avisos servem para editar, e não há mais o que editar.
  if (closed) { pendencias.length = 0; warnings.length = 0; }
  const ok = pendencias.length === 0 && pointsPool >= 0;

  return {
    year, month, label,
    periodId: period?.id ?? null,
    code: period?.code ?? null,
    fechamento: registro ? { ...registro, closedAt: registro.closedAt.toISOString() } : null,
    status: period?.status ?? null,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    grossPool, servicoFaturamento, ajusteServico,
    ajusteServicoMotivo: period?.ajusteServicoMotivo ?? null,
    deductionPercent, netPool,
    fixedTotal: rateio.totalCotasFixas,
    rescisoes: rateio.rescisoes,
    pontosDisponiveis: rateio.pontosDisponiveis,
    pointsPool,
    pointsBudget, totalPoints,
    pointsRemaining: round2(pointsBudget - totalPoints),
    pointValue: rateio.valorPonto,
    diasPadrao: regras.diasPadrao,
    descontaFalta: regras.descontaFalta,
    descontaAtestado: regras.descontaAtestado,
    descontaFerias: regras.descontaFerias,
    descontaOutros: regras.descontaOutros,
    proporcionalEntrada: regras.proporcionalEntrada,
    distribuido, saldo,
    composicao: {
      mes: somar(participants.filter((p) => p.kind === "PONTOS" && p.tipoCalculo === "MES")),
      rescisoes: {
        ...somar(participants.filter((p) => p.tipoCalculo === "RESCISAO" || p.tipoCalculo === "RESCISAO_QUITADA")),
        pendentes: participants.filter((p) => p.rescisaoPendente).length,
      },
      reserva: { valor: reservaValor, pontos: reservaPontos },
      fixos: (({ valor, pessoas }) => ({ valor, pessoas }))(somar(participants.filter((p) => p.kind === "FIXO" && p.tipoCalculo === "MES"))),
    },
    reservaTotal: reservaValor,
    reservaPontos,
    fundoReservaSaldo,
    participants,
    totals: {
      rateio: distribuido,
      vales: round2(participants.reduce((a, p) => a + p.valesTotal, 0)),
      netCommission: round2(participants.reduce((a, p) => a + p.netCommission, 0)),
      salarios: round2(participants.reduce((a, p) => a + p.salarioProporcional, 0)),
      totalAPagar: round2(participants.reduce((a, p) => a + p.totalAPagar, 0)),
      pagoNaRescisao: round2(participants.filter((p) => p.pagoNaRescisao).reduce((a, p) => a + p.rateioAmount, 0)),
    },
    check: { expectedNetPool: netPool, sumRateios: distribuido, ok, diff: round2(distribuido - netPool) },
    pendencias,
    warnings,
  };
}

function somar(lista: ComputedParticipant[]) {
  return {
    valor: round2(lista.reduce((a, p) => a + p.rateioAmount, 0)),
    pontos: round2(lista.reduce((a, p) => a + (p.kind === "PONTOS" ? p.points : 0), 0)),
    pessoas: lista.length,
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
  let period;
  for (let tentativa = 0; ; tentativa++) {
    try {
      period = await prisma.tipPeriod.create({
        data: {
          id: crypto.randomUUID(),
          code: await proximoCodigoApuracao(prisma, year),
          competenceYear: year, competenceMonth: month,
          periodStart: start, periodEnd: end, label,
          grossPool, servicoFaturamento: grossPool, poolSource: "REVENUE", deductionPercent: 20, netPool,
          createdById: userId,
        },
      });
      break;
    } catch (err) {
      // Código repetido (outra abertura no mesmo instante): gera o próximo.
      const codigo = (err as { code?: string }).code;
      if (codigo !== "P2002" || tentativa >= 3) throw err;
      const outro = await prisma.tipPeriod.findUnique({ where: { competenceYear_competenceMonth: { competenceYear: year, competenceMonth: month } } });
      if (outro) return outro;
    }
  }
  await syncParticipantsFromCadastro(period.id);
  return period;
}

// Traz para o período quem participa da gorjeta no cadastro e ainda não está nele
// (inclusive desligados, que recebem pela rescisão). Também atualiza os pontos-base
// de quem já está, porque a base vem sempre do cadastro — o ajuste do mês é que se
// edita no período. Não remove ninguém.
export async function syncParticipantsFromCadastro(periodId: string): Promise<{ added: number; elegiveis: number; atualizados: number }> {
  const periodo = await prisma.tipPeriod.findUniqueOrThrow({ where: { id: periodId }, select: { periodStart: true } });
  const elegiveis = await prisma.employee.findMany({
    where: {
      participaGorjeta: true, deletedAt: null,
      // Quem saiu antes do período começar já recebeu no período dele.
      OR: [{ terminationDate: null }, { terminationDate: { gte: periodo.periodStart } }],
    },
    select: { id: true, tipoGorjeta: true, pontosExtra: true, cotaFixaGorjeta: true, tipFunction: { select: { points: true, name: true } } },
  });
  const existing = await prisma.tipParticipant.findMany({ where: { periodId }, select: { id: true, employeeId: true, basePoints: true, functionName: true } });
  const byEmp = new Map(existing.map((e) => [e.employeeId, e]));
  const toAdd = elegiveis.filter((e) => !byEmp.has(e.id));
  if (toAdd.length > 0) {
    await prisma.tipParticipant.createMany({
      data: toAdd.map((e) => ({
        id: crypto.randomUUID(),
        periodId,
        employeeId: e.id,
        kind: e.tipoGorjeta,
        basePoints: e.tipoGorjeta === "PONTOS" ? pontosBaseDoCadastro(e) : null,
        functionName: e.tipFunction?.name ?? null,
        fixedAmount: e.tipoGorjeta === "FIXO" ? (e.cotaFixaGorjeta ?? 0) : null,
      })),
      skipDuplicates: true,
    });
  }
  let atualizados = 0;
  for (const e of elegiveis) {
    const atual = byEmp.get(e.id);
    if (!atual || e.tipoGorjeta !== "PONTOS") continue;
    const base = pontosBaseDoCadastro(e);
    const funcao = e.tipFunction?.name ?? null;
    if (Number(atual.basePoints ?? -1) !== base || atual.functionName !== funcao) {
      await prisma.tipParticipant.update({ where: { id: atual.id }, data: { basePoints: base, functionName: funcao } });
      atualizados += 1;
    }
  }
  return { added: toAdd.length, elegiveis: elegiveis.length, atualizados };
}

// ─── Fechar: recalcula, grava os valores e trava ─────────────────────────────
// Grava também as ocorrências e o serviço da rescisão que vieram da Escala e do
// faturamento, para o período fechado não mudar se essas fontes mudarem depois.
export async function closeTipPeriod(year: number, month: number, usuario: { id: string; name: string }) {
  const userId = usuario.id;
  const comp = await computeTipCommission(year, month);
  if (!comp.periodId) throw new Error("Período não encontrado.");
  if (!comp.check.ok) {
    throw new Error(comp.pendencias[0] ?? "As cotas fixas passam do líquido do período.");
  }

  await prisma.$transaction(async (tx) => {
    for (const p of comp.participants) {
      if (!p.participantId) continue;
      await tx.tipParticipant.update({
        where: { id: p.participantId },
        data: {
          points: p.kind === "PONTOS" ? p.points : null,
          rateioAmount: p.rateioAmount,
          valesTotal: p.valesTotal,
          netCommission: p.netCommission,
          salarioProporcional: p.salarioProporcional,
          totalAPagar: p.totalAPagar,
          faltas: p.faltas,
          atestados: p.atestados,
          ferias: p.ferias,
          rescisaoServicoBruto: p.rescisaoServicoBruto,
          functionName: p.functionName,
        },
      });
    }
    // Fundo de reserva: o que o fechamento guarda. Refazer um fechamento troca os lançamentos dele.
    await travarFundo(tx);
    const anteriores = await tx.tipReserveMovement.findMany({
      where: { periodId: comp.periodId!, type: { in: ["FECHAMENTO_RESERVA", "FECHAMENTO_SALDO"] } }, select: { amount: true },
    });
    const retirada = round2(anteriores.reduce((a, m) => a + Number(m.amount), 0) - comp.composicao.reserva.valor - Math.max(0, comp.saldo));
    const bloqueio = motivoParaNaoRetirar(await saldoReserva(tx), retirada, `${String(month).padStart(2, "0")}/${year}`);
    if (bloqueio) throw new Error(bloqueio);
    await tx.tipReserveMovement.deleteMany({ where: { periodId: comp.periodId!, type: { in: ["FECHAMENTO_RESERVA", "FECHAMENTO_SALDO"] } } });
    const dataFechamento = new Date(comp.periodEnd);
    const rotulo = `${String(month).padStart(2, "0")}/${year}`;
    if (comp.composicao.reserva.valor > 0) {
      await tx.tipReserveMovement.create({
        data: {
          id: crypto.randomUUID(), date: dataFechamento, type: "FECHAMENTO_RESERVA", amount: comp.composicao.reserva.valor,
          periodId: comp.periodId!, notes: `Reserva de ${rotulo}: ${comp.reservaPontos} pontos × ${comp.pointValue.toFixed(2)}`, createdById: userId,
        },
      });
    }
    if (comp.saldo > 0.005) {
      await tx.tipReserveMovement.create({
        data: {
          id: crypto.randomUUID(), date: dataFechamento, type: "FECHAMENTO_SALDO", amount: comp.saldo,
          periodId: comp.periodId!, notes: `Saldo não distribuído de ${rotulo}`, createdById: userId,
        },
      });
    }
    await tx.tipPeriod.update({
      where: { id: comp.periodId! },
      data: {
        netPool: comp.netPool, pointValue: comp.pointValue, saldoRetido: Math.max(0, comp.saldo),
        status: "CLOSED", closedAt: new Date(), updatedById: userId,
      },
    });
    // Registro permanente deste fechamento (retrato + hash), na mesma transação.
    const lancadas = await tx.tipReserveMovement.findMany({
      where: { periodId: comp.periodId!, type: { in: ["FECHAMENTO_RESERVA", "FECHAMENTO_SALDO"] } },
      select: { type: true, amount: true, notes: true },
    });
    await registrarFechamento(tx, comp, usuario, await saldoReserva(tx),
      lancadas.map((l) => ({ type: l.type, amount: Number(l.amount), notes: l.notes })));
  });

  return computeTipCommission(year, month);
}

// ─── Reabrir: destrava um período fechado para correções ─────────────────────
export async function reopenTipPeriod(year: number, month: number, usuario: { id: string; name: string }, motivo: string) {
  const userId = usuario.id;
  const texto = motivo.trim();
  if (texto.length < 10) throw new Error("Informe o motivo da reabertura (pelo menos 10 caracteres). Ele fica gravado no registro do fechamento.");
  const period = await prisma.tipPeriod.findUnique({
    where: { competenceYear_competenceMonth: { competenceYear: year, competenceMonth: month } },
  });
  if (!period) throw new Error("Período não encontrado.");
  if (period.status !== "CLOSED") throw new Error("O período não está fechado.");

  await prisma.$transaction(async (tx) => {
    await travarFundo(tx);
    const guardado = await tx.tipReserveMovement.findMany({
      where: { periodId: period.id, type: { in: ["FECHAMENTO_RESERVA", "FECHAMENTO_SALDO"] } }, select: { amount: true },
    });
    const retirada = round2(guardado.reduce((a, m) => a + Number(m.amount), 0));
    const bloqueio = motivoParaNaoRetirar(await saldoReserva(tx), retirada, `${String(month).padStart(2, "0")}/${year}`);
    if (bloqueio) throw new Error(bloqueio);
    await tx.tipReserveMovement.deleteMany({ where: { periodId: period.id, type: { in: ["FECHAMENTO_RESERVA", "FECHAMENTO_SALDO"] } } });
    await registrarReabertura(tx, period.id, usuario, texto);
    // Reabrir pode mudar valores já enviados: as etapas marcadas (envio, OK, folha
    // paga) são desmarcadas e a conferência tem de ser refeita.
    const etapas = await tx.tipPeriodEtapa.findMany({ where: { periodId: period.id }, orderBy: { em: "asc" } });
    const ultima = new Map<string, string>();
    for (const e of etapas) ultima.set(e.etapa, e.acao);
    for (const [etapa, acao] of ultima) {
      if (acao !== "MARCOU") continue;
      await tx.tipPeriodEtapa.create({
        data: {
          id: crypto.randomUUID(), periodId: period.id, etapa, acao: "DESMARCOU",
          obs: `Período reaberto: ${texto}`.slice(0, 300), porId: usuario.id, por: usuario.name,
        },
      });
    }
    await tx.tipPeriod.update({
      where: { competenceYear_competenceMonth: { competenceYear: year, competenceMonth: month } },
      data: { status: "OPEN", closedAt: null, updatedById: userId },
    });
  });

  return computeTipCommission(year, month);
}
