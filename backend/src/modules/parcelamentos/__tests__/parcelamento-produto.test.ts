import { expect, test } from "vitest";
import { motivoProdutoInvalido } from "../parcelamento-produto.js";

// Dados fictícios. O parcelamento de dívida é despesa: produto de estoque ou de CMV distorceria CMV e DRE.

const ok = { isActive: true, controlsStock: false, dreCategoryId: "d1", dreGroup: "LOCACAO" };

test("aceita produto ativo, sem estoque e com categoria fora do CMV", () => {
  expect(motivoProdutoInvalido(ok)).toBeNull();
});

test("recusa produto inativo", () => {
  expect(motivoProdutoInvalido({ ...ok, isActive: false })).toMatch(/inativo/i);
});

test("recusa produto que controla estoque", () => {
  expect(motivoProdutoInvalido({ ...ok, controlsStock: true })).toMatch(/estoque/i);
});

test("recusa produto sem categoria de DRE", () => {
  expect(motivoProdutoInvalido({ ...ok, dreCategoryId: null, dreGroup: null })).toMatch(/categoria/i);
});

test("recusa categoria que cai no CMV", () => {
  expect(motivoProdutoInvalido({ ...ok, dreGroup: "CMV_COMPRAS" })).toMatch(/CMV/);
});
