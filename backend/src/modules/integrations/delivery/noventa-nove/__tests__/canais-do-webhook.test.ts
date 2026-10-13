import { describe, expect, test } from "vitest";
import { CANAIS_FATURADOS, canalDoWebhook, ehCanalFaturado } from "../noventa-nove-canais.js";

// O canal "DELIVERY"/"DELIVERY_REFUND" e o que faz uma venda virar RECEITA (sync, telas e insights
// leem so esses). Quem decide o canal e a API financeira, nunca o corpo de um webhook publico.

describe("ehCanalFaturado", () => {
  test.each(["DELIVERY", "DELIVERY_REFUND", "delivery", "Delivery_Refund", "  DELIVERY  "])("%j e canal de faturamento", (c) => {
    expect(ehCanalFaturado(c)).toBe(true);
  });

  test.each(["1", "2", "WEBHOOK:DELIVERY", "DELIVERY2", "XDELIVERY", "", "   ", null, undefined])("%j NAO e", (c) => {
    expect(ehCanalFaturado(c as string | null | undefined)).toBe(false);
  });

  test("a lista oficial continua com os dois canais que a API financeira grava", () => {
    expect([...CANAIS_FATURADOS]).toEqual(["DELIVERY", "DELIVERY_REFUND"]);
  });
});

describe("canalDoWebhook", () => {
  test.each([
    [1, "1"],
    ["2", "2"],
    [0, "0"],
    [undefined, null],
    [null, null],
    ["", null],
    ["   ", null]
  ])("%j vira %j (comportamento legitimo preservado)", (entrada, esperado) => {
    expect(canalDoWebhook(entrada)).toBe(esperado);
  });

  test.each(["DELIVERY", "DELIVERY_REFUND", "delivery", "Delivery_Refund", " DELIVERY "])(
    "canal reservado %j recebe prefixo e deixa de contar como receita",
    (reservado) => {
      const canal = canalDoWebhook(reservado);
      expect(canal).toMatch(/^WEBHOOK:/);
      expect(ehCanalFaturado(canal)).toBe(false);
    }
  );

  test("INVARIANTE: nenhuma entrada, por mais estranha, produz canal de faturamento", () => {
    const hostis = [
      "DELIVERY", "delivery", "DeLiVeRy", " DELIVERY", "DELIVERY ", "\tDELIVERY\n", "DELIVERY_REFUND", "delivery_refund",
      "DELIVERY\u0000", "DELIVERY​", "ＤＥＬＩＶＥＲＹ", { toString: () => "DELIVERY" }, ["DELIVERY"], 1e21, true, false,
      "x".repeat(10_000), "WEBHOOK:DELIVERY", "   "
    ];
    for (const h of hostis) {
      expect(ehCanalFaturado(canalDoWebhook(h)), JSON.stringify(String(h)).slice(0, 40)).toBe(false);
    }
  });

  test("valor gigante e truncado (nao enche a coluna)", () => {
    expect((canalDoWebhook("x".repeat(10_000)) ?? "").length).toBeLessThanOrEqual(40);
  });

  test("o corte de tamanho vem ANTES do teste de reservado (nao da para esconder DELIVERY atras de enchimento)", () => {
    for (const hostil of ["DELIVERY" + " ".repeat(32) + "x", "DELIVERY" + " ".repeat(500), " ".repeat(500) + "DELIVERY", "DELIVERY_REFUND" + "	".repeat(40) + "y"]) {
      const canal = canalDoWebhook(hostil);
      expect(ehCanalFaturado(canal), JSON.stringify(hostil).slice(0, 30)).toBe(false);
      expect((canal ?? "").length).toBeLessThanOrEqual(40);
    }
    // "DELIVERY" seguido so de espacos e DELIVERY de fato: ganha o prefixo
    expect(canalDoWebhook("DELIVERY" + " ".repeat(500))).toBe("WEBHOOK:DELIVERY");
  });

  test("o resultado nunca passa de 40 caracteres, nem com prefixo", () => {
    expect(canalDoWebhook("DELIVERY_REFUND")!.length).toBeLessThanOrEqual(40);
    expect(canalDoWebhook("x".repeat(32))!.length).toBe(32);
  });
});
