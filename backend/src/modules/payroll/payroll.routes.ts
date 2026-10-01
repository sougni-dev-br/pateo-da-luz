import crypto from "node:crypto";
import { assertPeriodWritableForDate } from "../cmv-real/cmv-real.service.js";
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp, type SessionUser } from "../security/security-utils.js";
import { userHasPermission } from "../security/menu-permissions.js";
import { FERIAS_CATEGORY, PAYROLL_KINDS, RESCISAO_CATEGORY, computePayroll, computeStatus, generatePayroll, getOrDefaultSettings, type PayrollKind, type PayrollOverride } from "./payroll.service.js";
import {
  JUSTIFICATIVA_MINIMA, apurarRescisao, divergenciasDoApurado, localizarGorjetaNaApuracao, semDadosPessoais,
  type GorjetaNaApuracao, type ValoresRescisao,
} from "./rescisao-apuracao.js";
import { podeVerDadosPessoais } from "./dados-pessoais.js";
import { round2 } from "./vt-calc.js";
import { duplicadosDe, pagamentosEmDuplicidade, resumoItem, rotuloLivre, rotuloTipo, competenciaDe } from "./folha-duplicidade.js";
import { CAMPOS_TRAVA, dataBr, folhaLancamentoRouter, nomeDe } from "./folha-lancamento.routes.js";
import { RecusaRescisao, travarRescisao } from "./rescisao-trava.js";
import {
  type VerbaMarcada, algumaMarcada, aplicarVerbasOpcionais, calculoCompleto, lerEscolhaVerbas,
} from "./rescisao-verbas-opcionais.js";
import { ehQuitadaNoTermo, ehQuitadaSemValor, ehRescisaoQuitada } from "./rescisao-quitada.js";

export const payrollRouter = Router();
// Lançamento manual (POST /) e conferência do lote antes da baixa (POST /pay-check).
payrollRouter.use(folhaLancamentoRouter);

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

// Inteiro dentro de uma faixa, ou undefined (= não mexe no campo).
function clampInt(v: unknown, min: number, max: number): number | undefined {
  const n = numOrNull(v);
  if (n == null) return undefined;
  return Math.min(Math.max(Math.round(n), min), max);
}

// Rescisão na lista de Contas a Pagar, sem a permissão de ver Funcionários: o details
// guarda salário, apuração e histórico de ajustes. Sai só o que a lista usa (lista
// branca). Os outros tipos ficam como estão.
const DETALHES_RESCISAO_NA_LISTA = ["grupoRescisao", "installmentNumber", "installmentTotal", "valesLabel", "otherDiscountLabel", "quitadaNoTermo", "quitadaSemValor", "saldoDevedorPerdoado"] as const;
export function detalhesNaLista(type: string, details: unknown, podeVer: boolean): unknown {
  if (podeVer || type !== "RESCISAO" || details == null || typeof details !== "object") return details;
  const d = details as Record<string, unknown>;
  return Object.fromEntries(DETALHES_RESCISAO_NA_LISTA.filter((k) => d[k] !== undefined).map((k) => [k, d[k]]));
}

export { RecusaRescisao } from "./rescisao-trava.js";

const MSG_SEM_PERMISSAO_GORJETA = "Para lançar a gorjeta na apuração é preciso permissão de edição na Gorjeta.";
const podeEditarGorjeta = (user: { id: string; role: string }) => userHasPermission(user as SessionUser, "payroll-tips", "edit");

// A gorjeta da rescisão mudaria a apuração do mês? Mesmo valor já gravado não muda nada.
export function gorjetaMudaApuracao(alvo: { anterior: number | null } | null, gorjeta: number | null): boolean {
  if (!alvo || gorjeta == null) return false;
  return alvo.anterior == null || Math.abs(round2(alvo.anterior) - round2(gorjeta)) >= 0.01;
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
      // Corte da quinzena: 2 a 28 mantém os dois períodos com pelo menos um dia
      // em qualquer mês. Fora disso a 1ª ou a 2ª quinzena nasceria vazia.
      vtSecondPeriodStartDay: clampInt(b.vtSecondPeriodStartDay, 2, 28),
      // 1 a 12 semanas: abaixo de 1 nao faz sentido e acima de 12 deixaria de ser
      // "periodicidade" para virar nunca.
      dsrDomingoMulherSemanas: clampInt(b.dsrDomingoMulherSemanas, 1, 12),
      dsrDomingoGeralSemanas: clampInt(b.dsrDomingoGeralSemanas, 1, 12),
      advancePercent: numOrNull(b.advancePercent) ?? undefined,
      advanceDueDay: numOrNull(b.advanceDueDay) ?? undefined,
      salaryDueDay: numOrNull(b.salaryDueDay) ?? undefined,
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

  const podeVer = await podeVerDadosPessoais(request);
  const items = rows.map((r) => ({
    ...r,
    details: detalhesNaLista(r.type, r.details, podeVer),
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
  const already = await prisma.payrollItem.findFirst({ where: { employeeId: emp.id, type: "RESCISAO", deletedAt: null, status: { not: "CANCELED" } } });
  const podeVer = await podeVerDadosPessoais(request);
  const apuracao = await apurarRescisao(emp.id);

  response.json({
    employee: { id: emp.id, name: `${emp.firstName} ${emp.lastName}`.trim(), terminationDate: emp.terminationDate, terminationReason: emp.terminationReason },
    vtItems: vtItems.map((i) => ({ id: i.id, periodLabel: i.periodLabel, competenceYear: i.competenceYear, competenceMonth: i.competenceMonth, amount: i.amount, status: i.paymentDate ? "PAID" : "PENDING", dueDate: i.dueDate })),
    alreadyReleased: Boolean(already),
    rescisaoId: already?.id ?? null,
    apuracao: podeVer ? apuracao : semDadosPessoais(apuracao),
    lancada: lancadaVisivel(await rescisaoLancada(emp.id), podeVer),
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
// A folha ja travava a geracao do mes e a baixa, mas nao a rescisao, as ferias e a
// restauracao de lancamento excluido — as tres criam ou ressuscitam verba numa
// competencia, que e como o DRE posiciona folha. Auxiliar comum para as tres.
async function competenciaDeFolhaBloqueada(
  competence: Date,
  contexto: string,
  response: { status: (c: number) => { json: (b: unknown) => void } }
) {
  if (Number.isNaN(competence.getTime())) return false;
  try {
    await assertPeriodWritableForDate(competence, contexto);
    return false;
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Periodo fechado." });
    return true;
  }
}

payrollRouter.post("/termination/:employeeId", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const emp = await prisma.employee.findFirst({ where: { id: request.params.employeeId, deletedAt: null } });
  if (!emp) return response.status(404).json({ message: "Funcionário não encontrado." });

  const existing = await prisma.payrollItem.findFirst({ where: { employeeId: emp.id, type: "RESCISAO", deletedAt: null, status: { not: "CANCELED" } } });
  if (existing) return response.status(400).json({ message: "Rescisão já lançada para este funcionário." });

  const competenciaRescisao = emp.terminationDate ? new Date(emp.terminationDate) : new Date();
  if (await competenciaDeFolhaBloqueada(competenciaRescisao, "Lancamento de rescisao", response)) return;

  const b = request.body as Record<string, unknown>;
  // O que o sistema apurou na hora de lançar fica junto, para comparar com o que foi digitado.
  const apurado = await apurarOuResponder(emp.id, response);
  if (!apurado) return;
  const { apuracao } = apurado;
  // Vínculo vigente na saída (a apuração já leu o histórico do cadastro).
  const semRegistroNaSaida = apuracao?.semRegistro ?? emp.modality === "NAO_CLT";
  // Férias, 13º, aviso e valor livre: só o que foi marcado, recalculado aqui.
  const vo = verbasDoCorpo(b, semRegistroNaSaida, apuracao);
  if ("erro" in vo) return response.status(400).json({ message: vo.erro });
  const verbas = vo.verbas ?? null;
  const lido = lerValoresRescisao(b, semRegistroNaSaida, apuracao?.sugestao.creditos ?? 0, verbas?.total ?? 0);
  if ("erro" in lido) return response.status(400).json({ message: lido.erro });
  const { gross, vtDiscount, otherDiscount, net, saldoDevedorPerdoado } = lido;

  const firstDue = b.dueDate ? new Date(String(b.dueDate)) : new Date();
  const term = emp.terminationDate ? new Date(emp.terminationDate) : new Date();
  const dre = await prisma.dRECategory.findFirst({ where: { name: RESCISAO_CATEGORY } });

  // Líquido zero (ou negativo, já perdoado): nada a pagar. Vira um R$ 0,00 já pago na
  // saída, fora do Contas a Pagar — senão ficaria um título que a baixa (valor > 0) nunca
  // aceita e a rescisão nunca concluiria.
  const quitadaSemValor = net === 0;
  const pagamentoQuitada = emp.terminationDate ? new Date(emp.terminationDate) : firstDue;
  if (quitadaSemValor && await competenciaDeFolhaBloqueada(pagamentoQuitada, "Rescisao quitada sem valor", response)) return;

  // Parcelamento (acordo/art. 484-A): 1 = título único; N = N títulos mensais em Contas a
  // Pagar. Só parcela quando há líquido positivo a dividir.
  const requested = Math.trunc(numOrNull(b.installments) ?? 1);
  const n = net > 0 ? Math.max(1, Math.min(requested, 12)) : 1;
  // Mudou algum valor apurado: exige a justificativa e grava o antes e o depois.
  const divergencias = divergenciasDoApurado(apuracao?.sugestao ?? null, lido.componentes);
  const justificativa = typeof b.ajusteJustificativa === "string" ? b.ajusteJustificativa.trim().slice(0, 1000) : "";
  if (divergencias.length > 0 && justificativa.length < JUSTIFICATIVA_MINIMA) {
    return response.status(400).json({
      message: `Você mudou ${divergencias.map((d) => d.rotulo.toLowerCase()).join(", ")} em relação ao apurado pelo sistema. Explique o ajuste (pelo menos ${JUSTIFICATIVA_MINIMA} letras).`,
    });
  }
  // A gorjeta lançada aqui passa a ser a gorjeta paga na apuração do mês (sem registro).
  // Saída depois do ciclo, no mês do salário: só a parte dos dias depois do ciclo.
  const loc = await localizarGorjetaNaApuracao(emp.id, emp.terminationDate, lido.componentes.gorjeta, apuracao);
  if ("erro" in loc) return response.status(400).json({ message: loc.erro });
  const gorjetaNaApuracao: GorjetaNaApuracao | null = loc.alvo;
  // Gravar a gorjeta paga na apuração é editar a Gorjeta: exige a permissão de lá.
  const mudaGorjeta = gorjetaMudaApuracao(loc.alvo, loc.alvo?.aplicada ?? null);
  if (mudaGorjeta && !(await podeEditarGorjeta(user))) {
    return response.status(403).json({ message: MSG_SEM_PERMISSAO_GORJETA });
  }
  // Todas as parcelas levam o mesmo grupo e o vínculo com a gorjeta: excluir uma parcela
  // isolada não pode soltar a gorjeta enquanto as outras seguem valendo.
  const grupoRescisao = crypto.randomUUID();
  const baseDetails = {
    grupoRescisao,
    grossAmount: gross, vtDiscount, otherDiscount, otherDiscountLabel: textoLimitado(b.otherDiscountLabel, 300),
    gorjetaNaApuracao,
    salario: lido.componentes.salario, gorjeta: lido.componentes.gorjeta, creditos: lido.creditos,
    valesDiscount: lido.componentes.vales, valesLabel: textoLimitado(b.valesLabel, 300),
    apuracaoSistema: apuracao ? JSON.parse(JSON.stringify(apuracao)) : null,
    ajusteManual: divergencias.length > 0
      ? { divergencias, justificativa, porUserId: user.id, porNome: user.name ?? null, em: new Date().toISOString() }
      : null,
    ...(quitadaSemValor ? { quitadaSemValor: true, saldoDevedorPerdoado } : {}),
    // Verbas opcionais marcadas (decisão da empresa) e quem marcou.
    ...(verbas ? { verbasOpcionais: verbas, verbasOpcionaisPor: { userId: user.id, nome: user.name ?? null, em: new Date().toISOString() } } : {}),
  };
  const parcelas = splitCents(Math.round(net * 100), n).map((cents, i) => ({
    id: crypto.randomUUID(),
    number: i + 1,
    amount: round2(cents / 100),
    due: quitadaSemValor ? pagamentoQuitada : addMonthsUTC(firstDue, i),
  }));
  const dadosParcelas: Prisma.PayrollItemUncheckedCreateInput[] = parcelas.map((p) => ({
    id: p.id,
    employeeId: emp.id,
    type: "RESCISAO",
    competenceYear: term.getUTCFullYear(),
    competenceMonth: term.getUTCMonth() + 1,
    periodLabel: quitadaSemValor ? "Rescisão (quitada)" : n > 1 ? `Parcela ${p.number}/${n}` : "Rescisão",
    dueDate: p.due,
    amount: p.amount,
    status: quitadaSemValor ? "PAID" : computeStatus(p.due, null),
    ...(quitadaSemValor ? { paymentDate: pagamentoQuitada, paidAmount: 0 } : {}),
    dreCategoryId: dre?.id ?? null,
    source: "MANUAL",
    notes: textoLimitado(b.notes, 1000),
    // A 1ª parcela carrega o detalhamento (bruto/descontos); todas guardam o índice.
    details: n > 1
      ? { ...(p.number === 1 ? baseDetails : { grupoRescisao, gorjetaNaApuracao }), installmentNumber: p.number, installmentTotal: n, netTotal: net }
      : baseDetails,
    createdById: user.id,
  }));

  // Dois lançamentos ao mesmo tempo passariam os dois pela checagem de cima e criariam
  // duas rescisões: com a trava do funcionário, a segunda reconfere e recusa.
  try {
    await prisma.$transaction(async (tx) => {
      await travarRescisao(tx, emp.id);
      const viva = await tx.payrollItem.findFirst({
        where: { employeeId: emp.id, type: "RESCISAO", deletedAt: null, status: { not: "CANCELED" } }, select: { id: true },
      });
      if (viva) throw new RecusaRescisao(400, "Rescisão já lançada para este funcionário.");
      for (const data of dadosParcelas) await tx.payrollItem.create({ data });
      if (gorjetaNaApuracao && mudaGorjeta) {
        await tx.tipParticipant.update({
          where: { id: gorjetaNaApuracao.participantId },
          data: { rescisaoValorFixo: gorjetaNaApuracao.aplicada, rescisaoRecibo: Prisma.DbNull },
        });
      }
    });
  } catch (err) {
    if (err instanceof RecusaRescisao) return response.status(err.status).json({ message: err.message });
    throw err;
  }

  await auditLog({
    userId: user.id, action: "RELEASE_TERMINATION", entity: "PayrollItem", entityId: parcelas[0].id,
    newValue: {
      employeeId: emp.id, gross, vtDiscount, otherDiscount, net, installments: n, dueDates: parcelas.map((p) => p.due.toISOString().slice(0, 10)),
      ...(divergencias.length > 0 ? { ajusteManual: { divergencias, justificativa } } : {}),
      ...(quitadaSemValor ? { quitadaSemValor: true, saldoDevedorPerdoado } : {}),
      ...(verbas ? { verbasOpcionais: verbas } : {}),
    },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });

  response.status(201).json({
    id: parcelas[0].id,
    amount: net,
    installments: n,
    quitadaSemValor,
    saldoDevedorPerdoado,
    items: parcelas.map((p) => ({ id: p.id, amount: p.amount, dueDate: p.due.toISOString(), installmentNumber: p.number })),
  });
});

// Lê o que foi digitado na rescisão. Sem registro: salário + gorjeta (+ créditos da aba
// Vales) formam o bruto, e os vales descontam. CLT: bruto da contabilidade; vales já
// saíram da gorjeta enviada, então não descontam aqui. Sem salário/gorjeta no corpo
// (tela antiga), vale o bruto digitado.
const VALOR_MAXIMO_RESCISAO = 1_000_000;
// Texto livre que vai para o JSON da rescisão: só string, com tamanho limitado.
export function textoLimitado(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null;
}

// verbasOpcionais: o total das verbas opcionais marcadas (já recalculado no servidor), só
// para sem registro — soma no bruto antes de comparar com os descontos.
export function lerValoresRescisao(b: Record<string, unknown>, semRegistro: boolean, creditosApurados: number, verbasOpcionais = 0):
  | { erro: string }
  | { gross: number; vtDiscount: number; otherDiscount: number; net: number; saldoDevedorPerdoado: number; creditos: number; componentes: ValoresRescisao } {
  // Número de verdade, finito e dentro do razoável; ausente = null.
  let invalido = false;
  const valor = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > VALOR_MAXIMO_RESCISAO) { invalido = true; return null; }
    return round2(n);
  };
  const salario = semRegistro ? valor(b.salario) : null;
  const gorjeta = semRegistro ? valor(b.gorjeta) : null;
  const vales = semRegistro ? valor(b.valesDiscount) ?? 0 : 0;
  const vtDiscount = valor(b.vtDiscount) ?? 0;
  const otherDiscount = valor(b.otherDiscount) ?? 0;
  const brutoInformado = semRegistro ? null : valor(b.grossAmount);
  if (invalido) return { erro: "Valores da rescisão precisam ser números entre 0 e 1.000.000." };
  // Sem registro: o bruto é sempre salário + gorjeta. Aceitar um bruto avulso deixaria
  // lançar sem passar pela comparação com o apurado (e sem justificativa).
  if (semRegistro && (salario == null || gorjeta == null)) return { erro: "Informe o salário proporcional e a gorjeta da rescisão." };
  const creditos = semRegistro ? round2(creditosApurados) : 0;
  const gross = semRegistro ? round2((salario ?? 0) + (gorjeta ?? 0) + creditos + round2(verbasOpcionais)) : brutoInformado ?? 0;
  if (gross <= 0 && vtDiscount + vales + otherDiscount <= 0) {
    return { erro: "Bruto e descontos estão zerados: não há rescisão a lançar." };
  }
  // Descontos que passam do bruto: o saldo devedor é perdoado (regra do Eli, 01/10/2026)
  // e a rescisão fica quitada com líquido zero — nunca vira cobrança da pessoa.
  const liquidoBruto = round2(gross - vtDiscount - vales - otherDiscount);
  const saldoDevedorPerdoado = Math.max(0, round2(-liquidoBruto));
  const net = Math.max(0, liquidoBruto);
  return {
    gross, vtDiscount, otherDiscount, net, saldoDevedorPerdoado, creditos,
    componentes: { salario, gorjeta, vales, vtDesconto: vtDiscount },
  };
}

export type VerbasGravadas = { itens: VerbaMarcada[]; total: number };

// O que o corpo marcou nas verbas opcionais, recalculado com a apuração do servidor (o
// valor vindo da tela não vale para férias, 13º e aviso). verbas: undefined = o corpo não
// mandou (o ajuste mantém as gravadas); null = nada marcado. CLT: recusa o que vier marcado.
export function verbasDoCorpo(
  b: Record<string, unknown>, semRegistro: boolean,
  apuracao: { verbasOpcionais?: { calculo: Parameters<typeof calculoCompleto>[0] } | null } | null,
): { erro: string } | { verbas: VerbasGravadas | null | undefined } {
  if (b.verbasOpcionais === undefined) return { verbas: undefined };
  const lida = lerEscolhaVerbas(b.verbasOpcionais);
  if ("erro" in lida) return lida;
  if (!algumaMarcada(lida.escolha)) return { verbas: null };
  if (!semRegistro) {
    return { erro: "Férias, 13º, aviso prévio e valor livre são verbas opcionais só para quem não tem registro: na CLT elas vêm no termo da contabilidade." };
  }
  const r = aplicarVerbasOpcionais(calculoCompleto(apuracao?.verbasOpcionais?.calculo), lida.escolha);
  return "erro" in r ? r : { verbas: r };
}

// "AVISO:2200:|LIVRE:100:Acordo": para saber se a escolha mudou no ajuste.
const assinaturaVerbas = (v: VerbasGravadas | null | undefined) =>
  (v?.itens ?? []).map((i) => `${i.tipo}:${round2(i.valor)}:${i.descricao ?? ""}`).join("|");

type Tx = Prisma.TransactionClient;
const gorjetaDe = (details: unknown) =>
  (details as { gorjetaNaApuracao?: GorjetaNaApuracao | null } | null)?.gorjetaNaApuracao ?? null;

// O vínculo com a apuração que vale para esta rescisão: o da própria parcela ou, nas
// lançadas antes de ele ir para todas as parcelas, o da parcela 1 (mesmo excluída).
async function vinculoGorjeta(tx: Tx, employeeId: string, details: unknown): Promise<GorjetaNaApuracao | null> {
  const proprio = gorjetaDe(details);
  if (proprio) return proprio;
  const irmas = await tx.payrollItem.findMany({
    where: { employeeId, type: "RESCISAO" }, orderBy: { createdAt: "desc" }, select: { details: true },
  });
  return irmas.map((i) => gorjetaDe(i.details)).find((g) => g != null) ?? null;
}

// Excluída a última parcela, a gorjeta da apuração volta ao que era antes — só se o mês
// da gorjeta segue aberto e ninguém trocou o valor depois.
// Sem permissão de editar a Gorjeta: recusa se houver o que desfazer.
async function desfazerGorjetaDaRescisao(tx: Tx, employeeId: string, details: unknown, podeEditar: boolean) {
  const g = await vinculoGorjeta(tx, employeeId, details);
  if (!g) return null;
  const where = { id: g.participantId, rescisaoValorFixo: g.aplicada, period: { status: { not: "CLOSED" as const } } };
  if (!podeEditar) {
    if (await tx.tipParticipant.count({ where }) > 0) {
      throw new RecusaRescisao(403, "Excluir esta rescisão desfaz a gorjeta lançada na apuração: é preciso permissão de edição na Gorjeta.");
    }
    return null;
  }
  const r = await tx.tipParticipant.updateMany({ where, data: { rescisaoValorFixo: g.anterior } });
  return r.count > 0 ? { participantId: g.participantId, voltouPara: g.anterior } : null;
}

type RescisaoExcluida = { employeeId: string; details: unknown; createdAt: Date };

// Rescisão: só volta se não houver OUTRA rescisão viva (lançada depois da exclusão) —
// senão ficariam duas, e a gorjeta da antiga passaria por cima da nova.
async function recusarSeOutraRescisaoViva(tx: Tx, existing: RescisaoExcluida) {
  const vivas = await tx.payrollItem.findMany({
    where: { employeeId: existing.employeeId, type: "RESCISAO", deletedAt: null, status: { not: "CANCELED" } },
    select: { details: true, createdAt: true },
  });
  const grupo = (existing.details as { grupoRescisao?: string } | null)?.grupoRescisao;
  const mesmaRescisao = (v: { details: unknown; createdAt: Date }) => grupo
    ? (v.details as { grupoRescisao?: string } | null)?.grupoRescisao === grupo
    : Math.abs(v.createdAt.getTime() - existing.createdAt.getTime()) < 5000;
  if (vivas.some((v) => !mesmaRescisao(v))) {
    throw new RecusaRescisao(409, "Já existe outra rescisão lançada para este funcionário. Exclua a atual antes de restaurar esta.");
  }
}

// Rescisão restaurada: a gorjeta dela volta a valer na apuração — se o mês ainda está
// aberto e ninguém gravou outro valor depois da exclusão.
async function refazerGorjetaDaRescisao(tx: Tx, existing: RescisaoExcluida, podeEditar: boolean) {
  const g = await vinculoGorjeta(tx, existing.employeeId, existing.details);
  if (!g) return null;
  const aberto = { id: g.participantId, period: { status: { not: "CLOSED" as const } } };
  if (!podeEditar) {
    // Já com o valor da rescisão (ou mês fechado): restaurar não muda a apuração.
    const mudaria = g.anterior !== g.aplicada && await tx.tipParticipant.count({ where: { ...aberto, rescisaoValorFixo: g.anterior } }) > 0;
    if (mudaria) {
      throw new RecusaRescisao(403, "Restaurar esta rescisão relança a gorjeta na apuração: é preciso permissão de edição na Gorjeta.");
    }
    return null;
  }
  const r = await tx.tipParticipant.updateMany({
    where: { ...aberto, OR: [{ rescisaoValorFixo: g.anterior }, ...(g.anterior == null ? [] : [{ rescisaoValorFixo: g.aplicada }])] },
    data: { rescisaoValorFixo: g.aplicada, rescisaoRecibo: Prisma.DbNull },
  });
  return r.count > 0 ? { participantId: g.participantId, valor: g.aplicada } : { conflito: "gorjeta paga mudou depois da exclusão; não sobrescrevi" };
}

// Apuração obrigatória para lançar/ajustar: se ela falhar, não dá para comparar com o
// lançado nem exigir justificativa — então não lança (antes caía em silêncio para null).
async function apurarOuResponder(employeeId: string, response: { status: (c: number) => { json: (b: unknown) => void } }) {
  try {
    return { apuracao: await apurarRescisao(employeeId) };
  } catch (err) {
    console.error("[rescisao] apuração falhou", err);
    response.status(500).json({ message: "Não consegui apurar a rescisão agora (gorjeta/VT). Tente de novo em instantes." });
    return null;
  }
}

// Sem a permissão de ver Funcionários, a rescisão lançada sai sem o salário.
type Lancada = NonNullable<Awaited<ReturnType<typeof rescisaoLancada>>>;
export function lancadaVisivel(l: Lancada | null, podeVer: boolean): Lancada | null {
  if (!l || podeVer) return l;
  const semSalario = <T extends { salario?: number | null }>(v: T) => ({ ...v, salario: null, verbasOpcionaisTotal: null });
  const ajuste = l.ajusteManual as { divergencias?: Array<{ campo?: string }> } | null;
  return {
    ...l,
    salario: null,
    // Férias, 13º e aviso revelam o salário: valor, memória e total saem; o valor livre fica.
    verbasOpcionais: l.verbasOpcionais ? {
      ...l.verbasOpcionais, total: null,
      itens: l.verbasOpcionais.itens.map((i) => (i.tipo === "LIVRE" ? i : { ...i, valor: null, memoria: "valor oculto: exige a permissão de ver Funcionários" })),
    } : null,
    ajusteManual: ajuste ? { ...ajuste, divergencias: (ajuste.divergencias ?? []).filter((d) => d.campo !== "salario") } : null,
    // divergenciasDoApurado traz o salário apurado e o lançado: sai inteiro (a tela não o usa).
    historicoAjustes: l.historicoAjustes.map((h) => {
      const { divergenciasDoApurado: _fora, ...resto } = h as AjusteRescisao & { divergenciasDoApurado?: unknown };
      return { ...resto, antes: semSalario(h.antes), depois: semSalario(h.depois) };
    }),
  };
}

// A rescisão lançada, somada das parcelas, com o histórico de ajustes (na 1ª parcela).
type AjusteRescisao = {
  em: string; porUserId: string; porNome: string | null; justificativa: string;
  antes: ValoresLancados;
  depois: ValoresLancados;
};
type ValoresLancados = {
  bruto: number; salario: number | null; gorjeta: number | null; vales: number;
  vtDesconto: number; outroDesconto: number; liquido: number;
  // Total das verbas opcionais (ausente nos ajustes gravados antes delas).
  verbasOpcionaisTotal?: number | null;
};

// Algum valor da rescisão mudou (centavo a centavo)?
export function valoresMudaram(antes: ValoresLancados, depois: ValoresLancados): boolean {
  const campos: Array<keyof ValoresLancados> = ["bruto", "salario", "gorjeta", "vales", "vtDesconto", "outroDesconto", "liquido", "verbasOpcionaisTotal"];
  return campos.some((c) => Math.round(Math.abs((antes[c] ?? 0) - (depois[c] ?? 0)) * 100) >= 1);
}
// As verbas opcionais gravadas na rescisão e quem marcou. valor/total null = oculto.
type VerbasLancadas = {
  itens: Array<Omit<VerbaMarcada, "valor" | "memoria"> & { valor: number | null; memoria: string | null }>;
  total: number | null;
  por: { userId: string; nome: string | null; em: string } | null;
};
function verbasLancadas(d: Record<string, unknown>): VerbasLancadas | null {
  const v = d.verbasOpcionais as VerbasGravadas | null | undefined;
  if (!v || !Array.isArray(v.itens) || v.itens.length === 0) return null;
  return { itens: v.itens, total: v.total, por: (d.verbasOpcionaisPor as VerbasLancadas["por"]) ?? null };
}

async function rescisaoLancada(employeeId: string) {
  const itens = await prisma.payrollItem.findMany({
    where: { employeeId, type: "RESCISAO", deletedAt: null, status: { not: "CANCELED" } },
    orderBy: { dueDate: "asc" },
  });
  if (itens.length === 0) return null;
  const d = (itens[0].details ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;
  const ouNulo = (v: unknown) => (v == null ? null : n(v));
  return {
    bruto: n(d.grossAmount), vtDesconto: n(d.vtDiscount), outroDesconto: n(d.otherDiscount),
    // Lançadas antes da separação não têm salário/gorjeta: ficam null.
    salario: ouNulo(d.salario), gorjeta: ouNulo(d.gorjeta), vales: n(d.valesDiscount),
    valesRotulo: (d.valesLabel as string | null) ?? null,
    outroDescontoRotulo: (d.otherDiscountLabel as string | null) ?? null,
    liquido: round2(itens.reduce((a, i) => a + Number(i.amount), 0)),
    parcelas: itens.map((i) => ({ id: i.id, rotulo: i.periodLabel, valor: Number(i.amount), vencimento: i.dueDate.toISOString(), paga: i.paymentDate != null })),
    algumaPaga: itens.some((i) => i.paymentDate != null),
    // Quitada sem valor (líquido zero ou saldo devedor perdoado): nada a pagar nem a estornar.
    quitadaSemValor: ehQuitadaSemValor(d) ? { saldoDevedorPerdoado: n(d.saldoDevedorPerdoado) } : null,
    notes: itens[0].notes,
    ajusteManual: (d.ajusteManual as unknown) ?? null,
    verbasOpcionais: verbasLancadas(d),
    historicoAjustes: (Array.isArray(d.historicoAjustes) ? d.historicoAjustes : []) as AjusteRescisao[],
  };
}

// ─── RESCISÃO — ajustar a já lançada ──────────────────────────────────────────────
// Corrige bruto/descontos de uma rescisão ainda não paga. Justificativa obrigatória;
// o antes e o depois ficam no histórico da própria rescisão e na auditoria.
payrollRouter.put("/termination/:employeeId", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });
  const emp = await prisma.employee.findFirst({ where: { id: request.params.employeeId, deletedAt: null } });
  if (!emp) return response.status(404).json({ message: "Funcionário não encontrado." });

  const itens = await prisma.payrollItem.findMany({ where: { employeeId: emp.id, type: "RESCISAO", deletedAt: null, status: { not: "CANCELED" } }, orderBy: { dueDate: "asc" } });
  if (itens.length === 0) return response.status(404).json({ message: "Não há rescisão lançada para ajustar." });
  const quitada = itens.find((i) => ehRescisaoQuitada(i.details));
  if (quitada) {
    const tipo = ehQuitadaNoTermo(quitada.details) ? "no termo" : "sem valor";
    return response.status(400).json({ message: `Rescisão quitada ${tipo} não se ajusta: para corrigir, exclua e lance de novo (RH → Rescisões).` });
  }
  if (itens.some((i) => i.paymentDate)) {
    return response.status(400).json({ message: "Rescisão com parcela já paga: estorne o pagamento em Contas a Pagar antes de ajustar." });
  }
  const primeira = itens[0];
  if (await competenciaDeFolhaBloqueada(new Date(Date.UTC(primeira.competenceYear, primeira.competenceMonth - 1, 1)), "Ajuste de rescisao", response)) return;

  const b = request.body as Record<string, unknown>;
  const apurado = await apurarOuResponder(emp.id, response);
  if (!apurado) return;
  const { apuracao } = apurado;
  // Créditos: os que entraram no lançamento; recalcular mudaria o bruto sem ninguém ver.
  const creditosLancados = (primeira.details as { creditos?: unknown } | null)?.creditos;
  const semRegistroNaSaida = apuracao?.semRegistro ?? emp.modality === "NAO_CLT";
  // Verbas opcionais: as marcadas no ajuste (recalculadas aqui) ou, se o corpo não mandou,
  // as já gravadas, como estão.
  const vo = verbasDoCorpo(b, semRegistroNaSaida, apuracao);
  if ("erro" in vo) return response.status(400).json({ message: vo.erro });
  const verbasGravadas = ((primeira.details as { verbasOpcionais?: VerbasGravadas | null } | null)?.verbasOpcionais) ?? null;
  const verbas = vo.verbas === undefined ? verbasGravadas : vo.verbas;
  const mudouVerbas = assinaturaVerbas(verbas) !== assinaturaVerbas(verbasGravadas);
  const lido = lerValoresRescisao(b, semRegistroNaSaida, typeof creditosLancados === "number" ? creditosLancados : apuracao?.sugestao.creditos ?? 0, verbas?.total ?? 0);
  if ("erro" in lido) return response.status(400).json({ message: lido.erro });
  const { gross, vtDiscount, otherDiscount, net } = lido;
  // Ajustar não vira quitação: um título em aberto de R$ 0,00 nunca baixaria.
  if (net === 0) {
    return response.status(400).json({ message: "Com esse ajuste o líquido fica zero (ou o saldo devedor seria perdoado): exclua esta rescisão e lance de novo, que ela fica quitada." });
  }
  const justificativa = typeof b.justificativa === "string" ? b.justificativa.trim().slice(0, 1000) : "";
  if (justificativa.length < JUSTIFICATIVA_MINIMA) {
    return response.status(400).json({ message: `Explique o ajuste da rescisão (pelo menos ${JUSTIFICATIVA_MINIMA} letras).` });
  }

  const atual = (await rescisaoLancada(emp.id))!;
  const antes: ValoresLancados = {
    bruto: atual.bruto, salario: atual.salario, gorjeta: atual.gorjeta, vales: atual.vales,
    vtDesconto: atual.vtDesconto, outroDesconto: atual.outroDesconto, liquido: atual.liquido,
    verbasOpcionaisTotal: verbasGravadas?.total ?? 0,
  };
  const depois: ValoresLancados = {
    bruto: round2(gross), salario: lido.componentes.salario, gorjeta: lido.componentes.gorjeta, vales: lido.componentes.vales,
    vtDesconto: round2(vtDiscount), outroDesconto: round2(otherDiscount), liquido: net,
    verbasOpcionaisTotal: verbas?.total ?? 0,
  };
  // Ajuste sem nada mudado só enche o histórico: recusa.
  const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const mudouTexto = (campo: string, atualValor: string | null) =>
    b[campo] !== undefined && texto(b[campo]) !== (atualValor ?? "").trim();
  if (!valoresMudaram(antes, depois) && !mudouVerbas && !mudouTexto("otherDiscountLabel", atual.outroDescontoRotulo)
    && !mudouTexto("valesLabel", atual.valesRotulo) && !mudouTexto("notes", atual.notes)) {
    return response.status(400).json({ message: "Nada mudou em relação à rescisão lançada: não há o que ajustar." });
  }
  const ajuste: AjusteRescisao & { divergenciasDoApurado: unknown } = {
    em: new Date().toISOString(), porUserId: user.id, porNome: user.name ?? null, justificativa, antes, depois,
    divergenciasDoApurado: divergenciasDoApurado(apuracao?.sugestao ?? null, lido.componentes),
  };
  // O líquido novo se reparte nas mesmas parcelas, mantendo os vencimentos.
  const valores = splitCents(Math.round(net * 100), itens.length).map((c) => round2(c / 100));
  const detalhes = (primeira.details ?? {}) as Record<string, unknown>;
  const loc = await localizarGorjetaNaApuracao(emp.id, emp.terminationDate, lido.componentes.gorjeta, apuracao);
  if ("erro" in loc) return response.status(400).json({ message: loc.erro });
  const jaAplicada = detalhes.gorjetaNaApuracao as GorjetaNaApuracao | null | undefined;
  // O "anterior" é o de antes da PRIMEIRA aplicação: é para ele que a exclusão volta.
  const gorjetaNaApuracao: GorjetaNaApuracao | null = loc.alvo
    ? { ...loc.alvo, anterior: jaAplicada?.participantId === loc.alvo.participantId ? jaAplicada.anterior : loc.alvo.anterior }
    : jaAplicada ?? null;
  // Gravar outra gorjeta paga na apuração é editar a Gorjeta: exige a permissão de lá.
  // Mesmo valor já gravado não muda a apuração e não é regravado.
  const mudaGorjeta = gorjetaMudaApuracao(loc.alvo, loc.alvo?.aplicada ?? null);
  if (mudaGorjeta && !(await podeEditarGorjeta(user))) {
    return response.status(403).json({ message: MSG_SEM_PERMISSAO_GORJETA });
  }
  const MAX_HISTORICO = 50;
  const detalhesDe = (i: number, it: (typeof itens)[number]) => (i === 0
    ? {
      ...detalhes,
      grossAmount: depois.bruto, vtDiscount: depois.vtDesconto, otherDiscount: depois.outroDesconto,
      salario: depois.salario, gorjeta: depois.gorjeta, creditos: lido.creditos, valesDiscount: depois.vales,
      ...(b.valesLabel !== undefined ? { valesLabel: textoLimitado(b.valesLabel, 300) } : {}),
      otherDiscountLabel: b.otherDiscountLabel !== undefined ? textoLimitado(b.otherDiscountLabel, 300) : (detalhes.otherDiscountLabel ?? null),
      ...(itens.length > 1 ? { netTotal: net } : {}),
      // A auditoria guarda todos; aqui ficam os últimos, para a rescisão não crescer sem fim.
      historicoAjustes: [...atual.historicoAjustes, ajuste].slice(-MAX_HISTORICO),
      gorjetaNaApuracao,
      verbasOpcionais: verbas,
      verbasOpcionaisPor: mudouVerbas
        ? { userId: user.id, nome: user.name ?? null, em: new Date().toISOString() }
        : (detalhes.verbasOpcionaisPor ?? null),
    }
    : { ...((it.details ?? {}) as Record<string, unknown>), netTotal: net, gorjetaNaApuracao }) as Prisma.InputJsonValue;
  // Dois ajustes ao mesmo tempo: o segundo leria o histórico velho e apagaria o do
  // primeiro. A trava do funcionário enfileira os dois, e a 1ª parcela só é gravada se
  // o updatedAt ainda for o lido (compare-and-set atômico, não ler-e-depois-gravar).
  const conflito = () => new RecusaRescisao(409, "A rescisão foi alterada por outra pessoa enquanto você ajustava. Reabra e confira antes de salvar.");
  try {
    await prisma.$transaction(async (tx) => {
      await travarRescisao(tx, emp.id);
      // Parcela excluída, restaurada ou paga desde a leitura também é conflito.
      const vivas = await tx.payrollItem.findMany({
        where: { employeeId: emp.id, type: "RESCISAO", deletedAt: null, status: { not: "CANCELED" } },
        select: { id: true, paymentDate: true },
      });
      const mesmas = vivas.length === itens.length && itens.every((it) => vivas.some((v) => v.id === it.id && v.paymentDate == null));
      if (!mesmas) throw conflito();
      for (const [i, it] of itens.entries()) {
        const data = {
          amount: valores[i],
          updatedById: user.id,
          ...(b.notes !== undefined && i === 0 ? { notes: textoLimitado(b.notes, 1000) } : {}),
          details: detalhesDe(i, it),
        };
        if (i === 0) {
          const r = await tx.payrollItem.updateMany({ where: { id: it.id, updatedAt: primeira.updatedAt }, data });
          if (r.count === 0) throw conflito();
        } else {
          await tx.payrollItem.update({ where: { id: it.id }, data });
        }
      }
      if (gorjetaNaApuracao && loc.alvo && mudaGorjeta) {
        await tx.tipParticipant.update({
          where: { id: gorjetaNaApuracao.participantId },
          data: { rescisaoValorFixo: gorjetaNaApuracao.aplicada, rescisaoRecibo: Prisma.DbNull },
        });
      }
    });
  } catch (err) {
    if (err instanceof RecusaRescisao) return response.status(err.status).json({ message: err.message });
    throw err;
  }

  await auditLog({
    userId: user.id, action: "ADJUST_TERMINATION", entity: "PayrollItem", entityId: primeira.id,
    previousValue: antes, newValue: { ...depois, justificativa, ...(mudouVerbas ? { verbasOpcionais: verbas } : {}) },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });
  response.json({ ok: true, lancada: lancadaVisivel(await rescisaoLancada(emp.id), await podeVerDadosPessoais(request)) });
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
  const dre = await prisma.dRECategory.findFirst({ where: { name: FERIAS_CATEGORY } });

  // A competencia das ferias e o mes de INICIO, que e o que vai para o PayrollItem.
  if (await competenciaDeFolhaBloqueada(start, "Lancamento de ferias", response)) return;

  // As mesmas férias (mesma pessoa e mesmo início) já lançadas: recusa. Outro período no
  // mesmo mês é legítimo e ganha rótulo próprio (a chave única inclui o rótulo, até de excluído).
  const competenciaFerias = { employeeId: emp.id, type: "FERIAS", competenceYear: start.getUTCFullYear(), competenceMonth: start.getUTCMonth() + 1 } as const;
  const feriasDoMes = await prisma.payrollItem.findMany({ where: competenciaFerias, select: CAMPOS_TRAVA });
  const feriasRepetidas = duplicadosDe({ ...competenciaFerias, periodStart: start }, feriasDoMes);
  if (feriasRepetidas.length > 0) {
    return response.status(409).json({
      code: "DUPLICIDADE",
      message: `Estas férias de ${nomeDe(emp)} (início ${dataBr(start)}) já estão lançadas.`,
      existentes: feriasRepetidas.map(resumoItem),
    });
  }

  const item = await prisma.payrollItem.create({
    data: {
      id: crypto.randomUUID(),
      employeeId: emp.id,
      type: "FERIAS",
      competenceYear: start.getUTCFullYear(),
      competenceMonth: start.getUTCMonth() + 1,
      periodLabel: rotuloLivre("Férias", feriasDoMes.map((f) => f.periodLabel)),
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

  // As quatro guardas abaixo existiam em contas a pagar e faltavam aqui, apesar
  // de ser a mesma operação: gravar o pagamento de um título que entra no DRE.

  // 1. Rebaixar sobrescreveria paymentDate/paidAmount e apagaria a trilha do
  //    pagamento anterior. Estornar primeiro deixa o histórico intacto.
  if (existing.paymentDate || existing.status === "PAID") {
    return response.status(400).json({
      message: "Lançamento já baixado. Estorne o pagamento antes de lançar uma nova baixa."
    });
  }

  // 2. Data futura joga a despesa para um mês que ainda não aconteceu.
  const soData = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (soData(paymentDate).getTime() > soData(new Date()).getTime()) {
    return response.status(400).json({ message: "Data do pagamento não pode ser futura." });
  }

  // 3. O paymentDate posiciona a despesa no mês do DRE — o mesmo motivo pelo
  //    qual a baixa de fatura de cartão já é travada. Sem isto dava para alterar
  //    um mês com CMV fechado por aqui, contornando a trava.
  try {
    await assertPeriodWritableForDate(paymentDate, "Baixa de lançamento de folha");
  } catch (error) {
    return response.status(400).json({ message: error instanceof Error ? error.message : "Período fechado." });
  }
  // Paridade com títulos normais: forma de pagamento obrigatória.
  if (!paidPaymentMethodId && !paidPaymentMethodNameInput) {
    return response.status(400).json({ message: "Forma de pagamento é obrigatória." });
  }
  // Diferença em relação ao valor do título exige justificativa.
  // 4. Erro de digitação com ordem de grandeza a mais (R$ 1.200 virando 12.000).
  //    Só barra o que é absurdo em proporção E em valor, para não atrapalhar
  //    acerto legítimo em título pequeno.
  const MAX_PAYMENT_MULTIPLIER = 10;
  const MIN_ABSURD_SURCHARGE = 10_000;
  const tituloOriginal = Number(existing.amount ?? 0);
  if (
    tituloOriginal > 0 &&
    paidAmount > tituloOriginal * MAX_PAYMENT_MULTIPLIER &&
    paidAmount - tituloOriginal > MIN_ABSURD_SURCHARGE
  ) {
    return response.status(400).json({
      message: `Valor pago (${paidAmount.toFixed(2)}) é mais de ${MAX_PAYMENT_MULTIPLIER}x o título (${tituloOriginal.toFixed(2)}). Confira antes de baixar.`
    });
  }

  const difference = Number((paidAmount - Number(existing.amount)).toFixed(2));
  if (Math.abs(difference) > 0.009 && !differenceReason) {
    return response.status(400).json({ message: "Justificativa obrigatória quando o valor pago difere do valor do título." });
  }
  // Conta bancária tem que pertencer à empresa pagadora e estar ativa.
  if (payingCompanyId && companyBankAccountId) {
    const owned = await prisma.companyBankAccount.findFirst({ where: { id: companyBankAccountId, companyId: payingCompanyId, isActive: true } });
    if (!owned) return response.status(400).json({ message: "Conta bancária não pertence à empresa selecionada ou está inativa." });
  }
  // 5. Baixa em duplicidade: o mesmo pagamento (pessoa + tipo + competência, + quinzena no
  //    VT) já pago em OUTRO item. Parcela da mesma rescisão e complemento não contam.
  //    Só passa com a confirmação explícita, que fica na auditoria.
  const outrosPagos = await prisma.payrollItem.findMany({
    where: {
      employeeId: existing.employeeId, type: existing.type, competenceYear: existing.competenceYear, competenceMonth: existing.competenceMonth,
      deletedAt: null, paymentDate: { not: null }, id: { not: existing.id },
    },
    select: CAMPOS_TRAVA,
  });
  const jaPagos = pagamentosEmDuplicidade(existing, outrosPagos);
  const confirmaDuplicidade = b.confirmaDuplicidade === true;
  if (jaPagos.length > 0 && !confirmaDuplicidade) {
    const emp = await prisma.employee.findFirst({ where: { id: existing.employeeId }, select: { firstName: true, lastName: true } });
    const pessoa = nomeDe(emp);
    const p = jaPagos[0];
    const valor = Number(p.paidAmount ?? p.amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    return response.status(409).json({
      code: "BAIXA_DUPLICADA",
      message: `Já foi pago ${rotuloTipo(existing.type).toLowerCase()} ${competenciaDe(existing)} de ${pessoa} em ${dataBr(p.paymentDate)} (${valor}). Baixar mesmo assim?`,
      pessoa,
      item: resumoItem(existing),
      jaPagos: jaPagos.map(resumoItem),
    });
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
  if (jaPagos.length > 0) {
    await auditLog({
      userId: user.id, action: "BAIXA_FOLHA_DUPLICIDADE_CONFIRMADA", entity: "PayrollItem", entityId: updated.id,
      newValue: { item: resumoItem(existing), jaPagos: jaPagos.map(resumoItem) },
      ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
    });
  }

  response.json({ id: updated.id, status: updated.status });
});

// ─── ESTORNAR ──────────────────────────────────────────────────────────────────
payrollRouter.patch("/:id/reverse", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  // Motivo obrigatorio, igual ao estorno de conta a pagar e ao de imposto. Estornar
  // apaga a baixa inteira; sem o porque, a auditoria mostra o que sumiu e nao por que.
  const reason = typeof request.body?.reason === "string" ? request.body.reason.trim() : null;
  if (!reason) return response.status(400).json({ message: "Motivo obrigatório para estornar o lançamento." });

  const existing = await prisma.payrollItem.findFirst({ where: { id: request.params.id, deletedAt: null } });
  if (!existing) return response.status(404).json({ message: "Lançamento não encontrado." });
  if (!existing.paymentDate) return response.status(400).json({ message: "Este lançamento ainda não foi pago." });
  // Quitada no termo não saiu do caixa: não há baixa a estornar. Desfazer = excluir.
  if (existing.type === "RESCISAO" && ehQuitadaNoTermo(existing.details)) {
    return response.status(400).json({ message: "Rescisão quitada no termo não teve pagamento a estornar: para desfazer, exclua o registro (RH → Rescisões)." });
  }
  if (existing.type === "RESCISAO" && ehQuitadaSemValor(existing.details)) {
    return response.status(400).json({ message: "Rescisão quitada sem valor: não houve pagamento a estornar; para refazer, exclua." });
  }

  // Estornar tira a despesa do mês em que ela foi paga. Trava na data do
  // pagamento ORIGINAL, que é o mês que seria alterado — mesmo critério do
  // estorno de conta a pagar.
  try {
    await assertPeriodWritableForDate(existing.paymentDate, "Estorno de lançamento de folha");
  } catch (error) {
    return response.status(400).json({ message: error instanceof Error ? error.message : "Período fechado." });
  }

  const updated = await prisma.payrollItem.update({
    where: { id: request.params.id },
    data: {
      paymentDate: null, paidAmount: null, status: computeStatus(existing.dueDate, null),
      paidPaymentMethodId: null, paidPaymentMethodName: null, paidByCompanyId: null,
      // paymentNotes guarda o motivo do estorno, como no estorno de conta a pagar.
      companyBankAccountId: null, differenceReason: null, paymentNotes: reason,
      updatedById: user.id,
    },
  });

  await auditLog({
    userId: user.id, action: "REVERSE_PAYROLL_ITEM", entity: "PayrollItem", entityId: updated.id,
    previousValue: existing, newValue: { ...updated, reverseReason: reason }, ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });

  response.json({ id: updated.id, status: updated.status });
});

// ─── RESTAURAR (desfazer exclusão) ──────────────────────────────────────────────
payrollRouter.patch("/:id/restore", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const existing = await prisma.payrollItem.findFirst({ where: { id: request.params.id, deletedAt: { not: null } } });
  if (!existing) return response.status(404).json({ message: "Lançamento excluído não encontrado (talvez já restaurado)." });

  // Restaurar RESSUSCITA despesa num mes passado. A rota vizinha (PATCH /:id, logo
  // abaixo) ja travava; esta nao — e o efeito e maior, porque muda o total do mes em
  // vez de editar um lancamento que ja conta.
  if (await competenciaDeFolhaBloqueada(
    new Date(existing.competenceYear, existing.competenceMonth - 1, 1),
    "Restauracao de lancamento de folha",
    response
  )) return;

  // Restaurar com o mesmo pagamento já vivo em outro item criaria a duplicidade que a
  // folha trava em todo o resto. Rescisão tem a regra própria (recusarSeOutraRescisaoViva).
  if (existing.type !== "RESCISAO") {
    const vivos = await prisma.payrollItem.findMany({
      where: { employeeId: existing.employeeId, type: existing.type, competenceYear: existing.competenceYear, competenceMonth: existing.competenceMonth, deletedAt: null, id: { not: existing.id } },
      select: CAMPOS_TRAVA,
    });
    const duplicados = duplicadosDe(existing, vivos);
    if (duplicados.length > 0) {
      return response.status(409).json({
        code: "DUPLICIDADE",
        message: `Já existe outro ${rotuloTipo(existing.type).toLowerCase()} de ${competenciaDe(existing)} desta pessoa. Exclua o outro antes de restaurar este.`,
        existentes: duplicados.map(resumoItem),
      });
    }
  }

  // Relançar a gorjeta na apuração é editar a Gorjeta: a permissão é lida antes da transação.
  const podeGorjeta = existing.type === "RESCISAO" ? await podeEditarGorjeta(user) : false;
  let resultado;
  try {
    resultado = await prisma.$transaction(async (tx) => {
      if (existing.type === "RESCISAO") {
        // Com a trava, lançar/restaurar ao mesmo tempo não deixam duas rescisões vivas.
        await travarRescisao(tx, existing.employeeId);
        await recusarSeOutraRescisaoViva(tx, existing);
      }
      const item = await tx.payrollItem.update({
        where: { id: existing.id },
        data: { deletedAt: null, deletedById: null, status: computeStatus(existing.dueDate, existing.paymentDate), updatedById: user.id },
      });
      // Quitada no termo nunca mexeu na gorjeta: nada a relançar (e o vínculo das irmãs não é dela).
      const restaurada = existing.type === "RESCISAO" && !ehQuitadaNoTermo(existing.details)
        ? await refazerGorjetaDaRescisao(tx, existing, podeGorjeta) : null;
      return { updated: item, gorjetaRestaurada: restaurada };
    });
  } catch (err) {
    if (err instanceof RecusaRescisao) return response.status(err.status).json({ message: err.message });
    throw err;
  }
  const { updated, gorjetaRestaurada } = resultado;

  // O valor restaurado JÁ vem com o abatimento de falta embutido, mas a exclusão
  // tinha soltado essas faltas de volta para a fila. Sem recarimbá-las aqui, o
  // vale seguinte descontaria as MESMAS faltas outra vez — o funcionário pagaria
  // duas vezes pelo mesmo dia. A lista vive em details.faltasDescontadas.
  const faltas = (existing.details as { faltasDescontadas?: unknown } | null)?.faltasDescontadas;
  let faltasRecarimbadas = 0;
  if (Array.isArray(faltas) && faltas.length > 0) {
    const linhas = faltas
      .filter((f): f is { date: string; amount: number; tipo?: string } =>
        !!f && typeof f === "object" && typeof (f as { date?: unknown }).date === "string")
      .map((f) => ({
        id: crypto.randomUUID(),
        employeeId: existing.employeeId,
        date: new Date(`${f.date}T00:00:00.000Z`),
        // Lançamentos antigos não têm o tipo gravado; FALTA é o padrão seguro.
        dayType: f.tipo === "ATESTADO" ? ("ATESTADO" as const) : ("FALTA" as const),
        amount: Number(f.amount ?? 0),
        payrollItemId: existing.id,
      }));
    if (linhas.length > 0) {
      const res = await prisma.vtFaltaDeduction.createMany({ data: linhas, skipDuplicates: true });
      faltasRecarimbadas = res.count;
    }
  }

  await auditLog({
    userId: user.id, action: "RESTORE_PAYROLL_ITEM", entity: "PayrollItem", entityId: updated.id,
    newValue: { restored: true, faltasRecarimbadas, ...(gorjetaRestaurada ? { gorjetaRestaurada } : {}) },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
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

  // Soft-delete não dispara o ON DELETE CASCADE, então os abatimentos de falta
  // precisam ser soltos à mão. Sem isso, apagar um VT deixaria as faltas dele
  // carimbadas como "já descontadas" e elas nunca mais voltariam ao cálculo.
  // Parcela de rescisão já paga: excluir apagaria a despesa e desfaria a gorjeta de algo
  // que já saiu do caixa. Estorna primeiro.
  // Quitada (no termo ou sem valor, R$ 0,00): a "baixa" é só o registro, nada saiu do
  // caixa — exclui direto. Só a do termo não mexe na gorjeta; a sem valor gravou a gorjeta
  // na apuração e a exclusão desfaz como numa rescisão normal.
  const quitadaNoTermo = existing.type === "RESCISAO" && ehQuitadaNoTermo(existing.details);
  const quitada = existing.type === "RESCISAO" && ehRescisaoQuitada(existing.details);
  if (existing.type === "RESCISAO" && existing.paymentDate && !quitada) {
    return response.status(400).json({ message: "Parcela de rescisão já paga: estorne o pagamento em Contas a Pagar antes de excluir." });
  }

  // Desfazer a gorjeta na apuração é editar a Gorjeta: a permissão é lida antes da transação.
  const podeGorjeta = existing.type === "RESCISAO" ? await podeEditarGorjeta(user) : false;
  let resultado;
  try {
    resultado = await prisma.$transaction(async (tx) => {
      if (existing.type === "RESCISAO") await travarRescisao(tx, existing.employeeId);
      const liberadas = await tx.vtFaltaDeduction.deleteMany({ where: { payrollItemId: request.params.id } });
      await tx.payrollItem.update({ where: { id: request.params.id }, data: { deletedAt: new Date(), deletedById: user.id } });
      // Rescisão: a gorjeta que ela gravou na apuração volta ao que era antes — só quando
      // sai a última parcela (enquanto houver parcela viva, a rescisão continua valendo).
      let desfeita = null;
      if (existing.type === "RESCISAO") {
        const restantes = await tx.payrollItem.count({ where: { employeeId: existing.employeeId, type: "RESCISAO", deletedAt: null, status: { not: "CANCELED" } } });
        if (restantes === 0 && !quitadaNoTermo) desfeita = await desfazerGorjetaDaRescisao(tx, existing.employeeId, existing.details, podeGorjeta);
      }
      return { faltasLiberadas: liberadas, gorjetaDesfeita: desfeita };
    });
  } catch (err) {
    if (err instanceof RecusaRescisao) return response.status(err.status).json({ message: err.message });
    throw err;
  }
  const { faltasLiberadas, gorjetaDesfeita } = resultado;

  await auditLog({
    userId: user.id, action: "DELETE_PAYROLL_ITEM", entity: "PayrollItem", entityId: request.params.id,
    previousValue: existing, newValue: { reason, faltasLiberadas: faltasLiberadas.count, ...(gorjetaDesfeita ? { gorjetaDesfeita } : {}) },
    ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? ""),
  });

  response.json({ ok: true });
});
