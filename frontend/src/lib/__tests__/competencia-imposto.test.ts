import { describe, expect, test } from "vitest";
import { competenciaPeloVencimento, competenciaSugerida } from "../competencia-imposto";

describe("competência sugerida pelo vencimento da guia", () => {
  test("guia que vence no mês é do mês anterior", () => {
    expect(competenciaPeloVencimento("2026-10-20")).toBe("2026-09-01");
    expect(competenciaPeloVencimento("2026-10-01")).toBe("2026-09-01");
  });

  test("vencimento em janeiro é competência de dezembro do ano anterior", () => {
    expect(competenciaPeloVencimento("2027-01-20")).toBe("2026-12-01");
  });

  test("data vazia ou inválida não sugere nada", () => {
    expect(competenciaPeloVencimento("")).toBe("");
    expect(competenciaPeloVencimento("2026-13-40")).toBe("");
  });
});

describe("competência sugerida pelo tipo e vencimento", () => {
  test("Simples, FGTS, GPS e DARF seguem o mês anterior ao vencimento", () => {
    for (const tipo of ["Simples Nacional / DAS", "DASN", "FGTS", "GPS / INSS", "DARF", "DARF IR", "IRRF"]) {
      expect(competenciaSugerida(tipo, "2026-10-20")).toBe("2026-09-01");
    }
  });

  test("IPTU, taxas, ICMS, ISS e parcelamento não recebem sugestão", () => {
    for (const tipo of ["IPTU", "TFE", "DARE", "DARE-SP", "GARE ICMS", "GARE ISS", "ISS", "Parcelamento Tributário", "Outros", ""]) {
      expect(competenciaSugerida(tipo, "2026-10-20")).toBe("");
    }
  });
});
