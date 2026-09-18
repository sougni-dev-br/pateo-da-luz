import { describe, expect, test } from "vitest";
import { deducaoComoCusto } from "../noventa-nove-real-sync.service.js";

// Valores REAIS de bills de producao colhidos em 17/09/2026. A 99 manda deducao
// como NEGATIVO na linha de receita e INVERTE o sinal no estorno.
const RECEITA = { commissionAmount: -329, b2pDeliveryAmount: -600 };  // pedido de R$ 16,45
const ESTORNO = { commissionAmount: 0, b2pDeliveryAmount: 450 };      // estorno orderType 2

describe("deducaoComoCusto", () => {
  test("deducao de receita vira custo POSITIVO", () => {
    expect(deducaoComoCusto(RECEITA.commissionAmount)).toBe(3.29);
    expect(deducaoComoCusto(RECEITA.b2pDeliveryAmount)).toBe(6);
  });

  test("deducao devolvida em estorno vira custo NEGATIVO (credito)", () => {
    // Math.abs daria +4,50 e cobraria de novo uma taxa que foi devolvida.
    expect(deducaoComoCusto(ESTORNO.b2pDeliveryAmount)).toBe(-4.5);
  });

  test("zero continua zero, sem -0", () => {
    expect(deducaoComoCusto(0)).toBe(0);
    expect(Object.is(deducaoComoCusto(0), -0)).toBe(false);
  });

  test("ausente ou invalido vira 0 em vez de NaN", () => {
    expect(deducaoComoCusto(undefined)).toBe(0);
    expect(deducaoComoCusto(null)).toBe(0);
    expect(deducaoComoCusto(Number.NaN)).toBe(0);
    expect(deducaoComoCusto(Number.POSITIVE_INFINITY)).toBe(0);
  });

  test("converte centavos para reais", () => {
    expect(deducaoComoCusto(-1)).toBe(0.01);
    expect(deducaoComoCusto(-231012)).toBe(2310.12);
  });

  test("o somatorio de setembro deixa de ser negativo — era isso que zerava a linha da despesa", () => {
    // Antes da correcao a soma de commissionAmount de 09/2026 dava -2.310,12 e o
    // Math.max(0, ...) de reflectFeesIntoMonthlyExpense a descartava, jogando a
    // despesa inteira em "outros".
    const somaCrua = -231012;
    expect(Math.max(0, somaCrua / 100)).toBe(0);
    expect(Math.max(0, deducaoComoCusto(somaCrua))).toBe(2310.12);
  });
});
