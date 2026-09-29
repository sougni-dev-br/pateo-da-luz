// Distribuição do fundo de reserva: quais linhas do formulário vão de fato para o
// servidor. O total mostrado e o confirmado são a soma destas — nunca das que ficam de fora.

export type ItemDistribuicao = { employeeId: string; valor: string; descricao: string };

export const valorDoItem = (valor: string): number => {
  const n = Number(valor.trim().replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

/** Por que a linha fica de fora; null = vai ser enviada. */
export function problemaDoItem(item: ItemDistribuicao): string | null {
  const temValor = item.valor.trim() !== "";
  const valor = valorDoItem(item.valor);
  if (!item.employeeId && !temValor) return "linha vazia: fica de fora";
  if (!item.employeeId) return "falta escolher o funcionário";
  if (!temValor) return "falta o valor";
  if (!(valor > 0)) return "o valor precisa ser maior que zero";
  return null;
}

export function resumirDistribuicao(itens: ItemDistribuicao[]) {
  const validos = itens.filter((i) => problemaDoItem(i) === null);
  const total = Math.round(validos.reduce((a, i) => a + valorDoItem(i.valor), 0) * 100) / 100;
  return { validos, total, foraDaConta: itens.length - validos.length };
}
