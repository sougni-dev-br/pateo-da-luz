import { expect, test } from "vitest";
import type { Payable } from "../../../api/client";
import { juntarVencidosAnteriores } from "../regras";

const p = (id: string, status: string, sourceType = "PAYROLL") => ({ id, status, sourceType, dueDate: "2026-09-30" }) as unknown as Payable;

test("vencido de antes do período entra; repetido e pago não", () => {
  const periodo = [p("a", "OPEN"), p("b", "OVERDUE")];
  const antes = [p("juliana", "OVERDUE"), p("b", "OVERDUE"), p("pago", "PAID")];
  expect(juntarVencidosAnteriores(periodo, antes).map((x) => x.id)).toEqual(["juliana", "a", "b"]);
});

test("mesmo id de origens diferentes não é repetido", () => {
  expect(juntarVencidosAnteriores([p("1", "OPEN", "DIRECT")], [p("1", "OVERDUE", "PAYROLL")]).length).toBe(2);
});

test("vencidos de antes do período: só nos presets de mês/ano corrente e dos próximos dias", async () => {
  const { periodoPuxaVencidosAnteriores, OPCOES_PERIODO } = await import("../regras");
  for (const preset of ["currentMonth", "currentYear", "next7", "next15", "next30", "nextMonth", "paidMonth"]) {
    expect(periodoPuxaVencidosAnteriores(preset)).toBe(true);
  }
  // "Vence hoje", "Últimos 7/30 dias", "Ontem", "Mês anterior", personalizado e "Vencidos" (já cobre tudo): não.
  for (const preset of ["today", "yesterday", "last7", "last30", "previousMonth", "custom", "overdue", "", null, undefined]) {
    expect(periodoPuxaVencidosAnteriores(preset)).toBe(false);
  }
  expect(OPCOES_PERIODO.map((o) => o.label)).toContain("Mês anterior");
});
