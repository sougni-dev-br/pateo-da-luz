import type { Insight } from "./agile-analise-insights.js";
import type { Periodo } from "./agile-analise.report.js";

// Buffet por pessoa. O lado da RECEITA vem do PDV (pessoas, ticket por pessoa, faixas de preço). O CUSTO de comida por pessoa não
// existe por prato nem por refeição: quem informa é o dono, mês a mês, e a tela só calcula a margem onde há custo informado.

// Menos pessoas que isso e a faixa é pequena demais para virar aviso (staff, parceria, teste de preço).
export const MIN_PESSOAS_FAIXA_PARA_AVISO = 50;

export type FaixaDeBuffet = {
  produto: string;
  comandas: number;
  pessoas: number;
  receita: number;
  // Receita só das comandas com número de pessoas informado: o ticket por pessoa não pode contar valor sem pessoa.
  receitaComPessoas: number;
};
export type MesDeBuffet = { ano: number; mes: number; comandas: number; pessoas: number; receita: number; receitaComPessoas: number };
export type CustoDoMes = { ano: number; mes: number; valor: number };

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const razao = (parte: number, todo: number) => (todo > 0 ? parte / todo : 0);
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (n: number) => `${(n * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;
const chaveDoMes = (ano: number, mes: number) => `${ano}-${mes}`;

export type LinhaDeMes = {
  ano: number; mes: number; comandas: number; pessoas: number; receita: number; receitaPorPessoa: number;
  custoPorPessoa: number | null; margemPorPessoa: number | null; margemTotal: number | null; margemPct: number | null;
  status: "com-custo" | "sem-custo" | "sem-pessoas";
};
export type LinhaDeFaixa = { produto: string; comandas: number; pessoas: number; receita: number; receitaPorPessoa: number; pctReceita: number };
export type MargemDoPeriodo = { pessoas: number; receita: number; custo: number; margem: number; custoPorPessoa: number; margemPorPessoa: number; margemPct: number | null };
export type CoberturaDoCusto = { pessoasComCusto: number; pessoasTotal: number; pctComCusto: number; mesesSemCusto: number };

type Entrada = {
  periodo: Periodo;
  faixas: FaixaDeBuffet[];
  meses: MesDeBuffet[];
  custos: CustoDoMes[];
  // Os últimos custos informados (qualquer mês), para a pessoa partir do último valor.
  historicoDeCustos: CustoDoMes[];
  // Receita de todos os itens do salão no período: a participação do buffet no faturamento.
  receitaTotalDoSalao: number;
};

export function montarMargemBuffet({ periodo, faixas, meses, custos, historicoDeCustos, receitaTotalDoSalao }: Entrada) {
  const custoDoMes = new Map(custos.map((c) => [chaveDoMes(c.ano, c.mes), c.valor]));

  const mesesOrdenados: LinhaDeMes[] = [...meses].sort((a, b) => a.ano - b.ano || a.mes - b.mes).map((m) => {
    const custo = custoDoMes.get(chaveDoMes(m.ano, m.mes)) ?? null;
    const receitaPorPessoa = razao(m.receitaComPessoas, m.pessoas);
    const status = m.pessoas === 0 ? ("sem-pessoas" as const) : custo === null ? ("sem-custo" as const) : ("com-custo" as const);
    const comCusto = status === "com-custo" && custo !== null;
    const margemPorPessoa = comCusto ? receitaPorPessoa - (custo as number) : null;
    return {
      ano: m.ano,
      mes: m.mes,
      comandas: m.comandas,
      pessoas: m.pessoas,
      receita: round2(m.receita),
      receitaPorPessoa: round2(receitaPorPessoa),
      custoPorPessoa: comCusto ? round2(custo as number) : null,
      margemPorPessoa: margemPorPessoa === null ? null : round2(margemPorPessoa),
      margemTotal: comCusto ? round2(m.receitaComPessoas - (custo as number) * m.pessoas) : null,
      // Sem receita nas comandas com pessoas (só cortesia) não há % do ticket a mostrar: null, não 0%.
      margemPct: comCusto && m.receitaComPessoas > 0 ? round4((m.receitaComPessoas - (custo as number) * m.pessoas) / m.receitaComPessoas) : null,
      status
    };
  });

  const comanda = meses.reduce((s, m) => s + m.comandas, 0);
  const pessoas = meses.reduce((s, m) => s + m.pessoas, 0);
  const receita = meses.reduce((s, m) => s + m.receita, 0);
  const receitaComPessoas = meses.reduce((s, m) => s + m.receitaComPessoas, 0);

  const totalFaixas = faixas.reduce((s, f) => s + f.receita, 0);
  const faixasOrdenadas: LinhaDeFaixa[] = [...faixas]
    .sort((a, b) => b.receita - a.receita || a.produto.localeCompare(b.produto))
    .map((f) => ({
      produto: f.produto,
      comandas: f.comandas,
      pessoas: f.pessoas,
      receita: round2(f.receita),
      receitaPorPessoa: round2(razao(f.receitaComPessoas, f.pessoas)),
      pctReceita: round4(razao(f.receita, totalFaixas))
    }));

  // Margem do período: só os meses COM custo informado e com pessoas. Mês sem custo não vira margem de 100%.
  const base = meses.filter((m) => m.pessoas > 0 && custoDoMes.has(chaveDoMes(m.ano, m.mes)));
  const pessoasComCusto = base.reduce((s, m) => s + m.pessoas, 0);
  const receitaDaBase = base.reduce((s, m) => s + m.receitaComPessoas, 0);
  const custoDaBase = base.reduce((s, m) => s + (custoDoMes.get(chaveDoMes(m.ano, m.mes)) as number) * m.pessoas, 0);
  const margem: MargemDoPeriodo | null = base.length === 0
    ? null
    : {
        pessoas: pessoasComCusto,
        receita: round2(receitaDaBase),
        custo: round2(custoDaBase),
        margem: round2(receitaDaBase - custoDaBase),
        custoPorPessoa: round2(razao(custoDaBase, pessoasComCusto)),
        margemPorPessoa: round2(razao(receitaDaBase - custoDaBase, pessoasComCusto)),
        margemPct: receitaDaBase > 0 ? round4((receitaDaBase - custoDaBase) / receitaDaBase) : null
      };

  const cobertura: CoberturaDoCusto = {
    pessoasComCusto,
    pessoasTotal: pessoas,
    pctComCusto: round4(razao(pessoasComCusto, pessoas)),
    mesesSemCusto: mesesOrdenados.filter((m) => m.status === "sem-custo").length
  };

  const ultimo = [...historicoDeCustos].sort((a, b) => b.ano - a.ano || b.mes - a.mes)[0];
  return {
    periodo,
    buffet: {
      comandas: comanda,
      pessoas,
      receita: round2(receita),
      receitaPorPessoa: round2(razao(receitaComPessoas, pessoas)),
      pctDaReceita: round4(razao(receita, receitaTotalDoSalao))
    },
    faixas: faixasOrdenadas,
    meses: mesesOrdenados,
    margem,
    cobertura,
    referencia: ultimo ? { ano: ultimo.ano, mes: ultimo.mes, valor: ultimo.valor } : null,
    insights: gerarInsights(mesesOrdenados, faixasOrdenadas, margem, cobertura, pessoas)
  };
}

function gerarInsights(
  meses: LinhaDeMes[],
  faixas: LinhaDeFaixa[],
  margem: MargemDoPeriodo | null,
  cobertura: CoberturaDoCusto,
  pessoas: number
): Insight[] {
  const out: Insight[] = [];

  const acima = meses
    .filter((m) => m.status === "com-custo" && m.margemPorPessoa !== null && m.margemPorPessoa < 0)
    .sort((a, b) => (a.margemTotal as number) - (b.margemTotal as number))[0];
  if (acima) {
    out.push({
      id: "custo-acima-do-ticket", tom: "alerta", secao: "margem", hipotese: false, impactoMes: null,
      titulo: `O custo informado de ${String(acima.mes).padStart(2, "0")}/${acima.ano} passa do que cada pessoa paga`,
      detalhe: `Custo de ${brl(acima.custoPorPessoa as number)} por pessoa contra ${brl(acima.receitaPorPessoa)} de ticket: cada pessoa deixa ${brl(-(acima.margemPorPessoa as number))} a menos que o custo da comida.`,
      acao: "Confira o custo informado (é por pessoa, não por refeição de grupo) e o preço da faixa. Se estiver certo, o preço precisa subir ou o custo cair."
    });
  }

  if (margem) {
    const fracas = faixas
      .filter((f) => f.pessoas >= MIN_PESSOAS_FAIXA_PARA_AVISO && f.receitaPorPessoa < margem.custoPorPessoa)
      .sort((a, b) => a.receitaPorPessoa - b.receitaPorPessoa);
    if (fracas[0]) {
      const f = fracas[0];
      out.push({
        id: "faixa-abaixo-do-custo", tom: "alerta", secao: "margem", hipotese: false, impactoMes: null,
        titulo: `${f.produto} rende ${brl(f.receitaPorPessoa)} por pessoa, abaixo do custo de ${brl(margem.custoPorPessoa)}`,
        detalhe: `Em ${f.pessoas.toLocaleString("pt-BR")} pessoas dessa faixa o ticket não cobre o custo médio de comida informado.${fracas.length > 1 ? ` Mais ${fracas.length - 1} ${fracas.length - 1 === 1 ? "faixa está" : "faixas estão"} na mesma situação.` : ""}`,
        acao: "Veja se a faixa é promoção de propósito. Se não for, reveja o preço ou o que ela inclui."
      });
    }
  }

  if (pessoas > 0 && cobertura.pessoasComCusto === 0) {
    out.push({
      id: "sem-custo-informado", tom: "info", secao: "margem", hipotese: false, impactoMes: null,
      titulo: "Sem custo de comida por pessoa informado neste período",
      detalhe: "O sistema não sabe o custo do buffet: ele não existe por prato nem por refeição. Sem o custo informado só dá para ver o lado da receita.",
      acao: "Informe o custo médio de comida por pessoa de cada mês na tabela abaixo (a cozinha ou a contabilidade costumam ter esse número)."
    });
  } else if (pessoas > 0 && cobertura.pctComCusto < 1) {
    out.push({
      id: "custo-parcial", tom: "info", secao: "margem", hipotese: false, impactoMes: null,
      titulo: `Custo por pessoa informado para só ${pct(cobertura.pctComCusto)} das pessoas`,
      detalhe: "A margem calculada vale apenas para os meses com custo informado; os demais ficam de fora, não entram como margem cheia.",
      acao: "Informe o custo dos meses que faltam na tabela abaixo."
    });
  }

  const ordem = { alerta: 0, oportunidade: 1, info: 2 } as const;
  return out.sort((a, b) => ordem[a.tom] - ordem[b.tom]);
}
