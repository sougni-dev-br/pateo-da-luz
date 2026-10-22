// Deslocamento de período para os comparativos da DRE ("mês anterior" e "ano anterior").
//
// `Date#setMonth` NÃO serve para isso: tirar um mês de 31/10 dá "31/09", que o
// JavaScript normaliza para 01/10. O "mês anterior" de outubro passava a ir de
// 01/09 até 01/10 23:59 e engolia o primeiro dia de outubro (em 22/10/2026:
// R$ 841,79 de delivery e R$ 18.088,46 de salão a mais). Na direção contrária,
// o "mês anterior" de setembro terminava em 30/08 e perdia o dia 31.

const ultimoDiaDoMes = (ano: number, mesIndice: number) => new Date(ano, mesIndice + 1, 0).getDate();

/** `true` quando `data` cai no último dia do seu mês. */
function eUltimoDiaDoMes(data: Date): boolean {
  return data.getDate() === ultimoDiaDoMes(data.getFullYear(), data.getMonth());
}

/**
 * Move `data` por `meses` meses mantendo a hora. O dia é limitado ao tamanho do
 * mês de destino; se `data` é o último dia do mês, o resultado também é.
 */
export function deslocarMeses(data: Date, meses: number): Date {
  const alvoTotal = data.getFullYear() * 12 + data.getMonth() + meses;
  const ano = Math.floor(alvoTotal / 12);
  const mesIndice = alvoTotal - ano * 12;
  const maximo = ultimoDiaDoMes(ano, mesIndice);
  const dia = eUltimoDiaDoMes(data) ? maximo : Math.min(data.getDate(), maximo);
  return new Date(ano, mesIndice, dia, data.getHours(), data.getMinutes(), data.getSeconds(), data.getMilliseconds());
}

export type Intervalo = { from: Date; to: Date };

export function intervaloMesAnterior(from: Date, to: Date): Intervalo {
  return { from: deslocarMeses(from, -1), to: deslocarMeses(to, -1) };
}

export function intervaloAnoAnterior(from: Date, to: Date): Intervalo {
  return { from: deslocarMeses(from, -12), to: deslocarMeses(to, -12) };
}
