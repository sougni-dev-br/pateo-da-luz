import { describe, expect, test } from "vitest";
import { supplierSubline } from "../Suppliers";

const base = { contactName: null, phone: null, email: null, mainCategory: null };

describe("linha de apoio do fornecedor na lista", () => {
  test("contato e categoria juntos", () => {
    expect(supplierSubline({ ...base, contactName: "Wilson", mainCategory: "Bebidas" })).toBe("Wilson · Bebidas");
  });

  test("sem nome de contato, cai no telefone e depois no e-mail", () => {
    expect(supplierSubline({ ...base, phone: "31011781" })).toBe("31011781");
    expect(supplierSubline({ ...base, email: "a@b.com", mainCategory: "Frios" })).toBe("a@b.com · Frios");
  });

  test("só categoria, ou nada preenchido (a linha some)", () => {
    expect(supplierSubline({ ...base, mainCategory: "Limpeza" })).toBe("Limpeza");
    expect(supplierSubline(base)).toBe("");
  });
});
