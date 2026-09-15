// Cálculo de VT a partir do trajeto REAL de cada funcionário.
//
// O trajeto é uma lista de pernas por sentido: "na ida pego ônibus e depois
// metrô; na volta só ônibus". Cada perna aponta para uma tarifa, e cada tarifa
// carrega a própria regra de tarifa zero: o ônibus da SPTrans zera aos
// domingos, a integração ônibus+metrô CAI para a tarifa do metrô (a SPTrans não
// dá desconto de integração quando o ônibus é grátis), e metrô e EMTU cobram
// sempre. É por isso que a regra mora na TARIFA e não no cálculo: quem vem de
// Carapicuíba pela EMTU não pode ter a perna zerada só porque hoje é domingo.
//
// O período é a quinzena exata da escala. Não existe mais "dia de sobra"
// adiantado nem crédito rolando para o período seguinte: paga-se o que o
// funcionário vai gastar nos dias em que ele vem trabalhar, e ponto.

export type Fare = {
  id: string;
  name: string;
  amount: number;
  /** Valor nos dias de tarifa zero; null = cobra normal nesses dias. */
  sundayAmount: number | null;
};

// Domingão Tarifa Zero da SPTrans: ônibus municipal grátis TODO domingo e em
// três feriados — e só nesses três. Os outros 12 feriados do calendário de São
// Paulo (Tiradentes, 7 de Setembro, Consciência Negra...) cobram tarifa cheia.
//
// Isto aqui não é detalhe: tratar "feriado" como sinônimo de gratuidade zerava
// o vale de 7 de setembro para todo mundo que anda de ônibus — dinheiro que a
// pessoa precisa para ir trabalhar no feriado e não receberia.
const TARIFA_ZERO_HOLIDAYS = new Set(["01-01", "01-25", "12-25"]);

export function isTarifaZeroDay(month: number, day: number, isSunday: boolean): boolean {
  return isSunday || TARIFA_ZERO_HOLIDAYS.has(`${pad(month)}-${pad(day)}`);
}

/** O que esta perna custa no dia — já considerando a tarifa zero. */
export function fareOnDay(fare: Fare, tarifaZero: boolean): number {
  if (tarifaZero && fare.sundayAmount != null) return fare.sundayAmount;
  return fare.amount;
}

export type Leg = {
  direction: "IDA" | "VOLTA";
  sortOrder: number;
  fare: Fare;
};

const pad = (n: number) => String(n).padStart(2, "0");

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Custo de um dia inteiro (ida + volta) e a composição, para o comprovante.
export function costForDay(legs: Leg[], tarifaZero: boolean): number {
  let total = 0;
  for (const leg of legs) total += fareOnDay(leg.fare, tarifaZero);
  return round2(total);
}

// Custo de um dia do calendário para este trajeto. Usado no desconto de falta:
// faltar num domingo (ônibus grátis) custa menos que faltar numa terça, e o
// abatimento tem que refletir o que a pessoa REALMENTE deixou de gastar.
export function costOfCalendarDay(legs: Leg[], date: Date): number {
  const tz = isTarifaZeroDay(date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCDay() === 0);
  return costForDay(legs, tz);
}

/** "Ida: Ônibus SP + Metrô · Volta: Ônibus SP" — vai no detalhe do lançamento. */
export function describeLegs(legs: Leg[]): string {
  const side = (dir: "IDA" | "VOLTA") =>
    legs.filter((l) => l.direction === dir).sort((a, b) => a.sortOrder - b.sortOrder).map((l) => l.fare.name).join(" + ");
  const ida = side("IDA");
  const volta = side("VOLTA");
  if (!ida && !volta) return "sem trajeto cadastrado";
  return `Ida: ${ida || "—"} · Volta: ${volta || "—"}`;
}

export type VtPeriodResult = {
  workedDays: number;
  /** Dias trabalhados que caíram em tarifa zero e por isso custaram menos. */
  freeDays: number;
  amount: number;
  /** Custo de um dia comum, sem gratuidade — referência de conferência na tela. */
  normalDayCost: number;
  /** Quanto cada tarifa somou no período. Vira o detalhe auditável do lançamento. */
  byFare: Array<{ fareId: string; fareName: string; trips: number; amount: number }>;
  /**
   * Os dias do mês que este vale realmente pagou.
   *
   * Gravado no lançamento porque é a ÚNICA forma honesta de saber, depois, se
   * uma falta precisa ser devolvida: se o dia está aqui, o dinheiro saiu e o
   * acerto é devido; se não está, o cálculo já o havia excluído e descontar
   * seria cobrar duas vezes. Inferir isso pelo período dava desconto em dobro.
   */
  paidDays: number[];
};

// Percorre [startDay, endDay] do mês, pulando folgas, férias e dias fora do
// vínculo, e soma o custo de cada dia trabalhado.
export function computeVtForPeriod(params: {
  legs: Leg[];
  year: number;
  month: number;
  startDay: number;
  endDay: number;
  folgaDays: Set<number>;
  feriasDays?: Set<number>;
  admissionMs: number | null;
  terminationMs: number | null;
}): VtPeriodResult {
  const { legs, year, month, startDay, endDay, folgaDays, feriasDays, admissionMs, terminationMs } = params;

  let workedDays = 0;
  let freeDays = 0;
  let amount = 0;
  const byFare = new Map<string, { fareId: string; fareName: string; trips: number; amount: number }>();
  const paidDays: number[] = [];

  for (let d = startDay; d <= endDay; d++) {
    const t = Date.UTC(year, month - 1, d);
    if (admissionMs != null && t < admissionMs) continue;
    if (terminationMs != null && t > terminationMs) continue;
    if (folgaDays.has(d)) continue;
    if (feriasDays?.has(d)) continue; // dias de férias: não vem trabalhar, sem VT

    const tarifaZero = isTarifaZeroDay(month, d, new Date(t).getUTCDay() === 0);

    workedDays += 1;
    paidDays.push(d);
    let diaMaisBarato = false;
    for (const leg of legs) {
      const custo = fareOnDay(leg.fare, tarifaZero);
      if (custo < leg.fare.amount) diaMaisBarato = true;
      if (custo <= 0) continue;
      amount += custo;
      const acc = byFare.get(leg.fare.id) ?? { fareId: leg.fare.id, fareName: leg.fare.name, trips: 0, amount: 0 };
      acc.trips += 1;
      acc.amount = round2(acc.amount + custo);
      byFare.set(leg.fare.id, acc);
    }
    if (diaMaisBarato) freeDays += 1;
  }

  return {
    workedDays,
    freeDays,
    amount: round2(amount),
    normalDayCost: costForDay(legs, false),
    byFare: Array.from(byFare.values()),
    paidDays,
  };
}

// ─── Quinzenas ──────────────────────────────────────────────────────────────
// O VT é pago ANTES do funcionário viajar: em 31/08 se paga o período de 01 a
// 15/09; em 15/09 se paga 16 a 30/09. Ou seja, o vencimento é sempre a VÉSPERA
// do primeiro dia do período — o que joga o vencimento da 1ª quinzena para o
// mês anterior. A competência continua sendo o mês das viagens, para o DRE
// registrar a despesa onde ela acontece.

export type VtPeriod = {
  label: string;
  quinzena: 1 | 2;
  startDay: number;
  endDay: number;
  /** Vencimento como [ano, mês, dia] — pode cair no mês anterior. */
  due: [number, number, number];
};

/** Véspera de uma data, como [ano, mês, dia] — atravessa a virada do mês. */
export function eveOf(year: number, month: number, day: number): [number, number, number] {
  const d = new Date(Date.UTC(year, month - 1, day - 1));
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

export function vtPeriods(params: {
  year: number;
  month: number;
  daysInMonth: number;
  periodicity: "QUINZENAL" | "MENSAL";
  secondPeriodStartDay: number;
  labelPrefix: string;
}): VtPeriod[] {
  const { year, month, daysInMonth, periodicity, labelPrefix } = params;
  const cut = Math.min(Math.max(params.secondPeriodStartDay, 2), daysInMonth);

  if (periodicity === "MENSAL") {
    return [{ label: `${labelPrefix} mensal`, quinzena: 1, startDay: 1, endDay: daysInMonth, due: eveOf(year, month, 1) }];
  }
  return [
    { label: `${labelPrefix} 1ª quinzena`, quinzena: 1, startDay: 1, endDay: cut - 1, due: eveOf(year, month, 1) },
    { label: `${labelPrefix} 2ª quinzena`, quinzena: 2, startDay: cut, endDay: daysInMonth, due: eveOf(year, month, cut) },
  ];
}
