import { describe, expect, test } from "vitest";
import { movementSignedQuantity, movementTypeLabel } from "../shared";

describe("movementTypeLabel — historico mostrava o codigo cru", () => {
  test("tipo do formulario vira o rotulo em portugues", () => {
    expect(movementTypeLabel("MANUAL_OUT")).toBe("Saida manual");
    expect(movementTypeLabel("BREAKAGE")).toBe("Quebra");
  });

  test("entrada nao diz 'manual': as compras tambem geram PURCHASE_IN", () => {
    expect(movementTypeLabel("PURCHASE_IN")).toBe("Entrada");
  });

  test("ajuste criado pelo sistema, que nao existe no formulario, tem rotulo", () => {
    expect(movementTypeLabel("ADJUSTMENT")).toBe("Ajuste automatico");
  });

  test("codigo desconhecido aparece como veio, em vez de sumir", () => {
    expect(movementTypeLabel("NOVO_TIPO")).toBe("NOVO_TIPO");
  });
});

describe("movementSignedQuantity — mesmo sinal que o backend aplica no estoque", () => {
  test("entrada, ajuste positivo e devolucao somam", () => {
    expect(movementSignedQuantity("PURCHASE_IN", 3)).toBe(3);
    expect(movementSignedQuantity("POSITIVE_ADJUSTMENT", 3)).toBe(3);
    expect(movementSignedQuantity("RETURN", 3)).toBe(3);
  });

  test("saida, perda e quebra subtraem", () => {
    expect(movementSignedQuantity("MANUAL_OUT", 3)).toBe(-3);
    expect(movementSignedQuantity("LOSS", 3)).toBe(-3);
    expect(movementSignedQuantity("BREAKAGE", 3)).toBe(-3);
  });

  test("ajuste automatico ja vem com sinal e fica como esta", () => {
    expect(movementSignedQuantity("ADJUSTMENT", -2)).toBe(-2);
    expect(movementSignedQuantity("ADJUSTMENT", 5)).toBe(5);
  });
});
