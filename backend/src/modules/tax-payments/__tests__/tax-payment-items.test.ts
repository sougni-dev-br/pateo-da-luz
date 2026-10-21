import { describe, expect, test } from "vitest";
import { descricaoDosItens, lerNumeroDoDocumento, MAXIMO_DE_LINHAS, normalizarItens, totalDaLinha } from "../tax-payment-items.js";

// Composição do DAS de exemplo (valores fictícios): o total tem de ser a soma das linhas, ao centavo.
const das = [
  { code: "1001", description: "IRPJ - SIMPLES NACIONAL", principal: 469.71 },
  { code: "1002", description: "CSLL - SIMPLES NACIONAL", principal: 298.9 },
  { code: "1004", description: "COFINS - SIMPLES NACIONAL", principal: 1088.03 },
  { code: "1005", description: "PIS - SIMPLES NACIONAL", principal: 235.71 },
  { code: "1006", description: "INSS - SIMPLES NACIONAL", principal: 3586.89 },
  { code: "1007", description: "ICMS - SIMPLES NACIONAL SP", principal: 2060.87 },
];

describe("normalizarItens", () => {
  test("a soma das linhas do DAS bate com o total da guia, ao centavo", () => {
    const r = normalizarItens(das);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.total).toBe(7740.11);
      expect(r.itens).toHaveLength(6);
      expect(r.itens[0]).toEqual({ code: "1001", description: "IRPJ - SIMPLES NACIONAL", principal: 469.71, fine: 0, interest: 0 });
    }
  });

  test("soma principal, multa e juros da linha sem erro de ponto flutuante", () => {
    const r = normalizarItens([{ description: "FGTS Mensal", principal: 0.1, fine: 0.2, interest: 0.01 }]);
    expect(r.ok && r.total).toBe(0.31);
    expect(totalDaLinha({ principal: 0.1, fine: 0.2, interest: 0 })).toBe(0.3);
  });

  test("aceita valores em texto canônico, como a API manda", () => {
    const r = normalizarItens([{ description: "FGTS Mensal", principal: "1383.57" }]);
    expect(r.ok && r.total).toBe(1383.57);
  });

  test("código é opcional e vira null quando vazio (o FGTS não tem código)", () => {
    const r = normalizarItens([{ code: "  ", description: "FGTS Mensal", principal: 10 }]);
    expect(r.ok && r.itens[0].code).toBeNull();
  });

  test.each([
    ["lista vazia", []],
    ["não é lista", "abc"],
    ["sem denominação", [{ description: "", principal: 10 }]],
    ["denominação longa", [{ description: "x".repeat(201), principal: 10 }]],
    ["código longo", [{ code: "1".repeat(21), description: "IRPJ", principal: 10 }]],
    ["linha zerada", [{ description: "IRPJ", principal: 0 }]],
    ["valor negativo", [{ description: "IRPJ", principal: -5 }]],
    ["valor em formato brasileiro", [{ description: "IRPJ", principal: "1.234,56" }]],
    ["valor gigante", [{ description: "IRPJ", principal: 1e12 }]],
    ["multa inválida", [{ description: "IRPJ", principal: 10, fine: "abc" }]],
    ["linha nula", [null]],
  ])("recusa %s", (_nome, entrada) => {
    expect(normalizarItens(entrada).ok).toBe(false);
  });

  test.each([
    ["milhar brasileiro", "1.234"],
    ["hexadecimal", "0x10"],
    ["booleano", true],
    ["lista", [5]],
    ["notação científica", "1e3"],
    ["espaço no meio", "1 234"],
  ])("recusa valor em formato ambíguo (%s)", (_nome, principal) => {
    expect(normalizarItens([{ description: "IRPJ", principal }]).ok).toBe(false);
  });

  test("aceita texto canônico com espaços nas pontas e até 2 casas", () => {
    const r = normalizarItens([{ description: "IRPJ", principal: " 12.5 ", fine: "0.30" }]);
    expect(r.ok && r.total).toBe(12.8);
  });

  test("código que não é texto nem número é recusado", () => {
    expect(normalizarItens([{ code: { a: 1 }, description: "IRPJ", principal: 10 }]).ok).toBe(false);
    const r = normalizarItens([{ code: 1001, description: "IRPJ", principal: 10 }]);
    expect(r.ok && r.itens[0].code).toBe("1001");
  });

  test("a soma das linhas não passa do valor máximo de uma guia (Decimal 12,2)", () => {
    const r = normalizarItens([{ description: "A", principal: 9999999999.99 }, { description: "B", principal: 1 }]);
    expect(!r.ok && r.message).toMatch(/valor máximo/);
  });

  test("aponta a linha com problema", () => {
    const r = normalizarItens([...das.slice(0, 2), { description: "COFINS", principal: 0 }]);
    expect(!r.ok && r.message).toMatch(/Linha 3/);
  });

  test("limita a quantidade de linhas", () => {
    const muitas = Array.from({ length: MAXIMO_DE_LINHAS + 1 }, (_, i) => ({ description: `L${i}`, principal: 1 }));
    expect(normalizarItens(muitas).ok).toBe(false);
  });
});

describe("descricaoDosItens", () => {
  test("junta as denominações", () => {
    expect(descricaoDosItens([{ description: "IRPJ" }, { description: "CSLL" }])).toBe("IRPJ · CSLL");
  });

  test("corta o texto longo", () => {
    const longo = Array.from({ length: 40 }, () => ({ description: "DENOMINACAO MUITO LONGA" }));
    expect(descricaoDosItens(longo).length).toBeLessThanOrEqual(240);
  });
});

describe("lerNumeroDoDocumento", () => {
  test("texto limpo, vazio vira null", () => {
    expect(lerNumeroDoDocumento(" 07.20.26290.7165263-2 ")).toEqual({ ok: true, valor: "07.20.26290.7165263-2" });
    expect(lerNumeroDoDocumento("  ")).toEqual({ ok: true, valor: null });
    expect(lerNumeroDoDocumento(undefined)).toEqual({ ok: true, valor: null });
  });

  test("recusa o que não é texto e o muito longo", () => {
    expect(lerNumeroDoDocumento({})).toEqual({ ok: false });
    expect(lerNumeroDoDocumento("1".repeat(61))).toEqual({ ok: false });
  });
});
