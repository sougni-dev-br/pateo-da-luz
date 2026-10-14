import { sugerirPratos } from "./agile-nomes.js";
import type { Insight } from "./agile-analise-insights.js";
import type { Periodo } from "./agile-analise.report.js";

// Margem de REVENDA das bebidas: preço médio cobrado no PDV menos o custo de compra do insumo que cada venda
// consome. Só calcula onde há vínculo e custo completo; o resto vira lista de trabalho, do que mais vende.

export const MAX_A_FAZER_BEBIDAS = 30;
// Bebida costuma deixar bem mais que prato: abaixo de metade do preço já merece olhar.
export const LIMITE_MARGEM_BAIXA_BEBIDA = 0.5;
export const COBERTURA_MINIMA_BEBIDAS = 0.5;
export const MIN_RECEITA_PARA_AVISO_BEBIDA = 500;
export const MAX_INSIGHTS_BEBIDAS = 4;

// quantidadePaga: unidades com valor > 0; o preço médio sai só delas (cortesia não dilui o preço).
export type BebidaVendida = { codigo: string | null; nome: string; categoria: string | null; quantidade: number; valor: number; quantidadePaga?: number };
export type VinculoDeBebida = {
  codigo: string;
  insumoId: string;
  insumo: string;
  // Quanto UM item vendido consome do insumo, na unidade informada (1 UN; 150 ML).
  quantidade: number;
  unidade: string;
  // Custo de compra do que uma venda consome; null se o insumo não tem custo ou a unidade não converte.
  custoPorVenda: number | null;
  custoCompleto: boolean;
  problema: string | null;
};
export type InsumoParaVincular = { id: string; nome: string; unidade: string };

type Situacao = "sem-vinculo" | "custo-incompleto";

export type LinhaDeMargemBebida = {
  codigo: string;
  nome: string;
  categoria: string | null;
  quantidade: number;
  // Unidades vendidas sem cobrança (cortesia, item de combo sem preço): contam no custo, não no preço médio.
  quantidadeSemCobranca: number;
  receita: number;
  precoMedio: number;
  insumo: string;
  consumo: string;
  custoPorVenda: number;
  margemUnitaria: number;
  margemPct: number;
  cmvPct: number;
  margemTotal: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const razao = (parte: number, todo: number) => (todo > 0 ? parte / todo : 0);
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brl2 = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (n: number) => `${(Math.abs(n) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;
const numeroCurto = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });

export function montarMargemBebidas({ periodo, bebidas, vinculos, insumos }: { periodo: Periodo; bebidas: BebidaVendida[]; vinculos: VinculoDeBebida[]; insumos: InsumoParaVincular[] }) {
  const vinculoDoCodigo = new Map(vinculos.map((v) => [v.codigo, v]));
  const comVenda = bebidas.filter((b) => b.valor > 0);
  const receitaBebidas = comVenda.reduce((s, b) => s + b.valor, 0);

  const linhas: LinhaDeMargemBebida[] = [];
  const aFazerBruto: Array<{ bebida: BebidaVendida; situacao: Situacao; vinculo: VinculoDeBebida | null }> = [];
  for (const b of comVenda) {
    const v = b.codigo ? vinculoDoCodigo.get(b.codigo) : undefined;
    if (!v) {
      aFazerBruto.push({ bebida: b, situacao: "sem-vinculo", vinculo: null });
      continue;
    }
    if (!v.custoCompleto || v.custoPorVenda === null) {
      aFazerBruto.push({ bebida: b, situacao: "custo-incompleto", vinculo: v });
      continue;
    }
    const paga = b.quantidadePaga ?? b.quantidade;
    const precoMedio = razao(b.valor, paga);
    const margemUnitaria = precoMedio - v.custoPorVenda;
    linhas.push({
      codigo: v.codigo,
      nome: b.nome,
      categoria: b.categoria,
      quantidade: round2(b.quantidade),
      quantidadeSemCobranca: round2(Math.max(0, b.quantidade - paga)),
      receita: round2(b.valor),
      precoMedio: round2(precoMedio),
      insumo: v.insumo,
      consumo: `${numeroCurto(v.quantidade)} ${v.unidade} de ${v.insumo}`,
      custoPorVenda: round2(v.custoPorVenda),
      margemUnitaria: round2(margemUnitaria),
      margemPct: round4(razao(margemUnitaria, precoMedio)),
      cmvPct: round4(razao(v.custoPorVenda, precoMedio)),
      // Receita menos o custo de TODAS as unidades, inclusive as sem cobrança.
      margemTotal: round2(b.valor - v.custoPorVenda * b.quantidade)
    });
  }
  linhas.sort((a, b) => b.margemTotal - a.margemTotal || a.nome.localeCompare(b.nome));

  const receitaComMargem = linhas.reduce((s, l) => s + l.receita, 0);
  const soma = (situacao: Situacao) => aFazerBruto.filter((x) => x.situacao === situacao).reduce((s, x) => s + x.bebida.valor, 0);
  const receitaSemVinculo = soma("sem-vinculo");
  const receitaCustoIncompleto = soma("custo-incompleto");

  const aFazer = aFazerBruto
    .sort((a, b) => b.bebida.valor - a.bebida.valor || a.bebida.nome.localeCompare(b.bebida.nome))
    .slice(0, MAX_A_FAZER_BEBIDAS)
    .map(({ bebida, situacao, vinculo }) => ({
      codigo: bebida.codigo,
      nome: bebida.nome,
      categoria: bebida.categoria,
      quantidade: round2(bebida.quantidade),
      receita: round2(bebida.valor),
      pctReceita: round4(razao(bebida.valor, receitaBebidas)),
      situacao,
      insumo: vinculo?.insumo ?? null,
      problema: vinculo?.problema ?? null,
      // Sem código não dá para vincular, então sugerir seria inútil.
      sugestoes: situacao === "sem-vinculo" && bebida.codigo
        ? sugerirPratos(bebida.nome, insumos.map((i) => ({ id: i.id, nome: i.nome }))).map((s) => ({ insumoId: s.pratoId, nome: s.nome, similaridade: s.similaridade }))
        : []
    }));

  const pctComMargem = round4(razao(receitaComMargem, receitaBebidas));
  return {
    periodo,
    cobertura: {
      receitaBebidas: round2(receitaBebidas),
      receitaComMargem: round2(receitaComMargem),
      receitaSemVinculo: round2(receitaSemVinculo),
      receitaCustoIncompleto: round2(receitaCustoIncompleto),
      pctComMargem,
      pctSemVinculo: round4(razao(receitaSemVinculo, receitaBebidas)),
      pctCustoIncompleto: round4(razao(receitaCustoIncompleto, receitaBebidas)),
      bebidasComMargem: linhas.length
    },
    linhas,
    aFazer,
    // Só quando há o que vincular: a lista inteira de insumos não precisa viajar a cada consulta.
    insumosParaVincular: aFazer.length === 0 ? [] : insumos.map((i) => ({ id: i.id, nome: i.nome, unidade: i.unidade })).sort((a, b) => a.nome.localeCompare(b.nome)),
    insights: gerarInsights(linhas, pctComMargem, receitaBebidas)
  };
}

function gerarInsights(linhas: LinhaDeMargemBebida[], pctComMargem: number, receitaBebidas: number): Insight[] {
  const out: Insight[] = [];
  const relevantes = linhas.filter((l) => l.receita >= MIN_RECEITA_PARA_AVISO_BEBIDA);

  const negativas = relevantes.filter((l) => l.margemUnitaria < 0).sort((a, b) => a.margemTotal - b.margemTotal);
  if (negativas[0]) {
    const l = negativas[0];
    out.push({
      id: "margem-negativa", tom: "alerta", secao: "margem", hipotese: false, impactoMes: null,
      titulo: `${l.nome} vende abaixo do custo de compra`,
      detalhe: `Preço médio de ${brl2(l.precoMedio)} contra custo de ${brl2(l.custoPorVenda)} por venda (${l.consumo}): cada venda perde ${brl2(-l.margemUnitaria)}.`,
      acao: "Confira o vínculo (quantidade e unidade consumidas) e o preço no PDV antes de reajustar ou tirar do cardápio."
    });
  }

  const baixas = relevantes.filter((l) => l.margemUnitaria >= 0 && l.margemPct < LIMITE_MARGEM_BAIXA_BEBIDA).sort((a, b) => b.receita - a.receita);
  if (baixas[0]) {
    const l = baixas[0];
    out.push({
      id: "margem-baixa", tom: "oportunidade", secao: "margem", hipotese: false, impactoMes: null,
      titulo: `${l.nome} deixa só ${pct(l.margemPct)} do preço depois do custo de compra`,
      detalhe: `Preço médio de ${brl2(l.precoMedio)} e custo de ${brl2(l.custoPorVenda)} por venda, em ${brl(l.receita)} de receita no período.${baixas.length > 1 ? ` Mais ${baixas.length - 1} ${baixas.length - 1 === 1 ? "bebida está" : "bebidas estão"} abaixo de ${pct(LIMITE_MARGEM_BAIXA_BEBIDA)}.` : ""}`,
      acao: "Veja preço de venda e preço de compra. Esta margem ainda não desconta perdas, quebra nem mão de obra do bar."
    });
  }

  if (receitaBebidas >= MIN_RECEITA_PARA_AVISO_BEBIDA && pctComMargem < COBERTURA_MINIMA_BEBIDAS) {
    out.push({
      id: "cobertura-baixa", tom: "info", secao: "margem", hipotese: false, impactoMes: null,
      titulo: `Margem calculada para só ${pct(pctComMargem)} da receita das bebidas`,
      detalhe: "O resto vende sem insumo vinculado, então não dá para dizer onde ganhamos ou perdemos nele.",
      acao: "Comece pela lista abaixo: vincule as bebidas que mais vendem ao insumo comprado."
    });
  }
  return out.slice(0, MAX_INSIGHTS_BEBIDAS);
}
