import { describe, expect, test } from "vitest";
import { montarRotina, type ApoioDaRotina } from "../conversoes-pendentes.js";
import type { ProdutoCarregadoParaConversao } from "../../products/conversao-automatica.service.js";

const produto = (id: string, nome: string, contagem: string, extra: Partial<ProdutoCarregadoParaConversao["entrada"]> = {}): ProdutoCarregadoParaConversao => ({
  productId: id, codigo: id.toUpperCase(), nome, contagem,
  entrada: { nome, unidadeDeContagem: contagem, cadastradas: [], unidadesDaNota: [], precoNaContagem: null, ...extra }
});

const apoio = (ids: string[], extra: Partial<ApoioDaRotina> = {}): ApoioDaRotina => ({
  saldos: new Map(), controlaEstoque: new Set(ids), setores: new Map(), setorDoProduto: new Map(), usos: new Map(), conferencias: new Map(), ...extra
});

const statusDe = (r: ReturnType<typeof montarRotina>, id: string) => r.produtos.find((p) => p.productId === id)?.status;

describe("montarRotina: situação da conversão de cada produto", () => {
  test("sem nenhuma conversão cadastrada o produto está PENDENTE, mesmo sem compra nem uso", () => {
    const r = montarRotina([produto("a", "ALFACE", "UN")], apoio(["a"]));
    expect(statusDe(r, "a")).toBe("PENDENTE");
    expect(r.resumo).toEqual({ total: 1, pendentes: 1, parciais: 0, cadastrados: 0, naoPrecisa: 0 });
  });

  test("com conversão cadastrada e nada mais em uso, está CADASTRADO", () => {
    const p = produto("a", "FARINHA", "KG", { cadastradas: [{ fromUnit: "SC", toUnit: "KG", factor: 25 }], unidadesDaNota: [{ unidade: "SC", linhas: 3, valor: 300, precoPorUnidade: 100 }] });
    expect(statusDe(montarRotina([p], apoio(["a"])), "a")).toBe("CADASTRADO");
  });

  test("conversão cadastrada, mas ainda se compra em outra unidade que não converte: PARCIAL", () => {
    const p = produto("a", "QUEIJO", "KG", { cadastradas: [{ fromUnit: "SC", toUnit: "KG", factor: 25 }], unidadesDaNota: [{ unidade: "PC", linhas: 6, valor: 900, precoPorUnidade: 150 }] });
    const r = montarRotina([p], apoio(["a"]));
    expect(statusDe(r, "a")).toBe("PARCIAL");
    expect(r.produtos[0].pendencias[0]).toMatchObject({ unidade: "PC", origem: "COMPRA", linhas: 6 });
  });

  test("conferido como 'não precisa' sai da fila, com quem conferiu e quando", () => {
    const r = montarRotina([produto("a", "SAL", "KG")], apoio(["a"], { conferencias: new Map([["a", { por: "Eli", em: "2026-10-15T10:00:00.000Z" }]]) }));
    expect(r.produtos[0]).toMatchObject({ status: "NAO_PRECISA", conferidoPorNome: "Eli", conferidoEm: "2026-10-15T10:00:00.000Z" });
    expect(r.resumo.naoPrecisa).toBe(1);
  });

  test("BACON PEÇA em KG pede a conversão da peça (UN) como pendência", () => {
    const r = montarRotina([produto("b", "BACON PEÇA", "KG")], apoio(["b"], { saldos: new Map([["b", 0.1]]) }));
    expect(r.produtos[0].pendencias).toEqual([{ unidade: "PÇ", origem: "NOME_PECA", linhas: 0, valor: 0, proposta: null }]);
    expect(r.produtos[0].saldo).toBe(0.1);
  });

  test("traz a proposta do nome quando existe (FARINHA 5KG comprada em UN)", () => {
    const p = produto("c", "FARINHA TRIGO 5KG", "KG", { unidadesDaNota: [{ unidade: "UN", linhas: 4, valor: 200, precoPorUnidade: 50 }], precoNaContagem: 10 });
    expect(montarRotina([p], apoio(["c"])).produtos[0].pendencias[0].proposta).toMatchObject({ factor: 5 });
  });

  test("produto que não controla estoque fica de fora", () => {
    const r = montarRotina([produto("a", "BACON PEÇA", "KG"), produto("b", "PRESUNTO PEÇA", "KG")], apoio(["b"]));
    expect(r.produtos.map((x) => x.productId)).toEqual(["b"]);
  });

  test("o local do produto vai junto, para o estoquista trabalhar uma prateleira por vez", () => {
    const r = montarRotina([produto("a", "ALFACE", "UN")], apoio(["a"], { setores: new Map([["s1", { id: "s1", nome: "CAMARA FRIA" }]]), setorDoProduto: new Map([["a", "s1"]]) }));
    expect(r.produtos[0]).toMatchObject({ sectorId: "s1", sectorName: "CAMARA FRIA" });
  });

  test("a fila vem do que a cozinha mais pede para o que menos pede; depois o valor em compras; os resolvidos por último", () => {
    const muito = produto("m", "ZEBU", "KG");
    const compras = produto("c", "ALHO", "KG", { unidadesDaNota: [{ unidade: "PC", linhas: 5, valor: 9000, precoPorUnidade: 1 }] });
    const pouco = produto("p", "BANANA", "KG");
    const pronto = produto("r", "AAA PRONTO", "KG", { cadastradas: [{ fromUnit: "UN", toUnit: "KG", factor: 1 }] });
    const r = montarRotina([pronto, pouco, compras, muito], apoio(["m", "c", "p", "r"], { usos: new Map([["m", 12], ["p", 1]]) }));
    expect(r.produtos.map((x) => x.productId)).toEqual(["m", "p", "c", "r"]);
  });
});
