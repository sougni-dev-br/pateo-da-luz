import { describe, expect, test } from "vitest";
import { ROTAS_ANTIGAS_RH, linkRescisao, rotaNovaDe } from "../rotasRh";

describe("rotaNovaDe — endereços antigos de /pessoal", () => {
  test.each([
    ["/pessoal/funcionarios", "/rh/funcionarios"],
    ["/pessoal/escala", "/rh/escala"],
    ["/pessoal/folha", "/rh/folha"],
    ["/pessoal/gorjeta", "/rh/gorjeta"],
    ["/pessoal/extras", "/rh/extras"],
    ["/pessoal", "/rh/funcionarios"],
  ])("%s → %s", (antigo, novo) => {
    expect(rotaNovaDe(antigo)).toBe(novo);
  });

  test("barra no fim e maiúsculas também redirecionam", () => {
    expect(rotaNovaDe("/pessoal/escala/")).toBe("/rh/escala");
    expect(rotaNovaDe("/Pessoal/Folha")).toBe("/rh/folha");
  });

  test("a busca vai junto", () => {
    expect(rotaNovaDe("/pessoal/escala", "?mes=2026-09")).toBe("/rh/escala?mes=2026-09");
  });

  test("atalho da gorjeta ?rescisao= abre a rescisão da pessoa", () => {
    expect(rotaNovaDe("/pessoal/funcionarios", "?rescisao=abc")).toBe("/rh/rescisoes?funcionario=abc");
  });

  test("endereço que não é antigo devolve null", () => {
    expect(rotaNovaDe("/rh/folha")).toBeNull();
    expect(rotaNovaDe("/pessoal/outra")).toBeNull();
  });

  test("lista das antigas cobre todos os itens de antes", () => {
    expect(ROTAS_ANTIGAS_RH).toEqual(expect.arrayContaining(["/pessoal/funcionarios", "/pessoal/escala", "/pessoal/folha", "/pessoal/gorjeta", "/pessoal/extras"]));
  });
});

describe("linkRescisao", () => {
  test("codifica o id", () => {
    expect(linkRescisao("a b")).toBe("/rh/rescisoes?funcionario=a%20b");
  });
});
