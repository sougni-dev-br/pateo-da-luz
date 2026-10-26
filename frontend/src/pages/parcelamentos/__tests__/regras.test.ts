import { describe, expect, it } from "vitest";
import { gerarParcelas, motivoProdutoInvalido, parcelasSugeridas, repartirAcrescimo, repartirDesconto, somaEmCentavos, valorDoCampo } from "../regras";

// Valores e datas fictícios.

describe("valorDoCampo", () => {
  it("aceita formato brasileiro e com ponto decimal", () => {
    expect(valorDoCampo("1.234,56")).toBe(1234.56);
    expect(valorDoCampo("1234,5")).toBe(1234.5);
    expect(valorDoCampo("1234.56")).toBe(1234.56);
    expect(valorDoCampo("100")).toBe(100);
  });
  it("devolve null para texto inválido ou vazio", () => {
    expect(valorDoCampo("")).toBeNull();
    expect(valorDoCampo("abc")).toBeNull();
    expect(valorDoCampo("12,345")).toBeNull();
  });
});

describe("gerarParcelas", () => {
  it("divide em centavos com o resto na última e vencimentos mensais", () => {
    expect(gerarParcelas(100, 3, "2026-11-30")).toEqual([
      { valor: "33,33", vencimento: "2026-11-30" },
      { valor: "33,33", vencimento: "2026-12-30" },
      { valor: "33,34", vencimento: "2027-01-30" }
    ]);
  });
  it("dia 31 cai no último dia do mês curto", () => {
    expect(gerarParcelas(30, 3, "2026-01-31").map((p) => p.vencimento)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });
  it("devolve lista vazia com dados incompletos", () => {
    expect(gerarParcelas(0, 3, "2026-11-30")).toEqual([]);
    expect(gerarParcelas(100, 0, "2026-11-30")).toEqual([]);
    expect(gerarParcelas(100, 3, "")).toEqual([]);
  });
});

describe("somaEmCentavos", () => {
  it("soma sem erro de ponto flutuante e ignora valor inválido", () => {
    expect(somaEmCentavos([{ valor: "0,10" }, { valor: "0,20" }, { valor: "x" }])).toBe(30);
  });
});

describe("repartirDesconto", () => {
  it("reparte em centavos e a soma fecha no desconto", () => {
    const partes = repartirDesconto([100, 100, 100], 10);
    expect(partes).toEqual([3.33, 3.33, 3.34]);
  });
  it("recusa desconto que zere ou ultrapasse as parcelas", () => {
    expect(repartirDesconto([50, 50], 100)).toBeNull();
    expect(repartirDesconto([50, 50], -1)).toBeNull();
  });
});

describe("motivoProdutoInvalido", () => {
  const ok = { isActive: true, controlsStock: false, dreCategoryId: "d1", dreCategory: { dreGroup: "LOCACAO" } };
  it("aceita produto de despesa", () => expect(motivoProdutoInvalido(ok)).toBeNull());
  it("recusa estoque, CMV, sem categoria e inativo", () => {
    expect(motivoProdutoInvalido({ ...ok, controlsStock: true })).toMatch(/estoque/);
    expect(motivoProdutoInvalido({ ...ok, dreCategory: { dreGroup: "CMV_COMPRAS" } })).toMatch(/CMV/);
    expect(motivoProdutoInvalido({ ...ok, dreCategoryId: null })).toMatch(/categoria/);
    expect(motivoProdutoInvalido({ ...ok, isActive: false })).toMatch(/inativo/);
  });
});

describe("parcelasSugeridas", () => {
  const parcelas = [
    { installmentId: "a", dueDate: "2026-09-10" },
    { installmentId: "b", dueDate: "2026-11-20" },
    { installmentId: "c", dueDate: "2026-12-10" },
    { installmentId: null, dueDate: "2026-10-25" }
  ];
  it("sugere as vencidas e as que vencem em até 30 dias", () => {
    expect(parcelasSugeridas(parcelas, "2026-10-23")).toEqual(["a", "b"]);
  });
  it("com mais dias inclui as seguintes", () => {
    expect(parcelasSugeridas(parcelas, "2026-10-23", 60)).toEqual(["a", "b", "c"]);
  });
});

describe("repartirAcrescimo", () => {
  it("reparte em centavos e a soma fecha", () => {
    expect(repartirAcrescimo(3, 10)).toEqual([3.33, 3.33, 3.34]);
  });
  it("recusa valor negativo ou sem parcelas", () => {
    expect(repartirAcrescimo(2, -1)).toBeNull();
    expect(repartirAcrescimo(0, 5)).toBeNull();
  });
});
