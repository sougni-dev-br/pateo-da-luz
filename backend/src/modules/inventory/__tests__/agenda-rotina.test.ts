import { describe, expect, test } from "vitest";
import { semanaDaData, statusDaRotina } from "../agenda-rotina.js";

const dia = (iso: string) => {
  const [ano, mes, d] = iso.split("-").map(Number);
  return new Date(ano, mes - 1, d);
};

describe("semanaDaData", () => {
  test("a semana vai de segunda a domingo", () => {
    const { inicio, fim } = semanaDaData(dia("2026-09-30")); // quarta
    expect(inicio).toEqual(dia("2026-09-28"));
    expect(fim).toEqual(dia("2026-10-05")); // exclusivo
  });

  test("domingo pertence a semana que comecou na segunda anterior", () => {
    const { inicio } = semanaDaData(dia("2026-10-04"));
    expect(inicio).toEqual(dia("2026-09-28"));
  });

  test("segunda abre a propria semana", () => {
    const { inicio } = semanaDaData(dia("2026-09-28"));
    expect(inicio).toEqual(dia("2026-09-28"));
  });
});

describe("statusDaRotina", () => {
  const hoje = dia("2026-09-30");

  test("sessao concluida marca o dia como feito, mesmo atrasado", () => {
    expect(statusDaRotina(dia("2026-09-28"), hoje, "CONCLUIDA")).toBe("FEITA");
  });

  test("sessao aberta ou em andamento conta como em andamento", () => {
    expect(statusDaRotina(dia("2026-09-30"), hoje, "ABERTA")).toBe("EM_ANDAMENTO");
    expect(statusDaRotina(dia("2026-09-29"), hoje, "EM_ANDAMENTO")).toBe("EM_ANDAMENTO");
  });

  test("sem sessao: atrasada, hoje ou prevista pela data", () => {
    expect(statusDaRotina(dia("2026-09-29"), hoje, null)).toBe("ATRASADA");
    expect(statusDaRotina(dia("2026-09-30"), hoje, null)).toBe("HOJE");
    expect(statusDaRotina(dia("2026-10-02"), hoje, null)).toBe("PREVISTA");
  });

  test("sessao cancelada nao conta: o dia volta a ficar pendente", () => {
    expect(statusDaRotina(dia("2026-09-29"), hoje, "CANCELADA")).toBe("ATRASADA");
  });
});
