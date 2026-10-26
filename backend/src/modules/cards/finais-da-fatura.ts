// Cartões vinculados (finais) de uma fatura.
//
// A fatura do banco é uma só, mas traz mais de um cartão (ex.: físico e virtual).
// Cada linha pode apontar para um final; a que ainda não foi classificada fica
// em "não definido" (cardFinalId nulo). Aqui ficam as contas puras, testáveis
// sem banco: subtotal por final e a comparação com o total do extrato.

export type FinalDoCartao = {
  id: string;
  label: string;
  last4Digits: string;
  kind: string;
  isActive: boolean;
};

export type LinhaParaSubtotal = {
  cardFinalId: string | null;
  value: number | string | { toString(): string };
};

export type SubtotalDoFinal = {
  /** null = itens ainda sem cartão definido. */
  cardFinalId: string | null;
  itens: number;
  total: number;
};

export type TotalDeclarado = {
  cardFinalId: string;
  statedAmount: number | string | { toString(): string };
};

export type ConferenciaDoFinal = {
  cardFinalId: string;
  calculado: number;
  declarado: number;
  diferenca: number;
};

function emCentavos(valor: number | string | { toString(): string }): number {
  return Math.round(Number(valor.toString()) * 100);
}

function deCentavos(centavos: number): number {
  return centavos / 100;
}

export function subtotaisPorFinal(linhas: LinhaParaSubtotal[], finais: FinalDoCartao[]): SubtotalDoFinal[] {
  const acumulado = new Map<string | null, { itens: number; centavos: number }>();
  for (const linha of linhas) {
    const chave = linha.cardFinalId ?? null;
    const atual = acumulado.get(chave) ?? { itens: 0, centavos: 0 };
    acumulado.set(chave, { itens: atual.itens + 1, centavos: atual.centavos + emCentavos(linha.value) });
  }

  const resultado: SubtotalDoFinal[] = [];
  for (const final of finais) {
    const soma = acumulado.get(final.id);
    if (!final.isActive && !soma) continue;
    resultado.push({ cardFinalId: final.id, itens: soma?.itens ?? 0, total: deCentavos(soma?.centavos ?? 0) });
  }
  const semFinal = acumulado.get(null);
  if (semFinal) resultado.push({ cardFinalId: null, itens: semFinal.itens, total: deCentavos(semFinal.centavos) });
  return resultado;
}

export function divergenciasDeExtrato(subtotais: SubtotalDoFinal[], declarados: TotalDeclarado[]): ConferenciaDoFinal[] {
  const divergentes: ConferenciaDoFinal[] = [];
  for (const declarado of declarados) {
    const calculadoCentavos = emCentavos(
      subtotais.find((s) => s.cardFinalId === declarado.cardFinalId)?.total ?? 0
    );
    const declaradoCentavos = emCentavos(declarado.statedAmount);
    if (calculadoCentavos === declaradoCentavos) continue;
    divergentes.push({
      cardFinalId: declarado.cardFinalId,
      calculado: deCentavos(calculadoCentavos),
      declarado: deCentavos(declaradoCentavos),
      diferenca: deCentavos(calculadoCentavos - declaradoCentavos)
    });
  }
  return divergentes;
}
