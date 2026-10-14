import { MIN_DIAS_PARA_COMPARAR_PERIODOS } from "./agile-analise-insights.js";
import { diasDoPeriodo } from "./agile-analise-visao.report.js";
import { turnoDe, ROTULO_TURNO, type TurnoId } from "./agile-analise-demanda.report.js";
import { ITENS_DE_ATENCAO, ROTULO_ITEM, type ItemDeAtencao } from "./agile-categorias.js";
import type { Periodo } from "./agile-analise.report.js";
import type { Insight } from "./agile-analise-insights.js";

// "O que vendemos": mix por categoria, curva ABC, cauda longa, produtos a R$ 0 e quanto cada
// bebida/café/sobremesa vende por comanda e por pessoa. Funções puras sobre agregados que o serviço
// já somou no banco (um produto por linha), não sobre milhares de itens.

export type LinhaProduto = {
  janela: "atual" | "anterior";
  produto: string;
  grupo: string | null;
  categoria: string | null;
  quantidade: number;
  valor: number;
};

export type LinhaAttach = {
  janela: "atual" | "anterior";
  turno: string;
  comandas: number;
  pessoas: number;
  comBebida: number;
  comAlcool: number;
  comCafe: number;
  comSobremesa: number;
  qtdBebida: number;
  valBebida: number;
  qtdAlcool: number;
  valAlcool: number;
  qtdCafe: number;
  valCafe: number;
  qtdSobremesa: number;
  valSobremesa: number;
};

// Classe A: até 80% da receita acumulada; B: até 95%; C: o resto. Um produto é da classe em que a
// receita acumulada ANTES dele ainda estava: um produto que sozinho passa de 80% é A.
export const LIMITE_CLASSE_A = 0.8;
export const LIMITE_CLASSE_B = 0.95;
// Produto que vende menos que isto da receita é "cauda longa": candidato a revisão, não a corte.
export const LIMITE_CAUDA = 0.001;
export const MAX_ITENS_ABC = 30;
export const MAX_EXEMPLOS_CAUDA = 12;
export const MAX_SEM_PRECO = 10;
export const MAX_GRUPOS = 10;
// Abaixo disto, a taxa por comanda oscila demais para comparar ou simular.
export const MIN_COMANDAS_PARA_TAXA = 100;
export const PONTO_SIMULADO = 0.01;
const DIAS_NO_MES = 30;
const SEM_CATEGORIA = "(sem categoria)";
const SEM_GRUPO = "(sem grupo)";

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const razao = (parte: number, todo: number) => (todo > 0 ? parte / todo : 0);

type Classe = "A" | "B" | "C";

function somarPorChave<T extends { valor: number; quantidade: number }>(linhas: T[], chave: (l: T) => string) {
  const mapa = new Map<string, { valor: number; quantidade: number; produtos: Set<string> }>();
  for (const l of linhas as Array<T & { produto: string }>) {
    const k = chave(l);
    const a = mapa.get(k) ?? { valor: 0, quantidade: 0, produtos: new Set<string>() };
    a.valor += l.valor;
    a.quantidade += l.quantidade;
    a.produtos.add(l.produto);
    mapa.set(k, a);
  }
  return mapa;
}

function montarMix(atual: LinhaProduto[], anterior: LinhaProduto[], chave: (l: LinhaProduto) => string, limite?: number) {
  const totalAtual = atual.reduce((s, l) => s + l.valor, 0);
  const totalAnterior = anterior.reduce((s, l) => s + l.valor, 0);
  const a = somarPorChave(atual, chave);
  const b = somarPorChave(anterior, chave);
  const linhas = [...a.entries()]
    .map(([nome, x]) => {
      const participacao = razao(x.valor, totalAtual);
      const anteriorX = b.get(nome);
      const participacaoAnterior = totalAnterior > 0 && anteriorX ? razao(anteriorX.valor, totalAnterior) : totalAnterior > 0 ? 0 : null;
      return {
        nome,
        valor: round2(x.valor),
        participacao: round4(participacao),
        produtos: x.produtos.size,
        quantidade: round2(x.quantidade),
        precoMedio: x.quantidade > 0 ? round2(x.valor / x.quantidade) : 0,
        participacaoAnterior: participacaoAnterior === null ? null : round4(participacaoAnterior),
        variacaoPontos: participacaoAnterior === null ? null : round4(participacao - participacaoAnterior)
      };
    })
    .sort((p, q) => q.valor - p.valor || p.nome.localeCompare(q.nome));
  return limite ? linhas.slice(0, limite) : linhas;
}

function montarAbc(atual: LinhaProduto[]) {
  const porProduto = new Map<string, { produto: string; grupo: string; categoria: string; quantidade: number; valor: number }>();
  for (const l of atual) {
    const a = porProduto.get(l.produto) ?? { produto: l.produto, grupo: l.grupo?.trim() || SEM_GRUPO, categoria: l.categoria?.trim() || SEM_CATEGORIA, quantidade: 0, valor: 0 };
    a.quantidade += l.quantidade;
    a.valor += l.valor;
    porProduto.set(l.produto, a);
  }
  const total = [...porProduto.values()].reduce((s, p) => s + p.valor, 0);
  const ordenados = [...porProduto.values()].sort((p, q) => q.valor - p.valor || p.produto.localeCompare(q.produto));

  let antes = 0;
  const itens = ordenados.map((p, i) => {
    const classe: Classe = total <= 0 || antes < LIMITE_CLASSE_A * total ? "A" : antes < LIMITE_CLASSE_B * total ? "B" : "C";
    antes += p.valor;
    return {
      posicao: i + 1,
      produto: p.produto,
      grupo: p.grupo,
      categoria: p.categoria,
      quantidade: round2(p.quantidade),
      valor: round2(p.valor),
      participacao: round4(razao(p.valor, total)),
      acumulada: round4(razao(antes, total)),
      classe
    };
  });
  return { total, itens };
}

type Taxa = { pctComandas: number; porPessoa: number; receitaPorPessoa: number; precoMedio: number; quantidade: number; valor: number };

function somarAttach(linhas: LinhaAttach[]) {
  const s = { comandas: 0, pessoas: 0, comBebida: 0, comAlcool: 0, comCafe: 0, comSobremesa: 0, qtdBebida: 0, valBebida: 0, qtdAlcool: 0, valAlcool: 0, qtdCafe: 0, valCafe: 0, qtdSobremesa: 0, valSobremesa: 0 };
  for (const l of linhas) for (const k of Object.keys(s) as Array<keyof typeof s>) s[k] += l[k];
  return s;
}

const CAMPOS: Record<ItemDeAtencao, { com: keyof LinhaAttach; qtd: keyof LinhaAttach; val: keyof LinhaAttach }> = {
  bebida: { com: "comBebida", qtd: "qtdBebida", val: "valBebida" },
  alcool: { com: "comAlcool", qtd: "qtdAlcool", val: "valAlcool" },
  cafe: { com: "comCafe", qtd: "qtdCafe", val: "valCafe" },
  sobremesa: { com: "comSobremesa", qtd: "qtdSobremesa", val: "valSobremesa" }
};

function taxaDe(s: ReturnType<typeof somarAttach>, item: ItemDeAtencao): Taxa {
  const c = CAMPOS[item];
  const quantidade = s[c.qtd as keyof typeof s];
  const valor = s[c.val as keyof typeof s];
  return {
    pctComandas: round4(razao(s[c.com as keyof typeof s], s.comandas)),
    porPessoa: round4(razao(quantidade, s.pessoas)),
    receitaPorPessoa: round2(razao(valor, s.pessoas)),
    precoMedio: round2(razao(valor, quantidade)),
    quantidade: round2(quantidade),
    valor: round2(valor)
  };
}

function montarBloco(atual: LinhaAttach[], anterior: LinhaAttach[]) {
  const a = somarAttach(atual);
  const b = somarAttach(anterior);
  const anteriorConfiavel = b.comandas >= MIN_COMANDAS_PARA_TAXA;
  const itens = Object.fromEntries(
    ITENS_DE_ATENCAO.map((item) => {
      const t = taxaDe(a, item);
      const tAnt = taxaDe(b, item);
      return [item, { ...t, pctComandasAnterior: anteriorConfiavel ? tAnt.pctComandas : null, variacaoPontos: anteriorConfiavel ? round4(t.pctComandas - tAnt.pctComandas) : null }];
    })
  ) as Record<ItemDeAtencao, Taxa & { pctComandasAnterior: number | null; variacaoPontos: number | null }>;
  return { comandas: a.comandas, pessoas: a.pessoas, comandasAnterior: b.comandas, itens };
}

function montarResultado({ periodo, produtos, attach }: { periodo: Periodo; produtos: LinhaProduto[]; attach: LinhaAttach[] }) {
  // Período curto contra o anterior compara dias da semana diferentes: sem variação, como no resto da tela.
  const compara = diasDoPeriodo(periodo) >= MIN_DIAS_PARA_COMPARAR_PERIODOS;
  const atual = produtos.filter((l) => l.janela === "atual");
  const anterior = compara ? produtos.filter((l) => l.janela === "anterior") : [];
  const { total, itens } = montarAbc(atual);

  const classes = (["A", "B", "C"] as const).map((classe) => {
    const doGrupo = itens.filter((i) => i.classe === classe);
    const valor = doGrupo.reduce((s, i) => s + i.valor, 0);
    return { classe, produtos: doGrupo.length, valor: round2(valor), participacao: round4(razao(valor, total)) };
  });

  // Pela razão EXATA, não pela arredondada: 0,0999% arredonda para 0,10% e sairia da cauda.
  const cauda = itens.filter((i) => i.valor > 0 && i.valor / total < LIMITE_CAUDA);
  const valorCauda = cauda.reduce((s, i) => s + i.valor, 0);
  const semPreco = itens
    .filter((i) => i.valor === 0 && i.quantidade > 0)
    .sort((p, q) => q.quantidade - p.quantidade || p.produto.localeCompare(q.produto));

  const turnos = (["ALMOCO", "JANTAR", "OUTRO"] as TurnoId[])
    .map((turno) => ({
      turno,
      linhasAtual: attach.filter((l) => l.janela === "atual" && turnoDe(l.turno) === turno),
      linhasAnterior: (compara ? attach : []).filter((l) => l.janela === "anterior" && turnoDe(l.turno) === turno)
    }))
    .filter((t) => t.linhasAtual.length > 0)
    .map((t) => ({ turno: t.turno, rotulo: ROTULO_TURNO[t.turno], ...montarBloco(t.linhasAtual, t.linhasAnterior) }));
  const geral = montarBloco(attach.filter((l) => l.janela === "atual"), (compara ? attach : []).filter((l) => l.janela === "anterior"));

  // Quanto vale cada ponto percentual a mais de comandas com o item: hipótese, não previsão.
  const dias = diasDoPeriodo(periodo);
  const comandasPorMes = dias > 0 ? (geral.comandas / dias) * DIAS_NO_MES : 0;
  const simulacoes = ITENS_DE_ATENCAO.map((item) => {
    const precoMedio = geral.itens[item].precoMedio;
    return {
      item,
      rotulo: ROTULO_ITEM[item],
      ponto: PONTO_SIMULADO,
      precoMedio,
      comandasPorMes: Math.round(comandasPorMes),
      // Sem preço médio (item nunca vendido a preço > 0) ou sem comandas, não há o que simular.
      valorMes: geral.comandas >= MIN_COMANDAS_PARA_TAXA && precoMedio > 0 ? round2(PONTO_SIMULADO * comandasPorMes * precoMedio) : null
    };
  });

  const resultado = {
    periodo,
    cobertura: { produtosVendidos: itens.length, comandas: geral.comandas, pessoas: geral.pessoas },
    resumo: {
      faturamentoItens: round2(total),
      produtosVendidos: itens.length,
      produtosClasseA: classes[0].produtos,
      produtosCaudaLonga: cauda.length,
      participacaoCauda: round4(razao(valorCauda, total)),
      maiorProduto: itens[0] ? { produto: itens[0].produto, participacao: itens[0].participacao } : null,
      semPrecoProdutos: semPreco.length,
      semPrecoUnidades: round2(semPreco.reduce((s, i) => s + i.quantidade, 0))
    },
    categorias: montarMix(atual, anterior, (l) => l.categoria?.trim() || SEM_CATEGORIA),
    grupos: montarMix(atual, anterior, (l) => l.grupo?.trim() || SEM_GRUPO, MAX_GRUPOS),
    abc: { classes, limiteA: LIMITE_CLASSE_A, limiteB: LIMITE_CLASSE_B, itens: itens.slice(0, MAX_ITENS_ABC) },
    cauda: { limite: LIMITE_CAUDA, produtos: cauda.length, valor: round2(valorCauda), participacao: round4(razao(valorCauda, total)), exemplos: cauda.slice(0, MAX_EXEMPLOS_CAUDA) },
    semPreco: semPreco.slice(0, MAX_SEM_PRECO).map((i) => ({ produto: i.produto, categoria: i.categoria, unidades: i.quantidade })),
    attach: { turnos, geral },
    simulacoes
  };
  return resultado;
}

type Resultado = ReturnType<typeof montarResultado>;

export function montarCardapio(args: { periodo: Periodo; produtos: LinhaProduto[]; attach: LinhaAttach[] }) {
  const resultado = montarResultado(args);
  return { ...resultado, insights: gerarInsightsCardapio(resultado) };
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = (n: number, casas = 0) => `${(n * 100).toLocaleString("pt-BR", { maximumFractionDigits: casas })}%`;

export const LIMITE_SOBREMESA_BAIXA = 0.05;
export const LIMITE_CAUDA_LONGA_PRODUTOS = 0.3;
export const LIMITE_CAUDA_LONGA_RECEITA = 0.05;
export const LIMITE_DEPENDENCIA = 0.4;
export const QUEDA_RELEVANTE_PONTOS = 0.03;
export const MAX_INSIGHTS_CARDAPIO = 5;
const ordemTom = { alerta: 0, oportunidade: 1, info: 2 } as const;

function gerarInsightsCardapio(r: Resultado): Insight[] {
  const lista: Insight[] = [];
  const g = r.attach.geral;

  if (r.resumo.semPrecoProdutos > 0) {
    const nomes = r.semPreco.slice(0, 3).map((s) => s.produto).join(", ");
    lista.push({
      id: "vendido-a-zero",
      tom: "alerta",
      titulo: `${r.resumo.semPrecoProdutos} produto${r.resumo.semPrecoProdutos > 1 ? "s" : ""} vendido${r.resumo.semPrecoProdutos > 1 ? "s" : ""} a R$ 0`,
      detalhe: `${Math.round(r.resumo.semPrecoUnidades)} unidades sem valor lançado, como ${nomes}.`,
      acao: "Confira se é cortesia ou promoção de propósito, ou se o preço não está cadastrado no PDV.",
      impactoMes: null,
      hipotese: false,
      secao: "cardapio"
    });
  }

  const sobremesa = g.itens.sobremesa;
  const simSobremesa = r.simulacoes.find((s) => s.item === "sobremesa");
  if (g.comandas >= MIN_COMANDAS_PARA_TAXA && sobremesa.pctComandas < LIMITE_SOBREMESA_BAIXA) {
    lista.push({
      id: "sobremesa-baixa",
      tom: "oportunidade",
      titulo: `Sobremesa em só ${pct(sobremesa.pctComandas, 1)} das comandas`,
      detalhe: simSobremesa?.valorMes != null
        ? `Cada ponto percentual a mais de comandas com sobremesa valeria cerca de ${brl(simSobremesa.valorMes)} por mês, ao preço médio de ${brl(sobremesa.precoMedio)}.`
        : "Quase não há sobremesa vendida pelo PDV neste período.",
      acao: "Confirme com a equipe se toda sobremesa é lançada no PDV. Se for, vale oferecer na hora da conta; se não, o número não mostra a venda real.",
      impactoMes: simSobremesa?.valorMes ?? null,
      hipotese: true,
      secao: "cardapio"
    });
  }

  for (const item of ["bebida", "alcool", "cafe"] as const) {
    const t = g.itens[item];
    if (t.variacaoPontos !== null && t.variacaoPontos <= -QUEDA_RELEVANTE_PONTOS) {
      const sim = r.simulacoes.find((s) => s.item === item);
      lista.push({
        id: `${item}-caiu`,
        tom: "alerta",
        titulo: `${ROTULO_ITEM[item]} em menos comandas: ${pct(t.pctComandas, 1)} contra ${pct(t.pctComandasAnterior ?? 0, 1)}`,
        detalhe: `Queda de ${(Math.abs(t.variacaoPontos) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} pontos percentuais contra o período anterior.`,
        acao: "Veja se mudou o preço, a oferta na mesa ou a equipe do turno, e acompanhe aqui.",
        impactoMes: sim?.valorMes != null ? Math.round(sim.valorMes * Math.abs(t.variacaoPontos) * 100) : null,
        hipotese: true,
        secao: "cardapio"
      });
    }
  }

  if (r.resumo.produtosVendidos >= 20 && r.resumo.produtosCaudaLonga / r.resumo.produtosVendidos >= LIMITE_CAUDA_LONGA_PRODUTOS && r.resumo.participacaoCauda < LIMITE_CAUDA_LONGA_RECEITA) {
    lista.push({
      id: "cauda-longa",
      tom: "info",
      titulo: `${r.resumo.produtosCaudaLonga} de ${r.resumo.produtosVendidos} produtos somam só ${pct(r.resumo.participacaoCauda, 1)} da receita`,
      detalhe: `Cada um vende menos de ${pct(LIMITE_CAUDA, 1)} do total. ${r.resumo.produtosClasseA} produtos fazem 80% da receita.`,
      acao: "Revise a permanência: pouca venda não é motivo para cortar sozinho (vinho e prato de ocasião contam), mas é onde o cardápio pode ficar mais simples.",
      impactoMes: null,
      hipotese: false,
      secao: "cardapio"
    });
  }

  if (r.resumo.maiorProduto && r.resumo.maiorProduto.participacao >= LIMITE_DEPENDENCIA) {
    lista.push({
      id: "dependencia",
      tom: "info",
      titulo: `${r.resumo.maiorProduto.produto} é ${pct(r.resumo.maiorProduto.participacao)} da receita`,
      detalhe: "O faturamento depende de um produto só: qualquer mudança nele mexe no resultado inteiro.",
      acao: "Acompanhe o preço e o volume desse produto de perto antes de qualquer promoção ou reajuste.",
      impactoMes: null,
      hipotese: false,
      secao: "cardapio"
    });
  }

  return lista
    .sort((a, b) => ordemTom[a.tom] - ordemTom[b.tom] || Math.abs(b.impactoMes ?? 0) - Math.abs(a.impactoMes ?? 0))
    .slice(0, MAX_INSIGHTS_CARDAPIO);
}
