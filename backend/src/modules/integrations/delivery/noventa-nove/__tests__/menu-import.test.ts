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

describe("chave do item quando a 99 nao da identificador", () => {
  // Payload REAL de producao (18/09/2026, Pateo da Luz Pizzaria): a 99 devolve
  // app_item_id VAZIO para todo item criado no portal dela — o campo e o id que o
  // INTEGRADOR envia ao subir cardapio por API, e este cardapio foi feito a mao.
  // A primeira versao do import usava esse campo como chave e pulou os 250 itens.
  const ITEM_REAL = {
    app_item_id: "",
    app_external_id: "",
    item_name: "Brotinho de chocolate",
    short_desc: "Brotinho de chocolate",
    item_type: 0,
    status: 1,
    price: 5090
  };

  function chaveDoItem(item: { app_item_id?: string; item_name?: string }) {
    const idDaPlataforma = item.app_item_id ? String(item.app_item_id).trim() : "";
    return idDaPlataforma || `nome:${chaveDoPrato(item.item_name ?? "")}`;
  }

  test("item sem identificador cai para o nome — e nao e descartado", () => {
    expect(chaveDoItem(ITEM_REAL)).toBe("nome:brotinho de chocolate");
  });

  test("a chave derivada e estavel entre lojas que digitaram o nome diferente", () => {
    expect(chaveDoItem({ app_item_id: "", item_name: "Brotinho de Chocolate" }))
      .toBe(chaveDoItem({ app_item_id: "", item_name: "  brotinho  de chocolate " }));
  });

  test("se um dia a plataforma der id, ele tem prioridade sobre o nome", () => {
    expect(chaveDoItem({ app_item_id: "ABC-1", item_name: "Brotinho" })).toBe("ABC-1");
  });

  test("preco do item real converte de centavos", () => {
    expect(precoEmReais(ITEM_REAL.price)).toBe(50.9);
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

describe("itens colapsados dentro da mesma loja", () => {
  // Caso REAL (18/09/2026, Pateo da Luz Pizzaria): dois itens chamados "Peperoni",
  // ambos ativos, a R$ 101,90 e R$ 76,00. Sem id de plataforma sao indistinguiveis,
  // e o segundo sobrescreveu o primeiro — 58 itens viraram 57 listagens.
  // Perder item de cardapio em silencio e como o erro chega no calculo de margem
  // sem ninguem saber, entao isto tem que sair no retorno.
  function detectaColapso(itens: { item_name: string; price: number }[]) {
    const vistas = new Map<string, number>();
    const colapsados: { nome: string; precos: string[] }[] = [];
    for (const i of itens) {
      const chave = chaveDoPrato(i.item_name);
      const preco = precoEmReais(i.price);
      const anterior = vistas.get(chave);
      if (anterior !== undefined) {
        colapsados.push({ nome: i.item_name, precos: [anterior, preco].map((p) => `R$ ${p.toFixed(2)}`) });
      }
      vistas.set(chave, preco);
    }
    return colapsados;
  }

  test("dois Peperoni com precos diferentes sao reportados", () => {
    const r = detectaColapso([
      { item_name: "Peperoni", price: 10190 },
      { item_name: "Peperoni", price: 7600 }
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].precos).toEqual(["R$ 101.90", "R$ 76.00"]);
  });

  test("mesmo nome digitado com espaco diferente tambem colapsa e e reportado", () => {
    expect(detectaColapso([
      { item_name: "Pizza Portuguesa", price: 5000 },
      { item_name: "pizza  portuguesa", price: 6000 }
    ])).toHaveLength(1);
  });

  test("cardapio sem repeticao nao gera ruido", () => {
    expect(detectaColapso([
      { item_name: "Peperoni", price: 10190 },
      { item_name: "Portuguesa", price: 7600 }
    ])).toHaveLength(0);
  });
});
