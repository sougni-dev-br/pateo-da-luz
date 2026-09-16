import { describe, expect, test } from "vitest";
import { cicloDivergeDaData, cicloSugerido, opcoesDeCiclo, rotuloDoCiclo } from "../ciclo-contagem";

describe("cicloSugerido — o caso que deixou agosto sem inventario", () => {
  test("contagem em 01 e 02/09 sugere o ciclo de agosto", () => {
    // As sete contagens que fecham agosto/2026 foram feitas nestes dois dias,
    // porque o dia 31 tinha evento. Nasceram marcadas como 9/2026.
    expect(cicloSugerido("2026-09-01")).toEqual({ mes: 8, ano: 2026 });
    expect(cicloSugerido("2026-09-02")).toEqual({ mes: 8, ano: 2026 });
  });

  test("do dia 6 em diante e o proprio mes", () => {
    expect(cicloSugerido("2026-09-06")).toEqual({ mes: 9, ano: 2026 });
    expect(cicloSugerido("2026-09-16")).toEqual({ mes: 9, ano: 2026 });
    expect(cicloSugerido("2026-08-27")).toEqual({ mes: 8, ano: 2026 });
  });

  test("o dia 5 ainda e virada; o 6 ja nao e", () => {
    expect(cicloSugerido("2026-09-05")).toEqual({ mes: 8, ano: 2026 });
    expect(cicloSugerido("2026-09-06")).toEqual({ mes: 9, ano: 2026 });
  });

  test("contagem no ultimo dia do mes fica no proprio mes (julho/2026)", () => {
    expect(cicloSugerido("2026-07-31")).toEqual({ mes: 7, ano: 2026 });
  });

  test("virada de ano volta para dezembro do ano anterior", () => {
    expect(cicloSugerido("2027-01-02")).toEqual({ mes: 12, ano: 2026 });
  });

  test("data vazia ou malformada nao quebra", () => {
    for (const entrada of ["", "abc", "2026-09"]) {
      const c = cicloSugerido(entrada);
      expect(c.mes).toBeGreaterThanOrEqual(1);
      expect(c.mes).toBeLessThanOrEqual(12);
    }
  });
});

describe("cicloDivergeDaData", () => {
  test("avisa quando o ciclo nao e o mes da data", () => {
    expect(cicloDivergeDaData("2026-09-02", { mes: 8, ano: 2026 })).toBe(true);
    expect(cicloDivergeDaData("2027-01-02", { mes: 12, ano: 2026 })).toBe(true);
  });

  test("nao avisa quando coincidem", () => {
    expect(cicloDivergeDaData("2026-09-16", { mes: 9, ano: 2026 })).toBe(false);
    expect(cicloDivergeDaData("2026-07-31", { mes: 7, ano: 2026 })).toBe(false);
  });
});

describe("opcoesDeCiclo", () => {
  test("oferece o mes da data e os dois anteriores", () => {
    expect(opcoesDeCiclo("2026-09-02")).toEqual([
      { mes: 9, ano: 2026 },
      { mes: 8, ano: 2026 },
      { mes: 7, ano: 2026 },
    ]);
  });

  test("atravessa a virada de ano sem mes zero", () => {
    expect(opcoesDeCiclo("2027-01-02")).toEqual([
      { mes: 1, ano: 2027 },
      { mes: 12, ano: 2026 },
      { mes: 11, ano: 2026 },
    ]);
  });

  test("a sugestao esta sempre entre as opcoes", () => {
    for (const data of ["2026-09-01", "2026-09-16", "2027-01-02", "2026-07-31"]) {
      expect(opcoesDeCiclo(data)).toContainEqual(cicloSugerido(data));
    }
  });
});

describe("rotuloDoCiclo", () => {
  test("mes por extenso em portugues", () => {
    expect(rotuloDoCiclo({ mes: 8, ano: 2026 })).toBe("agosto/2026");
    expect(rotuloDoCiclo({ mes: 12, ano: 2026 })).toBe("dezembro/2026");
    expect(rotuloDoCiclo({ mes: 3, ano: 2027 })).toBe("março/2027");
  });
});
