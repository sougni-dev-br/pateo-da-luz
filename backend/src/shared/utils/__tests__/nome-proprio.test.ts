import { describe, expect, test } from "vitest";
import { acentosDoNomeCompleto, cidadeProprio, nomeProprio } from "../nome-proprio.js";

describe("nomeProprio", () => {
  test("maiúsculas, minúsculas e misto viram nome próprio, com partículas em minúsculas", () => {
    expect(nomeProprio("FULANO DOS SANTOS DE TAL")).toBe("Fulano dos Santos de Tal");
    expect(nomeProprio("fulana da silva e souza")).toBe("Fulana da Silva e Souza");
    expect(nomeProprio("Rua DAS FLORES")).toBe("Rua das Flores");
  });

  test("espaços extras somem; vazio e nulo viram null", () => {
    expect(nomeProprio("  ANA   MARIA ")).toBe("Ana Maria");
    expect(nomeProprio("   ")).toBeNull();
    expect(nomeProprio(null)).toBeNull();
  });

  test("acento e cedilha são preservados; partícula no começo ganha maiúscula", () => {
    expect(nomeProprio("JOÃO GONÇALVES")).toBe("João Gonçalves");
    expect(nomeProprio("DA SILVA")).toBe("Da Silva");
  });

  test("romano, hífen e complemento de endereço", () => {
    expect(nomeProprio("PEDRO DE TAL II")).toBe("Pedro de Tal II");
    expect(nomeProprio("ANA-MARIA")).toBe("Ana-Maria");
    expect(nomeProprio("apto 23")).toBe("Apto 23");
  });
});

describe("sobrenome e acentos do nome completo", () => {
  test("sobrenome continua o nome: partícula no começo fica minúscula", () => {
    expect(nomeProprio("DA SILVA", { continuacao: true })).toBe("da Silva");
    expect(nomeProprio("DE SOUZA FERREIRA", { continuacao: true })).toBe("de Souza Ferreira");
  });

  test("acento vem do nome completo só para a mesma palavra", () => {
    expect(acentosDoNomeCompleto("Mendes Goncalves", "Fulana Mendes Gonçalves")).toBe("Mendes Gonçalves");
    expect(acentosDoNomeCompleto("Joao da Silva", "João da Silva Souza")).toBe("João da Silva");
    expect(acentosDoNomeCompleto("Mendes Goncalves", null)).toBe("Mendes Goncalves");
    expect(acentosDoNomeCompleto("Ana Paula", "Ana Pâmela")).toBe("Ana Paula");
  });
});

describe("cidadeProprio", () => {
  test("cidade da lista ganha acento; fora da lista fica só no padrão", () => {
    expect(cidadeProprio("SAO PAULO")).toBe("São Paulo");
    expect(cidadeProprio("CARAPICUIBA")).toBe("Carapicuíba");
    expect(cidadeProprio("TABOAO DA SERRA")).toBe("Taboão da Serra");
    expect(cidadeProprio("CAMPINAS")).toBe("Campinas");
  });

  test("naturalidade com UF: acento na cidade e UF em maiúsculas", () => {
    expect(cidadeProprio("SAO PAULO - SP")).toBe("São Paulo - SP");
    expect(cidadeProprio("RECIFE - PE")).toBe("Recife - PE");
  });
});
