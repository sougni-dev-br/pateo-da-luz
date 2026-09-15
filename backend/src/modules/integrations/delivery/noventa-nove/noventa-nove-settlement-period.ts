// Periodo dos repasses semanais da 99 Food.
//
// A 99 paga por semana (dom a sab), entao um repasse atravessa a virada do mes
// com frequencia. O endpoint getShopBillWeek so devolve repasses INTEIRAMENTE
// contidos na janela pedida — verificado em producao em 15/09/2026 com a loja
// PATEO-FREI-CANECA:
//
//   getSettlements(20260801..20260831) -> 4 repasses, nenhum comecando em 31/08
//   getSettlements(20260901..20260915) -> 1 repasse  (07 a 13/09)
//   getSettlements(20260820..20260917) -> 3 repasses, e ai sim aparece o de 31/08
//
// Pedir exatamente o mes fazia o repasse da virada sumir dos DOIS lados: nao
// cabia em agosto (termina em setembro) nem em setembro (comeca em agosto). O
// de 31/08 a 06/09 ficou fora da base e levou junto R$ 651,21 de deducao que
// nunca chegou ao custo de setembro.
//
// A solucao NAO e alargar a janela do mes: a API rejeita consulta com mais de
// 31 dias (errno 110005), e mes cheio + borda da 39. Sao duas consultas — a do
// mes e uma curta em volta da virada — deduplicadas por weekPaymentId.

// Repasses sao semanais, logo o que atravessa a virada comeca no maximo 6 dias
// antes do dia 1 e termina no maximo 5 dias depois. Uma semana de folga de cada
// lado cobre isso com sobra, e a mesma borda serve aos bills que compoem
// bruto/taxas desse repasse.
export const SETTLEMENT_EDGE_DAYS = 8;

// Teto da API por consulta (errno 110005). A janela da virada tem 17 dias e a
// do mes no maximo 31 — a invariante existe para o caso de alguem mexer nos
// numeros acima sem perceber o limite.
export const FINANCE_MAX_RANGE_DAYS = 31;

export type YmdWindow = { startDate: string; endDate: string };

// "YYYYMMDD" -> Date (UTC meia-noite).
export function parseYmd(ymd: string | undefined, fallback: Date): Date {
  if (ymd && /^[0-9]{8}$/.test(ymd)) {
    return new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8))));
  }
  return fallback;
}

export function toYmd(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

function ymdShift(ymd: string, days: number): string {
  const base = parseYmd(ymd, new Date());
  return toYmd(new Date(base.getTime() + days * 86_400_000));
}

export function ymdMinusDays(ymd: string, days: number): string {
  return ymdShift(ymd, -days);
}

export function ymdPlusDays(ymd: string, days: number): string {
  return ymdShift(ymd, days);
}

// Janelas de busca dos REPASSES. A primeira e o proprio mes; a segunda cerca a
// virada, para alcancar o repasse que comeca no mes anterior. Quando a segunda
// ja contem a primeira (comeco de mes, poucos dias decorridos), devolve so uma
// — nao ha ganho em consultar duas vezes o mesmo intervalo.
export function settlementSearchWindows(monthPeriod: YmdWindow): YmdWindow[] {
  const turn: YmdWindow = {
    startDate: ymdMinusDays(monthPeriod.startDate, SETTLEMENT_EDGE_DAYS),
    // Nunca passa do fim do periodo pedido: no mes corrente ele ja vem capado em
    // hoje, e a 99 rejeita data futura.
    endDate: minYmd(ymdPlusDays(monthPeriod.startDate, SETTLEMENT_EDGE_DAYS), monthPeriod.endDate)
  };
  if (turn.endDate >= monthPeriod.endDate) return [turn];
  return [monthPeriod, turn];
}

function minYmd(a: string, b: string): string {
  return a <= b ? a : b;
}

// Dias cobertos por uma janela, inclusive nas duas pontas — a 99 conta assim.
export function windowLengthInDays(window: YmdWindow): number {
  const start = parseYmd(window.startDate, new Date(0));
  const end = parseYmd(window.endDate, new Date(0));
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

// Janela dos BILLS da borda — a semana anterior ao mes. Serve so para compor
// bruto/taxas do repasse que atravessa a virada; as vendas vem da janela do mes.
export function edgeBillsWindow(monthStartYmd: string): YmdWindow {
  return { startDate: ymdMinusDays(monthStartYmd, SETTLEMENT_EDGE_DAYS), endDate: ymdMinusDays(monthStartYmd, 1) };
}

// Um repasse pertence ao mes em que TERMINA — a mesma regra que a despesa
// mensal ja usava para atribuir a deducao. Aplicada tambem na gravacao, ela
// impede que a janela da virada regrave repasses do mes anterior: eles seriam
// recompostos com bills que nem todos estao a mao, e um repasse ja correto
// viraria "incompleto" (bruto = liquido, taxas = 0), mexendo num mes fechado.
export function settlementEndsInMonth(periodEnd: Date, year: number, month: number): boolean {
  return periodEnd.getUTCFullYear() === year && periodEnd.getUTCMonth() + 1 === month;
}
