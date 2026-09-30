import { describe, expect, test } from "vitest";
import { nomeComApelido, resolverApelido } from "../NomePessoa";

describe("nomeComApelido", () => {
  test("nome completo com o apelido entre parênteses", () => {
    expect(nomeComApelido("Luiz Felipe Cardoso Silva", "Luiz")).toBe("Luiz Felipe Cardoso Silva (Luiz)");
  });

  test("sem apelido, ou apelido igual ao nome, fica só o nome", () => {
    expect(nomeComApelido("Ana Souza", null)).toBe("Ana Souza");
    expect(nomeComApelido("Ana Souza", "  ")).toBe("Ana Souza");
    expect(nomeComApelido("Ana Souza", "ana souza")).toBe("Ana Souza");
  });

  test("espaços sobrando no nome não aparecem", () => {
    expect(nomeComApelido(" Bruno  Lima ", "Bruninho")).toBe("Bruno Lima (Bruninho)");
  });
});

describe("resolverApelido", () => {
  const mapa = new Map([["e1", "Luiz"]]);

  test("o apelido da linha vale, inclusive null", () => {
    expect(resolverApelido(mapa, "e1", "Lu")).toBe("Lu");
    expect(resolverApelido(mapa, "e1", null)).toBeNull();
  });

  test("sem o campo, cai no cadastro pelo funcionário", () => {
    expect(resolverApelido(mapa, "e1")).toBe("Luiz");
    expect(resolverApelido(mapa, "e2")).toBeNull();
    expect(resolverApelido(mapa, null)).toBeNull();
  });
});
