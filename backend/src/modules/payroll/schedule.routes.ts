import crypto from "node:crypto";
import { Router } from "express";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { holidaysForYear } from "./holidays.js";

export const scheduleRouter = Router();

const SCHEDULE_TYPES = ["FOLGA", "TURNO", "FERIAS", "FALTA", "ATESTADO"] as const;
type ScheduleType = (typeof SCHEDULE_TYPES)[number];

function parseYearMonth(q: { year?: unknown; month?: unknown }) {
  const now = new Date();
  const year = parseInt(String(q.year ?? ""), 10) || now.getFullYear();
  let month = parseInt(String(q.month ?? ""), 10) || now.getMonth() + 1;
  if (month < 1) month = 1;
  if (month > 12) month = 12;
  return { year, month };
}

const pad = (n: number) => String(n).padStart(2, "0");

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
      id: true, firstName: true, lastName: true, sector: true, position: true,
      shiftStart: true, shiftEnd: true, scheduleRegime: true, admissionDate: true, terminationDate: true,
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

  response.json({ year, month, daysInMonth, days, employees, entries, vacationDays });
});

// ─── POST /schedule/bulk ─────────────────────────────────────────────────────────
// Substitui a escala do mês (delete + insert em transação) apenas para os
// funcionários ativos. Payload: { year, month, entries: [{employeeId, day, type}] }.
scheduleRouter.post("/bulk", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return response.status(401).json({ message: "Sessão obrigatória." });

  const b = request.body as { year?: unknown; month?: unknown; entries?: unknown };
  const { year, month } = parseYearMonth(b);
  const daysInMonth = new Date(year, month, 0).getDate();
  const rawEntries = Array.isArray(b.entries) ? b.entries : [];

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
  });

  await auditLog({
    userId: user.id,
    action: "SAVE_SCHEDULE",
    entity: "EmployeeScheduleDay",
    newValue: { year, month, count: entries.length },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
  });

  response.json({ ok: true, year, month, count: entries.length });
});
