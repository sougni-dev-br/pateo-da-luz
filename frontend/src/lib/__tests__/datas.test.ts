import { describe, expect, test } from "vitest";
import { dataLocalIso, hojeLocalIso } from "../datas";
import { somarDias } from "../formas-pagamento";
import { dateKey, sameDay } from "../../pages/inventory/shared";

// O fuso America/Sao_Paulo vem do vitest.config.ts. Numa maquina em UTC,
// toISOString e a data local coincidem e o bug antigo passaria — por isso o
// primeiro teste confere a premissa.
const NOITE_DO_DIA_30 = () => new Date(2026, 8, 30, 23, 30);

describe("premissa dos testes", () => {
  test("o fuso de Sao Paulo esta valendo: 23h30 do dia 30 ja e dia 1o em UTC", () => {
    expect(NOITE_DO_DIA_30().toISOString().slice(0, 10)).toBe("2026-10-01");
  });
});

describe("dataLocalIso / hojeLocalIso", () => {
  test("23h30 local do dia 30 continua sendo dia 30", () => {
    expect(dataLocalIso(NOITE_DO_DIA_30())).toBe("2026-09-30");
    expect(hojeLocalIso(NOITE_DO_DIA_30())).toBe("2026-09-30");
  });

  test("virada de ano a noite fica no ano velho", () => {
    expect(hojeLocalIso(new Date(2026, 11, 31, 22, 0))).toBe("2026-12-31");
  });

  test("zero a esquerda em mes e dia", () => {
    expect(dataLocalIso(new Date(2026, 0, 5, 0, 0))).toBe("2026-01-05");
  });

  test("meia-noite local e o proprio dia", () => {
    expect(dataLocalIso(new Date(2026, 8, 1, 0, 0))).toBe("2026-09-01");
  });

  test("sem argumento usa o relogio agora", () => {
    expect(hojeLocalIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("agenda de inventario: dateKey em UTC, sameDay contra o dia local", () => {
  // O backend grava scheduledDate como meia-noite do servidor, que roda em UTC.
  const AGENDA_DIA_30 = "2026-09-30T00:00:00.000Z";

  test("dateKey le a data gravada em UTC sem voltar um dia", () => {
    expect(dateKey(AGENDA_DIA_30)).toBe("2026-09-30");
  });

  test("as 23h30 do dia 30 a agenda de hoje e a do dia 30", () => {
    expect(sameDay(AGENDA_DIA_30, NOITE_DO_DIA_30())).toBe(true);
  });

  test("as 23h30 do dia 30 a agenda do dia 1o ainda nao e de hoje", () => {
    expect(sameDay("2026-10-01T00:00:00.000Z", NOITE_DO_DIA_30())).toBe(false);
  });

  test("de manha cedo tambem casa com o proprio dia", () => {
    expect(sameDay(AGENDA_DIA_30, new Date(2026, 8, 30, 0, 30))).toBe(true);
  });
});

describe("somarDias formata no fuso local", () => {
  test("atravessa o fim do mes", () => {
    expect(somarDias("2026-09-30", 1)).toBe("2026-10-01");
  });

  test("zero dias devolve a propria data", () => {
    expect(somarDias("2026-09-30", 0)).toBe("2026-09-30");
  });

  test("entrada vazia ou invalida devolve vazio", () => {
    expect(somarDias("", 3)).toBe("");
    expect(somarDias("xx", 3)).toBe("");
  });
});
