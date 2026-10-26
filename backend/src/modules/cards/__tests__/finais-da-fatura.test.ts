import { describe, expect, test } from "vitest";
import {
  divergenciasDeExtrato,
  subtotaisPorFinal,
  type FinalDoCartao
} from "../finais-da-fatura.js";

const fisico: FinalDoCartao = { id: "f1", label: "Físico", last4Digits: "1111", kind: "PHYSICAL", isActive: true };
const virtual: FinalDoCartao = { id: "f2", label: "Virtual", last4Digits: "2222", kind: "VIRTUAL", isActive: true };

describe("subtotaisPorFinal", () => {
  test("soma cada final e deixa os itens sem cartão em 'não definido'", () => {
    const resultado = subtotaisPorFinal(
      [
        { cardFinalId: "f1", value: "100.10" },
        { cardFinalId: "f1", value: 50 },
        { cardFinalId: "f2", value: "20.05" },
        { cardFinalId: null, value: "10.00" }
      ],
      [fisico, virtual]
    );
    expect(resultado).toEqual([
      { cardFinalId: "f1", itens: 2, total: 150.1 },
      { cardFinalId: "f2", itens: 1, total: 20.05 },
      { cardFinalId: null, itens: 1, total: 10 }
    ]);
  });

  test("lista o final sem itens com total zero e omite 'não definido' quando não há itens soltos", () => {
    const resultado = subtotaisPorFinal([{ cardFinalId: "f1", value: 5 }], [fisico, virtual]);
    expect(resultado).toEqual([
      { cardFinalId: "f1", itens: 1, total: 5 },
      { cardFinalId: "f2", itens: 0, total: 0 }
    ]);
  });

  test("não acumula erro de ponto flutuante", () => {
    const linhas = Array.from({ length: 10 }, () => ({ cardFinalId: "f1", value: 0.1 }));
    expect(subtotaisPorFinal(linhas, [fisico])[0].total).toBe(1);
  });

  test("final inativo só aparece se tiver itens", () => {
    const inativo = { ...virtual, isActive: false };
    expect(subtotaisPorFinal([], [fisico, inativo]).map((s) => s.cardFinalId)).toEqual(["f1"]);
    expect(subtotaisPorFinal([{ cardFinalId: "f2", value: 1 }], [fisico, inativo]).map((s) => s.cardFinalId)).toEqual(["f1", "f2"]);
  });
});

describe("divergenciasDeExtrato", () => {
  test("aponta só os finais cujo total do extrato difere do lançado", () => {
    const subtotais = subtotaisPorFinal(
      [
        { cardFinalId: "f1", value: 150.1 },
        { cardFinalId: "f2", value: 20.05 }
      ],
      [fisico, virtual]
    );
    const resultado = divergenciasDeExtrato(subtotais, [
      { cardFinalId: "f1", statedAmount: "150.10" },
      { cardFinalId: "f2", statedAmount: "25.00" }
    ]);
    expect(resultado).toEqual([{ cardFinalId: "f2", calculado: 20.05, declarado: 25, diferenca: -4.95 }]);
  });

  test("final sem total do extrato informado não entra na conferência", () => {
    const subtotais = subtotaisPorFinal([{ cardFinalId: "f1", value: 10 }], [fisico, virtual]);
    expect(divergenciasDeExtrato(subtotais, [])).toEqual([]);
  });

  test("total do extrato informado para final sem nenhum item conta como diferença", () => {
    const subtotais = subtotaisPorFinal([], [fisico]);
    expect(divergenciasDeExtrato(subtotais, [{ cardFinalId: "f1", statedAmount: 30 }])).toEqual([
      { cardFinalId: "f1", calculado: 0, declarado: 30, diferenca: -30 }
    ]);
  });
});
