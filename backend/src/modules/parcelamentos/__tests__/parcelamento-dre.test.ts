import { expect, test } from "vitest";
import { semParcelamentoForaDoDreSql } from "../parcelamento-dre.js";

// Dados fictícios.

test("o fragmento consulta o plano da compra pelo alias informado", () => {
  const sql = semParcelamentoForaDoDreSql("p").sql;
  expect(sql).toContain('"p"."installmentPlanId"');
  expect(sql).toContain('"excludeFromDre" = true');
  expect(sql.trim().startsWith("NOT EXISTS")).toBe(true);
});

test("sem alias usa a tabela Purchase", () => {
  expect(semParcelamentoForaDoDreSql().sql).toContain('"Purchase"."installmentPlanId"');
});

