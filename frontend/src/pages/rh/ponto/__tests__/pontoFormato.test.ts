import { describe, expect, test } from "vitest";
import { ROTULO_DO_ABONO, batidasDosCampos, diasDoMes, fmtMin, minutosDoHorario, normalizarHorario, rotuloDoDia } from "../pontoFormato";

describe("fmtMin", () => {
  test("horas e minutos, com sinal para negativo", () => {
    expect(fmtMin(0)).toBe("0:00");
    expect(fmtMin(90)).toBe("1:30");
    expect(fmtMin(605)).toBe("10:05");
    expect(fmtMin(-75)).toBe("−1:15");
  });
});

describe("normalizarHorario", () => {
  test.each([
    ["800", "08:00"],
    ["8:00", "08:00"],
    ["8h30", "08:30"],
    ["8", "08:00"],
    ["0830", "08:30"],
    ["17:5", "17:05"],
    ["2359", "23:59"],
  ])("%s → %s", (entrada, saida) => {
    expect(normalizarHorario(entrada)).toBe(saida);
  });

  test.each(["", "  ", "24:00", "8:60", "abc", "12345", "8:00:00"])("recusa %j", (entrada) => {
    expect(normalizarHorario(entrada)).toBeNull();
  });
});

describe("batidasDosCampos", () => {
  test("ignora campos vazios e normaliza os outros", () => {
    expect(batidasDosCampos(["800", "", "1300", "1700"])).toEqual(["08:00", "13:00", "17:00"]);
  });
  test("um campo ilegível invalida o dia", () => {
    expect(batidasDosCampos(["800", "xx"])).toBeNull();
  });
  test("tudo vazio dá lista vazia (apaga o dia)", () => {
    expect(batidasDosCampos(["", "", "", ""])).toEqual([]);
  });
});

describe("calendário", () => {
  test("dias do mês e rótulo com dia da semana", () => {
    expect(diasDoMes(2026, 10)).toHaveLength(31);
    expect(diasDoMes(2028, 2)).toHaveLength(29);
    expect(rotuloDoDia("2026-10-05")).toBe("seg 05/10");
    expect(rotuloDoDia("2026-10-04")).toBe("dom 04/10");
  });
});

import { resumoDoDia } from "../pontoFormato";

describe("normalizarHorario — aceita 8h", () => {
  test("8h e 8H viram 08:00", () => {
    expect(normalizarHorario("8h")).toBe("08:00");
    expect(normalizarHorario("17H")).toBe("17:00");
  });
});

describe("fmtMin — sinal de menos de verdade", () => {
  test("usa o sinal − (U+2212), que o leitor de tela lê", () => {
    expect(fmtMin(-90)).toBe("−1:30");
  });
});

describe("resumoDoDia — a conta que ela confere enquanto digita", () => {
  test("quatro batidas normais", () => {
    expect(resumoDoDia(["08:00", "12:00", "13:00", "17:00"])).toEqual({ trabalhadoMin: 480, avisos: [], viraNoite: false });
  });
  test("turno que vira a meia-noite", () => {
    const r = resumoDoDia(["20:00", "02:00"]);
    expect(r.trabalhadoMin).toBe(360);
    expect(r.viraNoite).toBe(true);
  });
  test("batida ímpar soma só os pares e avisa", () => {
    const r = resumoDoDia(["08:00", "12:00", "13:00"]);
    expect(r.trabalhadoMin).toBe(240);
    expect(r.avisos).toContain("Falta uma batida.");
  });
  test("saída digitada antes da entrada vira turno longo e é ignorada com aviso", () => {
    const r = resumoDoDia(["08:00", "07:00"]);
    expect(r.trabalhadoMin).toBe(0);
    expect(r.avisos).toContain("Mais de 16h seguidas: confira os horários.");
  });
  test("batida repetida no mesmo minuto vale uma só", () => {
    expect(resumoDoDia(["08:00", "08:00", "12:00", "13:00", "17:00"]).trabalhadoMin).toBe(480);
  });
  test("dia vazio", () => {
    expect(resumoDoDia([])).toEqual({ trabalhadoMin: 0, avisos: [], viraNoite: false });
  });
});

import { turnoCurto } from "../pontoFormato";

describe("turnoCurto — cabe na linha da grade", () => {
  test("tira os minutos zerados", () => {
    expect(turnoCurto("09:00–18:00")).toBe("09–18");
    expect(turnoCurto("08:30–17:00")).toBe("08:30–17");
    expect(turnoCurto(null)).toBe("");
  });
});

describe("minutosDoHorario (horas abonadas)", () => {
  test("aceita 3:01, 301 e 3h01", () => {
    expect(minutosDoHorario("3:01")).toBe(181);
    expect(minutosDoHorario("301")).toBe(181);
    expect(minutosDoHorario("3h01")).toBe(181);
    expect(minutosDoHorario("0:30")).toBe(30);
  });

  test("vazio ou ilegível dá null", () => {
    expect(minutosDoHorario("")).toBeNull();
    expect(minutosDoHorario("abc")).toBeNull();
  });
});

describe("ROTULO_DO_ABONO", () => {
  test("traduz o motivo e cai em abono para desconhecido", () => {
    expect(ROTULO_DO_ABONO("MEDICO_TRABALHO")).toBe("Médico do trabalho");
    expect(ROTULO_DO_ABONO(null)).toBe("abono");
  });
});
