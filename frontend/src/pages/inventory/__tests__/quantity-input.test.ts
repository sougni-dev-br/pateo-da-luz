import { describe, expect, test } from "vitest";
import { isAmbiguousQuantity, quantityToApi, sanitizeQuantityInput, unitAcceptsDecimal } from "../shared";

// Regressao do incidente de 02/09/2026: os campos de contagem sao <input> de
// texto (inputMode="decimal"). A virgula do teclado pt-BR seguia crua ate a API
// e virava zero no backend. Estes helpers fecham a borda de saida e precisam
// concordar com backend/src/shared/utils/parse-decimal.ts.

describe("sanitizeQuantityInput", () => {
  test("preserva a virgula enquanto o usuario digita", () => {
    expect(sanitizeQuantityInput("16,5")).toBe("16,5");
  });

  test("preserva o ponto decimal e o de milhar", () => {
    expect(sanitizeQuantityInput("16.5")).toBe("16.5");
    expect(sanitizeQuantityInput("1.234,5")).toBe("1.234,5");
  });

  test("remove letras e simbolos", () => {
    expect(sanitizeQuantityInput("16,5kg")).toBe("16,5");
    expect(sanitizeQuantityInput("R$ 12")).toBe("12");
  });

  test("nao atrapalha a digitacao em andamento", () => {
    expect(sanitizeQuantityInput("16,")).toBe("16,");
    expect(sanitizeQuantityInput("")).toBe("");
  });
});

describe("quantityToApi", () => {
  test("converte virgula em ponto para a API", () => {
    expect(quantityToApi("16,5")).toBe("16.5");
  });

  test("mantem valor ja com ponto", () => {
    expect(quantityToApi("16.5")).toBe("16.5");
  });

  test("le milhar com virgula decimal igual ao backend", () => {
    expect(quantityToApi("1.234,5")).toBe("1234.5");
  });

  // Este teste afirmava o contrario: que "1.234" seguia a leitura pt-BR de milhar
  // e virava 1234. Era a suposicao que causou o defeito. Em 04/09 a contagem do
  // freezer foi relancada com 12 leituras de balanca (11.700, 156.890...) e todas
  // foram gravadas mil vezes maiores. Em quantidade os dois sentidos sao possiveis,
  // entao a entrada e recusada e a tela pergunta qual deles.
  test("ponto de milhar sem virgula e ambiguo: recusa em vez de adivinhar", () => {
    expect(quantityToApi("1.234")).toBeUndefined();
    expect(isAmbiguousQuantity("1.234")).toBe(true);
  });

  test("leitura de balanca em kg: 11.700 nao vira 11700", () => {
    expect(quantityToApi("11.700")).toBeUndefined();
    expect(quantityToApi("156.890")).toBeUndefined();
    // o caminho certo, que a mensagem ensina
    expect(quantityToApi("11,700")).toBe("11.700");
    expect(quantityToApi("156,890")).toBe("156.890");
  });

  test("ponto com uma ou duas casas nao e ambiguo", () => {
    expect(quantityToApi("11.7")).toBe("11.7");
    expect(quantityToApi("0.5")).toBe("0.5");
    expect(isAmbiguousQuantity("11.7")).toBe(false);
  });

  test("unidade decide a dica mostrada no cabecalho e no campo", () => {
    expect(unitAcceptsDecimal("KG")).toBe(true);
    expect(unitAcceptsDecimal("LITROS")).toBe(true);
    expect(unitAcceptsDecimal("UNI")).toBe(false);
    expect(unitAcceptsDecimal("BDJ")).toBe(false);
  });

  test("campo vazio vira string vazia (pendente, nao zero)", () => {
    expect(quantityToApi("")).toBe("");
    expect(quantityToApi("   ")).toBe("");
  });

  test("zero digitado continua zero", () => {
    expect(quantityToApi("0")).toBe("0");
  });

  test("texto ilegivel retorna undefined para bloquear o envio", () => {
    expect(quantityToApi("abc")).toBeUndefined();
    expect(quantityToApi("16,5kg")).toBeUndefined();
  });
});

describe("quantityToApi no planejamento de compra", () => {
  // F-10: o campo de quantidade a pedir usava Number() direto. "16,5" virava NaN,
  // caia em !(qty > 0) e o item era descartado do pedido em silencio — contado
  // como "quantidade zero", indistinguivel de quem nao preencheu.
  const parseQty = (raw: string | undefined): number => {
    const normalizado = quantityToApi(raw ?? "");
    if (normalizado === undefined || normalizado === "") return NaN;
    return Number(normalizado);
  };
  const qtyInvalida = (raw: string | undefined): boolean =>
    (raw ?? "").trim() !== "" && quantityToApi(raw ?? "") === undefined;

  test("quantidade com virgula entra no pedido", () => {
    expect(parseQty("16,5")).toBe(16.5);
    expect(parseQty("16,5") > 0).toBe(true);
  });

  test("campo vazio nao vira pedido e nao e acusado de invalido", () => {
    expect(Number.isNaN(parseQty(""))).toBe(true);
    expect(qtyInvalida("")).toBe(false);
    expect(qtyInvalida(undefined)).toBe(false);
  });

  test("texto ilegivel e sinalizado, nao descartado em silencio", () => {
    expect(Number.isNaN(parseQty("abc"))).toBe(true);
    expect(qtyInvalida("abc")).toBe(true);
  });

  test("zero digitado continua sendo 'nao pedir', nao invalido", () => {
    expect(parseQty("0")).toBe(0);
    expect(qtyInvalida("0")).toBe(false);
  });
});
