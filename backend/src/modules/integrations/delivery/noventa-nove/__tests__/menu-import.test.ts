import { describe, expect, test } from "vitest";
import {
  chaveDoPrato,
  detectarPrecosDivergentes,
  mapaCategoriaPorItem,
  precoEmReais
} from "../noventa-nove-menu.service.js";

describe("chaveDoPrato", () => {
  test("mesmo prato digitado com espacos diferentes casa", () => {
    // O cardapio da 99 e digitado a mao, loja por loja.
    expect(chaveDoPrato("  Pizza Portuguesa ")).toBe(chaveDoPrato("Pizza  Portuguesa"));
  });

  test("caixa alta e baixa casam", () => {
    expect(chaveDoPrato("PIZZA PORTUGUESA")).toBe(chaveDoPrato("pizza portuguesa"));
  });

  test("NAO junta pratos diferentes que so parecem parecidos", () => {
    expect(chaveDoPrato("Pizza Portuguesa")).not.toBe(chaveDoPrato("Pizza Portuguesa Grande"));
    expect(chaveDoPrato("Contra filé acebolado")).not.toBe(chaveDoPrato("Contra filé grelhado"));
  });

  test("acento e preservado — separar a mais e menos grave que juntar errado", () => {
    // Remover acento juntaria "File" e "Filé", mas tambem correria o risco de
    // juntar palavras legitimamente distintas. Prato separado o Eli ve na tela;
    // prato juntado errado vira ficha tecnica mentirosa.
    expect(chaveDoPrato("Filé")).not.toBe(chaveDoPrato("File"));
  });
});

describe("precoEmReais", () => {
  test("converte centavos, como todo valor da 99", () => {
    expect(precoEmReais(5942)).toBe(59.42);
    expect(precoEmReais(11990)).toBe(119.9);
  });

  test("ausente ou invalido vira 0 em vez de NaN", () => {
    expect(precoEmReais(undefined)).toBe(0);
    expect(precoEmReais(Number.NaN)).toBe(0);
    expect(precoEmReais(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("mapaCategoriaPorItem", () => {
  test("a 99 so relaciona item e categoria do lado da categoria", () => {
    const mapa = mapaCategoriaPorItem([
      { category_name: "Pizzas", app_item_ids: ["1", "2"] },
      { category_name: "Bebidas", app_item_ids: ["3"] }
    ]);
    expect(mapa.get("1")).toBe("Pizzas");
    expect(mapa.get("2")).toBe("Pizzas");
    expect(mapa.get("3")).toBe("Bebidas");
  });

  test("categoria sem nome nao entra — evitaria prato com categoria vazia", () => {
    const mapa = mapaCategoriaPorItem([{ category_name: "  ", app_item_ids: ["9"] }]);
    expect(mapa.has("9")).toBe(false);
  });

  test("categoria sem itens e lista ausente nao quebram", () => {
    expect(mapaCategoriaPorItem([{ category_name: "Vazia" }]).size).toBe(0);
    expect(mapaCategoriaPorItem(undefined).size).toBe(0);
  });
});

describe("detectarPrecosDivergentes", () => {
  function vistos(entradas: [string, [string, number][]][]) {
    return new Map(entradas.map(([nome, precos]) => [nome.toLowerCase(), { nome, precos: new Map(precos) }]));
  }

  test("aponta o caso real: mesmo prato ao dobro do preco em outra loja", () => {
    const r = detectarPrecosDivergentes(
      vistos([["Contra Filé em tiras + Batatas Bravas", [["Luz & Pizza", 59.42], ["Pizzaria", 119.9]]]])
    );
    expect(r).toHaveLength(1);
    expect(r[0].prato).toBe("Contra Filé em tiras + Batatas Bravas");
    expect(r[0].precos).toEqual(["Luz & Pizza: R$ 59.42", "Pizzaria: R$ 119.90"]);
  });

  test("mesmo preco entre lojas NAO e divergencia", () => {
    expect(detectarPrecosDivergentes(vistos([["Pizza", [["A", 50], ["B", 50]]]]))).toHaveLength(0);
  });

  test("prato de uma loja so nao pode divergir de nada", () => {
    expect(detectarPrecosDivergentes(vistos([["Pizza", [["A", 50]]]]))).toHaveLength(0);
  });

  test("diferenca de centavo conta — e onde erro de cadastro se esconde", () => {
    expect(detectarPrecosDivergentes(vistos([["Pizza", [["A", 50], ["B", 50.01]]]]))).toHaveLength(1);
  });

  test("ordena por quantidade de lojas envolvidas, maior primeiro", () => {
    const r = detectarPrecosDivergentes(
      vistos([
        ["Duas lojas", [["A", 10], ["B", 20]]],
        ["Tres lojas", [["A", 10], ["B", 20], ["C", 30]]]
      ])
    );
    expect(r[0].prato).toBe("Tres lojas");
  });
});
