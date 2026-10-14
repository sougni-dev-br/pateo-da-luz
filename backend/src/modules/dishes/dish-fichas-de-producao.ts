// Ficha dentro de ficha: o ingrediente de uma ficha pode ser outra ficha (de produção), como a massa do nhoque
// que entra como 1 porção no prato com molho. O custo da ficha de baixo é calculado uma vez e vale para quem a usa.
//
// Regras: até MAX_NIVEIS níveis de ficha dentro de ficha, nunca em ciclo (uma ficha não pode conter a si mesma,
// direta ou indiretamente), e a quantidade é dada na unidade de rendimento da ficha de baixo (1 UN = 1 porção).
import { calculateDishCost } from "./dish-cost.js";
import { separarItensPorCardapio, toCostItem, type ClienteDoBanco, type ItemComProduto, type ProdutoDoItem } from "./dish-itens.js";
import { normalizarUnidade, resolveUnitFactor } from "../../shared/unidades/conversao.js";

/** Ficha dentro de ficha dentro de ficha: mais que isso é difícil de entender e de corrigir. */
export const MAX_NIVEIS = 3;

export type FichaResolvida = {
  id: string;
  name: string;
  code: string | null;
  yieldUnit: string;
  /** Custo de UMA unidade de rendimento; null quando a ficha está incompleta (ou em ciclo). */
  custoPorUnidade: number | null;
  incompleta: boolean;
  motivo: string | null;
};

/** O que carregar de cada ficha para calcular o custo dela. */
const SELECAO = {
  id: true,
  name: true,
  code: true,
  menu: true,
  alsoMenu: true,
  yieldQty: true,
  yieldUnit: true,
  items: {
    select: {
      menu: true,
      quantity: true,
      unit: true,
      wasteFactor: true,
      componentDishId: true,
      product: {
        select: {
          id: true,
          externalCode: true,
          name: true,
          unit: true,
          stockUnit: true,
          inventoryStock: { select: { averageCost: true, currentQuantity: true } },
          conversions: { where: { isActive: true }, select: { fromUnit: true, toUnit: true, factor: true } }
        }
      }
    }
  }
} as const;

/**
 * Carrega, nível a nível, todas as fichas alcançáveis a partir de `ids` (uma consulta por nível, não uma por ficha)
 * e calcula o custo de cada uma de baixo para cima. Ciclo ou profundidade além do limite deixam a ficha sem custo
 * (incompleta) em vez de travar.
 */
export async function resolverFichas(client: ClienteDoBanco, ids: string[]): Promise<Map<string, FichaResolvida>> {
  type Carregada = Awaited<ReturnType<typeof carregarNivel>>[number];
  const carregadas = new Map<string, Carregada>();
  let fronteira = [...new Set(ids)];
  for (let nivel = 0; nivel < MAX_NIVEIS + 1 && fronteira.length > 0; nivel++) {
    const novas = fronteira.filter((id) => !carregadas.has(id));
    if (novas.length === 0) break;
    const linhas = await carregarNivel(client, novas);
    for (const linha of linhas) carregadas.set(linha.id, linha);
    fronteira = [...new Set(linhas.flatMap((l) => l.items.map((i) => i.componentDishId)).filter((id): id is string => Boolean(id)))];
  }

  const resolvidas = new Map<string, FichaResolvida>();
  // Quantos níveis de ficha há de cada uma para baixo (ela mesma é 1). O limite vale pela altura e não pelo caminho percorrido:
  // senão o mesmo preparo sairia completo ou incompleto conforme a ficha por onde a consulta começou.
  const alturas = new Map<string, number>();

  const custoDe = (id: string, caminho: string[]): FichaResolvida => {
    const pronta = resolvidas.get(id);
    if (pronta) return pronta;
    const ficha = carregadas.get(id);
    const semCusto = (motivo: string, nome = ficha?.name ?? "Ficha"): FichaResolvida => ({
      id, name: nome, code: ficha?.code ?? null, yieldUnit: ficha?.yieldUnit ?? "UN", custoPorUnidade: null, incompleta: true, motivo
    });
    if (!ficha) return semCusto("Ficha de produção não encontrada.");
    if (caminho.includes(id)) return semCusto("Ficha que usa a si mesma (ciclo): corrija a ficha.");

    const itensDoCardapio = separarItensPorCardapio({ menu: ficha.menu, alsoMenu: null, items: ficha.items }).principais;
    const itens: ItemComProduto[] = [];
    let motivoDoFilho: string | null = null;
    let altura = 1;
    for (const item of itensDoCardapio) {
      if (item.componentDishId) {
        const filho = custoDe(item.componentDishId, [...caminho, id]);
        altura = Math.max(altura, 1 + (alturas.get(item.componentDishId) ?? 1));
        if (filho.incompleta) motivoDoFilho = motivoDoFilho ?? filho.motivo;
        itens.push({ quantity: item.quantity, unit: item.unit, wasteFactor: item.wasteFactor, product: produtoDaFicha(filho) });
      } else if (item.product) {
        itens.push({ quantity: item.quantity, unit: item.unit, wasteFactor: item.wasteFactor, product: item.product });
      }
    }
    alturas.set(id, altura);
    if (altura > MAX_NIVEIS) {
      const excedida = semCusto(`Ficha dentro de ficha só vai até ${MAX_NIVEIS} níveis: “${ficha.name}” tem fichas dentro dela demais.`);
      resolvidas.set(id, excedida);
      return excedida;
    }
    const calculo = calculateDishCost({ yieldQty: Number(ficha.yieldQty), salePrice: null, items: itens.map((i) => toCostItem(i)) });
    const incompleta = calculo.hasMissingCost || calculo.hasUnresolvedUnit || itens.length === 0;
    const resultado: FichaResolvida = {
      id,
      name: ficha.name,
      code: ficha.code,
      yieldUnit: ficha.yieldUnit,
      custoPorUnidade: incompleta || !(calculo.costPerServing > 0) ? null : calculo.costPerServing,
      incompleta,
      motivo: incompleta ? motivoDoFilho ?? (itens.length === 0 ? "Ficha de produção sem ingredientes." : "Ficha de produção incompleta: complete os ingredientes dela.") : null
    };
    resolvidas.set(id, resultado);
    return resultado;
  };

  for (const id of new Set(ids)) custoDe(id, []);
  return resolvidas;
}

function carregarNivel(client: ClienteDoBanco, ids: string[]) {
  return client.dish.findMany({ where: { id: { in: ids } }, select: SELECAO });
}

/** A ficha de produção vista como se fosse um produto: unidade de rendimento e custo por unidade. */
export function produtoDaFicha(ficha: FichaResolvida): ProdutoDoItem {
  return {
    id: ficha.id,
    externalCode: ficha.code,
    name: ficha.name,
    unit: ficha.yieldUnit,
    stockUnit: null,
    inventoryStock: ficha.custoPorUnidade == null ? null : { averageCost: ficha.custoPorUnidade, currentQuantity: null },
    conversions: [],
    ehFicha: true,
    semCustoMotivo: ficha.motivo ?? "Ficha de produção sem custo."
  };
}

/**
 * Dá um `product` a cada item: o produto comprado como veio do banco, ou a ficha de produção resolvida. Uma só
 * chamada ao resolvedor para todos os itens (e para vários pratos de uma vez, quando a lista os junta).
 */
export async function anexarFichas<T extends { componentDishId: string | null; product: ProdutoDoItem | null }>(
  client: ClienteDoBanco,
  itens: T[]
): Promise<Array<Omit<T, "product"> & { product: ProdutoDoItem }>> {
  const ids = [...new Set(itens.map((i) => i.componentDishId).filter((id): id is string => Boolean(id)))];
  const fichas = ids.length > 0 ? await resolverFichas(client, ids) : new Map<string, FichaResolvida>();
  return itens.map((item) => {
    if (item.componentDishId) {
      const ficha = fichas.get(item.componentDishId);
      return { ...item, product: produtoDaFicha(ficha ?? { id: item.componentDishId, name: "Ficha", code: null, yieldUnit: "UN", custoPorUnidade: null, incompleta: true, motivo: "Ficha de produção não encontrada." }) };
    }
    if (!item.product) throw new Error("Item de ficha sem produto e sem ficha de produção.");
    return { ...item, product: item.product };
  });
}

// ─── Gravação: o que pode virar ingrediente ─────────────────────────────────────

/**
 * Quantos níveis de ficha de produção a cadeia tem de `dishId` para cima, contando ele mesmo quando é ficha de produção: 0 para
 * um prato vendido que ninguém usa; 1 para uma ficha de produção usada só por pratos vendidos (ou por ninguém); 2 se uma ficha de
 * produção a usa; e assim por diante. O prato vendido no topo não conta: ele não é ingrediente de ninguém.
 */
async function niveisAcima(client: ClienteDoBanco, dishId: string, eProducao: boolean): Promise<number> {
  let atuais = [dishId];
  let niveis = eProducao ? 1 : 0;
  const vistos = new Set(atuais);
  for (let passo = 0; passo < MAX_NIVEIS && atuais.length > 0; passo++) {
    const linhas = await client.dish.findMany({ where: { id: { in: atuais } }, select: { usadaComoIngrediente: { select: { dishId: true } } } });
    const usuarios = [...new Set((linhas ?? []).flatMap((linha) => (linha.usadaComoIngrediente ?? []).map((uso) => uso.dishId)))].filter((id) => !vistos.has(id));
    if (usuarios.length === 0) break;
    usuarios.forEach((id) => vistos.add(id));
    const deProducao = await client.dish.findMany({ where: { id: { in: usuarios }, fichaDeProducao: true }, select: { id: true } });
    atuais = (deProducao ?? []).map((linha) => linha.id);
    if (atuais.length > 0) niveis += 1;
  }
  return niveis;
}

export type ItemParaValidar = { productId?: string | null; componentDishId?: string | null; unit: string };

/**
 * Confere as fichas de produção usadas como ingrediente antes de gravar: existem, não é a própria ficha, não fecham
 * ciclo, não passam do limite de níveis e a unidade é a de rendimento delas (ou converte por física: kg ↔ g).
 * Devolve a mensagem do primeiro problema, ou null.
 */
export async function primeiroProblemaDeFicha(
  client: ClienteDoBanco,
  dishId: string | null,
  itens: ItemParaValidar[],
  /** Se a ficha que está sendo gravada é de produção (conta como um nível). Ausente: lê do banco, quando já existe. */
  serProducao?: boolean
): Promise<string | null> {
  const ids = [...new Set(itens.map((i) => i.componentDishId).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return null;
  if (dishId && ids.includes(dishId)) return "Uma ficha não pode ter a si mesma como ingrediente.";

  // Arestas de ficha para ficha até o limite de níveis: o suficiente para achar ciclo e medir a profundidade.
  const arestas = new Map<string, string[]>();
  const nomes = new Map<string, { name: string; yieldUnit: string; fichaDeProducao: boolean }>();
  let fronteira = ids;
  for (let nivel = 0; nivel < MAX_NIVEIS + 1 && fronteira.length > 0; nivel++) {
    const novas = fronteira.filter((id) => !arestas.has(id));
    if (novas.length === 0) break;
    const linhas = await client.dish.findMany({ where: { id: { in: novas } }, select: { id: true, name: true, yieldUnit: true, fichaDeProducao: true, items: { select: { componentDishId: true } } } });
    for (const linha of linhas) {
      arestas.set(linha.id, [...new Set(linha.items.map((i) => i.componentDishId).filter((id): id is string => Boolean(id)))]);
      nomes.set(linha.id, { name: linha.name, yieldUnit: linha.yieldUnit, fichaDeProducao: linha.fichaDeProducao });
    }
    fronteira = [...new Set([...arestas.values()].flat())];
  }

  const ausente = ids.find((id) => !nomes.has(id));
  if (ausente) return "Ficha de produção do ingrediente não encontrada. Atualize a tela e escolha de novo.";
  // Prato vendido não vira ingrediente: o CMV dele é do que se vende, e a ficha de produção é o que se prepara.
  const vendido = ids.find((id) => !nomes.get(id)?.fichaDeProducao);
  if (vendido) return `“${nomes.get(vendido)?.name ?? vendido}” é um prato vendido, não uma ficha de produção: só ficha de produção entra como ingrediente.`;

  // Profundidade: quantos níveis de ficha há de cada ingrediente para baixo (a própria já é o nível 1).
  const profundidade = (id: string, visitando: Set<string>): number => {
    if (visitando.has(id)) return MAX_NIVEIS + 1;
    const filhos = arestas.get(id) ?? [];
    if (filhos.length === 0) return 1;
    return 1 + Math.max(...filhos.map((f) => profundidade(f, new Set([...visitando, id]))));
  };
  const alcanca = (de: string, alvo: string, visitados = new Set<string>()): boolean => {
    if (de === alvo) return true;
    if (visitados.has(de)) return false;
    visitados.add(de);
    return (arestas.get(de) ?? []).some((f) => alcanca(f, alvo, visitados));
  };

  // Quem edita uma ficha que já é ingrediente de outras soma os níveis que ficam acima dela: o limite vale de cima a baixo.
  const eProducao = serProducao ?? (dishId ? Boolean((await client.dish.findMany({ where: { id: { in: [dishId] } }, select: { fichaDeProducao: true } }))[0]?.fichaDeProducao) : false);
  // Ficha de produção é um nível dela mesma, mesmo que ninguém a use ainda: a cadeia de quatro não pode nascer por nenhuma ponta.
  const acima = dishId ? await niveisAcima(client, dishId, eProducao) : eProducao ? 1 : 0;
  for (const id of ids) {
    const nome = nomes.get(id)?.name ?? id;
    if (dishId && alcanca(id, dishId)) return `“${nome}” já usa esta ficha: uma não pode conter a outra.`;
    if (acima + profundidade(id, new Set()) > MAX_NIVEIS) return `Ficha dentro de ficha só vai até ${MAX_NIVEIS} níveis: “${nome}” já tem fichas dentro dela demais para entrar aqui.`;
  }

  for (const item of itens) {
    if (!item.componentDishId) continue;
    const ficha = nomes.get(item.componentDishId);
    if (ficha && resolveUnitFactor(item.unit, ficha.yieldUnit, []) == null) {
      return `A ficha “${ficha.name}” rende em ${normalizarUnidade(ficha.yieldUnit)}: use essa unidade no ingrediente.`;
    }
  }
  return null;
}

// ─── Sugestão: "estes ingredientes são uma ficha de produção" ───────────────────

export type SugestaoDeFicha = {
  componentDishId: string;
  name: string;
  /** Quantas unidades de rendimento da ficha o prato usa (1 UN da massa, por exemplo). */
  quantity: number;
  unit: string;
  /** Os itens do prato que a ficha substitui. */
  itemIds: string[];
};

type ItemDoPrato = { id: string; productId: string | null; componentDishId: string | null; quantity: number; unit: string };
type FichaCandidata = { id: string; name: string; yieldQty: number; yieldUnit: string; items: Array<{ productId: string | null; quantity: number; unit: string }> };

/** Diferença relativa aceita entre a proporção de um ingrediente e a dos outros: cobre o arredondamento a 4 casas da quantidade. */
const TOLERANCIA_DA_PROPORCAO = 0.02;
const MIN_ITENS_PARA_SUGERIR = 2;

/**
 * A quantidade copiada à mão vem arredondada (83,3333 em vez de 83,3333…), então a razão sai 0,9999: perto de um número
 * inteiro vira o inteiro (1 porção), senão fica com 3 casas.
 */
export function arredondarProporcao(razao: number): number {
  const inteiro = Math.round(razao);
  if (inteiro > 0 && Math.abs(razao - inteiro) / inteiro <= 0.005) return inteiro;
  return Math.round(razao * 1000) / 1000;
}

/**
 * Procura, entre as fichas, as que o prato repete ingrediente por ingrediente na mesma proporção: o caso do
 * "Nhoque ao molho 3 queijos", que copia a massa dividida por 12. Cada candidata só vale se TODOS os ingredientes dela
 * estão no prato (mesmo produto e unidade) e a razão entre as quantidades é a mesma em todos. Sem sobreposição:
 * a que cobre mais itens vem primeiro.
 */
export function sugerirFichasDeProducao(prato: { id: string; items: ItemDoPrato[] }, candidatas: FichaCandidata[]): SugestaoDeFicha[] {
  const livres = new Map(prato.items.filter((i) => i.productId).map((i) => [`${i.productId}|${normalizarUnidade(i.unit)}`, i]));
  const achadas: Array<SugestaoDeFicha & { cobertos: number }> = [];

  for (const ficha of candidatas) {
    if (ficha.id === prato.id || ficha.items.length < MIN_ITENS_PARA_SUGERIR || !(ficha.yieldQty > 0)) continue;
    const razoes: number[] = [];
    const itemIds: string[] = [];
    let todos = true;
    for (const item of ficha.items) {
      const doPrato = item.productId ? livres.get(`${item.productId}|${normalizarUnidade(item.unit)}`) : undefined;
      const porUnidade = item.quantity / ficha.yieldQty;
      if (!doPrato || !(porUnidade > 0)) { todos = false; break; }
      razoes.push(doPrato.quantity / porUnidade);
      itemIds.push(doPrato.id);
    }
    if (!todos) continue;
    const media = razoes.reduce((s, r) => s + r, 0) / razoes.length;
    if (!(media > 0) || razoes.some((r) => Math.abs(r - media) / media > TOLERANCIA_DA_PROPORCAO)) continue;
    // A ficha que cobriria o prato INTEIRO é uma cópia dele, não um componente: não se sugere trocar tudo.
    if (itemIds.length >= prato.items.length) continue;
    achadas.push({ componentDishId: ficha.id, name: ficha.name, quantity: arredondarProporcao(media), unit: ficha.yieldUnit, itemIds, cobertos: itemIds.length });
  }

  achadas.sort((a, b) => b.cobertos - a.cobertos || a.name.localeCompare(b.name, "pt-BR"));
  const usados = new Set<string>();
  const resultado: SugestaoDeFicha[] = [];
  for (const { cobertos: _cobertos, ...sugestao } of achadas) {
    if (sugestao.itemIds.some((id) => usados.has(id))) continue;
    sugestao.itemIds.forEach((id) => usados.add(id));
    resultado.push(sugestao);
  }
  return resultado;
}
