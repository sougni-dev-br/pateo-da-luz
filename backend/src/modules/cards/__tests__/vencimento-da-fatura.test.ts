import { describe, expect, it, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({ prisma: {} }));

const { getCardStatementPeriod, getCardStatementPeriodForInstallment, periodoDaCompetencia, vencimentoDaFatura } =
  await import("../cards.service.js");

// O vencimento é o primeiro "dia de vencimento" depois do fechamento: fecha 5 e vence 18 → mesmo mês;
// fecha 25 e vence 5 → mês seguinte. As três formas de criar fatura têm que dar a mesma data.

const dia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const cartao = (closingDay: number, dueDay: number) => ({ id: "c", name: "C", bankName: "B", last4Digits: "1111", closingDay, dueDay });

describe("vencimentoDaFatura", () => {
  it("vencimento depois do fechamento no mesmo mês fica no mesmo mês", () => {
    expect(dia(vencimentoDaFatura(2026, 8, 5, 18))).toBe("2026-08-18");
  });
  it("vencimento antes (ou no) do fechamento vai para o mês seguinte", () => {
    expect(dia(vencimentoDaFatura(2026, 3, 25, 5))).toBe("2026-04-05");
    expect(dia(vencimentoDaFatura(2026, 3, 10, 10))).toBe("2026-04-10");
  });
  it("vira o ano e respeita o último dia do mês", () => {
    expect(dia(vencimentoDaFatura(2026, 12, 25, 5))).toBe("2027-01-05");
    expect(dia(vencimentoDaFatura(2027, 1, 5, 31))).toBe("2027-01-31");
    expect(dia(vencimentoDaFatura(2027, 2, 5, 31))).toBe("2027-02-28");
  });
});

describe("as três formas de criar fatura dão o mesmo vencimento", () => {
  const casos: Array<[number, number]> = [[5, 18], [25, 5], [10, 10], [28, 31]];
  it.each(casos)("fecha %i vence %i", (closing, due) => {
    const c = cartao(closing, due);
    const compra = new Date(2026, 8, 2);
    const automatica = getCardStatementPeriodForInstallment(c, compra, 0);
    const porCompra = getCardStatementPeriod(c, compra);
    const porCompetencia = periodoDaCompetencia(c, automatica.competenceYear, automatica.competenceMonth);
    expect(dia(porCompra.dueDate)).toBe(dia(automatica.dueDate));
    expect(dia(porCompetencia.dueDate)).toBe(dia(automatica.dueDate));
    expect(dia(porCompetencia.closingDate)).toBe(dia(automatica.closingDate));
  });

  it("o caso real: fatura de agosto fecha 05/08 e vence 18/08", () => {
    const p = periodoDaCompetencia(cartao(5, 18), 2026, 8);
    expect([dia(p.closingDate), dia(p.dueDate)]).toEqual(["2026-08-05", "2026-08-18"]);
  });
});
