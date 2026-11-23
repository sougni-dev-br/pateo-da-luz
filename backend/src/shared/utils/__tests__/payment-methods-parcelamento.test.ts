import { describe, expect, test } from "vitest";
import { paymentMethodAllowsInstallments } from "../payment-methods";

describe("paymentMethodAllowsInstallments", () => {
  test.each(["BOLETO", "FATURADO", "CARTAO CREDITO", "PIX", "PIX 3X"])("%s permite parcelar", (name) => {
    expect(paymentMethodAllowsInstallments({ name })).toBe(true);
  });

  test.each(["DINHEIRO", "CARTAO DEBITO"])("%s não permite parcelar", (name) => {
    expect(paymentMethodAllowsInstallments({ name })).toBe(false);
  });
});
