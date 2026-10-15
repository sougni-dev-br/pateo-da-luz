// Simulacao (somente leitura) da troca do custo medio do estoque pelo custo de
// referencia: por produto e por prato do salao, antes e depois. Serve para decidir
// ligar a chave CUSTO_FICHA_FONTE=referencia.

import { prisma } from "../../config/database.js";
import { carregarCustosDeReferencia, type FonteDoCustoDeReferencia } from "../inventory/custo-de-referencia.js";
import { carregarPratosDoSalaoComCusto } from "./dish-custo-salao.js";

/** Mudanca menor que isso no custo do produto nao entra na lista de diferencas. */
const DIFERENCA_RELEVANTE = 0.05;

export type ProdutoSimulado = {
  codigo: string | null;
  nome: string;
  unidade: string;
  atual: number;
  referencia: number;
  razao: number;
  fonte: FonteDoCustoDeReferencia;
  detalhe: string | null;
  revisar: string | null;
};

export type PratoSimulado = {
  id: string;
  nome: string;
  antes: number | null;
  depois: number | null;
  diferenca: number | null;
  completoAntes: boolean;
  completoDepois: boolean;
};

export type SimulacaoDoCusto = {
  resumo: { produtos: number; mudamMaisDe5: number; paraRevisar: number; pratos: number; pratosComDiferenca: number; somaDasDiferencas: number };
  produtos: ProdutoSimulado[];
  pratos: PratoSimulado[];
};

export async function simularCustoDeReferencia(): Promise<SimulacaoDoCusto> {
  const estoques = await prisma.product.findMany({
    where: { isActive: true, inventoryStock: { averageCost: { gt: 0 } } },
    select: { id: true, externalCode: true, name: true, unit: true, stockUnit: true, inventoryStock: { select: { averageCost: true } } }
  });
  const referencia = await carregarCustosDeReferencia(estoques.map((p) => p.id));

  const produtos: ProdutoSimulado[] = estoques.flatMap((p) => {
    const ref = referencia.get(p.id);
    const atual = Number(p.inventoryStock?.averageCost ?? 0);
    if (!ref || atual <= 0) return [];
    return [{
      codigo: p.externalCode,
      nome: p.name,
      unidade: p.stockUnit || p.unit || "",
      atual,
      referencia: ref.valor,
      razao: ref.valor / atual,
      fonte: ref.fonte,
      detalhe: ref.detalhe,
      revisar: ref.revisar
    }];
  });
  const mudou = (p: ProdutoSimulado) => Math.abs(p.razao - 1) > DIFERENCA_RELEVANTE;

  const [antes, depois] = await Promise.all([carregarPratosDoSalaoComCusto(prisma, false), carregarPratosDoSalaoComCusto(prisma, true)]);
  const custoDepois = new Map(depois.map((p) => [p.id, p]));
  const pratos: PratoSimulado[] = antes.map((a) => {
    const d = custoDepois.get(a.id);
    const diferenca = a.custoPorcao != null && d?.custoPorcao != null ? d.custoPorcao - a.custoPorcao : null;
    return { id: a.id, nome: a.nome, antes: a.custoPorcao, depois: d?.custoPorcao ?? null, diferenca, completoAntes: a.custoCompleto, completoDepois: d?.custoCompleto ?? false };
  });
  const comDiferenca = pratos.filter((p) => p.diferenca != null && Math.abs(p.diferenca) >= 0.01);

  return {
    resumo: {
      produtos: produtos.length,
      mudamMaisDe5: produtos.filter(mudou).length,
      paraRevisar: produtos.filter((p) => p.revisar).length,
      pratos: pratos.length,
      pratosComDiferenca: comDiferenca.length,
      somaDasDiferencas: Math.round(comDiferenca.reduce((s, p) => s + (p.diferenca ?? 0), 0) * 100) / 100
    },
    produtos: produtos.filter((p) => mudou(p) || p.revisar).sort((a, b) => Math.abs(Math.log(b.razao)) - Math.abs(Math.log(a.razao))),
    pratos: comDiferenca.sort((a, b) => Math.abs(b.diferenca ?? 0) - Math.abs(a.diferenca ?? 0))
  };
}
