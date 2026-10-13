// Leitura analítica do desperdício: o que a loja precisa enxergar para agir (quanto, por quê, onde, quando,
// o que repete e quão confiável é o registro). Função pura: a rota busca os dados e esta função só conta.
// Nada aqui escreve em estoque, DRE ou período: o desperdício continua sendo decomposição do CMV.

import { rotuloDoMotivo, somarDias } from "./waste.js";

export type EntradaAnalisada = {
  dia: string;
  /** Id do insumo, ou "dish:<id>" para prato pronto. */
  itemKey: string;
  itemName: string;
  sector: string | null;
  reason: string;
  totalCost: number | null;
  quantity: number;
  unit: string | null;
  registeredById: string;
  createdAt: Date;
  hasPhoto: boolean;
};

export type FaturamentoDoDia = { dia: string; liquido: number; pessoas: number };

export type EntradaDaAnalise = {
  from: string;
  to: string;
  atual: EntradaAnalisada[];
  anterior: EntradaAnalisada[];
  /** Faturamento líquido por dia (atual + anterior). Vazio quando quem lê não vê custos. */
  faturamento: FaturamentoDoDia[];
  comCusto: boolean;
  nomesDasPessoas: Map<string, string>;
  /** Quanto cada insumo foi comprado no período, na unidade do estoque (compras com conversão conhecida). */
  comprados?: Map<string, number>;
  /** Hoje (São Paulo): o dia em andamento ainda pode receber lançamentos, então não conta como "dia sem registro". */
  hoje?: string;
};

export type GrupoAnalisado = {
  chave: string;
  nome: string;
  lancamentos: number;
  valor: number | null;
  semCusto: number;
  /** Mesmo grupo no período anterior de igual tamanho (0 quando não aparecia). */
  anteriorLancamentos: number;
  anteriorValor: number | null;
};

export type ProdutoAnalisado = GrupoAnalisado & {
  /** Em quantos dias diferentes foi lançado: 1 evento grande é diferente de perda que se repete. */
  dias: number;
  /** Soma na unidade do estoque; null quando o item aparece em mais de uma unidade. */
  quantidade: number | null;
  unidade: string | null;
  motivoPrincipal: string;
  motivoPrincipalRotulo: string;
  /** Quanto foi comprado no período (mesma unidade de `quantidade`); null sem compra ou sem unidade única. */
  comprado: number | null;
  /** % do comprado no período que virou perda. Referência, não balanço: parte da perda pode vir de estoque anterior. */
  taxaDePerda: number | null;
};

export type Analise = {
  periodo: { from: string; to: string; dias: number };
  total: { lancamentos: number; valor: number | null; semCusto: number };
  anterior: { from: string; to: string; lancamentos: number; valor: number | null };
  faturamento: { liquido: number; diasComVenda: number; pessoas: number; anteriorLiquido: number; percentual: number | null; percentualAnterior: number | null; porPessoa: number | null } | null;
  porDia: Array<{ dia: string; lancamentos: number; valor: number | null }>;
  porDiaDaSemana: Array<{ diaDaSemana: number; nome: string; lancamentos: number; valor: number | null; ocorrencias: number }>;
  porMotivo: GrupoAnalisado[];
  porSetor: GrupoAnalisado[];
  porProduto: ProdutoAnalisado[];
  produtosTotal: number;
  /** Quantos itens, do mais caro para o mais barato, somam 80% do valor (a "cauda" que não vale perseguir). */
  itensPara80: number | null;
  reincidentes: ProdutoAnalisado[];
  porPessoa: Array<{ id: string; nome: string; lancamentos: number }>;
  qualidade: {
    semCusto: number;
    motivoOutro: number;
    retroativos: number;
    semFotoNosMaiores: number;
    diasSemRegistro: number | null;
    diasComVenda: number | null;
  };
};

const NOMES_DA_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const MAX_PRODUTOS = 15;
const MIN_DIAS_PARA_REINCIDIR = 3;
const MAX_REINCIDENTES = 8;
/** Quantos dos maiores lançamentos entram na conferência de "tem foto?". */
const MAIORES_PARA_CONFERIR = 10;
/** Dia do lançamento e dia em que foi digitado: acima disso é registro de memória, menos confiável. */
const DIAS_PARA_SER_RETROATIVO = 1;
const FUSO_SAO_PAULO_MS = 3 * 3_600_000;

const arredondar = (n: number) => Math.round(n * 100) / 100;
const moeda = (n: number, comCusto: boolean) => (comCusto ? arredondar(n) : null);

export function diasEntre(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Período imediatamente anterior, do mesmo tamanho. */
export function periodoAnterior(from: string, to: string): { from: string; to: string } {
  const dias = diasEntre(from, to);
  return { from: somarDias(from, -dias), to: somarDias(from, -1) };
}

const diaDigitado = (criadoEm: Date) => new Date(criadoEm.getTime() - FUSO_SAO_PAULO_MS).toISOString().slice(0, 10);

function agrupar(
  atual: EntradaAnalisada[],
  anterior: EntradaAnalisada[],
  chave: (e: EntradaAnalisada) => string,
  nome: (e: EntradaAnalisada) => string,
  comCusto: boolean,
): GrupoAnalisado[] {
  const anteriores = new Map<string, { lancamentos: number; valor: number }>();
  for (const e of anterior) {
    const k = chave(e);
    const a = anteriores.get(k) ?? { lancamentos: 0, valor: 0 };
    anteriores.set(k, { lancamentos: a.lancamentos + 1, valor: a.valor + (e.totalCost ?? 0) });
  }
  const grupos = new Map<string, { nome: string; lancamentos: number; valor: number; semCusto: number }>();
  for (const e of atual) {
    const k = chave(e);
    const g = grupos.get(k) ?? { nome: nome(e), lancamentos: 0, valor: 0, semCusto: 0 };
    grupos.set(k, { nome: g.nome, lancamentos: g.lancamentos + 1, valor: g.valor + (e.totalCost ?? 0), semCusto: g.semCusto + (e.totalCost == null ? 1 : 0) });
  }
  return [...grupos.entries()]
    .map(([k, g]) => {
      const ant = anteriores.get(k) ?? { lancamentos: 0, valor: 0 };
      return {
        chave: k,
        nome: g.nome,
        lancamentos: g.lancamentos,
        valor: moeda(g.valor, comCusto),
        semCusto: comCusto ? g.semCusto : 0,
        anteriorLancamentos: ant.lancamentos,
        anteriorValor: moeda(ant.valor, comCusto),
      };
    })
    .sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0) || b.lancamentos - a.lancamentos || a.nome.localeCompare(b.nome, "pt-BR"));
}

function produtosAnalisados(atual: EntradaAnalisada[], anterior: EntradaAnalisada[], comCusto: boolean, comprados: Map<string, number>): ProdutoAnalisado[] {
  const base = agrupar(atual, anterior, (e) => e.itemKey, (e) => e.itemName, comCusto);
  return base.map((grupo) => {
    const linhas = atual.filter((e) => e.itemKey === grupo.chave);
    const unidades = new Set(linhas.map((l) => l.unit ?? ""));
    const porMotivo = new Map<string, number>();
    for (const l of linhas) porMotivo.set(l.reason, (porMotivo.get(l.reason) ?? 0) + 1);
    // Empate: o primeiro na ordem de chegada; o que importa é o motivo que mais se repete.
    const [motivo] = [...porMotivo.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["OTHER"];
    const quantidade = unidades.size === 1 ? Math.round(linhas.reduce((s, l) => s + l.quantity, 0) * 1e6) / 1e6 : null;
    const comprado = comCusto && quantidade != null ? comprados.get(grupo.chave) ?? null : null;
    return {
      ...grupo,
      dias: new Set(linhas.map((l) => l.dia)).size,
      quantidade,
      unidade: unidades.size === 1 ? ([...unidades][0] || null) : null,
      comprado: comprado != null && comprado > 0 ? Math.round(comprado * 1e6) / 1e6 : null,
      taxaDePerda: comprado != null && comprado > 0 && quantidade != null ? Math.round((quantidade / comprado) * 1000) / 10 : null,
      motivoPrincipal: motivo,
      motivoPrincipalRotulo: rotuloDoMotivo(motivo),
    };
  });
}

function itensAte80(produtos: Array<{ valor: number | null }>, total: number): number | null {
  if (!(total > 0)) return null;
  let soma = 0;
  let n = 0;
  for (const p of produtos) {
    soma += p.valor ?? 0;
    n += 1;
    if (soma >= total * 0.8) return n;
  }
  return n;
}

export function analisarDesperdicio(entrada: EntradaDaAnalise): Analise {
  const { from, to, atual, anterior, comCusto } = entrada;
  const dias = diasEntre(from, to);
  const ant = periodoAnterior(from, to);

  const valorAtual = atual.reduce((s, e) => s + (e.totalCost ?? 0), 0);
  const valorAnterior = anterior.reduce((s, e) => s + (e.totalCost ?? 0), 0);

  const porDiaMap = new Map<string, { lancamentos: number; valor: number }>();
  for (const e of atual) {
    const d = porDiaMap.get(e.dia) ?? { lancamentos: 0, valor: 0 };
    porDiaMap.set(e.dia, { lancamentos: d.lancamentos + 1, valor: d.valor + (e.totalCost ?? 0) });
  }
  const porDia = Array.from({ length: dias }, (_, i) => {
    const dia = somarDias(from, i);
    const d = porDiaMap.get(dia);
    return { dia, lancamentos: d?.lancamentos ?? 0, valor: moeda(d?.valor ?? 0, comCusto) };
  });

  const porSemana = NOMES_DA_SEMANA.map((nome, diaDaSemana) => ({ diaDaSemana, nome, lancamentos: 0, valor: 0, ocorrencias: 0 }));
  for (const { dia, lancamentos, valor } of porDia) {
    const s = porSemana[new Date(`${dia}T00:00:00Z`).getUTCDay()];
    s.ocorrencias += 1;
    s.lancamentos += lancamentos;
    s.valor += valor ?? 0;
  }
  // Soma por dia da semana; `ocorrencias` diz quantos desses dias cabem no período, para a tela comparar médias.
  const porDiaDaSemana = porSemana.map((s) => ({ ...s, valor: moeda(s.valor, comCusto) }));

  const todosProdutos = produtosAnalisados(atual, anterior, comCusto, entrada.comprados ?? new Map());
  const reincidentes = todosProdutos
    .filter((p) => p.dias >= MIN_DIAS_PARA_REINCIDIR)
    .sort((a, b) => b.dias - a.dias || (b.valor ?? 0) - (a.valor ?? 0) || b.lancamentos - a.lancamentos)
    .slice(0, MAX_REINCIDENTES);

  const pessoas = new Map<string, number>();
  for (const e of atual) pessoas.set(e.registeredById, (pessoas.get(e.registeredById) ?? 0) + 1);
  const porPessoa = [...pessoas.entries()]
    .map(([id, lancamentos]) => ({ id, nome: entrada.nomesDasPessoas.get(id) ?? "Usuário removido", lancamentos }))
    .sort((a, b) => b.lancamentos - a.lancamentos || a.nome.localeCompare(b.nome, "pt-BR"));

  const diasComRegistro = new Set(atual.map((e) => e.dia));
  const vendaPorDia = new Map(entrada.faturamento.map((f) => [f.dia, f]));
  const diasDoAtual = porDia.map((d) => d.dia);
  const diasComVenda = comCusto ? diasDoAtual.filter((d) => (vendaPorDia.get(d)?.liquido ?? 0) > 0) : [];
  const diasConferiveis = diasComVenda.filter((d) => d !== entrada.hoje);

  const liquidoAtual = diasDoAtual.reduce((s, d) => s + (vendaPorDia.get(d)?.liquido ?? 0), 0);
  const pessoasAtendidas = diasDoAtual.reduce((s, d) => s + (vendaPorDia.get(d)?.pessoas ?? 0), 0);
  const liquidoAnterior = entrada.faturamento
    .filter((f) => f.dia >= ant.from && f.dia <= ant.to)
    .reduce((s, f) => s + f.liquido, 0);

  // Maiores lançamentos sem foto: é onde a prova mais importa (o aviso do dia nasce deles).
  const maiores = [...atual].sort((a, b) => (b.totalCost ?? 0) - (a.totalCost ?? 0)).slice(0, MAIORES_PARA_CONFERIR).filter((e) => (e.totalCost ?? 0) > 0);

  return {
    periodo: { from, to, dias },
    total: { lancamentos: atual.length, valor: moeda(valorAtual, comCusto), semCusto: comCusto ? atual.filter((e) => e.totalCost == null).length : 0 },
    anterior: { from: ant.from, to: ant.to, lancamentos: anterior.length, valor: moeda(valorAnterior, comCusto) },
    faturamento: comCusto
      ? {
          liquido: arredondar(liquidoAtual),
          diasComVenda: diasComVenda.length,
          pessoas: pessoasAtendidas,
          anteriorLiquido: arredondar(liquidoAnterior),
          percentual: liquidoAtual > 0 && valorAtual > 0 ? Math.round((valorAtual / liquidoAtual) * 10000) / 100 : null,
          percentualAnterior: liquidoAnterior > 0 && valorAnterior > 0 ? Math.round((valorAnterior / liquidoAnterior) * 10000) / 100 : null,
          porPessoa: pessoasAtendidas > 0 && valorAtual > 0 ? arredondar(valorAtual / pessoasAtendidas) : null,
        }
      : null,
    porDia,
    porDiaDaSemana,
    porMotivo: agrupar(atual, anterior, (e) => e.reason, (e) => rotuloDoMotivo(e.reason), comCusto),
    porSetor: agrupar(atual, anterior, (e) => e.sector ?? "Sem setor", (e) => e.sector ?? "Sem setor", comCusto),
    porProduto: todosProdutos.slice(0, MAX_PRODUTOS),
    produtosTotal: todosProdutos.length,
    itensPara80: comCusto ? itensAte80(todosProdutos, valorAtual) : null,
    reincidentes,
    porPessoa,
    qualidade: {
      semCusto: comCusto ? atual.filter((e) => e.totalCost == null).length : 0,
      motivoOutro: atual.filter((e) => e.reason === "OTHER").length,
      retroativos: atual.filter((e) => diasEntre(e.dia, diaDigitado(e.createdAt)) - 1 > DIAS_PARA_SER_RETROATIVO).length,
      semFotoNosMaiores: comCusto ? maiores.filter((e) => !e.hasPhoto).length : 0,
      diasSemRegistro: comCusto ? diasConferiveis.filter((d) => !diasComRegistro.has(d)).length : null,
      diasComVenda: comCusto ? diasConferiveis.length : null,
    },
  };
}
