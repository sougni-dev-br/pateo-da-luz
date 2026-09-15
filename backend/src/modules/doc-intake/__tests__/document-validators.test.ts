import { describe, expect, test } from "vitest";
import { brToDate, brToNumber, chaveTitulo, isValidCnpj, somaConfere } from "../document-validators.js";

describe("brToNumber", () => {
  test("converte valor brasileiro com milhar e centavos", () => {
    expect(brToNumber("19.150,50")).toBe(19150.5);
  });

  test("converte valor sem separador de milhar", () => {
    expect(brToNumber("209,00")).toBe(209);
  });

  test("ignora simbolo de moeda", () => {
    expect(brToNumber("R$ 1.234,56")).toBe(1234.56);
  });

  test("devolve null quando nao ha numero", () => {
    expect(brToNumber("----")).toBeNull();
    expect(brToNumber(null)).toBeNull();
  });
});

describe("brToDate", () => {
  test("converte data brasileira em UTC", () => {
    const data = brToDate("17/08/2026");
    expect(data?.toISOString()).toBe("2026-08-17T00:00:00.000Z");
  });

  test("nao inverte dia e mes", () => {
    // 05/09 e 5 de setembro, nao 9 de maio. Inversao aqui joga a despesa
    // para outra competencia sem erro nenhum.
    const data = brToDate("05/09/2026");
    expect(data?.getUTCMonth()).toBe(8);
    expect(data?.getUTCDate()).toBe(5);
  });

  test("rejeita data impossivel em vez de corrigir sozinho", () => {
    expect(brToDate("31/02/2026")).toBeNull();
  });

  test("devolve null para texto que nao e data", () => {
    expect(brToDate("a vista")).toBeNull();
  });
});

describe("isValidCnpj", () => {
  test("aceita CNPJ real com mascara", () => {
    expect(isValidCnpj("08.238.299/0001-29")).toBe(true);
  });

  test("aceita CNPJ real so com digitos", () => {
    expect(isValidCnpj("46878233000192")).toBe(true);
  });

  test("rejeita CNPJ com digito verificador errado", () => {
    // Um OCR trocando um digito produz exatamente este caso.
    expect(isValidCnpj("08.238.299/0001-28")).toBe(false);
  });

  test("rejeita sequencia repetida e tamanho errado", () => {
    expect(isValidCnpj("00000000000000")).toBe(false);
    expect(isValidCnpj("123")).toBe(false);
  });
});

describe("somaConfere", () => {
  test("aceita quando as rubricas somam o total", () => {
    const rubricas = [{ valor: 14250 }, { valor: 3780.5 }, { valor: 1120 }];
    expect(somaConfere(rubricas, 19150.5)).toBe(true);
  });

  test("recusa divergencia de um centavo", () => {
    expect(somaConfere([{ valor: 100 }, { valor: 50 }], 150.02)).toBe(false);
  });

  test("aceita documento sem rubricas discriminadas", () => {
    expect(somaConfere([], 209)).toBe(true);
  });

  test("recusa quando nao ha total", () => {
    expect(somaConfere([{ valor: 10 }], null)).toBe(false);
  });
});

describe("chaveTitulo", () => {
  test("nota e boleto do mesmo titulo geram a mesma chave", () => {
    const nota = chaveTitulo({ cnpjEmissor: "08238299000129", valorTotal: 209, dataVencimento: new Date(Date.UTC(2026, 8, 15)) });
    const boleto = chaveTitulo({ cnpjEmissor: "08.238.299/0001-29", valorTotal: 209, dataVencimento: new Date(Date.UTC(2026, 8, 15)) });
    expect(nota).toBe(boleto);
  });

  test("valores diferentes geram chaves diferentes", () => {
    const a = chaveTitulo({ cnpjEmissor: "08238299000129", valorTotal: 209, dataVencimento: new Date(Date.UTC(2026, 8, 15)) });
    const b = chaveTitulo({ cnpjEmissor: "08238299000129", valorTotal: 210, dataVencimento: new Date(Date.UTC(2026, 8, 15)) });
    expect(a).not.toBe(b);
  });

  test("devolve null quando falta dado para identificar o titulo", () => {
    expect(chaveTitulo({ cnpjEmissor: null, valorTotal: 209, dataVencimento: new Date() })).toBeNull();
    expect(chaveTitulo({ cnpjEmissor: "08238299000129", valorTotal: null, dataVencimento: new Date() })).toBeNull();
  });
});
