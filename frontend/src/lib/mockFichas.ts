// Dados de exemplo das Fichas Técnicas para o modo ?mock-user=1 (só em dev, sem backend).
// Números redondos e nomes genéricos de propósito: nada aqui vem da produção.
//
// Cobre os casos que a tela precisa mostrar: ficha completa, CMV bom/atenção/alto,
// custo parcial por falta de conversão, prato sem ingredientes vindo do cardápio da 99,
// prato sem preço padrão, rendimento maior que 1 e prato inativo.

import type { DishUnitConversion } from "../api/client";
import { fatorConversao } from "./fichaTecnica";

type Produto = { id: string; name: string; code: string; unit: string; cost: number; conversions: DishUnitConversion[]; embalagem?: string };

// Como o backend: peso lido do nome ("5KG") vira conversão inferida em kg e em g.
const lidoDoNome = (kg: number): DishUnitConversion[] => [
  { fromUnit: "KG", toUnit: "UN", factor: 1 / kg, inferida: true },
  { fromUnit: "G", toUnit: "UN", factor: 1 / (kg * 1000), inferida: true }
];
type ItemMock = [produto: string, quantidade: number, unidade: string, perda?: number];
type PratoMock = {
  id: string; name: string; code?: string; category?: string; menu?: "CARDAPIO" | "DELIVERY"; price?: number | null; yieldQty?: number; yieldUnit?: string;
  notes?: string; active?: boolean; items?: ItemMock[]; listings?: Array<[loja: string, preco: number]>;
};

const PRODUTOS: Produto[] = [
  { id: "p-camarao", name: "CAMARAO DESCASCADO", code: "0101", unit: "KG", cost: 40, conversions: [] },
  { id: "p-mussarela", name: "MUSSARELA", code: "0102", unit: "KG", cost: 36, conversions: [] },
  { id: "p-cebola", name: "CEBOLA ROXA", code: "0103", unit: "KG", cost: 8, conversions: [] },
  { id: "p-parmesao", name: "QUEIJO PARMESAO", code: "0104", unit: "KG", cost: 48, conversions: [] },
  { id: "p-frango", name: "FILE DE FRANGO", code: "0105", unit: "KG", cost: 12, conversions: [] },
  { id: "p-batata", name: "BATATA ASTERIX", code: "0106", unit: "KG", cost: 7.5, conversions: [] },
  { id: "p-arroz", name: "ARROZ ARBORIO 1KG", code: "0107", unit: "UN", cost: 27, conversions: lidoDoNome(1), embalagem: "1 UN = 1 KG (lido do nome do produto)" },
  { id: "p-azeite", name: "AZEITE EXTRA VIRGEM", code: "0108", unit: "L", cost: 38, conversions: [] },
  { id: "p-sem-custo", name: "TRUFA NEGRA (SEM CUSTO)", code: "0109", unit: "UN", cost: 0, conversions: [] },
  { id: "p-farinha", name: "FARINHA DE TRIGO 5KG", code: "0110", unit: "UN", cost: 20, conversions: lidoDoNome(5), embalagem: "1 UN = 5 KG (lido do nome do produto)" }
];

const LOJAS = ["Pateo Frei Caneca", "Pateo da Luz & Pizza", "Pateo da Luz Pizzaria"];

const PRATOS: PratoMock[] = [
  { id: "d-risoto", name: "Risoto de camarão", code: "PRAT-001", category: "Risotos", price: 79.9, notes: "Mantecar fora do fogo.\nServir imediatamente.",
    items: [["p-camarao", 150, "G", 0.05], ["p-mussarela", 40, "G"], ["p-cebola", 30, "G", 0.07], ["p-parmesao", 20, "G"], ["p-azeite", 15, "ML"]],
    listings: [[LOJAS[0], 79.9], [LOJAS[1], 74.9]] },
  { id: "d-frango", name: "Frango grelhado com arroz e purê", code: "PRAT-002", category: "A la carte", price: 59.9, items: [["p-frango", 220, "G", 0.1], ["p-batata", 180, "G", 0.15]],
    listings: [[LOJAS[0], 59.9], [LOJAS[1], 84.9]] },
  { id: "d-camarao-alho", menu: "DELIVERY", name: "Camarão ao alho (porção)", category: "Pratos executivos", price: 34.9, items: [["p-camarao", 400, "G", 0.03]] },
  { id: "d-funghi", name: "Risoto de funghi", category: "Risotos", price: 69.9, yieldQty: 2, yieldUnit: "PORÇÃO", items: [["p-arroz", 240, "G"], ["p-parmesao", 40, "G"], ["p-sem-custo", 1, "UN"]] },
  { id: "d-pao", name: "Pão da casa (fornada)", category: "Buffet", price: null, yieldQty: 20, yieldUnit: "UN", items: [["p-farinha", 1, "KG"], ["p-azeite", 50, "ML"]] },
  { id: "d-antigo", name: "Prato antigo desativado", category: "A la carte", price: 45, active: false, items: [["p-cebola", 100, "G"]] },
  { id: "d-contra", menu: "DELIVERY", name: "Contra Filé em tiras + Batatas Bravas", listings: [[LOJAS[0], 59.42], [LOJAS[2], 119.9]] },
  { id: "d-salmao", menu: "DELIVERY", name: "Salmão Grelhado com risoto", listings: [[LOJAS[0], 59.9], [LOJAS[2], 76.42]] },
  { id: "d-margherita", menu: "DELIVERY", category: "Salgadas", name: "Pizza Margherita", listings: [[LOJAS[2], 69.9]] },
  { id: "d-calabresa", menu: "DELIVERY", category: "Salgadas", name: "Pizza Calabresa", listings: [[LOJAS[2], 71.9]] },
  { id: "d-peperoni", menu: "DELIVERY", name: "Peperoni", listings: [[LOJAS[2], 101.9], [LOJAS[2], 76]] },
  { id: "d-suco", menu: "DELIVERY", name: "Suco de Laranja 500ml", listings: [[LOJAS[0], 14.9], [LOJAS[1], 12.9]] },
  { id: "d-tiramisu", name: "Tiramisu", category: "Sobremesa", price: 28, listings: [[LOJAS[0], 28]] },
  { id: "d-lasanha", menu: "DELIVERY", name: "Lasanha à Bolonhesa", category: "A la carte", listings: [[LOJAS[0], 54.9], [LOJAS[1], 49.9]] }
];

type CategoriaMock = { nome: string; menu: "CARDAPIO" | "DELIVERY"; pai?: string; ordem: number };
const CATEGORIAS_MOCK: CategoriaMock[] = [
  { nome: "A la carte", menu: "CARDAPIO", ordem: 0 },
  { nome: "Risotos", menu: "CARDAPIO", pai: "A la carte", ordem: 0 },
  { nome: "Buffet", menu: "CARDAPIO", ordem: 1 },
  { nome: "Sobremesa", menu: "CARDAPIO", ordem: 2 },
  { nome: "Pratos executivos", menu: "DELIVERY", ordem: 0 },
  { nome: "Pizzas", menu: "DELIVERY", ordem: 1 },
  { nome: "Salgadas", menu: "DELIVERY", pai: "Pizzas", ordem: 0 }
];

const idDaCategoria = (nome?: string) => (nome ? `c-${nome.toLowerCase().replace(/[^a-z]+/g, "-")}` : undefined);

const CATEGORIAS = CATEGORIAS_MOCK.map((categoria) => ({
  id: idDaCategoria(categoria.nome)!, name: categoria.nome, sortOrder: categoria.ordem, isActive: true, notes: null as string | null,
  parentId: idDaCategoria(categoria.pai) ?? null, menu: categoria.menu,
  dishesCount: PRATOS.filter((prato) => prato.category === categoria.nome && prato.active !== false).length
}));

const produtoPorId = (id: string) => PRODUTOS.find((produto) => produto.id === id)!;

function calcular(prato: PratoMock) {
  const rendimento = prato.yieldQty ?? 1;
  const itens = (prato.items ?? []).map(([produtoId, quantidade, unidade, perda = 0], indice) => {
    const produto = produtoPorId(produtoId);
    const fator = fatorConversao(unidade, produto.unit, produto.conversions);
    const semCusto = produto.cost === 0;
    const itemCost = semCusto || fator == null ? null : quantidade * fator * (1 + perda) * produto.cost;
    const issue = semCusto
      ? "Produto sem custo medio no estoque."
      : fator == null ? `Sem conversao de ${unidade} para ${produto.unit}.` : null;
    return {
      id: `${prato.id}-i${indice}`, embalagemInferida: produto.embalagem ?? null, productId: produto.id, productCode: produto.code, productName: produto.name, productUnit: produto.unit,
      quantity: quantidade, unit: unidade, wasteFactor: perda, unitCost: semCusto ? null : produto.cost, unitFactor: fator,
      itemCost, issue, conversions: produto.conversions, notes: null, sortOrder: indice
    };
  });

  const custoTotal = itens.reduce((soma, item) => soma + (item.itemCost ?? 0), 0);
  const custoPorcao = custoTotal / rendimento;
  const preco = prato.price ?? null;
  return {
    itens,
    custoTotal,
    custoPorcao,
    margem: preco != null ? preco - custoPorcao : null,
    cmv: preco != null && preco > 0 ? (itens.length === 0 ? 0 : (custoPorcao / preco) * 100) : null,
    incompleto: itens.some((item) => item.itemCost == null)
  };
}

function nomeDaCategoria(prato: PratoMock) {
  if (!prato.category) return null;
  const categoria = CATEGORIAS_MOCK.find((candidata) => candidata.nome === prato.category)!;
  return { id: idDaCategoria(categoria.nome)!, name: categoria.nome, parentId: idDaCategoria(categoria.pai) ?? null, parentName: categoria.pai ?? null, menu: categoria.menu };
}

function resumo(prato: PratoMock) {
  const conta = calcular(prato);
  const precos = (prato.listings ?? []).map(([, preco]) => preco);
  return {
    id: prato.id, code: prato.code ?? null, name: prato.name, menu: prato.menu ?? "CARDAPIO", category: nomeDaCategoria(prato), salePriceDefault: prato.price ?? null,
    yieldQty: prato.yieldQty ?? 1, yieldUnit: prato.yieldUnit ?? "UN", notes: prato.notes ?? null, isActive: prato.active !== false,
    itemsCount: conta.itens.length, listingsCount: precos.length,
    listingPriceMin: precos.length ? Math.min(...precos) : null, listingPriceMax: precos.length ? Math.max(...precos) : null,
    calculatedCost: conta.custoTotal, custoPorcao: conta.custoPorcao, margemBruta: conta.margem, cmvPercentual: conta.cmv,
    custoIncompleto: conta.incompleto, createdAt: "2026-09-18T12:00:00.000Z", updatedAt: "2026-10-07T15:30:00.000Z"
  };
}

function detalhe(prato: PratoMock) {
  const conta = calcular(prato);
  return {
    ...resumo(prato),
    items: conta.itens,
    listings: (prato.listings ?? []).map(([loja, preco], indice) => ({
      id: `${prato.id}-l${indice}`, channel: "NOVENTA_NOVE", storeName: loja, externalName: prato.name, price: preco, isActive: true,
      lastSeenAt: "2026-10-07T04:00:00.000Z"
    }))
  };
}

/** Histórico de exemplo: a ficha nasce incompleta, ganha ingrediente, e o custo da camarão muda. */
function revisoesDe(id: string) {
  const prato = PRATOS.find((candidato) => candidato.id === id);
  if (!prato || !(prato.items?.length)) return [];
  const atual = detalhe(prato);
  const item = (i: (typeof atual.items)[number], quantidade = i.quantity, perda = i.wasteFactor) => ({
    productId: i.productId, productName: i.productName, quantity: quantidade, unit: i.unit, wasteFactor: perda, itemCost: i.itemCost
  });
  const snapshot = (itens: ReturnType<typeof item>[], custo: number, extra: object = {}) => ({
    name: atual.name, code: atual.code, menu: atual.menu, category: atual.category && { id: atual.category.id, name: atual.category.name, parentName: atual.category.parentName },
    salePriceDefault: atual.salePriceDefault, yieldQty: atual.yieldQty, yieldUnit: atual.yieldUnit, notes: atual.notes, isActive: true,
    custoPorcao: custo, cmvPercentual: atual.salePriceDefault ? (custo / atual.salePriceDefault) * 100 : null, custoIncompleto: false, items: itens, ...extra
  });
  const itens = atual.items.map((i) => item(i));
  const primeiro = itens.slice(0, 2);
  const meio = itens.map((i, indice) => (indice === 0 ? { ...i, quantity: i.quantity * 1.25, wasteFactor: 0.1 } : i));
  const custo = atual.custoPorcao;
  return [
    { id: "r3", action: "ALTERADA", userName: "Felipe", createdAt: "2026-10-08T18:40:00.000Z", costPerServing: custo, salePrice: atual.salePriceDefault, cmvPercent: snapshot(itens, custo).cmvPercentual, snapshot: snapshot(itens, custo) },
    { id: "r2", action: "ALTERADA", userName: "Felipe", createdAt: "2026-10-08T15:10:00.000Z", costPerServing: custo + 1.4, salePrice: atual.salePriceDefault, cmvPercent: null, snapshot: snapshot(meio, custo + 1.4) },
    { id: "r1", action: "CRIADA", userName: "Eli", createdAt: "2026-10-07T11:00:00.000Z", costPerServing: custo - 3, salePrice: atual.salePriceDefault, cmvPercent: null, snapshot: snapshot(primeiro, custo - 3) }
  ];
}

/** Resposta mock para as rotas /dishes; undefined quando a URL não é de fichas técnicas. */
export function mockFichas(url: string, method = "GET"): unknown | undefined {
  let caminho = url;
  let busca = "";
  try {
    const analisada = new URL(url, window.location.origin);
    caminho = analisada.pathname;
    busca = analisada.searchParams.get("search") ?? "";
  } catch { /* url relativa estranha: segue com o texto original */ }

  const marca = caminho.indexOf("/dishes");
  if (marca < 0) return undefined;
  const resto = caminho.slice(marca + "/dishes".length).replace(/^\/|\/$/g, "");

  // Gravar, inativar e reativar: nada muda no mock, mas a tela recebe uma resposta de sucesso.
  if (method.toUpperCase() !== "GET") {
    // Conversão informada na ficha: no mock vale sempre "1 UN = 1.000 g" (só para a demonstração).
    if (resto.endsWith("/conversions")) {
      return { conversions: [{ fromUnit: "G", toUnit: "UN", factor: 0.001 }, { fromUnit: "KG", toUnit: "UN", factor: 1 }], embalagemInferida: null };
    }
    return { id: PRATOS[0].id, ok: true };
  }

  if (resto === "bulk") return { atualizados: 2, categoriasLimpas: 0 };
  if (resto.endsWith("/revisions")) return revisoesDe(resto.split("/")[0]);
  if (resto === "") return PRATOS.map(resumo);
  if (resto === "categories") return CATEGORIAS;
  if (resto === "products/search") {
    const termo = busca.trim().toLowerCase();
    return PRODUTOS
      .filter((produto) => termo === "" || produto.name.toLowerCase().includes(termo) || produto.code.includes(termo))
      .map((produto) => ({ id: produto.id, externalCode: produto.code, name: produto.name, unit: produto.unit, averageCost: produto.cost, conversions: produto.conversions, embalagemInferida: produto.embalagem ?? null }));
  }

  const prato = PRATOS.find((candidato) => candidato.id === resto.split("/")[0]);
  return prato ? detalhe(prato) : undefined;
}
