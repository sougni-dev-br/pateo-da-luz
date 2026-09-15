import { describe, expect, test } from "vitest";
import { palavrasChave, semelhanca } from "../similaridade.js";

describe("semelhanca — casos que acontecem em nota fiscal", () => {
  test("texto idêntico dá 1", () => {
    expect(semelhanca("FILE DE FRANGO", "FILE DE FRANGO")).toBe(1);
  });

  test("ignora acento e caixa", () => {
    expect(semelhanca("MANJERICÃO", "manjericao")).toBe(1);
  });

  test("reconhece o mesmo item com sufixo de embalagem", () => {
    // Fornecedor escreve com o peso, o cadastro sem — ou o contrário.
    expect(semelhanca("ARROZ BRANCO T1 CAMIL", "ARROZ BRANCO T1 CAMIL PACOTE 5KG")).toBeGreaterThan(0.6);
  });

  test("reconhece ordem trocada das palavras", () => {
    expect(semelhanca("QUEIJO PARMESAO TROPICAL", "PARMESAO TROPICAL QUEIJO")).toBeGreaterThan(0.85);
  });

  test("tolera erro de grafia", () => {
    expect(semelhanca("MUSSARELA", "MUCARELA")).toBeGreaterThan(0.55);
  });

  test("dá nota baixa para produtos diferentes que só compartilham uma palavra", () => {
    // O risco real: lançar óleo de soja como azeite. Tem que ficar longe do corte.
    expect(semelhanca("OLEO DE SOJA PET 900ML", "AZEITE DE OLIVA 500ML")).toBeLessThan(0.55);
  });

  test("separa variações que importam do mesmo produto", () => {
    const alface = semelhanca("ALFACE CRESPA", "ALFACE ROXA");
    // São produtos distintos no cadastro: não pode passar por idêntico.
    expect(alface).toBeLessThan(0.82);
  });

  test("texto vazio não gera semelhança", () => {
    expect(semelhanca("", "FRANGO")).toBe(0);
    expect(semelhanca("FRANGO", "   ")).toBe(0);
  });
});

describe("palavrasChave", () => {
  test("descarta unidade, número e conectivo, ficando com o que significa", () => {
    expect(palavrasChave("1,00 UN - FILE DE FRANGO")).toEqual(expect.arrayContaining(["frango", "file"]));
    expect(palavrasChave("1,00 UN - FILE DE FRANGO")).not.toContain("un");
    expect(palavrasChave("1,00 UN - FILE DE FRANGO")).not.toContain("de");
  });

  test("prioriza as palavras mais longas", () => {
    expect(palavrasChave("CAFE EXTRA FORTE CHEF 250G", 2)).toEqual(["extra", "forte"]);
  });

  test("devolve vazio quando não há palavra útil", () => {
    expect(palavrasChave("1,00 UN - 500")).toEqual([]);
  });
});
