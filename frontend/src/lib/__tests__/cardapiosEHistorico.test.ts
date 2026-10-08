import { describe, expect, it } from "vitest";
import type { DishCategory, DishListItem, DishRevision, DishRevisionSnapshot } from "../../api/client";
import {
  caminhoDaCategoria, categoriaCombina, contarPorCardapio, montarArvore, opcoesDeCategoria, opcoesDoFiltroDeCategoria
} from "../categoriasDasFichas";
import { filtrarPratos } from "../fichaTecnica";
import { descreverMudancas, montarLinhaDoTempo, serieDoCusto } from "../historicoDaFicha";

const cat = (parcial: Partial<DishCategory> & { id: string; name: string }): DishCategory => ({
  sortOrder: 0, isActive: true, notes: null, parentId: null, menu: "CARDAPIO", ...parcial
});

const CATEGORIAS: DishCategory[] = [
  cat({ id: "massas", name: "Massas" }),
  cat({ id: "fresca", name: "Fresca", parentId: "massas" }),
  cat({ id: "recheada", name: "Recheada", parentId: "massas", sortOrder: 1 }),
  cat({ id: "buffet", name: "Buffet", sortOrder: 1 }),
  cat({ id: "pizzas", name: "Pizzas", menu: "DELIVERY" }),
  cat({ id: "doces", name: "Pizzas doces", menu: "DELIVERY", parentId: "pizzas" }),
  cat({ id: "velha", name: "Antiga", isActive: false })
];

function prato(parcial: Partial<DishListItem> = {}): DishListItem {
  return {
    id: "d", code: null, name: "Prato", menu: "CARDAPIO", category: null, salePriceDefault: 50, yieldQty: 1, yieldUnit: "UN",
    isActive: true, itemsCount: 2, listingsCount: 0, listingPriceMin: null, listingPriceMax: null, calculatedCost: 10,
    custoPorcao: 10, margemBruta: 40, cmvPercentual: 20, custoIncompleto: false, ...parcial
  };
}
const ref = (id: string, name: string, parentId: string | null = null, parentName: string | null = null, menu: "CARDAPIO" | "DELIVERY" = "CARDAPIO") =>
  ({ id, name, parentId, parentName, menu });

describe("categorias e cardápios", () => {
  it("o caminho mostra pai › filha, só o nome ou 'Sem categoria'", () => {
    expect(caminhoDaCategoria(ref("fresca", "Fresca", "massas", "Massas"))).toBe("Massas › Fresca");
    expect(caminhoDaCategoria(ref("buffet", "Buffet"))).toBe("Buffet");
    expect(caminhoDaCategoria(null)).toBe("Sem categoria");
  });

  it("filtrar pela categoria principal inclui as subcategorias; pela filha, só ela", () => {
    const naFresca = prato({ category: ref("fresca", "Fresca", "massas", "Massas") });
    const naPrincipal = prato({ category: ref("massas", "Massas") });
    expect(categoriaCombina(naFresca, "massas")).toBe(true);
    expect(categoriaCombina(naPrincipal, "massas")).toBe(true);
    expect(categoriaCombina(naFresca, "recheada")).toBe(false);
    expect(categoriaCombina(prato(), "massas")).toBe(false);
  });

  it("a árvore traz só o cardápio pedido, com as filhas ordenadas e a contagem de pratos ativos", () => {
    const pratos = [
      prato({ id: "1", category: ref("fresca", "Fresca", "massas", "Massas") }),
      prato({ id: "2", category: ref("fresca", "Fresca", "massas", "Massas") }),
      prato({ id: "3", category: ref("massas", "Massas") }),
      prato({ id: "4", category: ref("fresca", "Fresca", "massas", "Massas"), isActive: false }),
      prato({ id: "5", menu: "DELIVERY", category: ref("pizzas", "Pizzas", null, null, "DELIVERY") })
    ];
    const salao = montarArvore(CATEGORIAS, pratos, "CARDAPIO");
    expect(salao.map((n) => n.categoria.name)).toEqual(["Antiga", "Massas", "Buffet"]); // ordem, depois nome; inativa também aparece (para reativar)
    const massas = salao[1];
    expect(massas.filhas.map((f) => f.name)).toEqual(["Fresca", "Recheada"]);
    expect(massas.pratosDiretos).toBe(1);
    expect(massas.pratosTotal).toBe(3); // 1 direto + 2 ativos na Fresca (o inativo não conta)
    expect(massas.pratosPorFilha).toEqual({ fresca: 2, recheada: 0 });
    expect(montarArvore(CATEGORIAS, pratos, "DELIVERY").map((n) => n.categoria.name)).toEqual(["Pizzas"]);
    expect(montarArvore(CATEGORIAS, pratos, "todos")).toHaveLength(4);
  });

  it("subcategoria cujo pai está de outro cardápio não some: vira principal", () => {
    const orfas = [cat({ id: "x", name: "Solta", parentId: "pai-que-sumiu" })];
    expect(montarArvore(orfas, [], "todos").map((n) => n.categoria.name)).toEqual(["Solta"]);
  });

  it("o seletor do prato agrupa principal e filhas, deixa solta a que não tem filha e esconde inativa", () => {
    const opcoes = opcoesDeCategoria(CATEGORIAS, "CARDAPIO");
    expect(opcoes).toEqual([
      { value: "massas", label: "Massas (geral)", group: "Massas" },
      { value: "fresca", label: "Fresca", group: "Massas" },
      { value: "recheada", label: "Recheada", group: "Massas" },
      { value: "buffet", label: "Buffet" }
    ]);
    // A inativa só aparece quando é a que o prato já tem.
    expect(opcoesDeCategoria(CATEGORIAS, "CARDAPIO", "velha").map((o) => o.label)).toContain("Antiga (inativa)");
  });

  it("o seletor só mostra categorias do cardápio do prato", () => {
    expect(opcoesDeCategoria(CATEGORIAS, "DELIVERY").map((o) => o.value)).toEqual(["pizzas", "doces"]);
  });

  it("no filtro 'todos' os dois cardápios aparecem, com o nome do cardápio na frente", () => {
    const opcoes = opcoesDoFiltroDeCategoria(CATEGORIAS, "todos");
    expect(opcoes.find((o) => o.value === "buffet")?.label).toBe("Cardápio · Buffet");
    expect(opcoes.find((o) => o.value === "doces")?.group).toBe("Delivery · Pizzas");
  });

  it("conta pratos ativos por cardápio", () => {
    expect(contarPorCardapio([prato(), prato({ menu: "DELIVERY" }), prato({ menu: "DELIVERY" }), prato({ menu: "DELIVERY", isActive: false })]))
      .toEqual({ todos: 3, CARDAPIO: 1, DELIVERY: 2 });
  });

  it("a lista filtra por cardápio e por categoria principal juntos", () => {
    const lista = [
      prato({ id: "1", name: "Penne", category: ref("fresca", "Fresca", "massas", "Massas") }),
      prato({ id: "2", name: "Pizza", menu: "DELIVERY", category: ref("pizzas", "Pizzas", null, null, "DELIVERY") }),
      prato({ id: "3", name: "Feijoada" })
    ];
    const base = { busca: "", menu: "todos" as const, categoriaId: "", situacao: "todos" as const, mostrarInativos: false };
    expect(filtrarPratos(lista, { ...base, menu: "DELIVERY" }).map((p) => p.id)).toEqual(["2"]);
    expect(filtrarPratos(lista, { ...base, categoriaId: "massas" }).map((p) => p.id)).toEqual(["1"]);
    expect(filtrarPratos(lista, { ...base, menu: "DELIVERY", categoriaId: "massas" })).toEqual([]);
  });

  it("a busca também acha pelo nome da categoria e da subcategoria", () => {
    const lista = [prato({ id: "1", name: "Penne", category: ref("fresca", "Fresca", "massas", "Massas") }), prato({ id: "2", name: "Feijoada" })];
    const base = { busca: "massas", menu: "todos" as const, categoriaId: "", situacao: "todos" as const, mostrarInativos: false };
    expect(filtrarPratos(lista, base).map((p) => p.id)).toEqual(["1"]);
  });
});

function snap(parcial: Partial<DishRevisionSnapshot> = {}): DishRevisionSnapshot {
  return {
    name: "Risoto", code: null, menu: "CARDAPIO", category: null, salePriceDefault: 80, yieldQty: 1, yieldUnit: "UN", notes: null,
    isActive: true, custoPorcao: 9.5, cmvPercentual: 11.9, custoIncompleto: false,
    items: [
      { productId: "p1", productName: "CAMARAO", quantity: 150, unit: "G", wasteFactor: 0.05, itemCost: 6.3 },
      { productId: "p2", productName: "CEBOLA", quantity: 30, unit: "G", wasteFactor: 0, itemCost: 0.2 }
    ],
    ...parcial
  };
}

describe("histórico da ficha", () => {
  it("primeira versão: ficha criada com N ingredientes", () => {
    expect(descreverMudancas(null, snap())).toEqual(["Ficha criada com 2 ingredientes"]);
    expect(descreverMudancas(null, snap({ items: [] }))).toEqual(["Prato criado, ainda sem ingredientes"]);
  });

  it("descreve quantidade, perda, ingrediente novo e ingrediente que saiu", () => {
    const antes = snap();
    const depois = snap({
      items: [
        { productId: "p1", productName: "CAMARAO", quantity: 120, unit: "G", wasteFactor: 0.03, itemCost: 4 },
        { productId: "p3", productName: "ALHO", quantity: 5, unit: "G", wasteFactor: 0, itemCost: 0.1 }
      ]
    });
    expect(descreverMudancas(antes, depois)).toEqual([
      "CAMARAO: 150 G → 120 G",
      "CAMARAO: perda 5% → 3%",
      "+ ALHO: 5 G",
      "− CEBOLA saiu da ficha"
    ]);
  });

  it("descreve preço, nome, cardápio, categoria, rendimento, observação e situação", () => {
    const frases = descreverMudancas(
      snap(),
      snap({
        name: "Risoto de camarão", salePriceDefault: 89.9, menu: "DELIVERY", yieldQty: 2, yieldUnit: "PORÇÃO", notes: "Mantecar",
        category: { id: "m", name: "Fresca", parentName: "Massas" }, isActive: false
      })
    );
    expect(frases).toEqual(expect.arrayContaining([
      "Nome: “Risoto” → “Risoto de camarão”",
      "Cardápio: Cardápio → Delivery",
      "Categoria: Sem categoria → Massas › Fresca",
      expect.stringMatching(/Preço de venda: R\$\s80,00 → R\$\s89,90/),
      "Rendimento: 1 UN → 2 PORÇÃO",
      "Observações alteradas",
      "Prato inativado"
    ]));
  });

  it("preço que aparece ou some é dito com clareza", () => {
    expect(descreverMudancas(snap({ salePriceDefault: null }), snap({ salePriceDefault: 50 }))[0]).toMatch(/sem preço → R\$\s50,00/);
  });

  it("gravar sem mudar nada diz isso; muitas mudanças viram 8 frases e 'e mais N'", () => {
    expect(descreverMudancas(snap(), snap())).toEqual(["Gravada sem mudanças na ficha"]);
    const muitos = snap({ items: Array.from({ length: 12 }, (_, i) => ({ productId: `n${i}`, productName: `NOVO${i}`, quantity: 1, unit: "G", wasteFactor: 0, itemCost: 1 })) });
    const frases = descreverMudancas(snap({ items: [] }), muitos);
    expect(frases).toHaveLength(9);
    expect(frases[8]).toBe("e mais 4 mudanças");
  });

  it("o mesmo produto duas vezes na ficha é comparado ocorrência a ocorrência", () => {
    const duplo = (a: number, b: number) => snap({ items: [
      { productId: "p1", productName: "OVO", quantity: a, unit: "UN", wasteFactor: 0, itemCost: 1 },
      { productId: "p1", productName: "OVO", quantity: b, unit: "UN", wasteFactor: 0, itemCost: 1 }
    ] });
    expect(descreverMudancas(duplo(1, 2), duplo(1, 3))).toEqual(["OVO: 2 UN → 3 UN"]);
  });

  const revisao = (id: string, quando: string, custo: number | null, parcial = false, extra: Partial<DishRevisionSnapshot> = {}): DishRevision => ({
    id, action: "ALTERADA", userName: "Felipe", createdAt: quando, costPerServing: custo, salePrice: 80, cmvPercent: 10,
    snapshot: snap({ custoPorcao: custo ?? 0, custoIncompleto: parcial, ...extra })
  });

  it("linha do tempo: variação do custo contra a versão anterior; custo parcial não é comparável", () => {
    const linha = montarLinhaDoTempo([
      revisao("c", "2026-10-09T12:00:00Z", 8),
      revisao("b", "2026-10-08T12:00:00Z", 9.5),
      revisao("a", "2026-10-07T12:00:00Z", 7, true)
    ]);
    expect(linha[0].variacaoDoCusto).toBeCloseTo(-1.5);
    expect(linha[1].variacaoDoCusto).toBeNull(); // a anterior era parcial
    expect(linha[2].variacaoDoCusto).toBeNull(); // primeira versão
    expect(linha[2].mudancas).toEqual(["Ficha criada com 2 ingredientes"]);
  });

  it("série do custo vai do mais antigo ao mais novo e ignora versão sem ingrediente", () => {
    const serie = serieDoCusto([
      revisao("c", "2026-10-09T12:00:00Z", 8),
      revisao("b", "2026-10-08T12:00:00Z", 9.5, false, { items: [] }),
      revisao("a", "2026-10-07T12:00:00Z", 7)
    ]);
    expect(serie.map((p) => p.custo)).toEqual([7, 8]);
  });
});
