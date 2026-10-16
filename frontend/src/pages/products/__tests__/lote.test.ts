import { describe, expect, test } from "vitest";
import { LIMPAR, LOTE_VAZIO, comCategoria, descricaoDasMudancas, mudancasDoFormulario, temMudanca } from "../lote";

describe("mudancasDoFormulario", () => {
  test("formulário vazio não muda nada", () => {
    expect(mudancasDoFormulario(LOTE_VAZIO)).toEqual({});
    expect(temMudanca(LOTE_VAZIO)).toBe(false);
  });

  test("só os campos escolhidos entram", () => {
    expect(mudancasDoFormulario({ ...LOTE_VAZIO, categoryId: "c1", controlsStock: "nao" })).toEqual({ categoryId: "c1", controlsStock: false });
  });

  test('"deixar em branco" vira null na subcategoria e no setor', () => {
    expect(mudancasDoFormulario({ ...LOTE_VAZIO, subcategoryId: LIMPAR, inventorySectorId: LIMPAR })).toEqual({ subcategoryId: null, inventorySectorId: null });
  });

  test("situação e natureza", () => {
    expect(mudancasDoFormulario({ ...LOTE_VAZIO, isActive: "inativar", nature: "CONSUMO" })).toEqual({ isActive: false, nature: "CONSUMO" });
    expect(mudancasDoFormulario({ ...LOTE_VAZIO, isActive: "ativar" })).toEqual({ isActive: true });
  });
});

describe("comCategoria", () => {
  test("trocar a categoria zera a subcategoria escolhida", () => {
    const form = { ...LOTE_VAZIO, categoryId: "c1", subcategoryId: "s1" };
    expect(comCategoria(form, "c2")).toMatchObject({ categoryId: "c2", subcategoryId: "" });
  });
});

describe("descricaoDasMudancas", () => {
  test("escreve cada mudança em português com o nome, não o id", () => {
    const linhas = descricaoDasMudancas(
      { ...LOTE_VAZIO, categoryId: "c1", subcategoryId: LIMPAR, controlsStock: "sim" },
      { categoria: "SECOS E GRAOS" }
    );
    expect(linhas).toEqual(["Categoria: SECOS E GRAOS", "Subcategoria: deixar em branco", "Controla estoque: sim (entra na contagem)"]);
  });
});

describe("descricaoDasMudancas: subcategoria ao trocar de categoria", () => {
  test("avisa que a subcategoria antiga será deixada em branco", () => {
    expect(descricaoDasMudancas({ ...LOTE_VAZIO, categoryId: "c1" }, { categoria: "DOCES" })).toEqual([
      "Categoria: DOCES",
      "Subcategoria: deixar em branco (a antiga era de outra categoria)"
    ]);
  });
});
