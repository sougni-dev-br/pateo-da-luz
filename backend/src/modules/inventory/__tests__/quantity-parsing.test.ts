import { describe, expect, test } from "vitest";
import { parseDecimalInput } from "../../../shared/utils/parse-decimal.js";

// Regressao do incidente de 02/09/2026: o campo de contagem e um <input> de
// texto (inputMode="decimal"), entao a virgula do teclado pt-BR chegava crua na
// API. O asNumber antigo fazia Number("16,5") -> NaN e o guarda Number.isFinite
// devolvia 0 em silencio: o item era gravado como zerado, com status CONTADO, e
// so aparecia quando o pedido de compra saia errado.
//
// Estas funcoes espelham asNumber/parseQuantityInput de inventory.routes.ts.
// Sao reimplementadas aqui porque o router importa o Prisma no topo do modulo e
// nao pode ser carregado em teste unitario sem banco.

function asNumber(value: unknown) {
  return parseDecimalInput(value) ?? 0;
}

type ParsedQuantity = { ok: true; value: number | null } | { ok: false };

function parseQuantityInput(value: unknown): ParsedQuantity {
  if (value === undefined || value === null || String(value).trim() === "") {
    return { ok: true, value: null };
  }
  const parsed = parseDecimalInput(value);
  if (parsed === null) return { ok: false };
  return { ok: true, value: parsed };
}

describe("asNumber", () => {
  test("le a virgula decimal do teclado pt-BR", () => {
    expect(asNumber("16,5")).toBe(16.5);
  });

  test("le o ponto decimal", () => {
    expect(asNumber("16.5")).toBe(16.5);
  });

  test("aceita numero JSON sem alterar", () => {
    expect(asNumber(16.5)).toBe(16.5);
  });

  test("le milhar com virgula decimal", () => {
    expect(asNumber("1.234,5")).toBe(1234.5);
  });

  test("trata vazio e ausente como zero", () => {
    expect(asNumber("")).toBe(0);
    expect(asNumber(null)).toBe(0);
    expect(asNumber(undefined)).toBe(0);
  });
});

describe("parseQuantityInput", () => {
  test("converte quantidade fracionada digitada com virgula", () => {
    expect(parseQuantityInput("16,5")).toEqual({ ok: true, value: 16.5 });
  });

  test("campo vazio vira pendente, nao zero", () => {
    expect(parseQuantityInput("")).toEqual({ ok: true, value: null });
    expect(parseQuantityInput(null)).toEqual({ ok: true, value: null });
    expect(parseQuantityInput(undefined)).toEqual({ ok: true, value: null });
  });

  test("zero digitado continua sendo zero de verdade", () => {
    expect(parseQuantityInput("0")).toEqual({ ok: true, value: 0 });
  });

  test("texto nao numerico e recusado em vez de virar zero", () => {
    expect(parseQuantityInput("abc")).toEqual({ ok: false });
    expect(parseQuantityInput("16,5kg")).toEqual({ ok: false });
    expect(parseQuantityInput("--")).toEqual({ ok: false });
  });

  test("negativo e lido (o chamador decide se aceita)", () => {
    expect(parseQuantityInput("-3,5")).toEqual({ ok: true, value: -3.5 });
  });
});
