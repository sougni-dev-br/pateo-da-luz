// Cálculo de VT (transporte público) por tarifa e dias trabalhados.
// Regra SP: ônibus é grátis aos domingos E feriados; metrô cobra sempre.
// A integração ônibus+metrô usa a tarifa integrada nos dias úteis e cai para
// só o metrô nos dias de ônibus grátis.

export type Tariffs = { busFare: number; metroFare: number; integratedFare: number };

const pad = (n: number) => String(n).padStart(2, "0");
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Custo de um dia de deslocamento. freeBus = domingo ou feriado (ônibus grátis).
export function costForDay(commute: string | null, trips: number, tariffs: Tariffs, freeBus: boolean): number {
  const t = trips > 0 ? trips : 2;
  switch (commute) {
    case "ONIBUS":
      return freeBus ? 0 : round2(t * tariffs.busFare);
    case "METRO":
      return round2(t * tariffs.metroFare);
    case "INTEGRADO":
      return freeBus ? round2(t * tariffs.metroFare) : round2(t * tariffs.integratedFare);
    case "ONIBUS_METRO_SEPARADO":
      return freeBus ? round2(t * tariffs.metroFare) : round2(t * (tariffs.busFare + tariffs.metroFare));
    default:
      return 0; // trajeto não configurado
  }
}

export type VtPeriodResult = {
  workedDays: number;
  freeDays: number;   // domingos/feriados trabalhados (ônibus grátis)
  gross: number;      // custo dos dias trabalhados
  normalDayCost: number; // custo de 1 dia útil (usado no buffer)
};

// Percorre [startDay, endDay] do mês, pulando folgas e dias fora do vínculo,
// e soma o custo de cada dia trabalhado.
export function computeVtForPeriod(params: {
  commute: string | null;
  trips: number;
  tariffs: Tariffs;
  year: number;
  month: number;
  startDay: number;
  endDay: number;
  folgaDays: Set<number>;
  feriasDays?: Set<number>;
  admissionMs: number | null;
  terminationMs: number | null;
  holidays: Map<string, string>;
}): VtPeriodResult {
  const { commute, trips, tariffs, year, month, startDay, endDay, folgaDays, feriasDays, admissionMs, terminationMs, holidays } = params;
  let workedDays = 0;
  let freeDays = 0;
  let gross = 0;

  for (let d = startDay; d <= endDay; d++) {
    const t = Date.UTC(year, month - 1, d);
    if (admissionMs != null && t < admissionMs) continue;
    if (terminationMs != null && t > terminationMs) continue;
    if (folgaDays.has(d)) continue;
    if (feriasDays?.has(d)) continue; // dias de férias: não vem trabalhar, sem VT

    const dow = new Date(t).getUTCDay();
    const isHoliday = holidays.has(`${pad(month)}-${pad(d)}`);
    const freeBus = dow === 0 || isHoliday;
    workedDays += 1;
    if (freeBus) freeDays += 1;
    gross += costForDay(commute, trips, tariffs, freeBus);
  }

  return {
    workedDays,
    freeDays,
    gross: round2(gross),
    normalDayCost: costForDay(commute, trips, tariffs, false),
  };
}
