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

test("vencidos de antes do período só entram quando o período chega até hoje", async () => {
  const { periodoChegaAHoje, OPCOES_PERIODO } = await import("../regras");
  expect(periodoChegaAHoje("2026-10-31", "2026-10-02")).toBe(true);   // Mês atual
  expect(periodoChegaAHoje("2026-12-31", "2026-10-02")).toBe(true);   // Ano atual
  expect(periodoChegaAHoje("2026-09-30", "2026-10-02")).toBe(false);  // Mês anterior: só setembro
  expect(OPCOES_PERIODO.map((o) => o.label)).toContain("Mês anterior");
});
