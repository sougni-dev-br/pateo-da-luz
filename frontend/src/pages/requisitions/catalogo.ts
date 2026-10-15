import type { RequisitionCatalogItem } from "../../api/client";
import { lerNumero, normalizarUnidade } from "../../lib/fichaTecnica";
import type { LinhaDaRequisicao } from "./linhas";

/** O que a pessoa escolheu de um produto: quanto e em que unidade. Produto sem escolha não entra na requisição. */
export type Escolha = { unit: string; quantity: string };
export type Escolhas = Record<string, Escolha>;

export type Visao = "TODOS" | "ESCOLHIDOS" | "PROBLEMA";
export type Filtro = { texto: string; setorId: string | null; visao: Visao; mostrarSemSaldo: boolean };

export const SEM_LOCAL = "__sem_local__";

/** Escolha sem quantidade só guarda a unidade selecionada enquanto a pessoa redigita: não conta como item. */
export function escolhasComQuantidade(escolhas: Escolhas): Escolhas {
  return Object.fromEntries(Object.entries(escolhas).filter(([, e]) => e.quantity.trim() !== ""));
}

/** "Alface Americana" e "alface americana" e "ALFACE  AMERICANA" são a mesma busca; acento não conta. */
export function normalizarBusca(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function linhaDe(item: RequisitionCatalogItem, escolha: Escolha): LinhaDaRequisicao {
  return {
    productId: item.id,
    productName: item.name,
    productCode: item.code,
    stockUnit: item.unit,
    conversions: item.conversions,
    unit: escolha.unit,
    quantity: escolha.quantity
  };
}

const unidadeInicial = (item: RequisitionCatalogItem) => normalizarUnidade(item.unit) || "UN";

export const escolhaInicial = (item: RequisitionCatalogItem, quantity: string): Escolha => ({ unit: unidadeInicial(item), quantity });

/**
 * Quanto cada toque no + ou − soma: meio quilo, cem gramas, uma unidade. Grande demais não serve para pesar,
 * pequeno demais obriga a tocar dez vezes.
 */
export function passoDaUnidade(unidade: string): number {
  const u = normalizarUnidade(unidade);
  if (u === "G" || u === "ML") return 100;
  if (u === "KG" || u === "L") return 0.5;
  return 1;
}

const emTexto = (valor: number) => String(Math.round(valor * 1000) / 1000).replace(".", ",");

/** Soma ou subtrai um passo da quantidade digitada; chegar a zero devolve vazio (o produto sai da requisição). */
export function somarPasso(quantidade: string, passo: number, direcao: 1 | -1): string {
  const atual = lerNumero(quantidade);
  const base = Number.isFinite(atual) && atual > 0 ? atual : 0;
  const proximo = Math.round((base + direcao * passo) * 1000) / 1000;
  return proximo > 0 ? emTexto(proximo) : "";
}

/** Manhã até meio-dia, tarde até as 18h, depois noite: a maioria das requisições se faz no turno em que se está. */
export function turnoPelaHora(agora: Date = new Date()): "MORNING" | "AFTERNOON" | "NIGHT" {
  const hora = agora.getHours();
  return hora < 12 ? "MORNING" : hora < 18 ? "AFTERNOON" : "NIGHT";
}

const temSaldo = (item: RequisitionCatalogItem) => item.balance > 0;

/** Todas as palavras da busca precisam aparecer no nome ou no código ("alf am" acha ALFACE AMERICANA). */
export function combinaComBusca(item: RequisitionCatalogItem, texto: string): boolean {
  const termos = normalizarBusca(texto).split(" ").filter(Boolean);
  if (termos.length === 0) return true;
  const alvo = normalizarBusca(`${item.name} ${item.code ?? ""}`);
  return termos.every((termo) => alvo.includes(termo));
}

/**
 * O que a lista mostra. Sem saldo some, a menos que a pessoa procure o produto (aí ela vê por que não dá)
 * ou o tenha escolhido (o saldo mudou desde o rascunho e ela precisa ver o problema).
 */
export function filtrarCatalogo(itens: RequisitionCatalogItem[], escolhas: Escolhas, problemas: Set<string>, filtro: Filtro): RequisitionCatalogItem[] {
  const procurando = normalizarBusca(filtro.texto) !== "";
  return itens.filter((item) => {
    const escolhido = item.id in escolhas;
    if (filtro.visao === "ESCOLHIDOS") return escolhido && combinaComBusca(item, filtro.texto);
    if (filtro.visao === "PROBLEMA") return problemas.has(item.id);
    if (!combinaComBusca(item, filtro.texto)) return false;
    if (filtro.setorId != null && (item.sectorId ?? SEM_LOCAL) !== filtro.setorId) return false;
    return temSaldo(item) || filtro.mostrarSemSaldo || procurando || escolhido;
  });
}

/** Quantos produtos cada local tem para a lista atual (respeita "mostrar sem saldo"). */
export function contarPorLocal(itens: RequisitionCatalogItem[], mostrarSemSaldo: boolean): Map<string, number> {
  const contagem = new Map<string, number>();
  for (const item of itens) {
    if (!mostrarSemSaldo && !temSaldo(item)) continue;
    const chave = item.sectorId ?? SEM_LOCAL;
    contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
  }
  return contagem;
}
