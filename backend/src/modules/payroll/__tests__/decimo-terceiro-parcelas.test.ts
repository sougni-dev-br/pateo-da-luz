import { describe, expect, test } from "vitest";
import { primeiraParaAcerto } from "../decimo-terceiro-sr.js";
import { lerParcela } from "../decimo-terceiro.routes.js";

// Dados FICTÍCIOS: o repositório é público.
const data = new Date("2026-11-10T12:00:00Z");

describe("primeiraParaAcerto — quanto a 1ª parcela já pagou", () => {
  test("sem lançamento: conta a calculada", () => {
    expect(primeiraParaAcerto(null, 1350)).toBe(1350);
  });
  test("ainda a pagar: será atualizada para o calculado, então conta o calculado", () => {
    expect(primeiraParaAcerto({ deletedAt: null, paymentDate: null, paidAmount: null, amount: 1000 }, 1350)).toBe(1350);
  });
  test("paga: conta o valor realmente pago, não o lançado nem o calculado", () => {
    expect(primeiraParaAcerto({ deletedAt: null, paymentDate: data, paidAmount: 1200.5, amount: 1350 }, 1400)).toBe(1200.5);
  });
  test("paga sem valor de baixa: usa o valor lançado", () => {
    expect(primeiraParaAcerto({ deletedAt: null, paymentDate: data, paidAmount: null, amount: 1350 }, 1400)).toBe(1350);
  });
  test("excluída (à mão = paga por fora): conta como calculada", () => {
    expect(primeiraParaAcerto({ deletedAt: data, paymentDate: null, paidAmount: null, amount: 1350 }, 1400)).toBe(1400);
  });
  test("valor pago inválido: volta para o calculado em vez de contaminar a 2ª parcela", () => {
    expect(primeiraParaAcerto({ deletedAt: null, paymentDate: data, paidAmount: "abc", amount: "xyz" }, 1400)).toBe(1400);
  });
});

describe("lerParcela da rota", () => {
  test("ausente: 1ª; 1 ou 2 (número ou texto): a parcela; qualquer outra coisa: null (400)", () => {
    expect(lerParcela(undefined)).toBe(1);
    expect(lerParcela("")).toBe(1);
    expect(lerParcela(1)).toBe(1);
    expect(lerParcela("2")).toBe(2);
    expect(lerParcela(2)).toBe(2);
    expect(lerParcela(3)).toBeNull();
    expect(lerParcela("0")).toBeNull();
    expect(lerParcela("a")).toBeNull();
    expect(lerParcela(1.5)).toBeNull();
  });
});
