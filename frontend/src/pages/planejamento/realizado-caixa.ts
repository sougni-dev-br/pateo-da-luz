import type { PlanejamentoCaixaPremissas, PlanejamentoGrupoDeGasto, PlanejamentoLinhaDeGasto, PlanejamentoRealizadoDeCaixa } from "../../api/client";

// Aplica o realizado de caixa às premissas do cenário. Cada bloco é escolhido à parte; o que o ERP não mede (prazo e taxa
// das maquininhas) nunca é tocado.

export type BlocosDoCaixa = { mix: boolean; compras: boolean; pagoNoMes: ReadonlySet<PlanejamentoGrupoDeGasto>; herdado: boolean };

export type CaixaPreenchido = { caixa: PlanejamentoCaixaPremissas; gastos: PlanejamentoLinhaDeGasto[]; blocosAplicados: string[] };

export function aplicarRealizadoDeCaixa(
  caixa: PlanejamentoCaixaPremissas,
  gastos: readonly PlanejamentoLinhaDeGasto[],
  dados: PlanejamentoRealizadoDeCaixa,
  escolhidos: BlocosDoCaixa
): CaixaPreenchido {
  let proximoCaixa: PlanejamentoCaixaPremissas = { ...caixa, formas: caixa.formas.map((f) => ({ ...f })), herdado: { entradas: [...caixa.herdado.entradas], saidas: [...caixa.herdado.saidas] } };
  const aplicados: string[] = [];

  if (escolhidos.mix && dados.mix) {
    const mix = dados.mix.formas;
    proximoCaixa = { ...proximoCaixa, formas: proximoCaixa.formas.map((f) => ({ ...f, mix: mix[f.forma] ?? 0 })) };
    aplicados.push("mix");
  }
  if (escolhidos.compras && dados.comprasPrazoDias !== null) {
    proximoCaixa = { ...proximoCaixa, comprasPrazoDias: dados.comprasPrazoDias };
    aplicados.push("compras");
  }
  if (escolhidos.herdado) {
    // Entradas e saídas à parte: o que o ERP não tem lançado num dos lados não apaga o que a pessoa digitou.
    const entradas = dados.herdado.entradas.some((v) => v > 0);
    const saidas = dados.herdado.saidas.some((v) => v > 0);
    proximoCaixa = {
      ...proximoCaixa,
      herdado: { entradas: entradas ? [...dados.herdado.entradas] : proximoCaixa.herdado.entradas, saidas: saidas ? [...dados.herdado.saidas] : proximoCaixa.herdado.saidas }
    };
    if (entradas || saidas) aplicados.push("herdado");
  }

  // O % pago no mês é uma propriedade do prazo do grupo: vale para TODAS as linhas dele.
  let proximosGastos = gastos.map((g) => ({ ...g, valores: [...g.valores] }));
  for (const medida of dados.pagoNoMes) {
    if (!escolhidos.pagoNoMes.has(medida.grupo) || medida.pagoNoMes === null) continue;
    const pago = medida.pagoNoMes;
    if (!proximosGastos.some((g) => g.grupo === medida.grupo)) continue;
    proximosGastos = proximosGastos.map((g) => (g.grupo === medida.grupo ? { ...g, pagoNoMes: pago } : g));
    aplicados.push(`pago:${medida.grupo}`);
  }

  return { caixa: proximoCaixa, gastos: proximosGastos, blocosAplicados: aplicados };
}
