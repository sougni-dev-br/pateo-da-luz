import { describe, expect, test } from "vitest";
import { nomeDaSubcategoria, planejarSubcategorias, type ProdutoParaSubcategoria, type SubcategoriaExistente } from "../subcategory-plan.js";

const produto = (extra: Partial<ProdutoParaSubcategoria> & { id: string }): ProdutoParaSubcategoria => ({
  externalCode: extra.id.toUpperCase(), categoryId: "c-sec", categoryName: "SECOS E GRAOS", subcategoryId: null, ...extra
});

const existentes: SubcategoriaExistente[] = [{ id: "s-arroz", name: "ARROZ", categoryId: "c-sec" }];

describe("nomeDaSubcategoria", () => {
  test("maiúsculas e espaços simples", () => {
    expect(nomeDaSubcategoria("  feijões   e grãos ")).toBe("FEIJÕES E GRÃOS");
    expect(nomeDaSubcategoria("   ")).toBe("");
  });
});

describe("planejarSubcategorias", () => {
  test("reaproveita a existente da mesma categoria, sem diferenciar caixa nem acento", () => {
    const plano = planejarSubcategorias([{ codigo: "P1", subcategoria: "arroz" }], [produto({ id: "p1" })], existentes);
    expect(plano.criar).toEqual([]);
    expect(plano.atribuir).toEqual([{ productId: "p1", codigo: "P1", categoryId: "c-sec", name: "ARROZ", chave: "c-sec|arroz" }]);
  });

  test("reaproveita a existente com acento ou caixa diferente", () => {
    const comAcento: SubcategoriaExistente[] = [{ id: "s-feijao", name: "FEIJÕES", categoryId: "c-sec" }];
    const plano = planejarSubcategorias([{ codigo: "P1", subcategoria: "feijoes" }], [produto({ id: "p1" })], comAcento);
    expect(plano.criar).toEqual([]);
    expect(plano.atribuir[0]).toMatchObject({ name: "FEIJÕES", chave: "c-sec|feijoes" });
  });

  test("duas grafias da mesma subcategoria nova (com e sem acento) criam uma só e as duas linhas usam a mesma", () => {
    const plano = planejarSubcategorias(
      [{ codigo: "P1", subcategoria: "Feijões" }, { codigo: "P2", subcategoria: "FEIJOES" }],
      [produto({ id: "p1" }), produto({ id: "p2" })],
      existentes
    );
    expect(plano.criar).toEqual([{ categoryId: "c-sec", categoryName: "SECOS E GRAOS", name: "FEIJÕES" }]);
    expect(plano.atribuir.map((a) => a.name)).toEqual(["FEIJÕES", "FEIJÕES"]);
    expect(plano.atribuir.map((a) => a.chave)).toEqual(["c-sec|feijoes", "c-sec|feijoes"]);
  });

  test("subcategoria existente inativa não recebe produto, com motivo", () => {
    const inativa: SubcategoriaExistente[] = [{ id: "s-x", name: "ARROZ", categoryId: "c-sec", isActive: false }];
    const plano = planejarSubcategorias([{ codigo: "P1", subcategoria: "ARROZ" }], [produto({ id: "p1" })], inativa);
    expect(plano.atribuir).toEqual([]);
    expect(plano.ignorados[0].motivo).toMatch(/inativa/);
  });

  test("a categoria da planilha precisa ser a do produto agora", () => {
    const plano = planejarSubcategorias(
      [{ codigo: "P1", subcategoria: "ARROZ", categoria: "Doces e Confeitaria" }, { codigo: "P2", subcategoria: "ARROZ", categoria: "secos e grãos" }],
      [produto({ id: "p1" }), produto({ id: "p2" })],
      existentes
    );
    expect(plano.atribuir.map((a) => a.productId)).toEqual(["p2"]);
    expect(plano.ignorados[0].motivo).toMatch(/categoria mudou desde a planilha/);
  });

  test("cria uma vez só a subcategoria nova, mesmo escolhida por vários produtos", () => {
    const plano = planejarSubcategorias(
      [{ codigo: "P1", subcategoria: "Feijoes" }, { codigo: "P2", subcategoria: "FEIJOES" }],
      [produto({ id: "p1" }), produto({ id: "p2" })],
      existentes
    );
    expect(plano.criar).toEqual([{ categoryId: "c-sec", categoryName: "SECOS E GRAOS", name: "FEIJOES" }]);
    expect(plano.atribuir.map((a) => a.productId)).toEqual(["p1", "p2"]);
  });

  test("a mesma subcategoria em categorias diferentes são duas", () => {
    const plano = planejarSubcategorias(
      [{ codigo: "P1", subcategoria: "OUTROS" }, { codigo: "P2", subcategoria: "OUTROS" }],
      [produto({ id: "p1" }), produto({ id: "p2", categoryId: "c-doc", categoryName: "DOCES" })],
      existentes
    );
    expect(plano.criar).toHaveLength(2);
  });

  test("nunca troca a subcategoria que o produto já tem", () => {
    const plano = planejarSubcategorias([{ codigo: "P1", subcategoria: "ARROZ" }], [produto({ id: "p1", subcategoryId: "s-x" })], existentes);
    expect(plano.atribuir).toEqual([]);
    expect(plano.ignorados[0].motivo).toMatch(/já tem subcategoria/);
  });

  test("linha em branco é só pulada; código desconhecido, repetido e produto sem categoria são ignorados com motivo", () => {
    const plano = planejarSubcategorias(
      [
        { codigo: "P1", subcategoria: "" },
        { codigo: "X9", subcategoria: "ARROZ" },
        { codigo: "P2", subcategoria: "ARROZ" },
        { codigo: "P2", subcategoria: "ARROZ" },
        { codigo: "P3", subcategoria: "ARROZ" }
      ],
      [produto({ id: "p1" }), produto({ id: "p2" }), produto({ id: "p3", categoryId: null, categoryName: null })],
      existentes
    );
    expect(plano.atribuir.map((a) => a.productId)).toEqual(["p2"]);
    expect(plano.ignorados.map((i) => i.motivo)).toEqual(["produto não encontrado", "código repetido na planilha", "produto sem categoria"]);
  });
});
