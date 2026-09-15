import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { computeVtForPeriod, costOfCalendarDay, describeLegs, eveOf, round2, vtPeriods, type Fare, type Leg } from "./vt-calc.js";

// Nomes das categorias de DRE que a folha usa. O vinculo e por NOME, com acento:
// renomear a categoria na tela desliga o vinculo e o lancamento vai para o DRE sem
// categoria, saindo do grupo PESSOAL. Este projeto ja foi mordido por essa classe
// — ver o comentario de revenue-channels.ts, onde "Salao" sem acento comparado com
// "Salão" fazia o fechamento do dia recusar todo dia.
//
// Exportados para que as rotas de rescisao e ferias parem de repetir o literal.
export const FOLHA_CATEGORY = "Folha de Pagamento";
export const VT_CATEGORY = "Vale-Transporte";
export const RESCISAO_CATEGORY = "Rescisão";
export const FERIAS_CATEGORY = "Férias";

export type PayrollItemType = "ADIANTAMENTO" | "SALARIO" | "VALE_TRANSPORTE";

// Ausências que devolvem o vale: a pessoa não foi trabalhar, então não gastou
// condução. Atestado entra junto com falta — o motivo da ausência muda o que
// acontece com o SALÁRIO, não com o dinheiro do transporte que não foi usado.
export type AusenciaTipo = "FALTA" | "ATESTADO";
const AUSENCIAS: AusenciaTipo[] = ["FALTA", "ATESTADO"];

// Todos os tipos de folga. Para o VT sao iguais: a pessoa nao vem, nao gasta
// conducao. FOLGA_FERIADO e FOLGA_BANCO_HORAS existem para controle (de onde
// veio a folga), nao para mudar o calculo.
export const TIPOS_DE_FOLGA: Array<"FOLGA" | "FOLGA_FERIADO" | "FOLGA_BANCO_HORAS"> = ["FOLGA", "FOLGA_FERIADO", "FOLGA_BANCO_HORAS"];

// O que gerar: VT (inteiro ou por quinzena), só a folha, ou tudo.
export type PayrollKind = "ALL" | "VT" | "VT_Q1" | "VT_Q2" | "FOLHA";
export const PAYROLL_KINDS: PayrollKind[] = ["ALL", "VT", "VT_Q1", "VT_Q2", "FOLHA"];
const VT_TYPES: PayrollItemType[] = ["VALE_TRANSPORTE"];
const KIND_TYPES: Record<PayrollKind, PayrollItemType[]> = {
  ALL: ["VALE_TRANSPORTE", "ADIANTAMENTO", "SALARIO"],
  VT: VT_TYPES, VT_Q1: VT_TYPES, VT_Q2: VT_TYPES,
  FOLHA: ["ADIANTAMENTO", "SALARIO"],
};
const KIND_QUINZENA: Record<PayrollKind, 1 | 2 | null> = {
  ALL: null, VT: null, VT_Q1: 1, VT_Q2: 2, FOLHA: null,
};
// A quinzena de um item vem carimbada no cálculo. Antes era deduzida do
// vencimento (dia <= 15 => 1ª), e isso QUEBRA agora que o VT vence na véspera
// do período: o vencimento da 1ª quinzena caiu para o último dia do mês
// anterior (dia 31), que a regra antiga leria como 2ª quinzena.

export type ComputedItem = {
  employeeId: string;
  employeeName: string;
  employeeDisplayName: string | null;
  sector: string | null;
  type: PayrollItemType;
  periodLabel: string;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string;
  amount: number;
  workedDays: number | null;
  freeDays: number | null;
  /** 1 ou 2 para o VT; null para salário/adiantamento, que não têm quinzena. */
  quinzena: 1 | 2 | null;
  /** Ausências já pagas que este vale abate. Vira VtFaltaDeduction ao gerar. */
  faltaDeductions?: Array<{ date: string; amount: number; tipo: AusenciaTipo }>;
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
//
// `quinzenaAGerar` existe por causa de um buraco sutil: o cálculo percorre SEMPRE
// as duas quinzenas, e a fila de faltas pendentes é consumida em ordem. Se o
// operador manda gerar só a 2ª quinzena com a 1ª ainda não gerada, a 1ª — que
// nunca vira lançamento — "reserva" as faltas e a 2ª sai sem o desconto que
// deveria ter. O dinheiro sai a mais e o acerto só aconteceria no período
// seguinte. Informando o escopo, só a quinzena que vai virar lançamento reserva.
export async function computePayroll(year: number, month: number, quinzenaAGerar?: 1 | 2 | null) {
  const settings = await getOrDefaultSettings();
  const daysInMonth = new Date(year, month, 0).getDate();

  const employees = await prisma.employee.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: [{ sector: "asc" }, { firstName: "asc" }, { lastName: "asc" }],
    include: {
      vtLegs: { include: { fare: true }, orderBy: [{ direction: "asc" }, { sortOrder: "asc" }] },
      vtMonthlyFare: true,
    },
  });
  const empIds = employees.map((e) => e.id);

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const nextMonthStart = new Date(Date.UTC(year, month, 1));
  const folgas = await prisma.employeeScheduleDay.findMany({
    where: { employeeId: { in: empIds }, date: { gte: monthStart, lt: nextMonthStart }, type: { in: TIPOS_DE_FOLGA } },
    select: { employeeId: true, date: true },
  });
  const folgasByEmp = new Map<string, Set<number>>();
  for (const f of folgas) {
    const s = folgasByEmp.get(f.employeeId) ?? new Set<number>();
    s.add(f.date.getUTCDate());
    folgasByEmp.set(f.employeeId, s);
  }

  // Ausências DESTE mês (falta ou atestado): o dia não é trabalhado, então nem
  // entra no vale.
  const faltas = await prisma.employeeScheduleDay.findMany({
    where: { employeeId: { in: empIds }, date: { gte: monthStart, lt: nextMonthStart }, type: { in: AUSENCIAS } },
    select: { employeeId: true, date: true },
  });
  const faltasByEmp = new Map<string, Set<number>>();
  for (const f of faltas) {
    const s = faltasByEmp.get(f.employeeId) ?? new Set<number>();
    s.add(f.date.getUTCDate());
    faltasByEmp.set(f.employeeId, s);
  }

  // Faltas ATRASADAS: dias que já foram pagos e ainda não foram descontados.
  // O vale sai adiantado, então a falta de ontem só pode ser acertada no vale
  // de amanhã — inclusive a falta da 1ª quinzena, que acerta na 2ª.
  //
  // Um ano de histórico é o alcance: falta mais velha que isso nunca foi
  // descontada porque ninguém marcou na época, e ressuscitá-la agora viraria um
  // desconto surpresa no salário de alguém.
  const faltaFloor = new Date(Date.UTC(year - 1, month - 1, 1));
  const faltasAnteriores = await prisma.employeeScheduleDay.findMany({
    where: {
      employeeId: { in: empIds },
      type: { in: AUSENCIAS },
      date: { gte: faltaFloor, lt: nextMonthStart },
      employee: { vtType: "TRANSPORTE_PUBLICO" },
    },
    select: { employeeId: true, date: true, type: true },
    orderBy: { date: "asc" },
  });
  const jaDescontadas = await prisma.vtFaltaDeduction.findMany({
    where: { employeeId: { in: empIds } },
    select: { employeeId: true, date: true },
  });
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);
  const descontadaKey = new Set(jaDescontadas.map((d) => `${d.employeeId}|${isoDay(d.date)}`));

  // Só desconta falta de dia que o vale REALMENTE pagou. Cada lançamento guarda
  // em details.diasPagos exatamente quais dias ele cobriu; é isso que se
  // consulta aqui.
  //
  // Antes eu inferia pelo período ("a falta caiu dentro de uma quinzena já
  // gerada, logo foi paga") e isso descontava em DOBRO: uma falta marcada antes
  // de gerar já saía do cálculo como dia não trabalhado, e ainda assim virava
  // abatimento na quinzena seguinte. Período não diz o que foi pago; a lista de
  // dias diz. Lançamentos antigos, sem essa lista, ficam de fora — não dá para
  // adivinhar o que eles cobriram, e chutar aqui vira desconto no bolso de
  // alguém.
  const vtPagos = await prisma.payrollItem.findMany({
    where: { employeeId: { in: empIds }, type: "VALE_TRANSPORTE", deletedAt: null, periodStart: { not: null } },
    select: { employeeId: true, periodStart: true, periodEnd: true, details: true },
  });
  const diasPagosKey = new Set<string>();
  for (const v of vtPagos) {
    const dias = (v.details as { diasPagos?: unknown } | null)?.diasPagos;
    if (!Array.isArray(dias)) continue;
    const ano = v.periodStart!.getUTCFullYear();
    const mes = v.periodStart!.getUTCMonth() + 1;
    for (const d of dias) {
      if (typeof d !== "number") continue;
      diasPagosKey.add(`${v.employeeId}|${isoDay(new Date(Date.UTC(ano, mes - 1, d)))}`);
    }
  }

  const faltasAbertasByEmp = new Map<string, Array<{ date: Date; tipo: AusenciaTipo }>>();
  for (const f of faltasAnteriores) {
    const key = `${f.employeeId}|${isoDay(f.date)}`;
    if (descontadaKey.has(key)) continue;
    if (!diasPagosKey.has(key)) continue;
    const list = faltasAbertasByEmp.get(f.employeeId) ?? [];
    list.push({ date: f.date, tipo: f.type as AusenciaTipo });
    faltasAbertasByEmp.set(f.employeeId, list);
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
    select: { employeeId: true, type: true, periodLabel: true, amount: true, workedDays: true, freeDays: true },
  });
  const existingByKey = new Map(existingRows.map((e) => [`${e.employeeId}|${e.type}|${e.periodLabel}`, e]));
  const existsKey = new Set(existingByKey.keys());

  const items: ComputedItem[] = [];
  const warnings: string[] = [];
  // Nao achar a categoria nao derruba a geracao — o lancamento nasce sem categoria,
  // o que e recuperavel. Mas nascia em SILENCIO: o item saia do grupo PESSOAL do DRE
  // e ia para "Sem categoria" sem ninguem notar. Agora avisa.
  if (!dreFolha) {
    warnings.push(`Categoria de DRE "${FOLHA_CATEGORY}" nao encontrada — salario e adiantamento vao ficar sem categoria no DRE.`);
  }
  if (!dreVt) {
    warnings.push(`Categoria de DRE "${VT_CATEGORY}" nao encontrada — o vale-transporte vai ficar sem categoria no DRE.`);
  }


  for (const emp of employees) {
    const name = `${emp.firstName} ${emp.lastName}`.trim();
    const folgaDays = folgasByEmp.get(emp.id) ?? new Set<number>();
    const feriaDays = feriasByEmp.get(emp.id) ?? new Set<number>();
    const faltaDays = faltasByEmp.get(emp.id) ?? new Set<number>();
    let faltasPendentes: Array<{ date: Date; tipo: AusenciaTipo }> = faltasAbertasByEmp.get(emp.id) ?? [];
    const admissionMs = emp.admissionDate ? new Date(emp.admissionDate).getTime() : null;
    const terminationMs = emp.terminationDate ? new Date(emp.terminationDate).getTime() : null;

    // ── Vale-transporte ──
    // Três caminhos mutuamente exclusivos: trajeto calculado pela escala,
    // bilhete mensal de valor fechado, e ajuda de custo em dinheiro.
    const vtLegs: Leg[] = emp.vtLegs.map((l) => ({
      direction: l.direction,
      sortOrder: l.sortOrder,
      fare: {
        id: l.fare.id,
        name: l.fare.name,
        amount: round2(Number(l.fare.amount)),
        sundayAmount: l.fare.sundayAmount == null ? null : round2(Number(l.fare.sundayAmount)),
      } satisfies Fare,
    }));

    if (emp.vtType === "BILHETE_MENSAL") {
      // Valor fechado no mês (ilimitado): não depende de dias trabalhados.
      const label = "VT Bilhete Único Mensal";
      if (!emp.vtMonthlyFare) {
        warnings.push(`${name} está como Bilhete Único Mensal mas não tem tarifa mensal escolhida — o vale sai R$ 0,00.`);
      }
      items.push({
        employeeId: emp.id, employeeName: name, employeeDisplayName: emp.displayName, sector: emp.sector, type: "VALE_TRANSPORTE",
        periodLabel: label,
        periodStart: isoDate(year, month, 1), periodEnd: isoDate(year, month, daysInMonth),
        dueDate: isoDate(...eveOf(year, month, 1)), amount: round2(Number(emp.vtMonthlyFare?.amount ?? 0)),
        workedDays: null, freeDays: null, quinzena: 1,
        dreCategoryId: dreVt?.id ?? null, dreCategoryName: dreVt?.name ?? null,
        details: { bilheteUnicoMensal: true, tarifa: emp.vtMonthlyFare?.name ?? null },
        exists: existsKey.has(`${emp.id}|VALE_TRANSPORTE|${label}`),
      });
    } else if (emp.vtType === "TRANSPORTE_PUBLICO") {
      const periods = vtPeriods({
        year, month, daysInMonth, periodicity: emp.vtPeriodicity,
        secondPeriodStartDay: settings.vtSecondPeriodStartDay, labelPrefix: "VT",
      });
      for (const p of periods) {
        if (p.startDay > p.endDay) continue;
        const base = {
          employeeId: emp.id, employeeName: name, employeeDisplayName: emp.displayName, sector: emp.sector,
          type: "VALE_TRANSPORTE" as const,
          periodLabel: p.label,
          periodStart: isoDate(year, month, p.startDay), periodEnd: isoDate(year, month, p.endDay),
          dueDate: isoDate(...p.due),
          quinzena: p.quinzena,
          dreCategoryId: dreVt?.id ?? null, dreCategoryName: dreVt?.name ?? null,
        };

        // Período já lançado: mostra o que está gravado (o valor pago), não um
        // recálculo — conferir um período fechado contra número novo confunde.
        const prev = existingByKey.get(`${emp.id}|VALE_TRANSPORTE|${p.label}`);
        if (prev) {
          items.push({
            ...base,
            amount: Number(prev.amount), workedDays: prev.workedDays, freeDays: prev.freeDays,
            details: { trajeto: describeLegs(vtLegs) }, exists: true,
          });
          continue;
        }

        const r = computeVtForPeriod({
          legs: vtLegs, year, month, startDay: p.startDay, endDay: p.endDay,
          folgaDays: new Set([...folgaDays, ...faltaDays]), feriasDays: feriaDays,
          admissionMs, terminationMs,
        });

        // Acerto das faltas já pagas, em ordem de data (as mais antigas primeiro).
        //
        // Duas travas que existem para não sumir com dinheiro de ninguém:
        //
        // 1. Desconta o dia INTEIRO ou não desconta. Abater só o que "cabe" no
        //    vale e ainda assim carimbar a falta como quitada evaporava a
        //    diferença — o funcionário ficava devendo um valor que ninguém mais
        //    ia cobrar. O que não couber fica pendente para o vale seguinte.
        // 2. O vale nunca fica negativo. VT não se cobra do funcionário; se o
        //    período todo não cobre as faltas, o resto espera o próximo.
        const periodStartDate = new Date(Date.UTC(year, month - 1, p.startDay));
        const descontos: Array<{ date: string; amount: number; tipo: AusenciaTipo }> = [];
        let restante = r.amount;
        // Quinzena fora do escopo do que está sendo gerado não reserva falta —
        // ela não vai virar lançamento, e reservar deixaria o desconto órfão.
        const podeReservar = quinzenaAGerar == null || quinzenaAGerar === p.quinzena;
        // Sem trajeto cadastrado não dá para saber quanto o dia custou. Quitar a
        // falta com zero aqui a encerraria para sempre (a chave única não deixa
        // reprocessar) mesmo tendo sido paga integralmente lá atrás.
        const sabeOCusto = vtLegs.length > 0;
        for (const pend of podeReservar && sabeOCusto ? faltasPendentes : []) {
          const dia = pend.date;
          if (dia >= periodStartDate) continue; // ausência dentro do próprio período já saiu do cálculo acima
          const custo = round2(costOfCalendarDay(vtLegs, dia));
          // Faltou num dia que já sairia de graça (domingo, para quem só usa
          // ônibus): não há o que devolver. Fica quitada com zero em vez de
          // voltar para a fila em toda folha, para sempre.
          if (custo <= 0) {
            descontos.push({ date: isoDay(dia), amount: 0, tipo: pend.tipo });
            continue;
          }
          if (custo > restante) break; // não cabe inteiro: espera o próximo vale
          descontos.push({ date: isoDay(dia), amount: custo, tipo: pend.tipo });
          restante = round2(restante - custo);
        }
        const totalDesconto = round2(descontos.reduce((s, d) => s + d.amount, 0));
        // Consome o que foi usado, para a 2ª quinzena não descontar de novo o
        // que a 1ª já abateu dentro da MESMA prévia.
        faltasPendentes = faltasPendentes.filter((d) => !descontos.some((x) => x.date === isoDay(d.date)));

        // Trajeto em branco faz o cálculo devolver ZERO sem reclamar. O funcionário
        // está marcado como TRANSPORTE_PUBLICO, trabalhou o período, e o vale sai
        // R$ 0,00 — dinheiro que ele tinha a receber e não recebeu. Em 09/2026 eram
        // SEIS funcionários ativos assim. O aviso olha a CAUSA (trajeto ausente),
        // não o resultado, porque zero legítimo também existe.
        if (vtLegs.length === 0 && r.workedDays > 0) {
          warnings.push(
            `${name} recebe vale-transporte mas não tem trajeto cadastrado: ` +
            `${r.workedDays} dia(s) trabalhado(s) em ${p.label} e vale de R$ 0,00. ` +
            `Cadastre a ida e a volta na ficha do funcionário.`
          );
        }
        // Tarifa sem valor é o mesmo buraco por outro caminho — a EMTU nasce
        // assim, esperando o preço da linha. Sem o aviso o vale sai a menos e
        // ninguém percebe, porque a conta "funciona".
        const zeradas = Array.from(new Set(vtLegs.filter((l) => l.fare.amount <= 0).map((l) => l.fare.name)));
        if (zeradas.length > 0 && r.workedDays > 0) {
          warnings.push(`${name} usa tarifa sem valor preenchido (${zeradas.join(", ")}) — o vale de ${p.label} está saindo a menos.`);
        }

        items.push({
          ...base,
          amount: round2(r.amount - totalDesconto), workedDays: r.workedDays, freeDays: r.freeDays,
          details: {
            trajeto: describeLegs(vtLegs),
            custoDiaNormal: r.normalDayCost,
            porTarifa: r.byFare,
            // Os dias que este vale cobriu — base do acerto de falta depois.
            diasPagos: r.paidDays,
            // A lista vai inteira, incluindo as faltas quitadas com ZERO: é a
            // partir dela que a restauração de um lançamento excluído recarimba
            // os abatimentos. Guardar só as que tiveram valor faria a falta de
            // domingo voltar para a fila depois de um excluir/restaurar.
            ...(descontos.length > 0
              ? { brutoAntesDeFaltas: r.amount, descontoFaltas: totalDesconto, faltasDescontadas: descontos }
              : {}),
          },
          faltaDeductions: descontos,
          exists: false,
        });
      }
    } else if (emp.vtType === "AUXILIO_COMBUSTIVEL") {
      const val = round2(Number(emp.vtFixedAmount ?? 0));
      if (val > 0) {
        const periods = vtPeriods({
          year, month, daysInMonth, periodicity: emp.vtPeriodicity,
          secondPeriodStartDay: settings.vtSecondPeriodStartDay, labelPrefix: "Ajuda de custo",
        });
        for (const p of periods) {
          items.push({
            employeeId: emp.id, employeeName: name, employeeDisplayName: emp.displayName, sector: emp.sector, type: "VALE_TRANSPORTE",
            periodLabel: p.label,
            periodStart: isoDate(year, month, p.startDay), periodEnd: isoDate(year, month, p.endDay),
            dueDate: isoDate(...p.due),
            amount: val, workedDays: null, freeDays: null, quinzena: p.quinzena,
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
        employeeId: emp.id, employeeName: name, employeeDisplayName: emp.displayName, sector: emp.sector, type: "ADIANTAMENTO",
        periodLabel: "Adiantamento", periodStart: null, periodEnd: null,
        dueDate: isoDate(year, month, Math.min(settings.advanceDueDay, daysInMonth)),
        amount: advance, workedDays: null, freeDays: null, quinzena: null,
        dreCategoryId: dreFolha?.id ?? null, dreCategoryName: dreFolha?.name ?? null,
        details: { base, percent: Number(settings.advancePercent) },
        exists: existsKey.has(`${emp.id}|ADIANTAMENTO|Adiantamento`),
      });
      const ny = month === 12 ? year + 1 : year;
      const nm = month === 12 ? 1 : month + 1;
      const nmDays = new Date(ny, nm, 0).getDate();
      items.push({
        employeeId: emp.id, employeeName: name, employeeDisplayName: emp.displayName, sector: emp.sector, type: "SALARIO",
        periodLabel: "Salário", periodStart: null, periodEnd: null,
        dueDate: isoDate(ny, nm, Math.min(settings.salaryDueDay, nmDays)),
        amount: salary, workedDays: null, freeDays: null, quinzena: null,
        dreCategoryId: dreFolha?.id ?? null, dreCategoryName: dreFolha?.name ?? null,
        details: { base, advance }, exists: existsKey.has(`${emp.id}|SALARIO|Salário`),
      });
    }
  }

  return { year, month, settings, items, warnings };
}

// Persiste os itens ainda não existentes.
// `overrides` = valor ajustado à mão na prévia. O cálculo é uma base, não uma
// prisão: se não bater com a realidade, corrige aqui em vez de ir pra planilha.
export type PayrollOverride = { employeeId: string; type: string; periodLabel: string; amount: number };
const overrideKey = (o: { employeeId: string; type: string; periodLabel: string }) =>
  `${o.employeeId}|${o.type}|${o.periodLabel}`;

export async function generatePayroll(
  year: number, month: number, userId: string, kind: PayrollKind = "ALL", overrides: PayrollOverride[] = []
) {
  const { items } = await computePayroll(year, month, KIND_QUINZENA[kind]);

  // VT e folha (adiantamento + salário) são coisas distintas: periodicidade,
  // categoria no DRE e momento de fechamento diferentes. Por isso dá para
  // gerar cada uma isoladamente — e o VT ainda por quinzena, já que a 2ª só
  // fecha quando a escala da segunda metade do mês está pronta.
  const allowed = KIND_TYPES[kind];
  const quinzena = KIND_QUINZENA[kind];
  const escopo = items.filter((i) => allowed.includes(i.type) && (quinzena == null || i.quinzena === quinzena));
  const toCreate = escopo.filter((i) => !i.exists);

  const ajustes = new Map(overrides.map((o) => [overrideKey(o), round2(Number(o.amount))]));
  let ajustados = 0;

  await prisma.$transaction(async (tx) => {
    for (const item of toCreate) {
      const due = new Date(item.dueDate);
      const ajustado = ajustes.get(overrideKey(item));
      const usaAjuste = ajustado != null && ajustado > 0 && ajustado !== item.amount;
      if (usaAjuste) ajustados += 1;
      // A chave unica (employeeId, type, ano, mes, periodLabel) NAO inclui deletedAt, mas
      // existsKey acima so enxerga o que tem deletedAt null. Um item apagado continua
      // ocupando a chave: o gerador o considerava inexistente, tentava criar, e o P2002
      // derrubava a transacao inteira — o mes todo falhava por causa de um lancamento, e
      // a linha em conflito e invisivel na tela porque esta apagada. Agora o upsert
      // ressuscita: regerar a folha e exatamente o gesto de querer o lancamento de volta.
      await tx.payrollItem.upsert({
        where: {
          employeeId_type_competenceYear_competenceMonth_periodLabel: {
            employeeId: item.employeeId,
            type: item.type,
            competenceYear: year,
            competenceMonth: month,
            periodLabel: item.periodLabel,
          },
        },
        update: {
          dueDate: due,
          amount: usaAjuste ? ajustado : item.amount,
          workedDays: item.workedDays,
          freeDays: item.freeDays,
          details: ({
            ...(item.details ?? {}),
            ...(usaAjuste ? { ajusteManual: true, valorCalculado: item.amount } : {}),
          }) as Prisma.InputJsonValue,
          status: computeStatus(due, null),
          dreCategoryId: item.dreCategoryId,
          source: "GENERATED",
          updatedById: userId,
          deletedAt: null,
          deletedById: null,
        },
        create: {
          id: crypto.randomUUID(),
          employeeId: item.employeeId,
          type: item.type,
          competenceYear: year,
          competenceMonth: month,
          periodLabel: item.periodLabel,
          periodStart: item.periodStart ? new Date(item.periodStart) : null,
          periodEnd: item.periodEnd ? new Date(item.periodEnd) : null,
          dueDate: due,
          amount: usaAjuste ? ajustado : item.amount,
          workedDays: item.workedDays,
          freeDays: item.freeDays,
          // Guarda o valor calculado quando houve ajuste manual — sem isso não
          // dá para auditar depois por que o lançamento saiu diferente da regra.
          details: ({
            ...(item.details ?? {}),
            ...(usaAjuste ? { ajusteManual: true, valorCalculado: item.amount } : {}),
          }) as Prisma.InputJsonValue,
          status: computeStatus(due, null),
          dreCategoryId: item.dreCategoryId,
          // Continua "GENERATED": foi o gerador que criou, só com valor ajustado.
          // "MANUAL" já identifica rescisão/férias lançadas à mão.
          source: "GENERATED",
          createdById: userId,
        },
      });

      // Carimba as faltas que este vale abateu. A unique (employeeId, date) é a
      // trava real contra desconto duplo; o skipDuplicates evita que regerar a
      // folha derrube a transação inteira por causa de uma falta já carimbada.
      if (item.faltaDeductions?.length) {
        const row = await tx.payrollItem.findUnique({
          where: {
            employeeId_type_competenceYear_competenceMonth_periodLabel: {
              employeeId: item.employeeId, type: item.type,
              competenceYear: year, competenceMonth: month, periodLabel: item.periodLabel,
            },
          },
          select: { id: true },
        });
        if (row) {
          await tx.vtFaltaDeduction.createMany({
            data: item.faltaDeductions.map((d) => ({
              id: crypto.randomUUID(),
              employeeId: item.employeeId,
              date: new Date(`${d.date}T00:00:00.000Z`),
              dayType: d.tipo,
              amount: d.amount,
              payrollItemId: row.id,
            })),
            skipDuplicates: true,
          });
        }
      }
    }
  });

  return { year, month, kind, created: toCreate.length, skipped: escopo.length - toCreate.length, ajustados };
}
