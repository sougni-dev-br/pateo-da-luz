// Feriados de São Paulo (capital): nacionais + estadual + municipal + móveis.
// Usado para destacar dias no grid da escala e, na Fase 3, para a regra do VT
// (ônibus grátis em SP aos domingos E feriados).

function easterSunday(year: number): { month: number; day: number } {
  // Algoritmo de Gauss/Computus (Anonymous Gregorian).
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = março, 4 = abril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function shiftDate(year: number, month: number, day: number, delta: number): { month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day + delta));
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (month: number, day: number) => `${pad(month)}-${pad(day)}`;

// Retorna um Map "MM-DD" -> nome do feriado para o ano informado.
export function holidaysForYear(year: number): Map<string, string> {
  const map = new Map<string, string>();

  const fixed: Array<[number, number, string]> = [
    [1, 1, "Confraternização Universal"],
    [1, 25, "Aniversário de São Paulo"],
    [4, 21, "Tiradentes"],
    [5, 1, "Dia do Trabalho"],
    [7, 9, "Revolução Constitucionalista"],
    [9, 7, "Independência do Brasil"],
    [10, 12, "Nossa Senhora Aparecida"],
    [11, 2, "Finados"],
    [11, 15, "Proclamação da República"],
    [11, 20, "Consciência Negra"],
    [12, 25, "Natal"],
  ];
  for (const [m, d, name] of fixed) map.set(keyOf(m, d), name);

  const easter = easterSunday(year);
  const goodFriday = shiftDate(year, easter.month, easter.day, -2);
  const carnivalTue = shiftDate(year, easter.month, easter.day, -47);
  const carnivalMon = shiftDate(year, easter.month, easter.day, -48);
  const corpus = shiftDate(year, easter.month, easter.day, 60);
  map.set(keyOf(goodFriday.month, goodFriday.day), "Sexta-feira Santa");
  map.set(keyOf(carnivalTue.month, carnivalTue.day), "Carnaval");
  map.set(keyOf(carnivalMon.month, carnivalMon.day), "Carnaval");
  map.set(keyOf(corpus.month, corpus.day), "Corpus Christi");

  return map;
}
