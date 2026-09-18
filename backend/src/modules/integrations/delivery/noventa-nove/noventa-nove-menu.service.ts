import { prisma } from "../../../../config/database.js";
import { callNoventaNoveShop } from "./noventa-nove-http-client.js";

// Importa o cardapio das lojas da 99 para Dish + DishListing.
//
// O que a 99 devolve em GET /v1/item/item/list:
//   { menus: [...], categories: [{ app_category_id, category_name, app_item_ids }],
//     items: [{ app_item_id, item_name, price, status, short_desc, ... }] }
// `price` vem em CENTAVOS, como todo valor da plataforma.
//
// O import NAO monta ficha tecnica — traz nome, categoria e preco. Que a pizza
// leva 180g de mussarela e conhecimento do Eli e entra a mao depois.

export const CANAL_99 = "NOVENTA_NOVE";

type MenuResponse = {
  menus?: unknown[];
  categories?: { app_category_id?: string; category_name?: string; app_item_ids?: string[] }[];
  items?: {
    app_item_id?: string;
    item_name?: string;
    price?: number;
    status?: number;
    short_desc?: string;
  }[];
};

export type MenuImportStoreResult = {
  storeId: string;
  storeLabel: string;
  status: "SUCCESS" | "SKIPPED" | "ERROR";
  itensNoCanal: number;
  pratosCriados: number;
  listagensCriadas: number;
  listagensAtualizadas: number;
  message: string;
};

export type MenuImportResult = {
  ranAt: string;
  perStore: MenuImportStoreResult[];
  pratosDistintos: number;
  /** Mesmo prato com preco diferente entre lojas — o Eli precisa olhar. */
  precosDivergentes: { prato: string; precos: string[] }[];
  /**
   * Itens com o MESMO nome dentro da MESMA loja. Sem id de plataforma eles sao
   * indistinguiveis, entao um sobrescreve o outro e o primeiro se perde.
   * Caso real em 18/09/2026: a Pizzaria tem dois "Peperoni" ativos, a R$ 101,90 e
   * a R$ 76,00 — so o segundo sobreviveu ao import. Isso PRECISA aparecer no
   * retorno: perder item de cardapio em silencio e como o erro chega no calculo
   * de margem sem ninguem saber.
   */
  itensColapsados: { loja: string; nome: string; precos: string[] }[];
};

// Normaliza o nome para casar o mesmo prato entre lojas.
//
// As 4 lojas ficam no MESMO endereco (Rua Frei Caneca, 569), ou seja, mesma
// cozinha — prato de mesmo nome e a mesma receita, e uma ficha tecnica serve as
// duas listagens. Sem normalizar, "Pizza Portuguesa" e "pizza  portuguesa " (o
// cadastro da 99 e digitado a mao, loja por loja) viravam dois pratos e duas
// fichas para a mesma coisa.
//
// Acento NAO e removido de proposito: "Filé" e "File" sao o mesmo prato, mas
// remover acento tambem juntaria palavras legitimamente diferentes, e o risco de
// juntar errado e pior do que o de separar — separar o Eli ve na tela, juntar
// errado vira uma ficha tecnica mentirosa.
export function chaveDoPrato(nome: string): string {
  return nome.trim().toLowerCase().replace(/\s+/g, " ");
}

// price vem em centavos.
export function precoEmReais(centavos: number | undefined): number {
  return typeof centavos === "number" && Number.isFinite(centavos) ? Math.round(centavos) / 100 : 0;
}

// Monta o mapa item -> categoria a partir de `categories[].app_item_ids`.
// A 99 nao poe a categoria dentro do item; a relacao so existe do lado da
// categoria, e sem este mapa todo prato entraria sem categoria.
export function mapaCategoriaPorItem(categories: MenuResponse["categories"]): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const cat of categories ?? []) {
    const nome = cat.category_name?.trim();
    if (!nome) continue;
    for (const itemId of cat.app_item_ids ?? []) {
      if (itemId) mapa.set(String(itemId), nome);
    }
  }
  return mapa;
}

export async function importarCardapios(): Promise<MenuImportResult> {
  const lojas = await prisma.deliveryStore.findMany({
    where: { platform: "NOVENTA_NOVE", active: true },
    orderBy: { createdAt: "asc" }
  });

  const perStore: MenuImportStoreResult[] = [];
  const agora = new Date();
  // chave normalizada -> { nome exibido, precos vistos por loja }
  const vistos = new Map<string, { nome: string; precos: Map<string, number> }>();
  const itensColapsados: { loja: string; nome: string; precos: string[] }[] = [];

  // Carrega os pratos existentes UMA vez, indexados pela mesma chave normalizada
  // que o import usa. Duas razoes:
  //
  // 1. Correcao. Procurar no banco com `equals ... insensitive` nao colapsa
  //    espaco interno — "Pizza  Portuguesa" e "Pizza Portuguesa" nao casariam, e
  //    a normalizacao de chaveDoPrato ficaria decorativa. O cardapio da 99 e
  //    digitado a mao loja por loja, entao esse caso acontece.
  // 2. Custo. Uma consulta por item eram ~250 idas a um Postgres remoto so para
  //    procurar prato, mais outras 250 para procurar listagem.
  const pratosPorChave = new Map<string, { id: string }>();
  for (const d of await prisma.dish.findMany({ select: { id: true, name: true } })) {
    const chave = chaveDoPrato(d.name);
    // Se a base ja tem dois pratos que colapsam na mesma chave, fica o primeiro —
    // criar um terceiro so pioraria. O Eli resolve o duplicado na tela.
    if (!pratosPorChave.has(chave)) pratosPorChave.set(chave, { id: d.id });
  }

  // Listagens existentes deste canal, indexadas por (loja, item).
  const listagensPorChave = new Map<string, { id: string }>();
  for (const l of await prisma.dishListing.findMany({
    where: { channel: CANAL_99 },
    select: { id: true, deliveryStoreId: true, externalItemId: true }
  })) {
    listagensPorChave.set(`${l.deliveryStoreId ?? ""}::${l.externalItemId}`, { id: l.id });
  }

  for (const loja of lojas) {
    if (!loja.shopIdRemote) {
      perStore.push({
        storeId: loja.id,
        storeLabel: loja.nickname,
        status: "SKIPPED",
        itensNoCanal: 0,
        pratosCriados: 0,
        listagensCriadas: 0,
        listagensAtualizadas: 0,
        message: "Loja ainda nao vinculada na 99. Autorize no portal e sincronize as lojas antes."
      });
      continue;
    }

    let resposta: MenuResponse;
    try {
      resposta = await callNoventaNoveShop<MenuResponse>(loja.id, loja.externalId, {
        method: "GET",
        path: "/v1/item/item/list"
      });
    } catch (error: unknown) {
      perStore.push({
        storeId: loja.id,
        storeLabel: loja.nickname,
        status: "ERROR",
        itensNoCanal: 0,
        pratosCriados: 0,
        listagensCriadas: 0,
        listagensAtualizadas: 0,
        message: error instanceof Error ? error.message : "Falha ao ler o cardapio."
      });
      continue;
    }

    const itens = resposta.items ?? [];
    const categoriaPorItem = mapaCategoriaPorItem(resposta.categories);
    // Duas linhas do MESMO cardapio que colapsam na mesma chave: a segunda
    // sobrescreveria a primeira sem deixar rastro. Registra para o retorno.
    const chavesNaLoja = new Map<string, number>();
    let pratosCriados = 0;
    let listagensCriadas = 0;
    let listagensAtualizadas = 0;

    for (const item of itens) {
      const nome = item.item_name?.trim() ?? "";
      // Item sem nome nao vira prato. Pular e melhor do que criar lixo.
      if (!nome) continue;

      const chave = chaveDoPrato(nome);
      const preco = precoEmReais(item.price);

      // A 99 NAO devolve identificador proprio para item criado no portal dela.
      // Medido em producao em 18/09/2026: nos 58 itens da Pizzaria os campos
      // `app_item_id`, `app_external_id` e `app_category_id` vieram TODOS vazios.
      // O campo e "ID do item fornecido pela loja" — ou seja, preenchido pelo
      // INTEGRADOR ao subir cardapio via API. Como o cardapio foi montado a mao
      // no portal, esse id nunca existiu. A primeira versao deste import usava
      // app_item_id como chave e por isso pulou os 250 itens, criando zero.
      //
      // Sobra o nome como unica ancora. Consequencia aceita: renomear o prato na
      // 99 cria listagem nova e a antiga para de ser vista (detectavel por
      // lastSeenAt). O prefixo deixa explicito que a chave e derivada, para
      // ninguem confundir com id de plataforma.
      const anterior = chavesNaLoja.get(chave);
      if (anterior !== undefined) {
        itensColapsados.push({
          loja: loja.nickname,
          nome,
          precos: [anterior, preco].map((p) => `R$ ${p.toFixed(2)}`)
        });
      }
      chavesNaLoja.set(chave, preco);

      const idDaPlataforma = item.app_item_id ? String(item.app_item_id).trim() : "";
      const externalItemId = idDaPlataforma || `nome:${chave}`;

      // Pela mesma razao a categoria e irrecuperavel hoje: `categories[].app_item_ids`
      // e uma lista dos mesmos ids vazios. Fica NULA em vez de inventada. Se um dia
      // o cardapio subir por API os ids passam a existir e isto volta a funcionar.
      const categoria = idDaPlataforma ? categoriaPorItem.get(idDaPlataforma) ?? null : null;

      const jaVisto = vistos.get(chave);
      if (jaVisto) jaVisto.precos.set(loja.nickname, preco);
      else vistos.set(chave, { nome, precos: new Map([[loja.nickname, preco]]) });

      // O prato e procurado pela chave normalizada — a mesma que a proxima loja
      // usara, por isso "Pizza  Portuguesa" da loja B reaproveita o prato criado
      // pela loja A. Nao usa `code`: o code do ERP e do Eli, nao da plataforma.
      let dish = pratosPorChave.get(chave);
      if (!dish) {
        const criado = await prisma.dish.create({
          data: {
            name: nome,
            notes: item.short_desc?.trim() || null,
            // salePriceDefault fica NULO de proposito: o preco varia por loja e
            // escolher um seria mentir sobre os outros. O preco real esta na
            // listagem.
            isActive: true
          },
          select: { id: true }
        });
        dish = criado;
        pratosPorChave.set(chave, criado);
        pratosCriados += 1;
      }

      const existente = listagensPorChave.get(`${loja.id}::${externalItemId}`);

      const dados = {
        dishId: dish.id,
        externalName: nome,
        price: preco,
        categoryName: categoria,
        // status 1 = ativo na 99. Ausente tratamos como ativo: o campo nem sempre
        // vem, e sumir um prato do cardapio por causa de campo ausente seria pior
        // do que mostrar um a mais.
        isActive: item.status === undefined || item.status === 1,
        lastSeenAt: agora
      };

      if (existente) {
        await prisma.dishListing.update({ where: { id: existente.id }, data: dados });
        listagensAtualizadas += 1;
      } else {
        const nova = await prisma.dishListing.create({
          data: { ...dados, channel: CANAL_99, deliveryStoreId: loja.id, externalItemId },
          select: { id: true }
        });
        listagensPorChave.set(`${loja.id}::${externalItemId}`, nova);
        listagensCriadas += 1;
      }
    }

    perStore.push({
      storeId: loja.id,
      storeLabel: loja.nickname,
      status: "SUCCESS",
      itensNoCanal: itens.length,
      pratosCriados,
      listagensCriadas,
      listagensAtualizadas,
      message: `${itens.length} itens no cardapio. ${pratosCriados} prato(s) novo(s), ` +
        `${listagensCriadas} listagem(ns) criada(s), ${listagensAtualizadas} atualizada(s).`
    });
  }

  return {
    ranAt: agora.toISOString(),
    perStore,
    pratosDistintos: vistos.size,
    precosDivergentes: detectarPrecosDivergentes(vistos),
    itensColapsados
  };
}

// Mesmo prato com preco diferente entre lojas. Nao e erro por si — pode ser
// posicionamento de marca —, mas e exatamente onde mora um erro de cadastro, e
// nenhuma tela mostra isso hoje. Sai no retorno para o Eli conferir.
export function detectarPrecosDivergentes(
  vistos: Map<string, { nome: string; precos: Map<string, number> }>
): { prato: string; precos: string[] }[] {
  const saida: { prato: string; precos: string[] }[] = [];
  for (const { nome, precos } of vistos.values()) {
    if (precos.size < 2) continue;
    const distintos = new Set([...precos.values()].map((p) => p.toFixed(2)));
    if (distintos.size < 2) continue;
    saida.push({
      prato: nome,
      precos: [...precos.entries()].map(([loja, p]) => `${loja}: R$ ${p.toFixed(2)}`)
    });
  }
  // Maior divergencia primeiro — e onde o erro de cadastro costuma estar.
  return saida.sort((a, b) => b.precos.length - a.precos.length);
}
