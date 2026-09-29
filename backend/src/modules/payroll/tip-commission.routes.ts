// Rotas da Folha da Gorjeta (Comissão) — Fase A.
// Registrada em app.ts como:  app.use("/payroll/tip", tipCommissionRouter);

import crypto from "node:crypto";
import { Router, type Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp, type SessionUser } from "../security/security-utils.js";
import { userHasPermission } from "../security/menu-permissions.js";
import { podeVerDadosPessoais } from "./dados-pessoais.js";
import {
  closeTipPeriod, computeTipCommission, ensureTipPeriod, findOverlappingPeriod,
  getServicePool, getServicePoolByRange, pontosBaseDoCadastro, reopenTipPeriod, syncParticipantsFromCadastro, tipPeriodBounds,
} from "./tip-commission.service.js";
import fs from "node:fs";
import path from "node:path";
import { importExtrato, onlyDigits, parseExtratoMensal } from "./rh-extract.service.js";
import {
  distribuirReserva, evolucaoMensal, extratoReserva, lancarAjusteReserva, listarMudancas, motivoParaNaoRetirar, mudouSituacao,
  registrarHistorico, saldoReserva, travarFundo,
} from "./tip-historico.service.js";
import { detalheFechamento, listarFechamentos } from "./tip-fechamento.service.js";
import { lerPdfRescisao } from "./tip-trct.service.js";
import { tipConferenciaRouter } from "./tip-conferencia.routes.js";
import { tipValesRouter } from "./tip-vales.routes.js";

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
// Envio à contabilidade, conferência dos extratos, etapas e folha de líquidos.
tipCommissionRouter.use(tipConferenciaRouter);
tipCommissionRouter.use(tipValesRouter);

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

// Inteiro ≥ 0 ou null (campo vazio = "usar o cálculo/Escala").
function intOrNull(v: unknown): number | null {
  const n = numOrNull(v);
  return n == null ? null : Math.max(0, Math.round(n));
}

function intOrUndefined(v: unknown, min: number, max: number): number | undefined {
  const n = numOrNull(v);
  return n == null ? undefined : Math.min(max, Math.max(min, Math.round(n)));
}

function textoOuNull(v: unknown): string | null {
  return v != null && String(v).trim() !== "" ? String(v).trim() : null;
}

function hojeUTC(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function boolOrUndefined(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

// ─── Prévia do cálculo (não persiste) ───────────────────────────────────────
// Salário e PIX só vão para quem também pode ver a ficha de Funcionários: delegar a
// gorjeta não entrega junto o salário de todo mundo (ver /roster abaixo).
// Participantes cuja gorjeta paga foi gravada por uma rescisão viva (qualquer parcela).
async function participantesTravadosPelaRescisao(employeeIds: string[]): Promise<Set<string>> {
  if (employeeIds.length === 0) return new Set();
  const rescisoes = await prisma.payrollItem.findMany({
    where: { type: "RESCISAO", deletedAt: null, status: { not: "CANCELED" }, employeeId: { in: employeeIds } },
    select: { details: true },
  });
  return new Set(rescisoes
    .map((x) => (x.details as { gorjetaNaApuracao?: { participantId?: string } } | null)?.gorjetaNaApuracao?.participantId)
    .filter((id): id is string => Boolean(id)));
}

tipCommissionRouter.get("/", async (request, response) => {
  const { year, month } = parseYearMonth(request.query as { year?: unknown; month?: unknown });
  const computation = await computeTipCommission(year, month, { incluirDadosPessoais: await podeVerDadosPessoais(request) });
  response.json(computation);
});

// Pool sugerido do faturamento, sem abrir o período (para pré-visualizar).
tipCommissionRouter.get("/pool", async (request, response) => {
  const { year, month } = parseYearMonth(request.query as { year?: unknown; month?: unknown });
  const { start, end, label } = tipPeriodBounds(year, month);
  const grossPool = await getServicePool(year, month);
  response.json({ year, month, label, periodStart: start, periodEnd: end, grossPool });
});

// ─── Elenco para o rateio ──────────────────────────────────
// A tela da gorjeta so precisa saber quem existe e como se chama. Ate aqui ela
// chamava GET /employees, que devolve a ficha inteira: CPF, RG, PIS, conta
// bancaria, agencia, PIX e salario-base. Isso obrigava quem opera o rateio a ter
// tambem permissao de Funcionarios — ou seja, delegar a gorjeta entregava junto o
// salario de todo mundo.
//
// Vivendo sob /payroll/tip, esta rota responde ao modulo payroll-tips (regra em
// menuFromRequest, que testa /payroll/tip antes de /payroll) e devolve apenas os
// quatro campos que a tela usa. Inativos entram: o rateio do mes inclui quem foi
// desligado no meio dele.
tipCommissionRouter.get("/roster", async (_request, response) => {
  const employees = await prisma.employee.findMany({
    where: { deletedAt: null },
    select: { id: true, firstName: true, lastName: true, displayName: true, isActive: true },
    orderBy: [{ isActive: "desc" }, { firstName: "asc" }, { lastName: "asc" }],
  });
  response.json(employees);
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
  // Serviço, retenção, datas e pontos mudam o valor de todo mundo: fica no rastro.
  const antesDoPeriodo = await prisma.tipPeriod.findUnique({
    where: { id: periodId },
    select: {
      grossPool: true, servicoFaturamento: true, ajusteServico: true, ajusteServicoMotivo: true, deductionPercent: true,
      pointsTotal: true, periodStart: true, periodEnd: true, diasPadrao: true, reservaPontos: true,
      descontaFalta: true, descontaAtestado: true, descontaFerias: true, descontaOutros: true, proporcionalEntrada: true,
    },
  });
  const gross = numOrNull(b.grossPool);
  const pointsTotalRaw = numOrNull(b.pointsTotal);
  const pointsTotal = pointsTotalRaw == null ? undefined : Math.max(1, Math.round(pointsTotalRaw));

  // ── Datas do período (opcionais). Se enviadas, controla duplicidade e recalcula o total. ──
  let periodStart: Date | undefined;
  let periodEnd: Date | undefined;
  let label: string | undefined;
  let grossFromRange: number | undefined;
  const avisosPeriodo: string[] = [];

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
    // Sobreposicao ja e barrada acima. LACUNA nao era verificada, e ela custa o
    // contrario: sobrepor paga em duplicidade, mas deixar um buraco entre dois
    // periodos faz a taxa de servico daqueles dias NAO entrar em pool nenhum — dinheiro
    // cobrado do cliente que pertence aos funcionarios e que ninguem distribui, sem
    // nada indicando.
    //
    // Avisa em vez de barrar: pode haver motivo para pular dias (periodo em que a
    // gorjeta nao foi rateada), e so quem opera sabe. O aviso vai no retorno para
    // aparecer na tela, junto dos outros.
    const anterior = await prisma.tipPeriod.findFirst({
      where: { id: { not: periodId }, periodEnd: { lt: s } },
      orderBy: { periodEnd: "desc" },
      select: { label: true, periodEnd: true },
    });
    if (anterior) {
      const diaSeguinte = new Date(anterior.periodEnd.getTime() + 24 * 60 * 60 * 1000);
      const diasDeBuraco = Math.round((s.getTime() - diaSeguinte.getTime()) / (24 * 60 * 60 * 1000));
      if (diasDeBuraco > 0) {
        const [servico] = await prisma.$queryRaw<Array<{ v: unknown }>>`
          SELECT COALESCE(SUM("serviceAmount"), 0) AS v FROM "RevenueEntry"
          WHERE "status" = 'ACTIVE' AND "date" >= ${diaSeguinte} AND "date" < ${s}
        `;
        const valor = Number(servico?.v ?? 0);
        avisosPeriodo.push(
          `Ficam ${diasDeBuraco} dia(s) sem periodo de gorjeta entre "${anterior.label}" (termina ${fmtDay(anterior.periodEnd)}) e este (comeca ${fmtDay(s)})` +
          (valor > 0 ? `: R$ ${valor.toFixed(2)} de taxa de servico nao entram em pool nenhum.` : ".")
        );
      }
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

  // Serviço arrecadado = faturamento + ajuste. Mudar as datas repuxa o faturamento
  // e mantém o ajuste; o ajuste (com motivo) é o jeito de somar serviço que não
  // passa pelo sistema. "grossPool" direto (legado) vira ajuste sobre o faturamento.
  const atual = await prisma.tipPeriod.findUniqueOrThrow({ where: { id: periodId }, select: { servicoFaturamento: true, ajusteServico: true } });
  const faturamento = grossFromRange ?? Number(atual.servicoFaturamento);
  let ajuste = numOrNull(b.ajusteServico) ?? Number(atual.ajusteServico);
  if (gross != null && b.ajusteServico === undefined) ajuste = gross - faturamento;
  const motivo = b.ajusteServicoMotivo !== undefined ? textoOuNull(b.ajusteServicoMotivo) : undefined;
  if (Math.abs(ajuste) >= 0.005 && motivo === null) {
    return response.status(422).json({ message: "Informe o motivo do ajuste no serviço arrecadado." });
  }
  const grossFinal = Math.round((faturamento + ajuste) * 100) / 100;
  if (grossFinal < 0) return response.status(422).json({ message: "O serviço arrecadado não pode ficar negativo." });
  const period = await prisma.tipPeriod.update({
    where: { id: periodId },
    data: {
      grossPool: grossFinal,
      servicoFaturamento: faturamento,
      ajusteServico: ajuste,
      ajusteServicoMotivo: Math.abs(ajuste) < 0.005 ? null : motivo,
      poolSource: Math.abs(ajuste) >= 0.005 ? "MANUAL" : "REVENUE",
      deductionPercent: numOrNull(b.deductionPercent) ?? undefined,
      pointsTotal,
      diasPadrao: intOrUndefined(b.diasPadrao, 1, 31),
      descontaFalta: boolOrUndefined(b.descontaFalta),
      descontaAtestado: boolOrUndefined(b.descontaAtestado),
      descontaFerias: boolOrUndefined(b.descontaFerias),
      descontaOutros: boolOrUndefined(b.descontaOutros),
      proporcionalEntrada: boolOrUndefined(b.proporcionalEntrada),
      reservaPontos: (() => { const n = numOrNull(b.reservaPontos); return n == null ? undefined : Math.max(0, n); })(),
      periodStart,
      periodEnd,
      label,
      updatedById: user.id,
    },
  });
  // O aviso de lacuna viaja junto do periodo para aparecer na tela.
  await auditLog({
    userId: user.id, action: "UPDATE_TIP_PERIOD", entity: "TipPeriod", entityId: periodId,
    previousValue: antesDoPeriodo,
    newValue: {
      grossPool: period.grossPool, servicoFaturamento: period.servicoFaturamento, ajusteServico: period.ajusteServico,
      ajusteServicoMotivo: period.ajusteServicoMotivo, deductionPercent: period.deductionPercent, pointsTotal: period.pointsTotal,
      periodStart: period.periodStart, periodEnd: period.periodEnd, diasPadrao: period.diasPadrao, reservaPontos: period.reservaPontos,
      descontaFalta: period.descontaFalta, descontaAtestado: period.descontaAtestado, descontaFerias: period.descontaFerias, descontaOutros: period.descontaOutros,
      proporcionalEntrada: period.proporcionalEntrada,
    },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.json(avisosPeriodo.length > 0 ? { ...period, avisos: avisosPeriodo } : period);
});

// Busca de novo o serviço do faturamento no intervalo do período (ex.: depois de
// importar dias que faltavam). O ajuste manual continua valendo.
tipCommissionRouter.post("/periods/:id/refresh-service", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const periodId = request.params.id;
  if (await barrouPorFechamento(periodId, response, "Atualizar o serviço")) return;
  const p = await prisma.tipPeriod.findUnique({ where: { id: periodId } });
  if (!p) return response.status(404).json({ message: "Período não encontrado." });
  const faturamento = await getServicePoolByRange(p.periodStart, new Date(p.periodEnd.getTime() + 24 * 60 * 60 * 1000));
  const gross = Math.round((faturamento + Number(p.ajusteServico)) * 100) / 100;
  await prisma.tipPeriod.update({ where: { id: periodId }, data: { servicoFaturamento: faturamento, grossPool: gross, updatedById: user.id } });
  await auditLog({
    userId: user.id, action: "REFRESH_TIP_SERVICE", entity: "TipPeriod", entityId: periodId,
    previousValue: { servicoFaturamento: String(p.servicoFaturamento) }, newValue: { servicoFaturamento: faturamento },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.json({ servicoFaturamento: faturamento, grossPool: gross });
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

  // Pontos-base vêm do cadastro (função + ponto extra) e não se editam aqui:
  // o período só guarda o ajuste do mês. Quem entra pela tela pega a base na hora.
  const novos = (list as Array<Record<string, unknown>>).map((raw) => String(raw.employeeId ?? "")).filter(Boolean);
  const cadastro = await prisma.employee.findMany({
    where: { id: { in: novos } },
    select: { id: true, pontosExtra: true, tipFunction: { select: { points: true } } },
  });
  const basePorFuncionario = new Map(cadastro.map((e) => [e.id, pontosBaseDoCadastro(e)]));

  // Ocorrências e dias são contagens dentro de um período de ~31 dias.
  const CAMPOS_DIAS: Array<[string, string]> = [
    ["faltas", "Faltas"], ["atestados", "Atestados"], ["ferias", "Férias"], ["outrosDias", "Outros dias"],
    ["diasPrevistosOverride", "Dias previstos"], ["diasSalarioOverride", "Dias de salário"],
  ];
  for (const raw of list as Array<Record<string, unknown>>) {
    for (const [campo, rotulo] of CAMPOS_DIAS) {
      const n = numOrNull(raw[campo]);
      if (n != null && (n < 0 || n > 31)) {
        return response.status(422).json({ message: `${rotulo}: ${n} não é possível num período (use de 0 a 31).` });
      }
    }
    const ajuste = numOrNull(raw.pointsAdjustment);
    if (ajuste != null && Math.abs(ajuste) > 100) {
      return response.status(422).json({ message: `Ajuste de pontos ${ajuste} fora do razoável (máximo ±100).` });
    }
  }

  // Quem tem a gorjeta paga definida pela rescisão lançada (neste período) não muda
  // esse valor aqui: a rescisão é a fonte — ajuste lá, com justificativa.
  const idsDaLista = (list as Array<Record<string, unknown>>).map((x) => String(x.employeeId ?? ""));
  const travados = await participantesTravadosPelaRescisao(idsDaLista);
  const atuais = await prisma.tipParticipant.findMany({
    where: { periodId, employeeId: { in: idsDaLista } }, select: { id: true, employeeId: true, rescisaoValorFixo: true },
  });
  const gorjetaPelaRescisao = new Set(atuais.filter((p) => travados.has(p.id)).map((p) => p.employeeId));
  for (const raw of list as Array<Record<string, unknown>>) {
    const atual = atuais.find((p) => p.employeeId === String(raw.employeeId ?? ""));
    if (!atual || !gorjetaPelaRescisao.has(atual.employeeId) || raw.rescisaoValorFixo === undefined) continue;
    const novo = numOrNull(raw.rescisaoValorFixo);
    const antes = atual.rescisaoValorFixo == null ? null : Number(atual.rescisaoValorFixo);
    if ((novo == null) !== (antes == null) || (novo != null && antes != null && Math.round(Math.abs(novo - antes) * 100) >= 1)) {
      return response.status(409).json({ message: "Esta gorjeta paga veio da rescisão lançada: ajuste em Funcionários → Lançar rescisão → Ajustar rescisão." });
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const raw of list as Array<Record<string, unknown>>) {
      const employeeId = String(raw.employeeId ?? "");
      if (!employeeId || !basePorFuncionario.has(employeeId)) continue;
      const kind = raw.kind === "FIXO" ? "FIXO" : "PONTOS";
      const texto = (v: unknown) => (v != null && String(v).trim() !== "" ? String(v).trim() : null);
      const dados = {
        kind,
        fixedAmount: kind === "FIXO" ? (numOrNull(raw.fixedAmount) ?? 0) : null,
        pointsAdjustment: numOrNull(raw.pointsAdjustment) ?? 0,
        faltas: intOrNull(raw.faltas),
        atestados: intOrNull(raw.atestados),
        ferias: intOrNull(raw.ferias),
        outrosDias: intOrNull(raw.outrosDias),
        diasPrevistosOverride: intOrNull(raw.diasPrevistosOverride),
        diasSalarioOverride: intOrNull(raw.diasSalarioOverride),
        rescisaoServicoBruto: numOrNull(raw.rescisaoServicoBruto),
        rescisaoValorFixo: numOrNull(raw.rescisaoValorFixo),
        // Regra própria da pessoa: true/false decide; null volta para a regra do período.
        descontaFalta: boolOrNull(raw.descontaFalta),
        descontaAtestado: boolOrNull(raw.descontaAtestado),
        descontaFerias: boolOrNull(raw.descontaFerias),
        descontaOutros: boolOrNull(raw.descontaOutros),
        proporcionalEntrada: boolOrNull(raw.proporcionalEntrada),
        horaExtra: texto(raw.horaExtra),
        adicionalNoturno: texto(raw.adicionalNoturno),
        justificada: Boolean(raw.justificada),
      } as const;
      const { rescisaoValorFixo, ...semGorjetaPaga } = dados;
      await tx.tipParticipant.upsert({
        where: { periodId_employeeId: { periodId, employeeId } },
        create: { id: crypto.randomUUID(), periodId, employeeId, basePoints: basePorFuncionario.get(employeeId) ?? 0, ...dados },
        // Sem valor quitado, o recibo lido do TRCT deixa de valer.
        update: gorjetaPelaRescisao.has(employeeId) ? semGorjetaPaga
          : rescisaoValorFixo == null ? { ...dados, rescisaoRecibo: Prisma.DbNull } : dados,
      });
    }
  });

  const period = await prisma.tipPeriod.findUniqueOrThrow({ where: { id: periodId } });
  const computation = await computeTipCommission(period.competenceYear, period.competenceMonth, { incluirDadosPessoais: await podeVerDadosPessoais(request) });
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
  const { added, elegiveis, atualizados } = await syncParticipantsFromCadastro(periodId);
  const computation = await computeTipCommission(period.competenceYear, period.competenceMonth, { incluirDadosPessoais: await podeVerDadosPessoais(request) });
  response.json({ added, elegiveis, atualizados, computation });
});

// Remover um participante do período.
// Gorjeta real no lugar da calculada (valor null tira o ajuste). Os outros não mudam;
// a diferença vai para o livre para distribuir. Justificativa obrigatória e auditoria.
tipCommissionRouter.put("/participants/:id/gorjeta-real", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const p = await prisma.tipParticipant.findUnique({
    where: { id: request.params.id },
    select: {
      id: true, periodId: true, employeeId: true, kind: true, gorjetaReal: true, gorjetaRealMotivo: true,
      period: { select: { competenceYear: true, competenceMonth: true, periodEnd: true } },
      employee: { select: { terminationDate: true } },
    },
  });
  if (!p) return response.status(404).json({ message: "Participante não encontrado." });
  if (await barrouPorFechamento(p.periodId, response, "Mudar a gorjeta de alguém")) return;
  if (p.kind !== "PONTOS") return response.status(422).json({ message: "Cota fixa já é um valor: mude a cota na própria linha." });
  const saida = p.employee.terminationDate;
  if (saida && saida <= p.period.periodEnd) {
    return response.status(422).json({ message: "Quem saiu no período usa a gorjeta paga em \"Rescisões do período\" (ou na própria rescisão)." });
  }

  const b = request.body as { valor?: unknown; motivo?: unknown };
  const tirar = b.valor == null || b.valor === "";
  const valor = tirar ? null : Number(b.valor);
  if (valor != null && (!Number.isFinite(valor) || valor < 0 || valor > 1_000_000)) {
    return response.status(422).json({ message: "Gorjeta real inválida (use um valor entre 0 e 1.000.000)." });
  }
  const motivo = typeof b.motivo === "string" ? b.motivo.trim().slice(0, 500) : "";
  if (motivo.length < 10) return response.status(422).json({ message: "Explique por que a gorjeta real é outra (pelo menos 10 letras)." });

  await prisma.tipParticipant.update({
    where: { id: p.id },
    data: {
      gorjetaReal: valor == null ? null : Math.round(valor * 100) / 100,
      gorjetaRealMotivo: valor == null ? null : motivo,
      gorjetaRealPor: valor == null ? null : user.name,
      gorjetaRealEm: valor == null ? null : new Date(),
    },
  });
  await auditLog({
    userId: user.id, action: valor == null ? "REMOVE_TIP_GORJETA_REAL" : "SET_TIP_GORJETA_REAL", entity: "TipParticipant", entityId: p.id,
    previousValue: { gorjetaReal: p.gorjetaReal == null ? null : Number(p.gorjetaReal), motivo: p.gorjetaRealMotivo },
    newValue: { gorjetaReal: valor, motivo },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  const computation = await computeTipCommission(p.period.competenceYear, p.period.competenceMonth, { incluirDadosPessoais: await podeVerDadosPessoais(request) });
  response.json(computation);
});

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
  if ((await participantesTravadosPelaRescisao([antes.employeeId])).has(antes.id)) {
    return response.status(409).json({ message: "Esta pessoa tem a rescisão lançada com a gorjeta deste período: exclua a rescisão antes de tirá-la da apuração." });
  }
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

// Vales: em tip-vales.routes.ts (lançar, corrigir, cancelar, relatório).

// ─── Fechar o período (recalcula, persiste e trava a conferência) ───────────
tipCommissionRouter.post("/periods/:year/:month/close", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const year = parseInt(request.params.year, 10);
  const month = parseInt(request.params.month, 10);
  try {
    const result = await closeTipPeriod(year, month, { id: user.id, name: user.name });
    await auditLog({
      userId: user.id, action: "CLOSE_TIP_PERIOD", entity: "TipPeriod", entityId: result.code ?? `${year}-${month}`,
      newValue: { registro: result.fechamento?.code ?? null, ...result.totals }, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
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
    const motivo = String((request.body as { motivo?: unknown } | undefined)?.motivo ?? "");
    const result = await reopenTipPeriod(year, month, { id: user.id, name: user.name }, motivo);
    await auditLog({
      userId: user.id, action: "REOPEN_TIP_PERIOD", entity: "TipPeriod", entityId: result.code ?? `${year}-${month}`,
      newValue: { competenceYear: year, competenceMonth: month, motivo }, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
    });
    response.json(result);
  } catch (err) {
    response.status(422).json({ message: (err as Error).message });
  }
});

// ─── Tabela de funções e pontos-base ────────────────────────────────────────
// Versão da tabela de funções: muda a cada gravação. Quem edita manda a versão
// que abriu; se outra pessoa salvou no meio, o servidor recusa em vez de sobrescrever.
function funcaoParaTela(f: { id: string; name: string; points: unknown; minPoints: unknown; maxPoints: unknown; group: string | null; notes: string | null; sortOrder: number; isActive: boolean }) {
  return {
    id: f.id, name: f.name, points: Number(f.points),
    minPoints: f.minPoints == null ? null : Number(f.minPoints),
    maxPoints: f.maxPoints == null ? null : Number(f.maxPoints),
    group: f.group, notes: f.notes, sortOrder: f.sortOrder, isActive: f.isActive,
  };
}

function versaoDaTabela(funcoes: Array<{ updatedAt: Date }>): string {
  const ultima = funcoes.reduce((m, f) => Math.max(m, f.updatedAt.getTime()), 0);
  return `${funcoes.length}:${ultima}`;
}

tipCommissionRouter.get("/functions", async (_request, response) => {
  const funcoes = await prisma.tipFunction.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  response.json(funcoes.map(funcaoParaTela));
});

// Tabela para edição: as funções e a versão aberta (para não sobrescrever quem salvou antes).
tipCommissionRouter.get("/functions/table", async (_request, response) => {
  const funcoes = await prisma.tipFunction.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  response.json({ versao: versaoDaTabela(funcoes), funcoes: funcoes.map(funcaoParaTela) });
});

tipCommissionRouter.get("/functions/history", async (_request, response) => {
  const linhas = await prisma.tipFunctionHistory.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
  response.json(linhas.map((l) => ({
    id: l.id, tipFunctionId: l.tipFunctionId, name: l.name,
    pointsBefore: l.pointsBefore == null ? null : Number(l.pointsBefore), pointsAfter: Number(l.pointsAfter),
    minPoints: l.minPoints == null ? null : Number(l.minPoints), maxPoints: l.maxPoints == null ? null : Number(l.maxPoints),
    createdAt: l.createdAt.toISOString(),
  })));
});

// Grava a tabela inteira (cria as novas, atualiza as existentes). Função não se
// apaga — desativa — porque funcionários e períodos antigos apontam para ela.
tipCommissionRouter.put("/functions", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const b = request.body as Record<string, unknown>;
  const list = b.functions;
  if (!Array.isArray(list)) return response.status(400).json({ message: "functions deve ser uma lista." });

  const limpas = (list as Array<Record<string, unknown>>).map((raw, i) => ({
    id: raw.id ? String(raw.id) : null,
    name: String(raw.name ?? "").trim(),
    points: numOrNull(raw.points),
    minPoints: numOrNull(raw.minPoints),
    maxPoints: numOrNull(raw.maxPoints),
    group: raw.group ? String(raw.group).trim() : null,
    notes: raw.notes ? String(raw.notes).trim() : null,
    sortOrder: numOrNull(raw.sortOrder) ?? i + 1,
    isActive: raw.isActive !== false,
  }));
  const invalida = limpas.find((f) => !f.name || f.points == null || f.points < 0);
  if (invalida) return response.status(422).json({ message: `Função "${invalida.name || "sem nome"}": informe nome e pontos (≥ 0).` });
  const foraDaFaixa = limpas.find((f) => (f.minPoints != null && f.maxPoints != null && f.minPoints > f.maxPoints)
    || (f.minPoints != null && f.points! < f.minPoints) || (f.maxPoints != null && f.points! > f.maxPoints));
  if (foraDaFaixa) return response.status(422).json({ message: `Função "${foraDaFaixa.name}": os pontos precisam ficar entre o mínimo e o máximo.` });
  const nomes = new Set<string>();
  for (const f of limpas) {
    const k = f.name.toLocaleLowerCase("pt-BR");
    if (nomes.has(k)) return response.status(422).json({ message: `A função "${f.name}" aparece duas vezes.` });
    nomes.add(k);
  }

  const antes = await prisma.tipFunction.findMany();
  const versaoAberta = typeof b.baseVersion === "string" ? b.baseVersion : null;
  if (versaoAberta && versaoAberta !== versaoDaTabela(antes)) {
    return response.status(409).json({
      message: "A tabela de funções foi salva por outra pessoa depois que você começou a editar. Suas alterações continuam na tela: confira e salve de novo.",
    });
  }
  const antesPorId = new Map(antes.map((a) => [a.id, a]));
  const vigencia = parseDateUTC(b.validFrom) ?? hojeUTC();
  const motivo = textoOuNull((request.body as Record<string, unknown>).reason);
  await prisma.$transaction(async (tx) => {
    for (const f of limpas) {
      const dados = {
        name: f.name, points: f.points!, minPoints: f.minPoints, maxPoints: f.maxPoints,
        group: f.group, notes: f.notes, sortOrder: f.sortOrder, isActive: f.isActive,
      };
      const velha = f.id ? antesPorId.get(f.id) : undefined;
      const id = f.id ?? crypto.randomUUID();
      if (f.id) await tx.tipFunction.update({ where: { id }, data: dados });
      else await tx.tipFunction.create({ data: { id, ...dados } });
      const mudouPontos = !velha || Number(velha.points) !== f.points;
      const mudouNome = velha && velha.name !== f.name;
      const mudouFaixa = velha && (Number(velha.minPoints ?? -1) !== (f.minPoints ?? -1) || Number(velha.maxPoints ?? -1) !== (f.maxPoints ?? -1));
      if (mudouPontos || mudouNome || mudouFaixa) {
        await tx.tipFunctionHistory.create({
          data: {
            id: crypto.randomUUID(), tipFunctionId: id, name: f.name,
            pointsBefore: velha ? Number(velha.points) : null, pointsAfter: f.points!,
            minPoints: f.minPoints, maxPoints: f.maxPoints, changedById: user.id,
          },
        });
      }
      // Quem está nesta função tem a base alterada: fica no histórico dele.
      if (velha && (mudouPontos || mudouNome)) {
        const afetados = await tx.employee.findMany({ where: { tipFunctionId: id, deletedAt: null }, select: { id: true } });
        for (const a of afetados) {
          await registrarHistorico(tx, a.id, vigencia,
            user.id, motivo ?? `Tabela de funções: "${f.name}" ${mudouPontos ? `passou de ${Number(velha.points)} para ${f.points} pontos` : "mudou de nome"}`);
        }
      }
    }
  });
  await auditLog({
    userId: user.id, action: "UPDATE_TIP_FUNCTIONS", entity: "TipFunction", entityId: "tabela",
    previousValue: antes, newValue: limpas,
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.json({ ok: true });
});

// ─── Equipe da gorjeta ──────────────────────────────────────────────────────
// Só os campos da gorjeta (sem CPF, salário ou dados bancários), para quem opera
// a gorjeta não precisar da permissão de Funcionários.
tipCommissionRouter.get("/team", async (_request, response) => {
  const employees = await prisma.employee.findMany({
    where: { deletedAt: null },
    select: {
      id: true, firstName: true, lastName: true, displayName: true, isActive: true,
      sector: true, position: true, modality: true, admissionDate: true, terminationDate: true,
      companyId: true, participaGorjeta: true, tipoGorjeta: true, cotaFixaGorjeta: true,
      pontosExtra: true, pontosExtraMotivo: true, tipFunctionId: true,
    },
    orderBy: [{ isActive: "desc" }, { firstName: "asc" }, { lastName: "asc" }],
  });
  response.json(employees.map((e) => ({
    ...e,
    cotaFixaGorjeta: e.cotaFixaGorjeta == null ? null : Number(e.cotaFixaGorjeta),
    pontosExtra: e.pontosExtra == null ? null : Number(e.pontosExtra),
  })));
});

tipCommissionRouter.put("/team/:employeeId", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const b = request.body as Record<string, unknown>;
  const antes = await prisma.employee.findFirst({
    where: { id: request.params.employeeId, deletedAt: null },
    select: {
      id: true, companyId: true, participaGorjeta: true, tipoGorjeta: true, cotaFixaGorjeta: true,
      pontosExtra: true, pontosExtraMotivo: true, tipFunctionId: true,
    },
  });
  if (!antes) return response.status(404).json({ message: "Funcionário não encontrado." });

  const tipFunctionId = b.tipFunctionId ? String(b.tipFunctionId) : null;
  if (tipFunctionId && !(await prisma.tipFunction.findUnique({ where: { id: tipFunctionId } }))) {
    return response.status(422).json({ message: "Função não encontrada." });
  }
  const companyId = b.companyId ? String(b.companyId) : null;
  if (companyId && !(await prisma.company.findUnique({ where: { id: companyId } }))) {
    return response.status(422).json({ message: "Empresa não encontrada." });
  }
  // Ponto extra: soma (ou tira) dos pontos da função, sempre com justificativa.
  const extraBruto = numOrNull(b.pontosExtra);
  const extra = extraBruto == null || Math.abs(extraBruto) < 0.005 ? null : Math.round(extraBruto * 100) / 100;
  const motivoExtra = extra == null ? null : textoOuNull(b.pontosExtraMotivo);
  if (extra != null && (!motivoExtra || motivoExtra.length < 5)) {
    return response.status(422).json({ message: "Informe a justificativa do ponto extra (pelo menos 5 caracteres)." });
  }
  if (extra != null && Math.abs(extra) > 100) return response.status(422).json({ message: "Ponto extra fora do limite (±100)." });
  const pontosFuncao = tipFunctionId ? Number((await prisma.tipFunction.findUnique({ where: { id: tipFunctionId } }))?.points ?? 0) : 0;
  if (extra != null && pontosFuncao + extra < 0) {
    return response.status(422).json({ message: `O extra deixaria a pessoa com pontos negativos (função ${pontosFuncao}, extra ${extra}).` });
  }

  const tipoGorjeta = b.tipoGorjeta === "FIXO" ? "FIXO" : "PONTOS";
  const participa = Boolean(b.participaGorjeta);
  // Função, pontos e participação ficam no histórico, com a data a partir da qual valem.
  const registrar = mudouSituacao(
    { participaGorjeta: antes.participaGorjeta, tipFunctionId: antes.tipFunctionId, pontosExtra: antes.pontosExtra == null ? null : Number(antes.pontosExtra), pontosExtraMotivo: antes.pontosExtraMotivo },
    { participaGorjeta: participa, tipFunctionId, pontosExtra: extra, pontosExtraMotivo: motivoExtra },
  );
  // A justificativa do extra só explica o histórico quando foi o extra que mudou.
  const extraMudou = (antes.pontosExtra == null ? null : Number(antes.pontosExtra)) !== extra || antes.pontosExtraMotivo !== motivoExtra;
  // Tirar o extra também explica no histórico o que saiu.
  const extraRetirado = extra == null && antes.pontosExtra != null
    ? `Ponto extra retirado (era ${Number(antes.pontosExtra) > 0 ? "+" : ""}${Number(antes.pontosExtra)}: ${antes.pontosExtraMotivo ?? "sem justificativa"})`
    : null;
  const vigencia = parseDateUTC(b.validFrom) ?? hojeUTC();
  const depois = await prisma.$transaction(async (tx) => {
    const atualizado = await tx.employee.update({
    where: { id: antes.id },
    data: {
      participaGorjeta: participa,
      tipFunctionId,
      pontosExtra: extra,
      pontosExtraMotivo: motivoExtra,
      companyId,
      tipoGorjeta,
      cotaFixaGorjeta: tipoGorjeta === "FIXO" ? (numOrNull(b.cotaFixaGorjeta) ?? 0) : null,
      updatedById: user.id,
    },
    select: {
      id: true, companyId: true, participaGorjeta: true, tipoGorjeta: true, cotaFixaGorjeta: true,
      pontosExtra: true, pontosExtraMotivo: true, tipFunctionId: true,
    },
    });
    if (registrar) await registrarHistorico(tx, antes.id, vigencia, user.id, textoOuNull(b.reason) ?? (extraMudou ? motivoExtra ?? extraRetirado : null));
    return atualizado;
  });
  await auditLog({
    userId: user.id, action: "UPDATE_TIP_TEAM_MEMBER", entity: "Employee", entityId: antes.id,
    previousValue: antes, newValue: depois,
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.json({ ok: true });
});

// Empresas para agrupar o envio à contabilidade (só id e nome).
tipCommissionRouter.get("/companies", async (_request, response) => {
  const companies = await prisma.company.findMany({
    where: { isActive: true },
    select: { id: true, tradeName: true },
    orderBy: { tradeName: "asc" },
  });
  response.json(companies);
});

// ─── Histórico e relatórios ─────────────────────────────────────────────────
tipCommissionRouter.get("/team/:employeeId/history", async (request, response) => {
  response.json(await listarMudancas({ employeeId: request.params.employeeId }));
});

tipCommissionRouter.get("/reports/changes", async (request, response) => {
  const q = request.query as Record<string, unknown>;
  response.json(await listarMudancas({ de: parseDateUTC(q.de) ?? undefined, ate: parseDateUTC(q.ate) ?? undefined }));
});

// ?de=AAAA-MM&ate=AAAA-MM
tipCommissionRouter.get("/reports/evolution", async (request, response) => {
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
tipCommissionRouter.get("/reserve", async (_request, response) => {
  response.json(await extratoReserva());
});

// Ajuste manual (saldo inicial, correção). Valor positivo entra, negativo sai.
tipCommissionRouter.post("/reserve/adjustments", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const b = request.body as Record<string, unknown>;
  const amount = numOrNull(b.amount);
  const notes = textoOuNull(b.notes);
  if (amount == null || amount === 0) return response.status(422).json({ message: "Informe um valor diferente de zero." });
  if (!notes) return response.status(422).json({ message: "Descreva o ajuste (ex.: saldo inicial guardado até set/2026)." });
  const mov = await lancarAjusteReserva(amount, parseDateUTC(b.date) ?? hojeUTC(), notes, user.id);
  await auditLog({
    userId: user.id, action: "TIP_RESERVE_ADJUSTMENT", entity: "TipReserveMovement", entityId: mov.id,
    newValue: { amount, notes }, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.status(201).json({ ok: true });
});

tipCommissionRouter.delete("/reserve/adjustments/:id", async (request, response) => {
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
tipCommissionRouter.post("/reserve/distribute", async (request, response) => {
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
tipCommissionRouter.get("/closings", async (request, response) => {
  const ano = Number((request.query as Record<string, unknown>).ano) || undefined;
  response.json(await listarFechamentos(ano));
});

tipCommissionRouter.get("/closings/:id", async (request, response) => {
  const detalhe = await detalheFechamento(request.params.id);
  if (!detalhe) return response.status(404).json({ message: "Registro de fechamento não encontrado." });
  if (await podeVerDadosPessoais(request)) return response.json(detalhe);
  // Sem a permissão de Funcionários: some o que mistura salário (proporcional e total a pagar).
  const participants = (detalhe.participants as Array<Record<string, unknown>>).map(
    ({ salarioProporcional: _s, totalAPagar: _t, diasSalario: _d, ...resto }) => resto,
  );
  response.json({ ...detalhe, participants, salariosOcultos: true });
});

// ─── Recibo da rescisão (TRCT) que volta da contabilidade ───────────────────
// Lê o PDF, casa com o funcionário pelo CPF (sem gravar o CPF) e, com aplicar=true,
// grava a gorjeta paga como valor quitado da rescisão no período da saída.
tipCommissionRouter.post("/periods/:year/:month/rescisao-recibo", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const year = parseInt(request.params.year, 10);
  const month = parseInt(request.params.month, 10);
  const b = request.body as { fileBase64?: unknown; fileName?: unknown; aplicar?: unknown };
  if (typeof b.fileBase64 !== "string" || !b.fileBase64) return response.status(400).json({ message: "Envie o PDF da rescisão." });
  const arquivo = String(b.fileName ?? "rescisao.pdf").replace(/[^\p{L}\p{N}.\-() _]/gu, "_").slice(0, 120);

  const pdf = Buffer.from(b.fileBase64.replace(/^data:[^,]*,/, ""), "base64");
  if (pdf.length > 5 * 1024 * 1024) return response.status(413).json({ message: "Arquivo grande demais para um termo de rescisão (máximo 5 MB)." });
  let lido;
  try {
    lido = await lerPdfRescisao(pdf);
  } catch (err) {
    return response.status(422).json({ message: "Não foi possível ler o PDF da rescisão. " + (err as Error).message });
  }
  const { recibo, hash } = lido;
  if (!recibo.cpfDigitos) return response.status(422).json({ message: "Não achei o CPF no termo de rescisão para saber de quem é." });
  const candidatos = await prisma.employee.findMany({
    where: { deletedAt: null },
    select: { id: true, cpf: true, firstName: true, lastName: true, displayName: true, admissionDate: true, terminationDate: true },
  });
  // Casa pelo CPF; se não achar, pelo nome completo (único) — e avisa, para o cadastro ser conferido.
  const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  let emp = candidatos.find((e) => (e.cpf ?? "").replace(/\D/g, "") === recibo.cpfDigitos);
  let casadoPeloNome = false;
  if (!emp && recibo.nome) {
    const nomeTermo = semAcento(recibo.nome);
    const mesmos = candidatos.filter((e) => semAcento(`${e.firstName} ${e.lastName}`) === nomeTermo);
    if (mesmos.length === 1) { emp = mesmos[0]; casadoPeloNome = true; }
  }
  if (!emp) {
    return response.status(422).json({ message: `Não achei no cadastro de funcionários de quem é o termo (${recibo.nome ?? "nome não lido"}): nem pelo CPF, nem pelo nome completo.` });
  }
  const nome = (emp.displayName || `${emp.firstName} ${emp.lastName}`).trim();

  const periodo = await prisma.tipPeriod.findUnique({ where: { competenceYear_competenceMonth: { competenceYear: year, competenceMonth: month } } });
  if (!periodo) return response.status(404).json({ message: "Período não encontrado." });
  const participante = await prisma.tipParticipant.findUnique({ where: { periodId_employeeId: { periodId: periodo.id, employeeId: emp.id } } });

  const dia = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const br = (isoDia: string | null) => (isoDia ? isoDia.split("-").reverse().join("/") : "vazia");
  const divergencias: string[] = [];
  if (casadoPeloNome) divergencias.push("O CPF do termo é diferente do CPF no cadastro: reconhecido pelo nome completo. Confira o cadastro.");
  if (recibo.gorjeta == null) divergencias.push("O termo não tem a rubrica de gorjeta.");
  if (recibo.afastamento && dia(emp.terminationDate) !== recibo.afastamento) {
    divergencias.push(`Saída no cadastro: ${br(dia(emp.terminationDate))} × termo: ${br(recibo.afastamento)}.`);
  }
  if (recibo.admissao && dia(emp.admissionDate) !== recibo.admissao) {
    divergencias.push(`Admissão no cadastro: ${br(dia(emp.admissionDate))} × termo: ${br(recibo.admissao)}.`);
  }
  if (recibo.afastamento && (recibo.afastamento < dia(periodo.periodStart)! || recibo.afastamento > dia(periodo.periodEnd)!)) {
    divergencias.push(`A saída (${br(recibo.afastamento)}) não cai neste período (${periodo.label}).`);
  }
  if (!participante) divergencias.push(`${nome} não está na apuração deste período.`);
  if (participante?.rescisaoValorFixo != null && recibo.gorjeta != null && Number(participante.rescisaoValorFixo) !== recibo.gorjeta) {
    divergencias.push(`Valor quitado digitado antes: ${Number(participante.rescisaoValorFixo).toFixed(2)} (será trocado pelo do termo).`);
  }

  const previa = {
    employeeId: emp.id, nome, arquivo, hash,
    gorjeta: recibo.gorjeta, liquido: recibo.liquido,
    admissao: recibo.admissao, afastamento: recibo.afastamento, pagamento: recibo.pagamento,
    divergencias,
  };
  if (b.aplicar !== true) return response.json({ previa, aplicado: false });

  if (!participante || recibo.gorjeta == null) {
    return response.status(422).json({ message: participante ? "O termo não tem a rubrica de gorjeta." : `${nome} não está na apuração deste período.` });
  }
  if (await barrouPorFechamento(periodo.id, response, "Lançar o recibo da rescisão")) return;
  if ((await participantesTravadosPelaRescisao([participante.employeeId])).has(participante.id)) {
    return response.status(409).json({ message: "A gorjeta paga desta pessoa veio da rescisão lançada: ajuste pela rescisão (Funcionários → Lançar rescisão)." });
  }
  const gravado = {
    fonte: "TRCT", arquivo, hash, gorjeta: recibo.gorjeta, liquido: recibo.liquido,
    admissao: recibo.admissao, afastamento: recibo.afastamento, pagamento: recibo.pagamento,
    importadoEm: new Date().toISOString(), importadoPor: user.name,
  };
  await prisma.tipParticipant.update({
    where: { id: participante.id },
    data: { rescisaoValorFixo: recibo.gorjeta, rescisaoRecibo: gravado },
  });
  await auditLog({
    userId: user.id, action: "TIP_RESCISAO_RECIBO", entity: "TipParticipant", entityId: participante.id,
    previousValue: { rescisaoValorFixo: participante.rescisaoValorFixo == null ? null : Number(participante.rescisaoValorFixo) },
    newValue: { employeeId: emp.id, ...gravado },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  const computation = await computeTipCommission(year, month, { incluirDadosPessoais: await podeVerDadosPessoais(request) });
  response.json({ previa, aplicado: true, computation });
});
