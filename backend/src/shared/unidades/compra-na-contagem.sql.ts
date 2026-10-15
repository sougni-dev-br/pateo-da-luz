// Filtro SQL para somar compras na unidade em que o produto e contado.
//
// As agregacoes de inventario usavam COALESCE(convertedQuantity, quantity): a
// linha sem conversao (conversionMissing) entrava com a quantidade da NOTA. Uma
// caixa de 12 virava "1" ao lado de unidades, a quantidade comprada encolhia e o
// custo por unidade (total / quantidade) saia o custo da caixa inteira.
//
// Regra (a mesma do desperdicio): so entra a linha cuja quantidade esta na
// unidade de contagem — convertida para ela, ou ja comprada nela. Linha de
// antes das colunas de conversao (convertedUnit nulo) so entra se a unidade da
// nota for a de contagem. Nada aqui estima fator: o que nao converte fica fora
// e e contado a parte para a tela avisar.

import { Prisma } from "@prisma/client";
import { SINONIMOS_DE_UNIDADE } from "./conversao.js";

const IDENTIFICADOR = /^[a-z_][a-z0-9_]*$/i;

function alias(nome: string) {
  if (!IDENTIFICADOR.test(nome)) throw new Error(`Alias SQL invalido: ${nome}`);
  return Prisma.raw(`"${nome}"`);
}

function literal(texto: string) {
  if (!/^[A-Z0-9]+$/.test(texto)) throw new Error(`Unidade invalida no mapa de sinonimos: ${texto}`);
  return `'${texto}'`;
}

// Constante: o mapa vem do codigo, nunca de entrada do usuario.
const CASOS = Object.entries(SINONIMOS_DE_UNIDADE)
  .map(([de, para]) => `WHEN ${literal(de)} THEN ${literal(para)}`)
  .join(" ");

/** Mesma normalizacao de `normalizarUnidade`, em SQL: maiuscula, sem ponto final, sinonimo canonico. */
export function sqlUnidadeCanonica(expressao: Prisma.Sql): Prisma.Sql {
  const limpa = Prisma.sql`UPPER(REGEXP_REPLACE(TRIM(${expressao}), '\\.+$', ''))`;
  return Prisma.sql`(CASE ${limpa} ${Prisma.raw(CASOS)} ELSE ${limpa} END)`;
}

/**
 * Condicao: a linha de compra `item` (PurchaseItem) esta na unidade de contagem
 * do produto `produto` (Product). Usar nas somas de quantidade e de custo.
 */
export function sqlCompraNaUnidadeDeContagem(item = "pi", produto = "pr"): Prisma.Sql {
  const pi = alias(item);
  const pr = alias(produto);
  const contagem = sqlUnidadeCanonica(Prisma.sql`COALESCE(${pr}."stockUnit", ${pr}."unit")`);
  const convertida = sqlUnidadeCanonica(Prisma.sql`${pi}."convertedUnit"`);
  const daNota = sqlUnidadeCanonica(Prisma.sql`${pi}."unit"`);
  return Prisma.sql`(
    ${pi}."conversionMissing" = false
    AND (
      (${pi}."convertedUnit" IS NOT NULL AND ${convertida} = ${contagem})
      OR (${pi}."convertedUnit" IS NULL AND (${pi}."unit" IS NULL OR COALESCE(${pr}."stockUnit", ${pr}."unit") IS NULL OR ${daNota} = ${contagem}))
    )
  )`;
}
