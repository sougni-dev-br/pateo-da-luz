import { describe, expect, test } from "vitest";
import { summarizeTitle, type InstallmentRow } from "../supplier-history-title.js";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const hoje = day("2026-11-24");

const parcela = (over: Partial<InstallmentRow>): InstallmentRow => ({
  status: "OPEN", dueDate: day("2026-12-10"), paidDate: null, amount: 100, paidAmount: null, ...over
});

describe("summarizeTitle", () => {
  test("compra sem parcela não tem título", () => {
    expect(summarizeTitle([], hoje, false)).toMatchObject({ state: "NONE", installments: 0, viaCycle: false });
  });

  test("parcelas canceladas não contam", () => {
    expect(summarizeTitle([parcela({ status: "CANCELLED" })], hoje, false).state).toBe("NONE");
  });

  test("tudo baixado: estado PAID, com a data da última baixa e o valor pago", () => {
    const resumo = summarizeTitle([
      parcela({ status: "PAID", paidDate: day("2026-11-05"), paidAmount: 100 }),
      parcela({ status: "PAID_LATE", paidDate: day("2026-11-12"), paidAmount: 102.5 })
    ], hoje, false);
    expect(resumo).toMatchObject({ state: "PAID", installments: 2, paidInstallments: 2, paidAmount: 202.5, paidDate: "2026-11-12", nextDueDate: null });
  });

  test("parcela futura em aberto: OPEN, com o próximo vencimento", () => {
    const resumo = summarizeTitle([parcela({ dueDate: day("2026-12-20") }), parcela({ dueDate: day("2026-12-05") })], hoje, false);
    expect(resumo).toMatchObject({ state: "OPEN", nextDueDate: "2026-12-05", amount: 200 });
  });

  test("vence hoje ainda não é vencida; ontem já é", () => {
    expect(summarizeTitle([parcela({ dueDate: day("2026-11-24") })], hoje, false).state).toBe("OPEN");
    expect(summarizeTitle([parcela({ dueDate: day("2026-11-23") })], hoje, false).state).toBe("OVERDUE");
  });

  test("parcela marcada OVERDUE no banco é vencida mesmo sem data", () => {
    expect(summarizeTitle([parcela({ status: "OVERDUE", dueDate: null })], hoje, false).state).toBe("OVERDUE");
  });

  test("parcialmente paga: continua aberta e mostra quantas já foram baixadas", () => {
    const resumo = summarizeTitle([
      parcela({ status: "PAID", paidDate: day("2026-11-01"), paidAmount: 100, dueDate: day("2026-11-01") }),
      parcela({ dueDate: day("2026-12-01") })
    ], hoje, false);
    expect(resumo).toMatchObject({ state: "OPEN", installments: 2, paidInstallments: 1, nextDueDate: "2026-12-01" });
  });

  test("vencida pesa mais que aberta quando há as duas", () => {
    const resumo = summarizeTitle([parcela({ dueDate: day("2026-11-01") }), parcela({ dueDate: day("2026-12-01") })], hoje, false);
    expect(resumo.state).toBe("OVERDUE");
    expect(resumo.nextDueDate).toBe("2026-11-01");
  });

  test("lista as parcelas na ordem do título, cada uma com a sua situação", () => {
    const resumo = summarizeTitle([
      parcela({ installment: 2, dueDate: day("2026-12-10"), amount: 50 }),
      parcela({ installment: 1, status: "PAID", dueDate: day("2026-11-10"), paidDate: day("2026-11-09"), amount: 50, paidAmount: 49 }),
      parcela({ installment: 3, dueDate: day("2026-11-01"), amount: 50 }),
      parcela({ installment: 4, status: "CANCELLED", amount: 50 })
    ], hoje, false);
    expect(resumo.parcels).toEqual([
      { number: 1, dueDate: "2026-11-10", amount: 50, state: "PAID", paidDate: "2026-11-09", paidAmount: 49 },
      { number: 2, dueDate: "2026-12-10", amount: 50, state: "OPEN", paidDate: null, paidAmount: 0 },
      { number: 3, dueDate: "2026-11-01", amount: 50, state: "OVERDUE", paidDate: null, paidAmount: 0 }
    ]);
  });

  test("sem número de parcela, numera pela ordem de vencimento", () => {
    const resumo = summarizeTitle([parcela({ dueDate: day("2026-12-20") }), parcela({ dueDate: day("2026-12-05") })], hoje, false);
    expect(resumo.parcels.map((p) => [p.number, p.dueDate])).toEqual([[1, "2026-12-05"], [2, "2026-12-20"]]);
  });

  test("soma em centavos, sem ruído de ponto flutuante", () => {
    const resumo = summarizeTitle([parcela({ amount: 0.1 }), parcela({ amount: 0.2 }), parcela({ amount: 1081.27 })], hoje, false);
    expect(resumo.amount).toBe(1081.57);
  });

  test("valores nulos viram zero e o flag de ciclo é repassado", () => {
    const resumo = summarizeTitle([parcela({ amount: null, paidAmount: null })], hoje, true);
    expect(resumo).toMatchObject({ amount: 0, paidAmount: 0, viaCycle: true });
  });
});
