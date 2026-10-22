import { describe, expect, test } from "vitest";
import {
  avaliarExigencias,
  chaveDaExigencia,
  pendenciasDasExigencias,
  fornecedorPresenteComExigencias,
  type ExigenciaCadastrada
} from "../exigencias-do-fornecedor.js";

const CONDOMINIO: ExigenciaCadastrada = {
  id: "r1", label: "Condomínio do mês", productId: "p-cond", productName: "Taxa de condomínio", settledAt: null
};
const ACORDO: ExigenciaCadastrada = {
  id: "r2", label: "Parcelamento de dívida", productId: "p-div", productName: "Parcelamento de dívida do condomínio", settledAt: null
};

describe("avaliarExigencias", () => {
  test("cada exigência é reconhecida pelo SEU produto", () => {
    const r = avaliarExigencias([CONDOMINIO, ACORDO], [{ productId: "p-cond", total: 3000, count: 1 }]);
    expect(r.find((x) => x.id === "r1")).toMatchObject({ present: true, total: 3000, purchaseCount: 1 });
    expect(r.find((x) => x.id === "r2")).toMatchObject({ present: false, total: 0, purchaseCount: 0 });
  });

  test("lançamento de outro produto não cumpre a exigência", () => {
    const r = avaliarExigencias([ACORDO], [{ productId: "p-cond", total: 3000, count: 1 }]);
    expect(r[0].present).toBe(false);
  });

  test("os dois lançados: as duas presentes", () => {
    const r = avaliarExigencias([CONDOMINIO, ACORDO], [
      { productId: "p-cond", total: 3000, count: 1 },
      { productId: "p-div", total: 1200, count: 1 }
    ]);
    expect(r.every((x) => x.present)).toBe(true);
  });

  test("exigência quitada fica marcada como quitada", () => {
    const r = avaliarExigencias([{ ...ACORDO, settledAt: new Date("2026-10-01") }], []);
    expect(r[0].quitada).toBe(true);
  });

  test("traz o nome do produto para a tela", () => {
    expect(avaliarExigencias([ACORDO], [])[0].productName).toBe("Parcelamento de dívida do condomínio");
  });
});

describe("pendenciasDasExigencias", () => {
  const base = { supplierId: "s1", supplierName: "Condomínio do Shopping" };

  test("uma pendência por exigência faltando, com chave própria", () => {
    const av = avaliarExigencias([CONDOMINIO, ACORDO], [{ productId: "p-cond", total: 3000, count: 1 }]);
    const p = pendenciasDasExigencias({ ...base, aplicaNoMes: true, exigencias: av });
    expect(p).toHaveLength(1);
    expect(p[0].key).toBe(chaveDaExigencia("s1", "r2"));
    expect(p[0].key).toBe("supplier:s1:r2");
    expect(p[0].label).toContain("Condomínio do Shopping");
    expect(p[0].label).toContain("Parcelamento de dívida");
  });

  test("as duas faltando: duas pendências", () => {
    const av = avaliarExigencias([CONDOMINIO, ACORDO], []);
    expect(pendenciasDasExigencias({ ...base, aplicaNoMes: true, exigencias: av })).toHaveLength(2);
  });

  test("acordo quitado deixa de ser cobrado, mas o condomínio do mês continua", () => {
    const av = avaliarExigencias([CONDOMINIO, { ...ACORDO, settledAt: new Date("2026-10-01") }], []);
    const p = pendenciasDasExigencias({ ...base, aplicaNoMes: true, exigencias: av });
    expect(p.map((x) => x.key)).toEqual(["supplier:s1:r1"]);
  });

  test("fora da frequência do mês, não cobra nada", () => {
    const av = avaliarExigencias([CONDOMINIO, ACORDO], []);
    expect(pendenciasDasExigencias({ ...base, aplicaNoMes: false, exigencias: av })).toEqual([]);
  });

  test("tudo lançado: nenhuma pendência", () => {
    const av = avaliarExigencias([CONDOMINIO, ACORDO], [
      { productId: "p-cond", total: 1, count: 1 }, { productId: "p-div", total: 1, count: 1 }
    ]);
    expect(pendenciasDasExigencias({ ...base, aplicaNoMes: true, exigencias: av })).toEqual([]);
  });
});

describe("fornecedorPresenteComExigencias", () => {
  test("sem nenhuma exigência ativa devolve null: vale a regra antiga", () => {
    expect(fornecedorPresenteComExigencias([])).toBeNull();
    const todasQuitadas = avaliarExigencias([{ ...ACORDO, settledAt: new Date() }], []);
    expect(fornecedorPresenteComExigencias(todasQuitadas)).toBeNull();
  });

  test("com exigências ativas, só está presente se TODAS estiverem", () => {
    const so1 = avaliarExigencias([CONDOMINIO, ACORDO], [{ productId: "p-cond", total: 1, count: 1 }]);
    expect(fornecedorPresenteComExigencias(so1)).toBe(false);
    const as2 = avaliarExigencias([CONDOMINIO, ACORDO], [
      { productId: "p-cond", total: 1, count: 1 }, { productId: "p-div", total: 1, count: 1 }
    ]);
    expect(fornecedorPresenteComExigencias(as2)).toBe(true);
  });

  test("a quitada não conta para o 'todas presentes'", () => {
    const av = avaliarExigencias([CONDOMINIO, { ...ACORDO, settledAt: new Date() }], [{ productId: "p-cond", total: 1, count: 1 }]);
    expect(fornecedorPresenteComExigencias(av)).toBe(true);
  });
});
