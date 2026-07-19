import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { holidaysForYear } from "./holidays.js";
import { computeVtForPeriod, round2, type Tariffs } from "./vt-calc.js";

const FOLHA_CATEGORY = "Folha de Pagamento";
const VT_CATEGORY = "Vale-Transporte";

export type PayrollItemType = "ADIANTAMENTO" | "SALARIO" | "VALE_TRANSPORTE";

export type ComputedItem = {
  employeeId: string;
  employeeName: string;
  sector: string | null;
  type: PayrollItemType;
  periodLabel: string;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string;
  amount: number;
  workedDays: number | null;
  freeDays: number | null;
  bufferAmount: number | null;
  creditApplied: number | null;
  dreCategoryId: string | null;
  dreCategoryName: string | null;
  details: Record<string, unknown> | null;
  exists: boolean;
};

function isoDate(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString();
}

export async function getOrDefaultSettings() {
  const existing = await prisma.payrollSettings.findUnique({ where: { id: "singleton" } });
  if (existing) return existing;
  return prisma.payrollSettings.create({ data: { id: "singleton" } });
}

export function computeStatus(dueDate: Date, paymentDate: Date | null): "PENDING" | "PAID" | "OVERDUE" | "CANCELED" {
  if (paymentDate) return "PAID";
  if (dueDate < new Date()) return "OVERDUE";
  return "PENDING";
}

// Calcula (sem persistir) todos os itens de folha da competência.
export async function computePayroll(year: number, month: number) {
  const settings = await getOrDefaultSettings();
  const tariffs: Tariffs = {
    busFare: Number(settings.busFare),
    metroFare: Number(settings.metroFare),
    integratedFare: Number(settings.integratedFare),
  };
  const holidays = holidaysForYear(year);
  const daysInMonth = new Date(year, month, 0).getDate();

  const employees = await prisma.employee.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: [{ sector: "asc" }, { firstName: "asc" }, { lastName: "asc" }],
  });
  const empIds = employees.map((e) => e.id);

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const nextMonthStart = new Date(Date.UTC(year, month, 1));
  const folgas = await prisma.employeeScheduleDay.findMany({
    where: { employeeId: { in: empIds }, date: { gte: monthStart, lt: nextMonthStart }, type: "FOLGA" },
    select: { employeeId: true, date: true },
  });
  const folgasByEmp = new Map<string, Set<number>>();
  for (const f of folgas) {
    const s = folgasByEmp.get(f.employeeId) ?? new Set<number>();
    s.add(f.date.getUTCDate());
    folgasByEmp.set(f.employeeId, s);
  }

  // Férias que tocam este mês: os dias de férias não contam VT (funcionário não vem).
  const feriasItems = await prisma.payrollItem.findMany({
    where: {
      employeeId: { in: empIds }, type: "FERIAS", deletedAt: null,
      periodStart: { lt: nextMonthStart }, periodEnd: { gte: monthStart },
    },
    select: { employeeId: true, periodStart: true, periodEnd: true },
  });
  const lastDayOfMonth = new Date(nextMonthStart.getTime() - 86400000);
  const feriasByEmp = new Map<string, Set<number>>();
  for (const f of feriasItems) {
    if (!f.periodStart || !f.periodEnd) continue;
    const s = feriasByEmp.get(f.employeeId) ?? new Set<number>();
    const from = f.periodStart < monthStart ? monthStart : f.periodStart;
    const to = f.periodEnd > lastDayOfMonth ? lastDayOfMonth : f.periodEnd;
    for (let d = from.getUTCDate(); d <= to.getUTCDate(); d++) s.add(d);
    feriasByEmp.set(f.employeeId, s);
  }

  const dreCats = await prisma.dRECategory.findMany({
    where: { name: { in: [FOLHA_CATEGORY, VT_CATEGORY] } },
    select: { id: true, name: true },
  });
  const dreFolha = dreCats.find((c) => c.name === FOLHA_CATEGORY) ?? null;
  const dreVt = dreCats.find((c) => c.name === VT_CATEGORY) ?? null;

  const existingRows = await prisma.payrollItem.findMany({
    where: { competenceYear: year, competenceMonth: month, deletedAt: null },
    select: { employeeId: true, type: true, periodLabel: true },
  });
  const existsKey = new Set(existingRows.map((e) => `${e.employeeId}|${e.type}|${e.periodLabel}`));

  const items: ComputedItem[] = [];
  const creditUpdates: Array<{ employeeId: string; newBalance: number }> = [];
  const warnings: string[] = [];

  for (const emp of employees) {
    const name = `${emp.firstName} ${emp.lastName}`.trim();
    const folgaDays = folgasByEmp.get(emp.id) ?? new Set<number>();
    const feriaDays = feriasByEmp.get(emp.id) ?? new Set<number>();
    const admissionMs = emp.admissionDate ? new Date(emp.admissionDate).getTime() : null;
    const terminationMs = emp.terminationDate ? new Date(emp.terminationDate).getTime() : null;

    // ── Vale-transporte ──
    if (emp.vtType === "TRANSPORTE_PUBLICO") {
      const passValue = emp.vtCommute === "BILHETE_MENSAL_ONIBUS"
        ? round2(Number(settings.monthlyPassBus))
        : emp.vtCommute === "BILHETE_MENSAL_INTEGRADO"
          ? round2(Number(settings.monthlyPassIntegrated))
          : null;
      if (passValue != null) {
        // Bilhete Único Mensal: valor fixo mensal (ilimitado). Sem dias/buffer/crédito.
        items.push({
          employeeId: emp.id, employeeName: name, sector: emp.sector, type: "VALE_TRANSPORTE",
          periodLabel: "VT Bilhete Único Mensal",
          periodStart: isoDate(year, month, 1), periodEnd: isoDate(year, month, daysInMonth),
          dueDate: isoDate(year, month, 1), amount: passValue,
          workedDays: null, freeDays: null, bufferAmount: null, creditApplied: null,
          dreCategoryId: dreVt?.id ?? null, dreCategoryName: dreVt?.name ?? null,
          details: { bilheteUnicoMensal: true, modalidade: emp.vtCommute === "BILHETE_MENSAL_INTEGRADO" ? "integrado" : "ônibus" },
          exists: existsKey.has(`${emp.id}|VALE_TRANSPORTE|VT Bilhete Único Mensal`),
        });
      } else {
        let creditBalance = Number(emp.vtCreditBalance);
        const periods = emp.vtPeriodicity === "QUINZENAL"
          ? [{ label: "VT 1ª quinzena", start: 1, end: Math.min(15, daysInMonth) }, { label: "VT 2ª quinzena", start: 16, end: daysInMonth }]
          : [{ label: "VT mensal", start: 1, end: daysInMonth }];
        for (const p of periods) {
          if (p.start > daysInMonth) continue;
          const r = computeVtForPeriod({
            commute: emp.vtCommute, trips: emp.vtTripsPerDay ?? 2, tariffs,
            year, month, startDay: p.start, endDay: p.end, folgaDays, feriasDays: feriaDays, admissionMs, terminationMs, holidays,
          });
          const buffer = round2(settings.bufferDays * r.normalDayCost);
          const creditApplied = round2(Math.min(creditBalance, r.gross + buffer));
          const net = round2(Math.max(0, r.gross + buffer - creditApplied));
          creditBalance = round2(buffer + (creditBalance - creditApplied));
          items.push({
            employeeId: emp.id, employeeName: name, sector: emp.sector, type: "VALE_TRANSPORTE",
            periodLabel: p.label, periodStart: isoDate(year, month, p.start), periodEnd: isoDate(year, month, p.end),
            dueDate: isoDate(year, month, p.start), amount: net, workedDays: r.workedDays, freeDays: r.freeDays,
            bufferAmount: buffer, creditApplied,
            dreCategoryId: dreVt?.id ?? null, dreCategoryName: dreVt?.name ?? null,
            details: { commute: emp.vtCommute, trips: emp.vtTripsPerDay ?? 2, gross: r.gross, normalDayCost: r.normalDayCost },
            exists: existsKey.has(`${emp.id}|VALE_TRANSPORTE|${p.label}`),
          });
        }
        creditUpdates.push({ employeeId: emp.id, newBalance: creditBalance });
      }
    } else if (emp.vtType === "AUXILIO_COMBUSTIVEL") {
      const val = round2(Number(emp.vtFixedAmount ?? 0));
      if (val > 0) {
        const periods = emp.vtPeriodicity === "QUINZENAL"
          ? [{ label: "Ajuda de custo 1ª quinzena", start: 1 }, { label: "Ajuda de custo 2ª quinzena", start: Math.min(16, daysInMonth) }]
          : [{ label: "Ajuda de custo mensal", start: 1 }];
        for (const p of periods) {
          items.push({
            employeeId: emp.id, employeeName: name, sector: emp.sector, type: "VALE_TRANSPORTE",
            periodLabel: p.label, periodStart: null, periodEnd: null, dueDate: isoDate(year, month, p.start),
            amount: val, workedDays: null, freeDays: null, bufferAmount: null, creditApplied: null,
            dreCategoryId: dreVt?.id ?? null, dreCategoryName: dreVt?.name ?? null,
            details: { auxilioCombustivel: true }, exists: existsKey.has(`${emp.id}|VALE_TRANSPORTE|${p.label}`),
          });
        }
      }
    }

    // ── Adiantamento + Salário ──
    const base = round2(Number(emp.baseSalary ?? 0));
    if (base > 0 && feriaDays.size > 0) {
      warnings.push(`${name} tem férias e salário na mesma competência (${String(month).padStart(2, "0")}/${year}) — confira os valores para não pagar em dobro.`);
    }
    if (base > 0) {
      const advance = round2((base * Number(settings.advancePercent)) / 100);
      const salary = round2(base - advance);
      items.push({
        employeeId: emp.id, employeeName: name, sector: emp.sector, type: "ADIANTAMENTO",
        periodLabel: "Adiantamento", periodStart: null, periodEnd: null,
        dueDate: isoDate(year, month, Math.min(settings.advanceDueDay, daysInMonth)),
        amount: advance, workedDays: null, freeDays: null, bufferAmount: null, creditApplied: null,
        dreCategoryId: dreFolha?.id ?? null, dreCategoryName: dreFolha?.name ?? null,
        details: { base, percent: Number(settings.advancePercent) },
        exists: existsKey.has(`${emp.id}|ADIANTAMENTO|Adiantamento`),
      });
      const ny = month === 12 ? year + 1 : year;
      const nm = month === 12 ? 1 : month + 1;
      const nmDays = new Date(ny, nm, 0).getDate();
      items.push({
        employeeId: emp.id, employeeName: name, sector: emp.sector, type: "SALARIO",
        periodLabel: "Salário", periodStart: null, periodEnd: null,
        dueDate: isoDate(ny, nm, Math.min(settings.salaryDueDay, nmDays)),
        amount: salary, workedDays: null, freeDays: null, bufferAmount: null, creditApplied: null,
        dreCategoryId: dreFolha?.id ?? null, dreCategoryName: dreFolha?.name ?? null,
        details: { base, advance }, exists: existsKey.has(`${emp.id}|SALARIO|Salário`),
      });
    }
  }

  return { year, month, settings, items, creditUpdates, warnings };
}

// Persiste os itens ainda não existentes e atualiza o crédito de VT.
export async function generatePayroll(year: number, month: number, userId: string) {
  const { items, creditUpdates } = await computePayroll(year, month);
  const toCreate = items.filter((i) => !i.exists);

  // Funcionários cujo VT já existia neste mês: não reaplicar o crédito.
  const empsWithExistingVt = new Set(items.filter((i) => i.type === "VALE_TRANSPORTE" && i.exists).map((i) => i.employeeId));

  await prisma.$transaction(async (tx) => {
    for (const item of toCreate) {
      const due = new Date(item.dueDate);
      await tx.payrollItem.create({
        data: {
          id: crypto.randomUUID(),
          employeeId: item.employeeId,
          type: item.type,
          competenceYear: year,
          competenceMonth: month,
          periodLabel: item.periodLabel,
          periodStart: item.periodStart ? new Date(item.periodStart) : null,
          periodEnd: item.periodEnd ? new Date(item.periodEnd) : null,
          dueDate: due,
          amount: item.amount,
          workedDays: item.workedDays,
          freeDays: item.freeDays,
          bufferAmount: item.bufferAmount,
          creditApplied: item.creditApplied,
          details: (item.details ?? undefined) as Prisma.InputJsonValue | undefined,
          status: computeStatus(due, null),
          dreCategoryId: item.dreCategoryId,
          source: "GENERATED",
          createdById: userId,
        },
      });
    }
    for (const upd of creditUpdates) {
      if (empsWithExistingVt.has(upd.employeeId)) continue;
      await tx.employee.update({ where: { id: upd.employeeId }, data: { vtCreditBalance: upd.newBalance } });
    }
  });

  return { year, month, created: toCreate.length, skipped: items.length - toCreate.length };
}
