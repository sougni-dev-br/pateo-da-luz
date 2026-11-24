import type { PlanejamentoCaixaPremissas, PlanejamentoLinhaDeGasto } from "../../api/client";

// Leitura da régua de prazo da aba Caixa: só para a tela, a partir das premissas que estão sendo digitadas. Usa a mesma
// aproximação do cálculo de caixa do servidor (`distribuicaoPorPrazo` em planejamento-caixa.ts): venda espalhada por
// igual num mês de 30 dias, e o dinheiro chega P dias depois de cada venda. Com P = 45, metade da venda de um mês entra
// no mês seguinte e a outra metade dois meses depois.

export const DIAS_DO_MES = 30;
const PASSO_DA_ESCALA = 15;
const PRAZO_IMEDIATO = 1;
/** Meses acompanhados depois da venda (o prazo máximo aceito é 90 dias, que chega até 3 meses depois). */
const MESES_DA_DISTRIBUICAO = 5;

/** Parte da venda de um mês que entra k meses depois (posição k), para um prazo de `dias`. Igual ao servidor. */
export function distribuicaoPorPrazo(dias: number, meses = MESES_DA_DISTRIBUICAO): number[] {
  const prazo = Math.max(0, dias);
  return Array.from({ length: meses }, (_, k) => {
    const inicio = DIAS_DO_MES * k;
    const sobreposicao = Math.min(inicio + DIAS_DO_MES, prazo + DIAS_DO_MES) - Math.max(inicio, prazo);
    return Math.max(0, sobreposicao) / DIAS_DO_MES;
  });
}

/** Parte das vendas de um mês que só entra no caixa num mês seguinte (qualquer um). */
export const parteForaDoMes = (dias: number): number => 1 - distribuicaoPorPrazo(dias)[0];

export type LeituraDoPrazo = {
  /** Soma do mix (a régua pondera por ela; fora de 100% o cenário nem é calculado). */
  soma: number;
  /** Prazo médio de recebimento ponderado pelo mix, em dias. */
  prazoMedio: number;
  /** Parte das vendas que entra em até 1 dia. */
  imediato: number;
  /** Parte das vendas de cada mês que entra k meses depois (posição 0 = no próprio mês). */
  porMes: number[];
  /** Parte das vendas de cada mês que fica para algum mês seguinte. */
  foraDoMes: number;
  /** Parte que só entra dois meses depois ou mais (prazo acima de 30 dias). */
  alemDoSeguinte: number;
  /** Taxa média das maquininhas, ponderada pelo mix. */
  taxaMedia: number;
  /** Fim da régua, em dias: 30 ou o maior prazo (vendas e compras) arredondado para cima de 15 em 15. */
  escala: number;
};

export function lerPrazos(caixa: PlanejamentoCaixaPremissas): LeituraDoPrazo {
  const soma = caixa.formas.reduce((s, f) => s + f.mix, 0);
  const ponderar = (valor: (f: PlanejamentoCaixaPremissas["formas"][number]) => number) =>
    soma > 0 ? caixa.formas.reduce((s, f) => s + f.mix * valor(f), 0) / soma : 0;
  const porMes = Array.from({ length: MESES_DA_DISTRIBUICAO }, (_, k) => ponderar((f) => distribuicaoPorPrazo(f.prazoDias)[k]));
  const maior = Math.max(0, caixa.comprasPrazoDias, ...caixa.formas.map((f) => f.prazoDias));
  return {
    soma,
    prazoMedio: ponderar((f) => f.prazoDias),
    imediato: ponderar((f) => (f.prazoDias <= PRAZO_IMEDIATO ? 1 : 0)),
    porMes,
    foraDoMes: soma > 0 ? 1 - porMes[0] : 0,
    alemDoSeguinte: porMes.slice(2).reduce((s, v) => s + v, 0),
    taxaMedia: ponderar((f) => f.taxa),
    escala: Math.max(DIAS_DO_MES, Math.ceil(maior / PASSO_DA_ESCALA) * PASSO_DA_ESCALA)
  };
}

const QUANDO: Record<number, string> = { 1: "no mês seguinte", 2: "dois meses depois", 3: "três meses depois", 4: "quatro meses depois" };

/**
 * De cada R$ 100 vendidos num mês, quanto entra em cada mês seguinte, em reais inteiros ("R$ 60 no mês seguinte").
 * Só os meses com pelo menos R$ 1. O arredondamento é por faixa, então a soma pode diferir do total em R$ 1.
 */
export function entradasDosMesesSeguintes(porMes: readonly number[]): { reais: number; quando: string }[] {
  return porMes
    .map((parte, k) => ({ k, reais: Math.round(parte * 100) }))
    .filter(({ k, reais }) => k >= 1 && reais >= 1)
    .map(({ k, reais }) => ({ reais, quando: QUANDO[k] ?? `${k} meses depois` }));
}

/**
 * Parte dos gastos fixos paga no próprio mês, ponderada pelo valor do ano de cada linha (linhas em % das vendas e
 * zeradas não pesam). Sem nenhum valor fixo, a média simples das linhas; sem linhas, null.
 */
export function pagoNoMesMedio(gastos: readonly PlanejamentoLinhaDeGasto[]): number | null {
  if (gastos.length === 0) return null;
  const pago = (l: PlanejamentoLinhaDeGasto) => l.pagoNoMes ?? 1;
  const fixos = gastos.filter((l) => l.modo === "FIXO").map((l) => ({ peso: l.valores.reduce((s, v) => s + Math.max(0, v), 0), pago: pago(l) }));
  const pesoTotal = fixos.reduce((s, f) => s + f.peso, 0);
  if (pesoTotal > 0) return fixos.reduce((s, f) => s + f.peso * f.pago, 0) / pesoTotal;
  return gastos.reduce((s, l) => s + pago(l), 0) / gastos.length;
}

/** A partir daqui (fração do eixo) o rótulo do ponto passa para a esquerda dele: à direita não sobra trilho nem margem. */
export const LIMITE_DO_ROTULO_A_DIREITA = 0.75;

export type LadoDoRotulo = "direita" | "esquerda";

/**
 * De que lado do ponto fica o rótulo ("30 dias", "40% no mês"). Perto do fim do eixo o rótulo vai para a esquerda, para
 * nunca sair do cartão (antes, com prazo = fim do eixo, ele criava rolagem horizontal na tela). Fora do eixo (posição
 * fora de 0–1) também vai para a esquerda.
 */
export function ladoDoRotulo(posicao: number): LadoDoRotulo {
  return posicao > LIMITE_DO_ROTULO_A_DIREITA || posicao < 0 ? "esquerda" : "direita";
}
