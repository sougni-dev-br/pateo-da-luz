import { describe, expect, test } from "vitest";
import {
  FINANCE_MAX_RANGE_DAYS,
  edgeBillsWindow,
  parseYmd,
  settlementEndsInMonth,
  settlementSearchWindows,
  windowLengthInDays,
  ymdMinusDays,
  ymdPlusDays
} from "../noventa-nove-settlement-period.js";

const utc = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m - 1, d));

describe("settlementSearchWindows", () => {
  test("mes fechado: uma janela do mes e outra cercando a virada", () => {
    // Arrange
    const monthPeriod = { startDate: "20260801", endDate: "20260831" };

    // Act
    const windows = settlementSearchWindows(monthPeriod);

    // Assert — o repasse de 31/08 a 06/09 so cabe inteiro na janela da virada
    expect(windows).toEqual([
      { startDate: "20260801", endDate: "20260831" },
      { startDate: "20260724", endDate: "20260809" }
    ]);
  });

  test("mes corrente: a janela da virada alcanca o repasse que veio de agosto", () => {
    const windows = settlementSearchWindows({ startDate: "20260901", endDate: "20260915" });

    expect(windows).toContainEqual({ startDate: "20260824", endDate: "20260909" });
    // 31/08..06/09 cabe inteiro nessa janela — era exatamente o repasse perdido
    expect("20260824" <= "20260831" && "20260906" <= "20260909").toBe(true);
  });

  test("nenhuma janela estoura o teto de 31 dias da API (errno 110005)", () => {
    const meses = [
      { startDate: "20260101", endDate: "20260131" },
      { startDate: "20260201", endDate: "20260228" },
      { startDate: "20260401", endDate: "20260430" },
      { startDate: "20261201", endDate: "20261231" }
    ];
    for (const mes of meses) {
      for (const w of settlementSearchWindows(mes)) {
        expect(windowLengthInDays(w)).toBeLessThanOrEqual(FINANCE_MAX_RANGE_DAYS);
      }
    }
  });

  test("comeco de mes: a janela da virada ja cobre o mes, entao vai uma consulta so", () => {
    const windows = settlementSearchWindows({ startDate: "20260901", endDate: "20260903" });

    expect(windows).toEqual([{ startDate: "20260824", endDate: "20260903" }]);
  });

  test("nunca pede data alem do fim do periodo, que no mes corrente e hoje", () => {
    for (const w of settlementSearchWindows({ startDate: "20260901", endDate: "20260905" })) {
      expect(w.endDate <= "20260905").toBe(true);
    }
  });

  test("atravessa a virada do ano sem quebrar", () => {
    expect(settlementSearchWindows({ startDate: "20260101", endDate: "20260131" })).toContainEqual({
      startDate: "20251224",
      endDate: "20260109"
    });
  });
});

describe("edgeBillsWindow", () => {
  test("cobre a semana anterior ao mes, terminando na vespera do dia 1", () => {
    expect(edgeBillsWindow("20260901")).toEqual({ startDate: "20260824", endDate: "20260831" });
  });
});

describe("settlementEndsInMonth", () => {
  test("repasse que comeca no mes anterior pertence ao mes em que termina", () => {
    expect(settlementEndsInMonth(utc(2026, 9, 6), 2026, 9)).toBe(true);
  });

  test("o mesmo repasse NAO pertence ao mes em que comecou", () => {
    expect(settlementEndsInMonth(utc(2026, 9, 6), 2026, 8)).toBe(false);
  });

  test("repasse inteiro do mes anterior, trazido pela janela da virada, fica de fora", () => {
    expect(settlementEndsInMonth(utc(2026, 8, 30), 2026, 9)).toBe(false);
  });

  test("dezembro e janeiro nao se confundem", () => {
    expect(settlementEndsInMonth(utc(2026, 12, 31), 2026, 12)).toBe(true);
    expect(settlementEndsInMonth(utc(2027, 1, 3), 2026, 12)).toBe(false);
  });
});

describe("helpers de data", () => {
  test("parseYmd le YYYYMMDD como meia-noite UTC e cai no fallback quando invalido", () => {
    expect(parseYmd("20260831", utc(2000, 1, 1)).toISOString()).toBe("2026-08-31T00:00:00.000Z");
    expect(parseYmd(undefined, utc(2000, 1, 1)).toISOString()).toBe("2000-01-01T00:00:00.000Z");
    expect(parseYmd("31/08/2026", utc(2000, 1, 1)).toISOString()).toBe("2000-01-01T00:00:00.000Z");
  });

  test("ymdMinusDays e ymdPlusDays atravessam mes e ano", () => {
    expect(ymdMinusDays("20260301", 1)).toBe("20260228");
    expect(ymdMinusDays("20260101", 1)).toBe("20251231");
    expect(ymdPlusDays("20261231", 1)).toBe("20270101");
    expect(ymdPlusDays("20260228", 1)).toBe("20260301");
  });

  test("windowLengthInDays conta as duas pontas", () => {
    expect(windowLengthInDays({ startDate: "20260901", endDate: "20260901" })).toBe(1);
    expect(windowLengthInDays({ startDate: "20260801", endDate: "20260831" })).toBe(31);
  });
});
