import { CATEGORIAS_BEBIDA } from "./agile-categorias.js";
import { sugerirPratos, type SugestaoDePrato } from "./agile-nomes.js";
import type { Insight } from "./agile-analise-insights.js";
import type { Periodo } from "./agile-analise.report.js";

// Margem por prato do salão: preço médio REALMENTE cobrado no PDV menos o custo da porção da ficha
// técnica. Só calcula onde há vínculo e ficha completa; o resto vira lista de trabalho, na ordem do
// que mais vende, em vez de um número inventado.

export const MAX_A_FAZER = 30;
// Abaixo disso o prato deixa pouco depois do custo dos ingredientes (ainda sem mão de obra e ocupação).
export const LIMITE_MARGEM_BAIXA = 0.5;
// Menos que isso da receita dos pratos com margem calculada: o resto é lacuna, não resultado.
export const COBERTURA_MINIMA = 0.5;
export const MIN_RECEITA_PARA_AVISO = 500;
export const MAX_INSIGHTS_MARGEM = 4;
// Produto cujo nome começa por BUFFET é a refeição por quilo/pessoa, não um prato: a margem dele é custo
// de comida por pessoa e não cabe numa ficha de prato.
const EH_BUFFET = /^\s*buffet\b/i;
// Bebida é revenda: a margem dela é preço menos custo de COMPRA, não ficha de prato. Fica fora desta conta.
const ehBebida = (p: ProdutoVendido) => (CATEGORIAS_BEBIDA as readonly string[]).includes(p.categoria ?? "");

// quantidadePaga: unidades com valor > 0 (o preco médio não deve ser diluído por cortesia ou item de combo sem preço).
export type ProdutoVendido = { codigo: string | null; nome: string; categoria: string | null; quantidade: number; valor: number; quantidadePaga?: number };
export type PratoDoSalao = {
  id: string;
  nome: string;
  precoFicha: number | null;
  // Custo de UMA porção, pelos itens do cardápio do salão; null se a ficha do salão não tem itens.
  custoPorcao: number | null;
  itensNaFicha: number;
  // false = algum ingrediente sem custo ou sem conversão de unidade: o custo está subestimado.
  custoCompleto: boolean;
};
export type VinculoDoPdv = { codigo: string; pratoId: string };

// "prato-indisponivel": o produto TEM vinculo, mas o prato foi desativado ou saiu do cardapio do salao.
type Situacao = "sem-vinculo" | "prato-indisponivel" | "sem-ficha" | "custo-incompleto";

export type LinhaDeMargem = {
  pratoId: string;
  prato: string;
  produtosPdv: Array<{ codigo: string; nome: string }>;
  quantidade: number;
  receita: number;
  precoMedio: number;
  precoFicha: number | null;
  custoPorcao: number;
  margemUnitaria: number;
  margemPct: number;
  cmvPct: number;
  margemTotal: number;
  situacao: "completa";
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const razao = (parte: number, todo: number) => (todo > 0 ? parte / todo : 0);
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = (n: number) => `${(Math.abs(n) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;

export function montarMargem({ periodo, produtos, pratos, vinculos }: { periodo: Periodo; produtos: ProdutoVendido[]; pratos: PratoDoSalao[]; vinculos: VinculoDoPdv[] }) {
  const pratoPorId = new Map(pratos.map((p) => [p.id, p]));
  const pratoDoCodigo = new Map(vinculos.map((v) => [v.codigo, v.pratoId]));
  const comVenda = produtos.filter((p) => p.valor > 0);
  const receitaTotal = comVenda.reduce((s, p) => s + p.valor, 0);

  const buffet = comVenda.filter((p) => EH_BUFFET.test(p.nome));
  const bebidas = comVenda.filter((p) => !EH_BUFFET.test(p.nome) && ehBebida(p));
  const doSalao = comVenda.filter((p) => !EH_BUFFET.test(p.nome) && !ehBebida(p));
  const receitaBuffet = buffet.reduce((s, p) => s + p.valor, 0);
  const receitaBebidas = bebidas.reduce((s, p) => s + p.valor, 0);
  const receitaPratos = doSalao.reduce((s, p) => s + p.valor, 0);

  // Agrupa por prato os produtos vinculados a uma ficha que existe.
  const porPrato = new Map<string, ProdutoVendido[]>();
  const aFazerBruto: Array<{ produto: ProdutoVendido; situacao: Situacao; prato: PratoDoSalao | null }> = [];
  for (const p of doSalao) {
    const pratoId = p.codigo ? pratoDoCodigo.get(p.codigo) : undefined;
    const prato = pratoId ? pratoPorId.get(pratoId) ?? null : null;
    if (!prato) {
      aFazerBruto.push({ produto: p, situacao: pratoId ? "prato-indisponivel" : "sem-vinculo", prato: null });
      continue;
    }
    if (prato.custoPorcao === null || prato.itensNaFicha === 0) {
      aFazerBruto.push({ produto: p, situacao: "sem-ficha", prato });
      continue;
    }
    if (!prato.custoCompleto) {
      aFazerBruto.push({ produto: p, situacao: "custo-incompleto", prato });
      continue;
    }
    porPrato.set(prato.id, [...(porPrato.get(prato.id) ?? []), p]);
  }

  const linhas: LinhaDeMargem[] = [...porPrato.entries()]
    .map(([id, lista]): LinhaDeMargem => {
      const prato = pratoPorId.get(id) as PratoDoSalao;
      const quantidade = lista.reduce((s, p) => s + p.quantidade, 0);
      const receita = lista.reduce((s, p) => s + p.valor, 0);
      const precoMedio = razao(receita, quantidade);
      const custoPorcao = prato.custoPorcao as number;
      const margemUnitaria = precoMedio - custoPorcao;
      return {
        pratoId: id,
        prato: prato.nome,
        produtosPdv: lista.map((p) => ({ codigo: p.codigo as string, nome: p.nome })),
        quantidade: round2(quantidade),
        receita: round2(receita),
        precoMedio: round2(precoMedio),
        precoFicha: prato.precoFicha,
        custoPorcao: round2(custoPorcao),
        margemUnitaria: round2(margemUnitaria),
        margemPct: round4(razao(margemUnitaria, precoMedio)),
        cmvPct: round4(razao(custoPorcao, precoMedio)),
        margemTotal: round2(margemUnitaria * quantidade),
        situacao: "completa"
      };
    })
    .sort((a, b) => b.margemTotal - a.margemTotal || a.prato.localeCompare(b.prato));

  const receitaComMargem = linhas.reduce((s, l) => s + l.receita, 0);
  const soma = (situacao: Situacao) => aFazerBruto.filter((x) => x.situacao === situacao).reduce((s, x) => s + x.produto.valor, 0);
  const receitaSemVinculo = soma("sem-vinculo");
  const receitaPratoIndisponivel = soma("prato-indisponivel");
  const receitaSemFicha = soma("sem-ficha");
  const receitaCustoIncompleto = soma("custo-incompleto");

  const sugestoesPara = (nome: string): SugestaoDePrato[] => sugerirPratos(nome, pratos.map((p) => ({ id: p.id, nome: p.nome })));
  const aFazer = aFazerBruto
    .sort((a, b) => b.produto.valor - a.produto.valor || a.produto.nome.localeCompare(b.produto.nome))
    .slice(0, MAX_A_FAZER)
    .map(({ produto, situacao, prato }) => ({
      codigo: produto.codigo,
      nome: produto.nome,
      categoria: produto.categoria,
      quantidade: round2(produto.quantidade),
      receita: round2(produto.valor),
      pctReceita: round4(razao(produto.valor, receitaPratos)),
      situacao,
      pratoId: prato?.id ?? null,
      prato: prato?.nome ?? null,
      // Quem precisa (re)escolher o prato recebe sugestão: sem vínculo ou com o prato indisponível.
      sugestoes: situacao === "sem-vinculo" || situacao === "prato-indisponivel" ? sugestoesPara(produto.nome) : []
    }));

  const pctComMargem = round4(razao(receitaComMargem, receitaPratos));
  return {
    periodo,
    cobertura: {
      receitaTotal: round2(receitaTotal),
      receitaBuffet: round2(receitaBuffet),
      receitaBebidas: round2(receitaBebidas),
      receitaPratos: round2(receitaPratos),
      receitaComMargem: round2(receitaComMargem),
      receitaPratoIndisponivel: round2(receitaPratoIndisponivel),
      receitaSemFicha: round2(receitaSemFicha),
      receitaCustoIncompleto: round2(receitaCustoIncompleto),
      receitaSemVinculo: round2(receitaSemVinculo),
      pctComMargem,
      pctVinculadoSemCusto: round4(razao(receitaSemFicha + receitaCustoIncompleto + receitaPratoIndisponivel, receitaPratos)),
      pctSemVinculo: round4(razao(receitaSemVinculo, receitaPratos)),
      pctDaReceitaTotalComMargem: round4(razao(receitaComMargem, receitaTotal)),
      pratosComMargem: linhas.length
    },
    linhas,
    aFazer,
    pratosParaVincular: pratos.map((p) => ({ id: p.id, nome: p.nome })).sort((a, b) => a.nome.localeCompare(b.nome)),
    insights: gerarInsights(linhas, pctComMargem, receitaPratos)
  };
}

function gerarInsights(linhas: LinhaDeMargem[], pctComMargem: number, receitaPratos: number): Insight[] {
  const out: Insight[] = [];
  const relevantes = linhas.filter((l) => l.receita >= MIN_RECEITA_PARA_AVISO);

  const negativos = relevantes.filter((l) => l.margemUnitaria < 0).sort((a, b) => a.margemTotal - b.margemTotal);
  if (negativos[0]) {
    const l = negativos[0];
    out.push({
      id: "margem-negativa", tom: "alerta", secao: "margem", hipotese: false, impactoMes: null,
      titulo: `${l.prato} vende abaixo do custo`,
      detalhe: `Preço médio de ${brl(l.precoMedio)} contra custo de ${brl(l.custoPorcao)} por porção: cada prato vendido perde ${brl(-l.margemUnitaria)} só nos ingredientes.`,
      acao: "Confira a ficha (quantidades e custo dos insumos) e o preço no PDV antes de reajustar ou tirar do cardápio."
    });
  }

  const baixas = relevantes.filter((l) => l.margemUnitaria >= 0 && l.margemPct < LIMITE_MARGEM_BAIXA).sort((a, b) => b.receita - a.receita);
  if (baixas[0]) {
    const l = baixas[0];
    out.push({
      id: "margem-baixa", tom: "oportunidade", secao: "margem", hipotese: false, impactoMes: null,
      titulo: `${l.prato} deixa só ${pct(l.margemPct)} depois dos ingredientes`,
      detalhe: `Preço médio de ${brl(l.precoMedio)} e custo de ${brl(l.custoPorcao)} por porção, em ${brl(l.receita)} de receita no período.${baixas.length > 1 ? ` Mais ${baixas.length - 1} ${baixas.length - 1 === 1 ? "prato está" : "pratos estão"} abaixo de ${pct(LIMITE_MARGEM_BAIXA)}.` : ""}`,
      acao: "Veja se dá para ajustar porção, fornecedor ou preço. Lembre que esta margem ainda não desconta mão de obra, perdas e ocupação."
    });
  }

  if (receitaPratos >= MIN_RECEITA_PARA_AVISO && pctComMargem < COBERTURA_MINIMA) {
    out.push({
      id: "cobertura-baixa", tom: "info", secao: "margem", hipotese: false, impactoMes: null,
      titulo: `Margem calculada para só ${pct(pctComMargem)} da receita dos pratos`,
      detalhe: "O resto vende sem ficha técnica vinculada, então não dá para dizer onde ganhamos ou perdemos nele.",
      acao: "Comece pela lista abaixo: vincule ou monte a ficha dos pratos que mais vendem."
    });
  }
  // Já saem na ordem do que pede atenção primeiro: alerta, oportunidade, informação.
  return out.slice(0, MAX_INSIGHTS_MARGEM);
}
