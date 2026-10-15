import { describe, expect, test } from "vitest";
import { montarPendencias } from "../conversoes-pendentes.js";
import type { ProdutoCarregadoParaConversao } from "../../products/conversao-automatica.service.js";

const produto = (id: string, nome: string, contagem: string, extra: Partial<ProdutoCarregadoParaConversao["entrada"]> = {}): ProdutoCarregadoParaConversao => ({
  productId: id, codigo: id.toUpperCase(), nome, contagem,
  entrada: { nome, unidadeDeContagem: contagem, cadastradas: [], unidadesDaNota: [], precoNaContagem: null, ...extra }
});

const todos = (...ids: string[]) => new Set(ids);

describe("montarPendencias", () => {
  test("unidade em que se comprou e que não converte vira pendência, com o valor e as linhas", () => {
    const p = produto("a", "QUEIJO", "KG", { unidadesDaNota: [{ unidade: "PC", linhas: 12, valor: 3000, precoPorUnidade: 250 }] });
    const r = montarPendencias([p], new Map([["a", 2.5]]), todos("a"));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ productId: "a", unidadeDeContagem: "KG", saldo: 2.5 });
    expect(r[0].pendencias[0]).toMatchObject({ origem: "COMPRA", linhas: 12, valor: 3000 });
  });

  test("o que já converte (cadastrado, mesma unidade, KG↔G) não é pendência", () => {
    const p = produto("a", "FARINHA", "KG", {
      cadastradas: [{ fromUnit: "SC", toUnit: "KG", factor: 25 }],
      unidadesDaNota: [{ unidade: "SC", linhas: 3, valor: 300, precoPorUnidade: 100 }, { unidade: "G", linhas: 2, valor: 10, precoPorUnidade: 0.01 }, { unidade: "KG", linhas: 9, valor: 90, precoPorUnidade: 10 }]
    });
    expect(montarPendencias([p], new Map(), todos("a"))).toEqual([]);
  });

  test("a unidade de compra do cadastro sem nenhuma compra aparece como 'cadastro'", () => {
    const p = produto("a", "AZEITE", "L", { unidadesDaNota: [{ unidade: "LATA", linhas: 0, valor: 0, precoPorUnidade: null }] });
    expect(montarPendencias([p], new Map(), todos("a"))[0].pendencias[0]).toMatchObject({ unidade: "LATA", origem: "CADASTRO" });
  });

  test("BACON PEÇA contado em KG pede a conversão da peça (UN), mesmo sem compra", () => {
    const r = montarPendencias([produto("b", "BACON PEÇA", "KG")], new Map([["b", 0.1]]), todos("b"));
    expect(r[0].pendencias).toEqual([{ unidade: "UN", origem: "NOME_PECA", linhas: 0, valor: 0, proposta: null }]);
  });

  test("traz a proposta do nome quando existe (FARINHA 5KG comprada em UN)", () => {
    const p = produto("c", "FARINHA TRIGO 5KG", "KG", { unidadesDaNota: [{ unidade: "UN", linhas: 4, valor: 200, precoPorUnidade: 50 }], precoNaContagem: 10 });
    const proposta = montarPendencias([p], new Map(), todos("c"))[0].pendencias[0].proposta;
    expect(proposta).toMatchObject({ factor: 5 });
  });

  test("produto que não controla estoque fica de fora; sem saldo registrado o saldo é nulo", () => {
    const a = produto("a", "BACON PEÇA", "KG");
    const b = produto("b", "PRESUNTO PEÇA", "KG");
    const r = montarPendencias([a, b], new Map(), todos("b"));
    expect(r.map((x) => x.productId)).toEqual(["b"]);
    expect(r[0].saldo).toBeNull();
  });

  test("ordena pelo valor em compras sem conversão e depois pelo nome", () => {
    const grande = produto("g", "ZEBU", "KG", { unidadesDaNota: [{ unidade: "PC", linhas: 5, valor: 9000, precoPorUnidade: 1 }] });
    const pequeno = produto("p", "ALHO", "KG", { unidadesDaNota: [{ unidade: "PC", linhas: 1, valor: 10, precoPorUnidade: 1 }] });
    const peca = produto("x", "BACON PEÇA", "KG");
    expect(montarPendencias([peca, pequeno, grande], new Map(), todos("g", "p", "x")).map((x) => x.productId)).toEqual(["g", "p", "x"]);
  });
});
