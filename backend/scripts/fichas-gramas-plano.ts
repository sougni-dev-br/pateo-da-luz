/**
 * PLANO (somente leitura) — o que mudaria se as fichas técnicas fossem refeitas em g/ml.
 *
 * Este script NÃO grava nada: só faz `findMany` e imprime. Não tem modo de escrita.
 *
 * Regras da proposta, por ingrediente:
 *   - já em G ou ML ............................ nada a fazer
 *   - KG → G (×1000) · L → ML (×1000) .......... conversão física, custo idêntico
 *   - em UN/PCT/CX e o produto tem conversão
 *     (cadastrada ou lida do nome) para g ...... g = quantidade ÷ fator(G→unidade do estoque)
 *   - idem, só com conversão para ml ........... ml
 *   - sem conversão nenhuma .................... PENDENTE: alguém precisa informar "1 UN = ? g"
 * Depois de propor, o script RECALCULA o custo do ingrediente na nova unidade com o mesmo
 * cálculo da ficha e compara com o de hoje: diferença acima da tolerância vira "CONFERIR".
 *
 * Uso (de dentro de backend/), com a URL do banco na variável de ambiente — nunca em arquivo versionado:
 *   TZ=UTC DATABASE_URL="postgresql://..." npx tsx scripts/relatorio-fichas-para-gramas.ts
 *   ... --desde=2026-10-08        só fichas criadas ou alteradas a partir desta data
 *   ... --csv=relatorio-fichas.csv  grava também um CSV (arquivo local, não toca no banco)
 *   ... --so-mudancas              omite os ingredientes que já estão em g/ml
 */
import { PrismaClient } from "@prisma/client";
import { calculateDishCost } from "../src/modules/dishes/dish-cost.js";
import { conversoesDoProduto, normalizarUnidade, resolveUnitFactor } from "../src/shared/unidades/conversao.js";

/** Diferença de custo aceita por ingrediente: arredondamento da quantidade em 4 casas. */
const TOLERANCIA_RELATIVA = 0.001;
const CASAS_DA_QUANTIDADE = 4;

export type Decisao = "JA-ESTA" | "MUDA" | "PENDENTE" | "CONFERIR";

export type Linha = {
  itemId: string;
  dishId: string;
  prato: string;
  ativo: boolean;
  atualizadoEm: string;
  produto: string;
  quantidadeHoje: number;
  unidadeHoje: string;
  quantidadeNova: number | null;
  unidadeNova: string | null;
  custoHoje: number | null;
  custoNovo: number | null;
  decisao: Decisao;
  motivo: string;
};

export const arredonda = (n: number) => Number(n.toFixed(CASAS_DA_QUANTIDADE));
export const moeda = (n: number | null) => (n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
export const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** Lê as fichas e propõe, ingrediente a ingrediente, a versão em g/ml. Somente leitura. */
export async function lerPlano(prisma: PrismaClient, desde: Date | null) {
  const pratos = await prisma.dish.findMany({
    where: desde ? { OR: [{ createdAt: { gte: desde } }, { updatedAt: { gte: desde } }] } : undefined,
    orderBy: { name: "asc" },
    include: {
      items: {
        orderBy: { sortOrder: "asc" },
        include: {
          product: {
            select: {
              name: true,
              unit: true,
              stockUnit: true,
              inventoryStock: { select: { averageCost: true } },
              conversions: { where: { isActive: true }, select: { fromUnit: true, toUnit: true, factor: true } }
            }
          }
        }
      }
    }
  });

  const linhas: Linha[] = [];

  for (const prato of pratos) {
    for (const item of prato.items) {
      const base = normalizarUnidade(item.product.stockUnit || item.product.unit);
      const cadastradas = item.product.conversions.map((c) => ({ fromUnit: c.fromUnit, toUnit: c.toUnit, factor: Number(c.factor) }));
      const conversoes = conversoesDoProduto(item.product.name, base, cadastradas);
      const custoMedio = item.product.inventoryStock?.averageCost == null ? null : Number(item.product.inventoryStock.averageCost);
      const quantidade = Number(item.quantity);
      const perda = Number(item.wasteFactor);
      const unidade = normalizarUnidade(item.unit);

      const custoEm = (qtd: number, un: string): number | null =>
        calculateDishCost({
          yieldQty: 1,
          salePrice: null,
          items: [{ quantity: qtd, unit: un, wasteFactor: perda, product: { unit: base, averageCost: custoMedio, conversions: conversoes } }]
        }).items[0].itemCost;

      const custoHoje = custoEm(quantidade, unidade);
      const base_ = {
        itemId: item.id,
        dishId: prato.id,
        prato: prato.name,
        ativo: prato.isActive,
        atualizadoEm: prato.updatedAt.toISOString().slice(0, 10),
        produto: item.product.name,
        quantidadeHoje: quantidade,
        unidadeHoje: unidade,
        custoHoje
      };

      if (unidade === "G" || unidade === "ML") {
        linhas.push({ ...base_, quantidadeNova: quantidade, unidadeNova: unidade, custoNovo: custoHoje, decisao: "JA-ESTA", motivo: "já está em g/ml" });
        continue;
      }

      let novaUnidade: string | null = null;
      let novaQuantidade: number | null = null;
      let motivo = "";

      if (unidade === "KG") {
        novaUnidade = "G";
        novaQuantidade = quantidade * 1000;
        motivo = "kg → g (física)";
      } else if (unidade === "L") {
        novaUnidade = "ML";
        novaQuantidade = quantidade * 1000;
        motivo = "l → ml (física)";
      } else {
        for (const alvo of ["G", "ML"]) {
          const fator = resolveUnitFactor(alvo, unidade, conversoes);
          if (fator != null && fator > 0) {
            novaUnidade = alvo;
            novaQuantidade = quantidade / fator;
            const inferida = conversoes.some((c) => "inferida" in c && c.inferida);
            motivo = `${unidade} → ${alvo} (${inferida ? "peso/volume lido do nome do produto" : "conversão cadastrada"})`;
            break;
          }
        }
      }

      if (novaUnidade == null || novaQuantidade == null) {
        linhas.push({ ...base_, quantidadeNova: null, unidadeNova: null, custoNovo: null, decisao: "PENDENTE", motivo: `sem conversão de ${unidade} para g/ml: informar "1 ${unidade} = ? g" no produto` });
        continue;
      }

      novaQuantidade = arredonda(novaQuantidade);
      const custoNovo = custoEm(novaQuantidade, novaUnidade);
      const diferenca = custoHoje != null && custoNovo != null && custoHoje > 0 ? Math.abs(custoNovo - custoHoje) / custoHoje : 0;
      const confere = custoHoje != null && custoNovo != null ? diferenca <= TOLERANCIA_RELATIVA : custoHoje == null && custoNovo == null;
      linhas.push({
        ...base_,
        quantidadeNova: novaQuantidade,
        unidadeNova: novaUnidade,
        custoNovo,
        decisao: confere ? "MUDA" : "CONFERIR",
        motivo: confere ? motivo : `${motivo} — custo diverge ${(diferenca * 100).toFixed(2)}% (hoje ${moeda(custoHoje)}, novo ${moeda(custoNovo)})`
      });
    }
  }


  return { pratos, linhas };
}
