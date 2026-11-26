import type { DiaRitmoMetaCmv } from "../../api/client";

export type PontoAcumulado = { dia: number; valor: number };

/** Soma corrida de um campo, dia a dia. */
export function acumular(dias: DiaRitmoMetaCmv[], campo: "faturamento" | "compras"): PontoAcumulado[] {
  let soma = 0;
  return dias.map((d) => {
    soma += d[campo];
    return { dia: d.dia, valor: Math.round(soma * 100) / 100 };
  });
}

/** Teto de compras até cada dia: faturamento acumulado × meta. */
export function tetoAcumulado(dias: DiaRitmoMetaCmv[], alvoPercentual: number): PontoAcumulado[] {
  return acumular(dias, "faturamento").map((p) => ({ dia: p.dia, valor: Math.round(p.valor * alvoPercentual) / 100 }));
}

/** Quanto uma compra pesa no CMV do mês: compra ÷ faturamento, em pontos percentuais. */
export function pontosDeCmv(compras: number, faturamento: number): number | null {
  if (!(faturamento > 0)) return null;
  return (compras / faturamento) * 100;
}

/** Variação % contra o mês anterior; null quando não há base (anterior zerado). */
export function variacao(atual: number, anterior: number): number | null {
  if (!(anterior > 0)) return null;
  return ((atual - anterior) / anterior) * 100;
}

/** Rótulo do trecho comparado: "1–10 de out." no mês em andamento, "out." no mês fechado. */
export function rotuloDaComparacao(mesAnterior: string, ateODia: number, diasNoMesAnterior: number): string {
  const [a, m] = mesAnterior.split("-").map(Number);
  const nome = new Date(Date.UTC(a, m - 1, 1)).toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" }).replace(".", "");
  return ateODia >= diasNoMesAnterior ? nome : `1–${ateODia} de ${nome}`;
}
