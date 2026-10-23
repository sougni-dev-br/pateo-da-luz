import { expect, test } from "vitest";
import { resumirParcelas, situacaoDaParcela, type ParcelaLinha } from "../parcelamento-regras.js";

const hoje = new Date(2026, 10, 15);
const base: ParcelaLinha = { status: "OPEN", purchaseStatus: "ACTIVE", amount: 100, paidAmount: null, dueDate: new Date(2026, 11, 5) };

test("parcela cancelada ou de compra cancelada não conta como aberta", () => {
  expect(situacaoDaParcela({ status: "CANCELLED", purchaseStatus: "ACTIVE" })).toBe("CANCELADA");
  expect(situacaoDaParcela({ status: "OPEN", purchaseStatus: "CANCELLED" })).toBe("CANCELADA");
});

test("PAID e PAID_LATE são pagas", () => {
  expect(situacaoDaParcela({ status: "PAID", purchaseStatus: "ACTIVE" })).toBe("PAGA");
  expect(situacaoDaParcela({ status: "PAID_LATE", purchaseStatus: "ACTIVE" })).toBe("PAGA");
});

test("resume quantas faltam, saldo, atraso e próximo vencimento", () => {
  const r = resumirParcelas([
    { ...base, status: "PAID", paidAmount: 95, dueDate: new Date(2026, 9, 5) },
    { ...base, dueDate: new Date(2026, 10, 1) },
    { ...base, dueDate: new Date(2026, 11, 5) },
    { ...base, status: "CANCELLED" }
  ], hoje);
  expect(r).toMatchObject({ total: 3, pagas: 1, abertas: 2, atrasadas: 1, canceladas: 1, valorPago: 95, saldoAberto: 200, quitado: false });
  expect(r.proximoVencimento).toEqual(new Date(2026, 10, 1));
});

test("vencida hoje ainda não é atrasada", () => {
  expect(resumirParcelas([{ ...base, dueDate: new Date(2026, 10, 15) }], hoje).atrasadas).toBe(0);
});

test("quitado quando só restam pagas", () => {
  expect(resumirParcelas([{ ...base, status: "PAID", paidAmount: 100 }], hoje).quitado).toBe(true);
  expect(resumirParcelas([], hoje).quitado).toBe(false);
});
