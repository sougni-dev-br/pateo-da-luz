// Previa, na linha da nota, de quanto entra na unidade de contagem.

import { fatorConversao, normalizarUnidade } from "../../lib/fichaTecnica";

// A mesma regra da ficha tecnica e do backend (sinonimos e KG<->G, L<->ML). A copia
// que existia aqui nao tinha os fatores universais: nota em G de produto contado em
// KG aparecia "sem conversao" e o aviso de preco 10x desligava.
export { normalizarUnidade };

type ProdutoComEmbalagens = {
  unit?: string | null;
  stockUnit?: string | null;
  unitConversions?: Array<{ fromUnit: string; toUnit: string; factor: string | number; isActive?: boolean }>;
};

export type PreviaDeConversao =
  | { tipo: "converte"; quantidade: number; unidade: string; fator: number }
  | { tipo: "sem_conversao"; unidade: string };

/** `null` quando a nota ja esta na unidade de contagem (ou nao da para saber). */
export function previaDaConversao(produto: ProdutoComEmbalagens | undefined, unidadeDaNota: string, quantidade: number): PreviaDeConversao | null {
  if (!produto) return null;
  const contagem = normalizarUnidade(produto.stockUnit ?? produto.unit);
  const nota = normalizarUnidade(unidadeDaNota);
  if (!contagem || !nota || contagem === nota) return null;
  const ativas = (produto.unitConversions ?? [])
    .filter((c) => c.isActive !== false)
    .map((c) => ({ fromUnit: c.fromUnit, toUnit: c.toUnit, factor: Number(c.factor) }));
  const fator = fatorConversao(nota, contagem, ativas);
  if (fator == null || !Number.isFinite(fator) || fator <= 0) return { tipo: "sem_conversao", unidade: contagem };
  return { tipo: "converte", quantidade: quantidade * fator, unidade: contagem, fator };
}

export const RAZAO_DE_AVISO = 10;

export type AvisoDePreco = { precoPorUnidade: number; precoNormal: number; unidade: string };

/**
 * Linha que provavelmente e pacote/caixa lancado como unidade: o preco por
 * unidade de contagem fica 10x ou mais acima do normal do produto. Com
 * embalagem escolhida (PCT com conversao), compara o preco ja dividido.
 */
export function avisoDePreco(
  produto: ProdutoComEmbalagens | undefined,
  unidadeDaNota: string,
  precoUnitario: number,
  referencia: { precoNormal: number | null; unidade: string } | undefined
): AvisoDePreco | null {
  if (!produto || !referencia?.precoNormal || !(precoUnitario > 0)) return null;
  const previa = previaDaConversao(produto, unidadeDaNota, 1);
  if (previa?.tipo === "sem_conversao") return null;
  const precoPorUnidade = previa?.tipo === "converte" ? precoUnitario / previa.fator : precoUnitario;
  if (precoPorUnidade < referencia.precoNormal * RAZAO_DE_AVISO) return null;
  return { precoPorUnidade, precoNormal: referencia.precoNormal, unidade: referencia.unidade };
}
