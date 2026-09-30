// Código automático das apurações da gorjeta e registro permanente de cada
// fechamento. O registro guarda o retrato completo (parâmetros, cada pessoa,
// totais e fundo) com um SHA-256 do conteúdo; o banco impede apagar e alterar
// (trigger "tip_fechamento_imutavel"). Reabrir exige motivo e fica anotado.

import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import type { TipComputation } from "./tip-commission.service.js";

type Tx = Prisma.TransactionClient;

// GOR-AAAA-NNNN, sequência por ano (mesmo padrão de CMV/CNT/INV).
export async function proximoCodigoApuracao(tx: Tx | typeof prisma, ano: number): Promise<string> {
  const [row] = await tx.$queryRaw<Array<{ proximo: number }>>`
    SELECT COALESCE(MAX(SUBSTRING("code" FROM ${`^GOR-${ano}-(\\d+)$`})::int), 0) + 1 AS "proximo"
    FROM "TipPeriod"
    WHERE "code" LIKE ${`GOR-${ano}-%`}
  `;
  return `GOR-${ano}-${String(Number(row?.proximo ?? 1)).padStart(4, "0")}`;
}

// JSON com chaves em ordem: o Postgres (jsonb) reordena as chaves ao gravar, e o
// hash tem de dar o mesmo na gravação e na conferência.
export function jsonCanonico(valor: unknown): string {
  if (valor === null || typeof valor !== "object") return JSON.stringify(valor);
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(",")}]`;
  const obj = valor as Record<string, unknown>;
  return `{${Object.keys(obj).filter((k) => obj[k] !== undefined).sort()
    .map((k) => `${JSON.stringify(k)}:${jsonCanonico(obj[k])}`).join(",")}}`;
}

export function hashDoConteudo(conteudo: { params: unknown; totals: unknown; participants: unknown; reserve: unknown }): string {
  return crypto.createHash("sha256").update(jsonCanonico(conteudo)).digest("hex");
}

// O que fica gravado: tudo que explica o valor de cada pessoa, sem dados
// bancários (PIX, conta) — esses ficam só no cadastro.
export function montarRetrato(comp: TipComputation, reservaLancada: Array<{ type: string; amount: number; notes: string | null }>) {
  const params = {
    label: comp.label,
    periodStart: comp.periodStart.slice(0, 10),
    periodEnd: comp.periodEnd.slice(0, 10),
    servicoFaturamento: comp.servicoFaturamento,
    ajusteServico: comp.ajusteServico,
    ajusteServicoMotivo: comp.ajusteServicoMotivo,
    grossPool: comp.grossPool,
    deductionPercent: comp.deductionPercent,
    pointsTotal: comp.pointsBudget,
    diasPadrao: comp.diasPadrao,
    descontaFalta: comp.descontaFalta,
    descontaAtestado: comp.descontaAtestado,
    descontaFerias: comp.descontaFerias,
    descontaOutros: comp.descontaOutros,
    proporcionalEntrada: comp.proporcionalEntrada,
    reservaPontos: comp.reservaPontos,
  };
  const totals = {
    netPool: comp.netPool,
    fixedTotal: comp.fixedTotal,
    rescisoes: comp.rescisoes,
    pontosDisponiveis: comp.pontosDisponiveis,
    pointValue: comp.pointValue,
    totalPoints: comp.totalPoints,
    distribuido: comp.distribuido,
    saldo: comp.saldo,
    reserva: comp.composicao.reserva,
    rateio: comp.totals.rateio,
    vales: comp.totals.vales,
    netCommission: comp.totals.netCommission,
    salarios: comp.totals.salarios,
    // Só quando houve adiantamento: retratos antigos continuam com o mesmo formato.
    ...(comp.totals.adiantamentos ? { adiantamentos: comp.totals.adiantamentos, adiantamentoRegra: comp.adiantamento } : {}),
    totalAPagar: comp.totals.totalAPagar,
  };
  const participants = comp.participants.map((p) => ({
    employeeId: p.employeeId,
    nome: p.employeeName,
    // Retratos gravados antes desta versão não têm o apelido.
    apelido: p.apelido,
    funcao: p.functionName,
    empresa: p.companyName,
    semRegistro: p.semRegistro,
    admissao: p.admissionDate?.slice(0, 10) ?? null,
    desligamento: p.terminationDate?.slice(0, 10) ?? null,
    tipo: p.kind,
    tipoCalculo: p.tipoCalculo,
    pontosBase: p.basePoints,
    ajuste: p.pointsAdjustment,
    cotaFixa: p.fixedAmount,
    faltas: p.faltas,
    atestados: p.atestados,
    ferias: p.ferias,
    outrosDias: p.outrosDias,
    diasPrevistos: p.diasPrevistos,
    diasReferencia: p.diasReferencia,
    diasComputados: p.diasComputados,
    fatorPresenca: p.fatorPresenca,
    regrasProprias: p.regras,
    regrasAplicadas: p.regrasEfetivas,
    pontosApurados: p.pontosApurados,
    pontos: p.points,
    pontosDireito: p.pontosDireito,
    pontosDevolvidos: p.pontosDevolvidos,
    extraRescisao: p.extraRescisao,
    justificativaExtra: p.justificativaExtra,
    valorPonto: p.valorPonto,
    rescisaoServicoBruto: p.rescisaoServicoBruto,
    rescisaoValorFixo: p.rescisaoValorFixo,
    gorjeta: p.rateioAmount,
    // Gorjeta real no lugar da calculada: o que o sistema calculou e o porquê. Só a que
    // entrou no cálculo (a que deixou de valer vem null do cálculo).
    ...(p.gorjetaReal != null ? { gorjetaCalculada: p.gorjetaCalculada, gorjetaReal: p.gorjetaReal } : {}),
    vales: p.vales.map((v) => ({ tipo: v.type, valor: v.amount, data: v.date?.slice(0, 10) ?? null, descricao: v.notes })),
    descontos: p.descontos,
    creditos: p.creditos,
    liquido: p.netCommission,
    diasSalario: p.diasSalario,
    salarioProporcional: p.salarioProporcional,
    ...(p.adiantamentoSalarial ? { adiantamentoSalarial: p.adiantamentoSalarial } : {}),
    totalAPagar: p.totalAPagar,
    horaExtra: p.horaExtra,
    adicionalNoturno: p.adicionalNoturno,
    justificada: p.justificada,
  }));
  const reserve = {
    pontos: comp.reservaPontos,
    lancamentos: reservaLancada,
    saldoDoFundoAposFechar: undefined as number | undefined,
  };
  return { params, totals, participants, reserve };
}

export async function registrarFechamento(
  tx: Tx, comp: TipComputation, usuario: { id: string; name: string }, saldoFundo: number,
  reservaLancada: Array<{ type: string; amount: number; notes: string | null }>,
) {
  const periodo = await tx.tipPeriod.findUniqueOrThrow({ where: { id: comp.periodId! }, select: { id: true, code: true } });
  const ultima = await tx.tipPeriodClosing.findFirst({ where: { periodId: periodo.id }, orderBy: { version: "desc" }, select: { version: true } });
  const versao = (ultima?.version ?? 0) + 1;
  const retrato = montarRetrato(comp, reservaLancada);
  retrato.reserve.saldoDoFundoAposFechar = saldoFundo;
  const conteudo = JSON.parse(JSON.stringify(retrato)) as typeof retrato;
  return tx.tipPeriodClosing.create({
    data: {
      id: crypto.randomUUID(),
      periodId: periodo.id,
      code: `${periodo.code}/v${versao}`,
      version: versao,
      competenceYear: comp.year,
      competenceMonth: comp.month,
      periodStart: new Date(comp.periodStart),
      periodEnd: new Date(comp.periodEnd),
      closedAt: new Date(),
      closedById: usuario.id,
      closedByName: usuario.name,
      params: conteudo.params,
      totals: conteudo.totals,
      participants: conteudo.participants,
      reserve: conteudo.reserve,
      payloadHash: hashDoConteudo(conteudo),
    },
  });
}

// Anota a reabertura na versão vigente. Motivo é obrigatório.
export async function registrarReabertura(tx: Tx, periodId: string, usuario: { id: string; name: string }, motivo: string) {
  const vigente = await tx.tipPeriodClosing.findFirst({ where: { periodId, reopenedAt: null }, orderBy: { version: "desc" } });
  if (!vigente) return null;
  return tx.tipPeriodClosing.update({
    where: { id: vigente.id },
    data: { reopenedAt: new Date(), reopenedById: usuario.id, reopenedByName: usuario.name, reopenReason: motivo },
  });
}

export async function listarFechamentos(ano?: number) {
  const linhas = await prisma.tipPeriodClosing.findMany({
    where: ano ? { competenceYear: ano } : undefined,
    orderBy: [{ competenceYear: "desc" }, { competenceMonth: "desc" }, { version: "desc" }],
  });
  return linhas.map((l) => {
    const t = l.totals as Record<string, unknown>;
    return {
      id: l.id, code: l.code, version: l.version,
      competenceYear: l.competenceYear, competenceMonth: l.competenceMonth,
      periodStart: l.periodStart.toISOString(), periodEnd: l.periodEnd.toISOString(),
      closedAt: l.closedAt.toISOString(), closedByName: l.closedByName,
      reopenedAt: l.reopenedAt?.toISOString() ?? null, reopenedByName: l.reopenedByName, reopenReason: l.reopenReason,
      pessoas: Array.isArray(l.participants) ? l.participants.length : 0,
      liquido: Number(t.netPool ?? 0), distribuido: Number(t.distribuido ?? 0), saldo: Number(t.saldo ?? 0),
      valorPonto: Number(t.pointValue ?? 0),
      integro: hashDoConteudo({ params: l.params, totals: l.totals, participants: l.participants, reserve: l.reserve }) === l.payloadHash,
    };
  });
}

export async function detalheFechamento(id: string) {
  const l = await prisma.tipPeriodClosing.findUnique({ where: { id } });
  if (!l) return null;
  const recalculado = hashDoConteudo({ params: l.params, totals: l.totals, participants: l.participants, reserve: l.reserve });
  return {
    ...l,
    periodStart: l.periodStart.toISOString(), periodEnd: l.periodEnd.toISOString(),
    closedAt: l.closedAt.toISOString(), reopenedAt: l.reopenedAt?.toISOString() ?? null,
    integro: recalculado === l.payloadHash,
  };
}
