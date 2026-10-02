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

describe("casos que a regra não pode estragar", () => {
  test("apóstrofo, Mc e parêntese", () => {
    expect(nomeProprio("JOANA D'ÁVILA")).toBe("Joana D'Ávila");
    expect(nomeProprio("o'brien")).toBe("O'Brien");
    expect(nomeProprio("MCDONALD")).toBe("McDonald");
    expect(nomeProprio("CASA (FUNDOS)")).toBe("Casa (Fundos)");
    expect(nomeProprio("COZINHEIRO (A)")).toBe("Cozinheiro (a)");
  });

  test("romanos até XX e letra sozinha depois de Rua/Bloco", () => {
    expect(nomeProprio("RUA XV DE NOVEMBRO")).toBe("Rua XV de Novembro");
    expect(nomeProprio("bloco e apto 12")).toBe("Bloco E Apto 12");
    expect(nomeProprio("RUA A")).toBe("Rua A");
    expect(nomeProprio("ANA E PAULO")).toBe("Ana e Paulo");
  });

  test("palavra com número ou barra fica como foi digitada", () => {
    expect(nomeProprio("Apto 12B")).toBe("Apto 12B");
    expect(nomeProprio("RODOVIA SP-280")).toBe("Rodovia SP-280");
    expect(nomeProprio("rua sem nome, S/N")).toBe("Rua Sem Nome, S/N");
  });

  test("Di e Du são sobrenomes, não partículas", () => {
    expect(nomeProprio("LUCIA DI MARCO")).toBe("Lucia Di Marco");
    expect(nomeProprio("DI LUCIA", { continuacao: true })).toBe("Di Lucia");
  });
});

describe("sobrenome e acentos do nome completo", () => {
  test("sobrenome continua o nome: partícula no começo fica minúscula", () => {
    expect(nomeProprio("DA SILVA", { continuacao: true })).toBe("da Silva");
    expect(nomeProprio("DE MOURA PRADO", { continuacao: true })).toBe("de Moura Prado");
  });

  test("acento vem do nome completo só para a mesma palavra", () => {
    expect(acentosDoNomeCompleto("Mota Goncalves", "Fulana Mota Gonçalves")).toBe("Mota Gonçalves");
    expect(acentosDoNomeCompleto("Joao da Silva", "João da Silva Souza")).toBe("João da Silva");
    expect(acentosDoNomeCompleto("Mota Goncalves", null)).toBe("Mota Goncalves");
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
