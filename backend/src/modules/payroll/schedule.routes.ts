import crypto from "node:crypto";
import { Router } from "express";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { holidaysForYear } from "./holidays.js";

export const scheduleRouter = Router();

const SCHEDULE_TYPES = ["FOLGA", "FOLGA_FERIADO", "FOLGA_BANCO_HORAS", "TURNO", "EVENTO", "FERIAS", "FALTA", "ATESTADO"] as const;
type ScheduleType = (typeof SCHEDULE_TYPES)[number];

const EVENT_SIZES = ["PEQUENO", "MEDIO", "GRANDE"] as const;
type EventSize = (typeof EVENT_SIZES)[number];

function parseYearMonth(q: { year?: unknown; month?: unknown }) {
  const now = new Date();
  const year = parseInt(String(q.year ?? ""), 10) || now.getFullYear();
  let month = parseInt(String(q.month ?? ""), 10) || now.getMonth() + 1;
  if (month < 1) month = 1;
  if (month > 12) month = 12;
  return { year, month };
}

const pad = (n: number) => String(n).padStart(2, "0");

// ─── Saldo de folga por feriado trabalhado ──────────────────────────────────
//
// O saldo é CALCULADO, não acumulado:
//
//     saldo = ajuste manual  +  feriados trabalhados  −  folgas FF tiradas
//
// Guardar um contador e somar/subtrair a cada gravação da escala seria o
// caminho óbvio e estaria errado: a escala é regravada inteira toda vez que se
// salva o mês, e o mesmo feriado creditaria de novo a cada salvada. Recalcular
// da escala é idempotente por construção — salvar dez vezes dá o mesmo número.
//
// A data de corte vale só para o CRÉDITO (feriados trabalhados): tudo que
// aconteceu antes dela já está embutido no ajuste manual que vinha sendo mantido
// na mão, e ligar o automático sem corte somaria de uma vez todos os feriados
// históricos.
//
// O DÉBITO (folgas FF) não precisa de corte e não pode ter: a marca FOLGA_FERIADO
// nasceu hoje, então não existe nenhuma no passado para contar em dobro — e com
// corte a folga marcada neste mês não abateria nada, que é justamente o uso.
const CORTE_SALDO_FERIADO = new Date(Date.UTC(2026, 9, 1)); // 01/10/2026

const TIPOS_NAO_TRABALHADOS = ["FOLGA", "FOLGA_FERIADO", "FOLGA_BANCO_HORAS", "FALTA", "ATESTADO", "FERIAS"] as const;
const TIPOS_DE_FOLGA = ["FOLGA", "FOLGA_FERIADO", "FOLGA_BANCO_HORAS"] as const;

// ─── Domingos anteriores ao mês exibido ─────────────────────────────────────
//
// A folga precisa cair em domingo de tempos em tempos: a cada 15 dias para a
// mulher (CLT art. 386, não revogado pela reforma de 2017) e a cada 7 semanas na
// regra geral (Decreto 27.048/49 + Portaria MTPS 417/66). Para saber há quanto
// tempo alguém não folga num domingo, a tela precisa de histórico — o mês
// exibido sozinho não conta essa história.
//
// O status vem calculado daqui porque só o servidor sabe distinguir "trabalhou
// no domingo" de "esse mês nunca foi montado". Ausência de marcação significa
// dia trabalhado apenas dentro de um mês com escala; fora dele é desconhecido, e
// tratar como trabalhado acusaria todo mundo por meses que ninguém preencheu.
const SEMANAS_DE_HISTORICO = 10;

async function domingosAnteriores(
  empIds: string[],
  monthStart: Date,
): Promise<Array<{ employeeId: string; date: string; status: "FOLGA" | "TRABALHOU" | "SEM_ESCALA" }>> {
  if (empIds.length === 0) return [];
  const inicio = new Date(monthStart.getTime() - SEMANAS_DE_HISTORICO * 7 * 86400000);

  const rows = await prisma.employeeScheduleDay.findMany({
    where: { employeeId: { in: empIds }, date: { gte: inicio, lt: monthStart } },
    select: { employeeId: true, date: true, type: true },
  });
  const mesesComEscala = new Set(rows.map((r) => `${r.employeeId}|${r.date.getUTCFullYear()}-${r.date.getUTCMonth()}`));
  const porDia = new Map<string, string>();
  for (const r of rows) porDia.set(`${r.employeeId}|${r.date.toISOString().slice(0, 10)}`, r.type);

  const out: Array<{ employeeId: string; date: string; status: "FOLGA" | "TRABALHOU" | "SEM_ESCALA" }> = [];
  for (let t = inicio.getTime(); t < monthStart.getTime(); t += 86400000) {
    const dia = new Date(t);
    if (dia.getUTCDay() !== 0) continue;
    const iso = dia.toISOString().slice(0, 10);
    for (const id of empIds) {
      const temEscala = mesesComEscala.has(`${id}|${dia.getUTCFullYear()}-${dia.getUTCMonth()}`);
      const tipo = porDia.get(`${id}|${iso}`);
      const status = !temEscala
        ? "SEM_ESCALA"
        : tipo && ((TIPOS_DE_FOLGA as readonly string[]).includes(tipo) || tipo === "FERIAS")
          ? "FOLGA"
          : "TRABALHOU";
      out.push({ employeeId: id, date: iso, status });
    }
  }
  return out;
}

async function saldosDeFolgaFeriado(
  employees: Array<{ id: string; holidayCompBalance: number; admissionDate: Date | null; terminationDate: Date | null }>,
): Promise<Map<string, number>> {
  const ids = employees.map((e) => e.id);
  const saldos = new Map<string, number>();
  if (ids.length === 0) return saldos;

  const [rows, ffRows] = await Promise.all([
    // Para o crédito: só a partir do corte.
    prisma.employeeScheduleDay.findMany({
      where: { employeeId: { in: ids }, date: { gte: CORTE_SALDO_FERIADO } },
      select: { employeeId: true, date: true, type: true },
    }),
    // Para o débito: todas as folgas de feriado, sem corte.
    prisma.employeeScheduleDay.findMany({
      where: { employeeId: { in: ids }, type: "FOLGA_FERIADO" },
      select: { employeeId: true },
    }),
  ]);

  // Meses que têm escala salva. Um mês sem NENHUMA marcação não foi montado, e
  // contar os feriados dele como "trabalhados" daria crédito por um mês que
  // ninguém preencheu.
  const mesesComEscala = new Set(rows.map((r) => `${r.employeeId}|${r.date.getUTCFullYear()}-${r.date.getUTCMonth()}`));
  const naoTrabalhado = new Set<string>();
  for (const r of rows) {
    if (!(TIPOS_NAO_TRABALHADOS as readonly string[]).includes(r.type)) continue;
    naoTrabalhado.add(`${r.employeeId}|${r.date.toISOString().slice(0, 10)}`);
  }
  const ffTiradas = new Map<string, number>();
  for (const r of ffRows) ffTiradas.set(r.employeeId, (ffTiradas.get(r.employeeId) ?? 0) + 1);

  const hoje = new Date();
  const anos = new Set<number>();
  for (let a = CORTE_SALDO_FERIADO.getUTCFullYear(); a <= hoje.getUTCFullYear(); a++) anos.add(a);
  const feriados: Date[] = [];
  for (const ano of anos) {
    for (const chave of holidaysForYear(ano).keys()) {
      const [m, d] = chave.split("-").map(Number);
      const data = new Date(Date.UTC(ano, m - 1, d));
      if (data >= CORTE_SALDO_FERIADO && data <= hoje) feriados.push(data);
    }
  }

  for (const emp of employees) {
    let trabalhados = 0;
    for (const f of feriados) {
      if (!mesesComEscala.has(`${emp.id}|${f.getUTCFullYear()}-${f.getUTCMonth()}`)) continue;
      if (emp.admissionDate && f < emp.admissionDate) continue;
      if (emp.terminationDate && f > emp.terminationDate) continue;
      if (naoTrabalhado.has(`${emp.id}|${f.toISOString().slice(0, 10)}`)) continue;
      trabalhados += 1;
    }
    saldos.set(emp.id, emp.holidayCompBalance + trabalhados - (ffTiradas.get(emp.id) ?? 0));
  }
  return saldos;
}

// ─── GET /schedule?year=&month= ─────────────────────────────────────────────────
scheduleRouter.get("/", async (request, response) => {
  const { year, month } = parseYearMonth(request.query as { year?: unknown; month?: unknown });
  const daysInMonth = new Date(year, month, 0).getDate();
  const holidays = holidaysForYear(year);

  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    const holidayName = holidays.get(`${pad(month)}-${pad(d)}`) ?? null;
    days.push({ day: d, dow, isSunday: dow === 0, isHoliday: holidayName != null, holidayName });
  }

  const employees = await prisma.employee.findMany({
    where: { deletedAt: null, isActive: true, includeInSchedule: true },
    select: {
      id: true, firstName: true, lastName: true, displayName: true, sector: true, subgroup: true, position: true,
      shiftStart: true, shiftEnd: true, scheduleRegime: true, admissionDate: true, terminationDate: true, gender: true,
      holidayCompBalance: true,
    },
    orderBy: [{ sector: "asc" }, { firstName: "asc" }, { lastName: "asc" }],
  });

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const nextMonthStart = new Date(Date.UTC(year, month, 1));
  const rows = await prisma.employeeScheduleDay.findMany({
    where: { date: { gte: monthStart, lt: nextMonthStart }, employee: { deletedAt: null, isActive: true } },
    select: { employeeId: true, date: true, type: true },
  });
  const entries = rows.map((r) => ({ employeeId: r.employeeId, day: r.date.getUTCDate(), type: r.type }));

  // Férias (PayrollItem type FERIAS) que tocam este mês → dias para a grade sombrear.
  const feriasItems = await prisma.payrollItem.findMany({
    where: {
      type: "FERIAS", deletedAt: null,
      employee: { deletedAt: null, isActive: true },
      periodStart: { lt: nextMonthStart }, periodEnd: { gte: monthStart },
    },
    select: { employeeId: true, periodStart: true, periodEnd: true },
  });
  const lastDay = new Date(nextMonthStart.getTime() - 86400000);
  const vacationDays: Array<{ employeeId: string; day: number }> = [];
  for (const f of feriasItems) {
    if (!f.periodStart || !f.periodEnd) continue;
    const from = f.periodStart < monthStart ? monthStart : f.periodStart;
    const to = f.periodEnd > lastDay ? lastDay : f.periodEnd;
    for (let d = from.getUTCDate(); d <= to.getUTCDate(); d++) vacationDays.push({ employeeId: f.employeeId, day: d });
  }

  // Eventos por data (do dia inteiro) — Pequeno/Médio/Grande, marcados no cabeçalho.
  const eventRows = await prisma.scheduleDayEvent.findMany({
    where: { date: { gte: monthStart, lt: nextMonthStart } },
    select: { date: true, size: true },
  });
  const dateEvents = eventRows.map((e) => ({ day: e.date.getUTCDate(), size: e.size }));

  // Dias das bordas (10 antes e 10 depois do mês). A regra de descanso não
  // enxerga o calendário: quem trabalha 27 a 30 de setembro e 1º a 4 de outubro
  // emendou 8 dias seguidos, e olhando só o mês exibido cada metade parece
  // inofensiva. A tela precisa desses dias para validar a virada.
  const bordaInicio = new Date(monthStart.getTime() - 10 * 86400000);
  const bordaFim = new Date(nextMonthStart.getTime() + 10 * 86400000);
  const bordaRows = await prisma.employeeScheduleDay.findMany({
    where: {
      employeeId: { in: employees.map((e) => e.id) },
      OR: [
        { date: { gte: bordaInicio, lt: monthStart } },
        { date: { gte: nextMonthStart, lt: bordaFim } },
      ],
    },
    select: { employeeId: true, date: true, type: true },
  });
  const borderDays = bordaRows.map((r) => ({
    employeeId: r.employeeId,
    date: r.date.toISOString().slice(0, 10),
    type: r.type,
  }));

  const cfg = await prisma.payrollSettings.findUnique({ where: { id: "singleton" }, select: { dsrDomingoMulherSemanas: true, dsrDomingoGeralSemanas: true } });
  const regraDomingo = { mulher: cfg?.dsrDomingoMulherSemanas ?? 2, geral: cfg?.dsrDomingoGeralSemanas ?? 3 };
  const sundayHistory = await domingosAnteriores(employees.map((e) => e.id), monthStart);
  const saldos = await saldosDeFolgaFeriado(employees);
  const employeesComSaldo = employees.map((e) => ({
    ...e,
    holidayCompBalance: saldos.get(e.id) ?? e.holidayCompBalance,
    /** A parte lançada à mão, para a tela poder explicar de onde vem o saldo. */
    holidayCompManual: e.holidayCompBalance,
  }));

  response.json({ year, month, daysInMonth, days, employees: employeesComSaldo, entries, vacationDays, dateEvents, borderDays, sundayHistory, regraDomingo });
});

// ─── POST /schedule/bulk ─────────────────────────────────────────────────────────
// Substitui a escala do mês (delete + insert em transação) apenas para os
// funcionários ativos. Payload: { year, month, entries: [{employeeId, day, type}] }.
scheduleRouter.post("/bulk", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const b = request.body as { year?: unknown; month?: unknown; entries?: unknown; dateEvents?: unknown };
  const { year, month } = parseYearMonth(b);
  const daysInMonth = new Date(year, month, 0).getDate();
  const rawEntries = Array.isArray(b.entries) ? b.entries : [];
  const rawEvents = Array.isArray(b.dateEvents) ? b.dateEvents : [];

  const seenDays = new Set<number>();
  const dateEvents = rawEvents
    .map((raw) => raw as { day?: unknown; size?: unknown })
    .map((e) => ({ day: parseInt(String(e.day), 10), size: String(e.size) as EventSize }))
    .filter((e) => {
      if (!(e.day >= 1 && e.day <= daysInMonth)) return false;
      if (!(EVENT_SIZES as readonly string[]).includes(e.size)) return false;
      if (seenDays.has(e.day)) return false;
      seenDays.add(e.day);
      return true;
    });

  const activeEmployees = await prisma.employee.findMany({
    where: { deletedAt: null, isActive: true },
    select: { id: true },
  });
  const activeIds = new Set(activeEmployees.map((e) => e.id));

  const seen = new Set<string>();
  const entries = rawEntries
    .map((raw) => raw as { employeeId?: unknown; day?: unknown; type?: unknown })
    .filter((e) => typeof e.employeeId === "string" && activeIds.has(e.employeeId))
    .map((e) => ({
      employeeId: String(e.employeeId),
      day: parseInt(String(e.day), 10),
      type: (SCHEDULE_TYPES as readonly string[]).includes(String(e.type)) ? (String(e.type) as ScheduleType) : "FOLGA",
    }))
    .filter((e) => {
      if (!(e.day >= 1 && e.day <= daysInMonth)) return false;
      const k = `${e.employeeId}|${e.day}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const nextMonthStart = new Date(Date.UTC(year, month, 1));

  await prisma.$transaction(async (tx) => {
    await tx.employeeScheduleDay.deleteMany({
      where: { date: { gte: monthStart, lt: nextMonthStart }, employeeId: { in: [...activeIds] } },
    });
    if (entries.length > 0) {
      await tx.employeeScheduleDay.createMany({
        data: entries.map((e) => ({
          id: crypto.randomUUID(),
          employeeId: e.employeeId,
          date: new Date(Date.UTC(year, month - 1, e.day)),
          type: e.type,
          createdById: user.id,
        })),
        skipDuplicates: true,
      });
    }
    // Eventos por data do mês: replace completo (delete + insert).
    await tx.scheduleDayEvent.deleteMany({
      where: { date: { gte: monthStart, lt: nextMonthStart } },
    });
    if (dateEvents.length > 0) {
      await tx.scheduleDayEvent.createMany({
        data: dateEvents.map((e) => ({
          id: crypto.randomUUID(),
          date: new Date(Date.UTC(year, month - 1, e.day)),
          size: e.size,
        })),
        skipDuplicates: true,
      });
    }
  });

  await auditLog({
    userId: user.id,
    action: "SAVE_SCHEDULE",
    entity: "EmployeeScheduleDay",
    newValue: { year, month, count: entries.length, events: dateEvents.length },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  response.json({ ok: true, year, month, count: entries.length, events: dateEvents.length });
});
