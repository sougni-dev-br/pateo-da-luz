import { describe, expect, test } from "vitest";
import { FATOR_MAXIMO, pecaSemConversao, validarConversaoManual } from "../conversao-manual.js";

describe("validarConversaoManual", () => {
  test("'peça' vira a unidade PÇ", () => {
    expect(validarConversaoManual({ fromUnit: "peça", factor: "3,5" }, "KG", [])).toEqual({ ok: true, valor: { fromUnit: "PÇ", toUnit: "KG", factor: 3.5, jaCadastrada: false } });
  });

  test("1 UN = 3,5 KG no produto contado em KG", () => {
    expect(validarConversaoManual({ fromUnit: "un", factor: "3,5" }, "KG", [])).toEqual({ ok: true, valor: { fromUnit: "UN", toUnit: "KG", factor: 3.5, jaCadastrada: false } });
  });

  test("aceita o número já convertido e normaliza a unidade (CAIXA vira CX)", () => {
    const r = validarConversaoManual({ fromUnit: "caixa", factor: 12 }, "UN", []);
    expect(r.ok && r.valor).toMatchObject({ fromUnit: "CX", toUnit: "UN", factor: 12 });
  });

  test("recusa fator vazio, zero, negativo, ilegível e absurdo", () => {
    for (const factor of ["", "0", "-2", "abc", null, FATOR_MAXIMO + 1]) {
      expect(validarConversaoManual({ fromUnit: "UN", factor }, "KG", []).ok).toBe(false);
    }
  });

  test("recusa a própria unidade do estoque e a unidade vazia", () => {
    expect(validarConversaoManual({ fromUnit: "KG", factor: 1 }, "KG", []).ok).toBe(false);
    expect(validarConversaoManual({ fromUnit: "", factor: 1 }, "KG", []).ok).toBe(false);
  });

  test("produto sem unidade de estoque não converte", () => {
    expect(validarConversaoManual({ fromUnit: "UN", factor: 2 }, null, []).ok).toBe(false);
  });

  test("KG e G já convertem sozinhos: não cadastra por cima", () => {
    const r = validarConversaoManual({ fromUnit: "G", factor: 1000 }, "KG", []);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.erro).toContain("já convertem sozinhos");
  });

  test("conversão igual já cadastrada é aceita sem duplicar; valor diferente é conflito", () => {
    const cadastradas = [{ fromUnit: "UN", toUnit: "KG", factor: 3.5 }];
    expect(validarConversaoManual({ fromUnit: "UN", factor: 3.5 }, "KG", cadastradas)).toMatchObject({ ok: true, valor: { jaCadastrada: true } });
    const conflito = validarConversaoManual({ fromUnit: "UN", factor: 4 }, "KG", cadastradas);
    expect(conflito).toMatchObject({ ok: false, conflito: true });
  });

  test("a conversão no sentido contrário também conta como cadastrada", () => {
    const cadastradas = [{ fromUnit: "KG", toUnit: "UN", factor: 0.25 }];
    expect(validarConversaoManual({ fromUnit: "UN", factor: 4 }, "KG", cadastradas)).toMatchObject({ ok: true, valor: { jaCadastrada: true } });
  });
});

describe("pecaSemConversao", () => {
  test("BACON PEÇA contado em KG sem conversão para UN", () => {
    expect(pecaSemConversao("BACON PEÇA", "KG", [])).toBe(true);
    expect(pecaSemConversao("QUEIJO PECA 2KG", "kg", [])).toBe(true);
  });

  test("peça cadastrada como PÇ (ou como UN, no legado) resolve a pendência", () => {
    expect(pecaSemConversao("BACON PEÇA", "KG", [{ fromUnit: "PÇ", toUnit: "KG", factor: 3.5 }])).toBe(false);
    expect(pecaSemConversao("BACON PEÇA", "KG", [{ fromUnit: "UN", toUnit: "KG", factor: 3.5 }])).toBe(false);
  });

  test("com a conversão cadastrada, ou contado em UN, ou sem 'peça' no nome, não é pendência", () => {
    expect(pecaSemConversao("BACON PEÇA", "KG", [{ fromUnit: "UN", toUnit: "KG", factor: 3.5 }])).toBe(false);
    expect(pecaSemConversao("BACON PEÇA", "UN", [])).toBe(false);
    expect(pecaSemConversao("BACON FATIADO", "KG", [])).toBe(false);
    expect(pecaSemConversao("ESPECIARIA", "KG", [])).toBe(false);
  });
});
