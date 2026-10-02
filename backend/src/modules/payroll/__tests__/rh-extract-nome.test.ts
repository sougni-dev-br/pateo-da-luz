import { describe, expect, test } from "vitest";
import { splitName } from "../rh-extract.service.js";

// Cadastro criado pelo extrato da contabilidade (nome em MAIÚSCULAS). Pessoa fictícia.
describe("nome do funcionário criado pelo extrato", () => {
  test("nasce no padrão do cadastro, com o nome inteiro em nome completo", () => {
    expect(splitName("FULANA DE TAL DOS SANTOS")).toEqual({
      firstName: "Fulana", lastName: "de Tal dos Santos", nomeCompleto: "Fulana de Tal dos Santos",
    });
  });

  test("nome de uma palavra só repete no sobrenome, como antes", () => {
    expect(splitName("  CICLANO ")).toEqual({ firstName: "Ciclano", lastName: "Ciclano", nomeCompleto: "Ciclano" });
  });
});
