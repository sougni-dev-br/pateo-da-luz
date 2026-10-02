import { describe, expect, test } from "vitest";
import { empresaDoCiclo } from "../supplier-cycle-company.js";

describe("empresa da compra gerada no fechamento do ciclo", () => {
  test("todas as compras do ciclo na mesma empresa: herda a empresa", () => {
    expect(empresaDoCiclo(["emp-frei", "emp-frei", "emp-frei"])).toBe("emp-frei");
  });
  test("empresas misturadas: fica sem empresa", () => {
    expect(empresaDoCiclo(["emp-frei", "emp-luz"])).toBeNull();
  });
  test("alguma compra sem empresa: fica sem empresa", () => {
    expect(empresaDoCiclo(["emp-frei", null])).toBeNull();
  });
  test("nenhuma compra com empresa (ou nenhum item): sem empresa", () => {
    expect(empresaDoCiclo([null, null])).toBeNull();
    expect(empresaDoCiclo([])).toBeNull();
  });
});
