// CMV de cada prato em cada lugar onde ele é vendido: salão, cada plataforma de delivery e cada loja dela.
// O custo é um só (a ficha); o que muda é o preço de cada lugar, e por isso o CMV. Funções puras.

import type { DishListItem } from "../api/client";
import { menusDoPrato } from "./categoriasDasFichas";
import { CMV_ALTO, CMV_BOM, faixaDeCmv, normalizarBusca, rotuloDoCanal } from "./fichaTecnica";

export type ModoDeAgrupamento = "canal" | "loja";

export type Coluna = {
  /** "SALAO", "IFOOD"... no modo canal; "IFOOD|<loja>" no modo loja. */
  chave: string;
  canal: string;
  loja: string | null;
  rotulo: string;
};

export type EstadoDaCelula = "ok" | "nao-vende" | "sem-ficha" | "incompleta" | "sem-preco" | "falta-delivery" | "sem-listagem";

/** Chave da loja nas razões: o id dela, ou "plataforma:KEETA" para a plataforma sem loja cadastrada. */
export const chaveDaLoja = (canal: { channel: string; deliveryStoreId: string | null }) =>
  canal.deliveryStoreId ?? `plataforma:${canal.channel}`;

/** Razão líquido ÷ tabela por loja da plataforma (0,46 = chega 46% do preço de tabela), pelo id da loja. */
export type RazoesLiquidas = Record<string, number>;

export type Celula = {
  estado: EstadoDaCelula;
  /** O preço desta célula já é o líquido estimado (tabela × razão da loja), não o de tabela. */
  sobreLiquido: boolean;
  /** Com várias lojas na mesma plataforma, é o pior (maior) CMV entre elas. */
  cmv: number | null;
  preco: number | null;
  /** Só no modo canal, com mais de uma loja: menor e maior preço da plataforma. */
  precoMin: number | null;
  precoMax: number | null;
  lojas: number;
};

export type LinhaDaMatriz = { prato: DishListItem; celulas: Record<string, Celula>; piorCmv: number | null };

export type ResumoDaColuna = {
  coluna: Coluna;
  /** Pratos com CMV calculado neste lugar. */
  analisados: number;
  cmvMedio: number | null;
  bons: number;
  atencao: number;
  altos: number;
};

const ORDEM_DOS_CANAIS = ["SALAO", "NOVENTA_NOVE", "IFOOD", "KEETA"];
const ordemDoCanal = (canal: string) => {
  const posicao = ORDEM_DOS_CANAIS.indexOf(canal);
  return posicao === -1 ? ORDEM_DOS_CANAIS.length : posicao;
};

export const ROTULO_DO_SALAO = "Salão (a la carte)";

const rotuloDaColuna = (canal: string, loja: string | null) =>
  canal === "SALAO" ? ROTULO_DO_SALAO : loja ? `${loja}` : rotuloDoCanal(canal);

type Venda = { canal: string; loja: string | null; preco: number; sobreLiquido: boolean; menu: "CARDAPIO" | "DELIVERY" };

/** Onde o prato tem preço: o do salão (se é vendido lá) e o de cada loja com listagem ativa. */
function vendasDoPrato(prato: DishListItem, razoes?: RazoesLiquidas): Venda[] {
  const vendas: Venda[] = (prato.canais ?? []).map((canal) => {
    // Com a razão da loja, o preço vira o que chega ao caixa: o CMV passa a ser sobre o líquido.
    const razao = razoes?.[chaveDaLoja(canal)];
    return razao != null && razao > 0
      ? { canal: canal.channel, loja: canal.storeName, preco: canal.price * razao, sobreLiquido: true, menu: "DELIVERY" as const }
      : { canal: canal.channel, loja: canal.storeName, preco: canal.price, sobreLiquido: false, menu: "DELIVERY" as const };
  });
  if (menusDoPrato(prato).includes("CARDAPIO") && prato.salePriceDefault != null && prato.salePriceDefault > 0) {
    vendas.push({ canal: "SALAO", loja: null, preco: prato.salePriceDefault, sobreLiquido: false, menu: "CARDAPIO" });
  }
  return vendas;
}

/** As colunas que a tabela precisa: só os lugares onde algum dos pratos é vendido. */
export function montarColunas(pratos: DishListItem[], modo: ModoDeAgrupamento): Coluna[] {
  const achadas = new Map<string, Coluna>();
  const garantir = (canal: string, loja: string | null) => {
    const chave = modo === "canal" || canal === "SALAO" ? canal : `${canal}|${loja ?? ""}`;
    if (!achadas.has(chave)) {
      achadas.set(chave, { chave, canal, loja: modo === "loja" ? loja : null, rotulo: modo === "canal" ? rotuloDaColuna(canal, null) : rotuloDaColuna(canal, loja) });
    }
  };

  for (const prato of pratos) {
    if (menusDoPrato(prato).includes("CARDAPIO")) garantir("SALAO", null);
    for (const venda of vendasDoPrato(prato)) garantir(venda.canal, venda.loja);
  }

  // As plataformas de delivery aparecem sempre (com ou sem preço lançado): sem isso não há como saber que existem.
  if (pratos.some((prato) => menusDoPrato(prato).includes("DELIVERY"))) {
    for (const canal of PLATAFORMAS_DO_DELIVERY) {
      if (![...achadas.values()].some((coluna) => coluna.canal === canal)) {
        achadas.set(canal, { chave: canal, canal, loja: null, rotulo: rotuloDaColuna(canal, null) });
      }
    }
  }
  return [...achadas.values()].sort(
    (a, b) => ordemDoCanal(a.canal) - ordemDoCanal(b.canal) || (a.loja ?? "").localeCompare(b.loja ?? "", "pt-BR")
  );
}

const PLATAFORMAS_DO_DELIVERY = ["NOVENTA_NOVE", "IFOOD", "KEETA"];

const celulaVazia = (estado: EstadoDaCelula): Celula => ({ estado, sobreLiquido: false, cmv: null, preco: null, precoMin: null, precoMax: null, lojas: 0 });

/**
 * A ficha do cardápio de um lugar: a quantidade do a la carte não é a do delivery, então o prato vendido nos dois
 * tem uma ficha (e um custo) para cada. Prato que não foi marcado nos dois usa a única ficha que tem.
 */
function fichaDoCardapio(prato: DishListItem, menu: "CARDAPIO" | "DELIVERY") {
  if (prato.alsoMenu === menu && prato.menu !== menu) {
    return { itens: prato.alsoItemsCount ?? 0, custo: prato.alsoCustoPorcao ?? 0, incompleta: prato.alsoCustoIncompleto ?? false, propria: true };
  }
  return { itens: prato.itemsCount, custo: prato.custoPorcao, incompleta: prato.custoIncompleto, propria: false };
}

function celulaDe(prato: DishListItem, vendas: Venda[]): Celula {
  if (vendas.length === 0) return celulaVazia("nao-vende");
  const ficha = fichaDoCardapio(prato, vendas[0].menu);
  const precos = vendas.map((venda) => venda.preco);
  const base: Celula = { ...celulaVazia("ok"), sobreLiquido: vendas.every((venda) => venda.sobreLiquido), precoMin: Math.min(...precos), precoMax: Math.max(...precos), lojas: vendas.length };

  // Vendido nos dois sem as quantidades do delivery: o CMV de lá não sai da ficha do a la carte.
  if (ficha.itens === 0) return { ...base, estado: ficha.propria ? "falta-delivery" : "sem-ficha" };
  // Custo parcial subestima o CMV: melhor mostrar "parcial" do que um número bonito e errado.
  if (ficha.incompleta) return { ...base, estado: "incompleta" };

  // O pior lugar manda: o menor preço é o que mais pesa o custo.
  return { ...base, cmv: (ficha.custo / base.precoMin!) * 100, preco: base.precoMin };
}

/** Uma linha por prato; cada coluna diz o CMV dele naquele lugar. `nao-vende` onde o prato não está. */
export function montarMatriz(pratos: DishListItem[], colunas: Coluna[], modo: ModoDeAgrupamento, razoes?: RazoesLiquidas): LinhaDaMatriz[] {
  return pratos.map((prato) => {
    const vendas = vendasDoPrato(prato, razoes);
    const celulas: Record<string, Celula> = {};
    const salaoSemPreco = menusDoPrato(prato).includes("CARDAPIO") && !vendas.some((venda) => venda.canal === "SALAO");

    for (const coluna of colunas) {
      const daColuna = vendas.filter((venda) =>
        coluna.canal === "SALAO"
          ? venda.canal === "SALAO"
          : venda.canal === coluna.canal && (modo === "canal" || (venda.loja ?? "") === (coluna.loja ?? ""))
      );
      // Lugar do delivery onde o prato é vendido mas ainda não tem preço lançado: "sem preço", não "não vende".
      const semListagem = coluna.canal !== "SALAO" && daColuna.length === 0 && menusDoPrato(prato).includes("DELIVERY");
      celulas[coluna.chave] = coluna.canal === "SALAO" && salaoSemPreco && daColuna.length === 0
        ? celulaVazia("sem-preco")
        : semListagem
          ? celulaVazia("sem-listagem")
          : celulaDe(prato, daColuna);
    }

    const cmvs = Object.values(celulas).map((celula) => celula.cmv).filter((valor): valor is number => valor != null);
    return { prato, celulas, piorCmv: cmvs.length > 0 ? Math.max(...cmvs) : null };
  });
}

export function resumirColunas(linhas: LinhaDaMatriz[], colunas: Coluna[]): ResumoDaColuna[] {
  return colunas.map((coluna) => {
    const cmvs = linhas.map((linha) => linha.celulas[coluna.chave]?.cmv).filter((valor): valor is number => valor != null);
    const faixas = cmvs.map((cmv) => faixaDeCmv(cmv)?.tom);
    return {
      coluna,
      analisados: cmvs.length,
      cmvMedio: cmvs.length > 0 ? cmvs.reduce((soma, cmv) => soma + cmv, 0) / cmvs.length : null,
      bons: faixas.filter((tom) => tom === "success").length,
      atencao: faixas.filter((tom) => tom === "warning").length,
      altos: faixas.filter((tom) => tom === "danger").length
    };
  });
}

export type OrdemDaMatriz = "nome" | "pior";

export type FiltroDaMatriz = {
  busca: string;
  /** Só pratos com CMV alto em algum lugar. */
  soAltos: boolean;
  /** Pratos sem ficha não têm CMV: ficam de fora, a não ser que se peça. */
  comSemFicha: boolean;
  ordem: OrdemDaMatriz;
};

export const FILTRO_DA_MATRIZ: FiltroDaMatriz = { busca: "", soAltos: false, comSemFicha: false, ordem: "pior" };

export function filtrarMatriz(linhas: LinhaDaMatriz[], filtro: FiltroDaMatriz): LinhaDaMatriz[] {
  const palavras = normalizarBusca(filtro.busca).split(" ").filter(Boolean);
  const filtradas = linhas.filter(({ prato, piorCmv }) => {
    if (!filtro.comSemFicha && prato.itemsCount === 0) return false;
    if (filtro.soAltos && !(piorCmv != null && piorCmv > CMV_ALTO)) return false;
    if (palavras.length === 0) return true;
    const texto = normalizarBusca(`${prato.name} ${prato.code ?? ""} ${prato.category?.name ?? ""}`);
    return palavras.every((palavra) => texto.includes(palavra));
  });

  const porNome = (a: LinhaDaMatriz, b: LinhaDaMatriz) => a.prato.name.localeCompare(b.prato.name, "pt-BR");
  return filtradas.sort((a, b) => {
    if (filtro.ordem === "nome") return porNome(a, b);
    // Quem não tem CMV (sem ficha, parcial) vai para o fim: "sem número" não é "CMV bom".
    if (a.piorCmv == null && b.piorCmv == null) return porNome(a, b);
    if (a.piorCmv == null) return 1;
    if (b.piorCmv == null) return -1;
    return b.piorCmv - a.piorCmv || porNome(a, b);
  });
}

/** Quantos pratos ficaram de fora por não terem ficha. */
export function contarSemFicha(pratos: DishListItem[]): number {
  return pratos.filter((prato) => prato.isActive && prato.itemsCount === 0).length;
}

export { CMV_ALTO, CMV_BOM };
