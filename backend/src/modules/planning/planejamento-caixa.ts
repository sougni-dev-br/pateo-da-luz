/**
 * Regime de caixa do cenário (Planejamento > Cenários, Fase 3c-1). O cenário calcula em COMPETÊNCIA (venda no mês
 * da venda, gasto no mês do gasto); aqui o mesmo resultado é reposicionado no tempo, para mostrar QUANDO o dinheiro
 * entra e sai:
 *
 *   entradas  = vendas do Salão (sem serviço) por forma de pagamento, com prazo de recebimento e taxa de cada forma
 *   saídas    = compras (o CMV pago com o prazo médio dos fornecedores) + gastos (cada linha paga uma parte no mês
 *               e o resto no mês seguinte)
 *   saldo     = saldo inicial + resultado de caixa acumulado
 *
 * Os prazos são aproximados por mês de 30 dias com venda uniforme: uma venda com prazo de L dias cai em parte no
 * mês da venda e em parte nos seguintes. O que vem de antes do ano (recebíveis e contas a pagar herdados de
 * novembro/dezembro do ano-base) é informado à mão nos três primeiros meses.
 *
 * Só se calcula a partir de janeiro SEM BURACO: mês sem projeção (sem base) interrompe a conta, porque as vendas dele
 * alimentariam os meses seguintes. Sem CMV definido não há saída de compras, então o mês fica em branco.
 */

import type { LinhaDeGasto, Resultado } from "./planejamento-gastos.js";
import type { Projecao } from "./planejamento-projecao.js";

export const FORMAS_DE_RECEBIMENTO = ["DINHEIRO", "PIX", "DEBITO", "CREDITO", "VOUCHER"] as const;
export type FormaDeRecebimento = (typeof FORMAS_DE_RECEBIMENTO)[number];

export const ROTULO_DA_FORMA: Record<FormaDeRecebimento, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "PIX",
  DEBITO: "Débito",
  CREDITO: "Crédito",
  VOUCHER: "Voucher"
};

export type FormaDePagamento = {
  forma: FormaDeRecebimento;
  /** Fração das vendas recebida nessa forma (as cinco somam 100%). */
  mix: number;
  /** Dias entre a venda e o dinheiro na conta. */
  prazoDias: number;
  /** Taxa descontada do que se recebe (fração). */
  taxa: number;
};

export type CaixaPremissas = {
  /** Caixa no começo de janeiro (R$). */
  saldoInicial: number;
  formas: FormaDePagamento[];
  /** Prazo médio de pagamento das compras (dias). */
  comprasPrazoDias: number;
  /** Do ano anterior, a cair em jan/fev/mar: entradas (recebíveis) e saídas (contas a pagar), em R$. */
  herdado: { entradas: number[]; saidas: number[] };
};

export const PRAZO_MAXIMO_EM_DIAS = 90;
export const MESES_HERDADOS = 3;
const DIAS_DO_MES = 30;

/** Ponto de partida: SUPOSIÇÕES a conferir e ajustar (mix, prazos e taxas reais vêm da maquininha e do realizado). */
export function caixaPadrao(): CaixaPremissas {
  return {
    saldoInicial: 0,
    formas: [
      { forma: "DINHEIRO", mix: 0.1, prazoDias: 0, taxa: 0 },
      { forma: "PIX", mix: 0.3, prazoDias: 0, taxa: 0 },
      { forma: "DEBITO", mix: 0.25, prazoDias: 1, taxa: 0 },
      { forma: "CREDITO", mix: 0.3, prazoDias: 30, taxa: 0 },
      { forma: "VOUCHER", mix: 0.05, prazoDias: 30, taxa: 0 }
    ],
    comprasPrazoDias: 30,
    herdado: { entradas: Array(MESES_HERDADOS).fill(0) as number[], saidas: Array(MESES_HERDADOS).fill(0) as number[] }
  };
}

/** % do gasto pago no mês, por grupo, para linhas novas (o resto sai no mês seguinte). Suposições editáveis. */
export const PAGO_NO_MES_PADRAO: Record<string, number> = {
  OCUPACAO: 0,
  TARIFAS_PUBLICAS: 0,
  FOLHA: 0.4,
  TRIBUTOS: 0
};

const arredondar = (n: number, casas = 2): number => {
  const f = 10 ** casas;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/**
 * Como uma venda de um mês se espalha pelos meses seguintes com prazo de `dias`: posição k = k meses depois.
 * Venda uniforme no mês de 30 dias; o dinheiro chega `dias` depois de cada venda.
 */
export function distribuicaoPorPrazo(dias: number, meses = 5): number[] {
  return Array.from({ length: meses }, (_, k) => {
    const inicio = DIAS_DO_MES * k;
    const sobreposicao = Math.min(inicio + DIAS_DO_MES, dias + DIAS_DO_MES) - Math.max(inicio, dias);
    return Math.max(0, sobreposicao) / DIAS_DO_MES;
  });
}

export type MesDeCaixa = {
  mes: number;
  entradas: number;
  saidasCompras: number;
  saidasGastos: number;
  saidas: number;
  resultado: number;
  /** Caixa no fim do mês; null se algum mês anterior não pôde ser calculado. */
  saldo: number | null;
  /** Resultado de caixa − lucro em competência: positivo = entrou mais do que se reconheceu. */
  diferencaParaCompetencia: number | null;
};

export type Caixa = {
  /** Um item por mês; null = não calculado (sem base antes dele, ou sem CMV nas compras que pagam nele). */
  meses: (MesDeCaixa | null)[];
  /** Meses de janeiro até o último sem buraco de projeção. */
  mesesCalculados: number[];
  total: {
    /** Soma dos meses calculados; null se algum mês no meio da corrente ficou sem cálculo (a soma teria buraco). */
    entradas: number | null;
    saidas: number | null;
    resultado: number | null;
    saldoFinal: number | null;
    menorSaldo: { mes: number; valor: number } | null;
    /** Quanto de capital de giro falta no pior momento (0 se o caixa nunca fica negativo). */
    necessidadeDeCapital: number | null;
  };
};

/** Parte do gasto de cada linha, depois do abatimento do serviço (que reduz só a folha, pro rata). */
function gastosLiquidosPorLinha(linhas: readonly LinhaDeGasto[], resultado: Resultado, mes: number): number[] {
  const r = resultado.meses[mes - 1];
  if (!r) return linhas.map(() => 0);
  const brutos = r.porLinha;
  const folhaBruta = linhas.reduce((s, l, i) => s + (l.grupo === "FOLHA" ? brutos[i] ?? 0 : 0), 0);
  return linhas.map((l, i) => {
    const bruto = brutos[i] ?? 0;
    if (l.grupo !== "FOLHA" || folhaBruta <= 0) return bruto;
    return bruto - r.abatimentoDoServico * (bruto / folhaBruta);
  });
}

export function montarCaixa(projecao: Projecao, resultado: Resultado, linhas: readonly LinhaDeGasto[], premissas: CaixaPremissas): Caixa {
  // Janeiro em diante sem buraco: o que vem depois de um mês sem projeção depende de vendas que não existem.
  const calculados: number[] = [];
  for (let mes = 1; mes <= 12 && projecao.meses[mes - 1]?.projetado; mes += 1) calculados.push(mes);

  const vendas = projecao.meses.map((m) => m.projetado?.vendas.total ?? 0);
  const cmv = projecao.meses.map((m) => m.cmvValor);
  const liquidos = Array.from({ length: 12 }, (_, i) => gastosLiquidosPorLinha(linhas, resultado, i + 1));

  // % das vendas que vira dinheiro k meses depois, já líquido da taxa de cada forma.
  const recebimento = Array.from({ length: 5 }, () => 0);
  for (const f of premissas.formas) {
    const dist = distribuicaoPorPrazo(f.prazoDias);
    dist.forEach((parte, k) => { recebimento[k] += f.mix * (1 - f.taxa) * parte; });
  }
  const pagamentoDeCompras = distribuicaoPorPrazo(premissas.comprasPrazoDias);

  const meses: (MesDeCaixa | null)[] = Array.from({ length: 12 }, () => null);
  let saldo: number | null = premissas.saldoInicial;
  let menor: { mes: number; valor: number } | null = null;
  let somaEntradas = 0;
  let somaSaidas = 0;
  let somaResultado = 0;
  let algumMesNaoCalculado = false;

  for (const mes of calculados) {
    // Entradas: vendas deste e dos meses anteriores que chegam agora, mais o herdado.
    let entradas = mes <= MESES_HERDADOS ? premissas.herdado.entradas[mes - 1] ?? 0 : 0;
    for (let j = 1; j <= mes; j += 1) entradas += vendas[j - 1] * (recebimento[mes - j] ?? 0);

    // Compras pagas: o CMV de cada mês anterior que vence agora. Sem CMV num desses meses, a saída é desconhecida.
    let compras = 0;
    let semCmv = false;
    for (let j = 1; j <= mes; j += 1) {
      const parte = pagamentoDeCompras[mes - j] ?? 0;
      if (parte <= 0) continue;
      if (cmv[j - 1] === null) semCmv = true;
      else compras += (cmv[j - 1] ?? 0) * parte;
    }
    if (semCmv) {
      algumMesNaoCalculado = true;
      saldo = null;
      continue;
    }

    // Gastos: cada linha paga `pagoNoMes` no mês do gasto e o resto no mês seguinte.
    let gastosPagos = mes <= MESES_HERDADOS ? premissas.herdado.saidas[mes - 1] ?? 0 : 0;
    linhas.forEach((linha, i) => {
      const pago = linha.pagoNoMes ?? 1;
      gastosPagos += liquidos[mes - 1][i] * pago;
      if (mes > 1) gastosPagos += liquidos[mes - 2][i] * (1 - pago);
    });

    const resultadoDoMes = entradas - compras - gastosPagos;
    if (saldo !== null) saldo += resultadoDoMes;
    if (saldo !== null && (menor === null || saldo < menor.valor)) menor = { mes, valor: saldo };
    const lucro = resultado.meses[mes - 1]?.lucro ?? null;

    meses[mes - 1] = {
      mes,
      entradas: arredondar(entradas),
      saidasCompras: arredondar(compras),
      saidasGastos: arredondar(gastosPagos),
      saidas: arredondar(compras + gastosPagos),
      resultado: arredondar(resultadoDoMes),
      saldo: saldo === null ? null : arredondar(saldo),
      diferencaParaCompetencia: lucro === null ? null : arredondar(resultadoDoMes - lucro)
    };
    somaEntradas += entradas;
    somaSaidas += compras + gastosPagos;
    somaResultado += resultadoDoMes;
  }

  const completos = meses.filter((m): m is MesDeCaixa => m !== null);
  // Sem nenhum mês calculado a soma não existe (zero pareceria um caixa que não se mexeu).
  const semSoma = algumMesNaoCalculado || completos.length === 0;
  return {
    meses,
    mesesCalculados: calculados,
    total: {
      entradas: semSoma ? null : arredondar(somaEntradas),
      saidas: semSoma ? null : arredondar(somaSaidas),
      resultado: semSoma ? null : arredondar(somaResultado),
      // Só há saldo/menor saldo quando a corrente de meses não teve buraco: senão o acumulado mentiria.
      saldoFinal: !algumMesNaoCalculado && completos.length > 0 ? completos[completos.length - 1].saldo : null,
      menorSaldo: !algumMesNaoCalculado && menor ? { mes: menor.mes, valor: arredondar(menor.valor) } : null,
      necessidadeDeCapital: !algumMesNaoCalculado && menor ? arredondar(Math.max(0, -menor.valor)) : null
    }
  };
}
