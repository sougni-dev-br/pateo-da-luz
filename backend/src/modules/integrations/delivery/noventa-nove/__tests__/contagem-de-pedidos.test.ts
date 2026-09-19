import { describe, expect, test } from "vitest";
import { contaComoPedido } from "../contagem-de-pedidos.js";

describe("o que conta como pedido na tela conta igual no razao", () => {
  test("venda faturada conta", () => {
    expect(contaComoPedido("DELIVERY")).toBe(true);
  });

  test("estorno NAO conta — ele reduz o valor do dia, mas nao e um pedido a mais", () => {
    expect(contaComoPedido("DELIVERY_REFUND")).toBe(false);
  });

  test("webhook nao conta — o canal e o delivery_type numerico do payload", () => {
    expect(contaComoPedido("1")).toBe(false);
  });

  test("canal nulo nao conta (339 linhas assim em ago/set de 2026, valendo R$ 0,00)", () => {
    expect(contaComoPedido(null)).toBe(false);
  });

  // Julho/2026: 2.015 linhas de canal faturado, das quais 95 eram estorno.
  // O razao dizia 1.920 e a tela dizia 2.015 para o mesmo dinheiro.
  test("reproduz julho/2026: 1.920 pedidos de 2.015 linhas", () => {
    const linhas = [
      ...Array<string>(1920).fill("DELIVERY"),
      ...Array<string>(95).fill("DELIVERY_REFUND")
    ];
    expect(linhas.filter((c) => contaComoPedido(c)).length).toBe(1920);
  });
});
