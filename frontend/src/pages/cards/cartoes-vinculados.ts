// Cartões vinculados (físico/virtual) dentro de uma fatura: helpers puros da tela.

export type FinalParaTela = { id: string; label: string; last4Digits: string; kind: string };

/** "todos", "sem" (ainda sem cartão definido) ou o id de um final. */
export type FiltroDeCartao = string;

export function tipoDoFinal(kind: string): string {
  if (kind === "VIRTUAL") return "Virtual";
  if (kind === "PHYSICAL") return "Físico";
  return kind;
}

export function rotuloDoFinal(final: FinalParaTela): string {
  return `${final.label} ·· ${final.last4Digits}`;
}

export function filtrarLinhas<T extends { cardFinalId: string | null }>(linhas: T[], filtro: FiltroDeCartao): T[] {
  if (filtro === "todos") return linhas;
  if (filtro === "sem") return linhas.filter((linha) => !linha.cardFinalId);
  return linhas.filter((linha) => linha.cardFinalId === filtro);
}

export function transicaoDeSelecao(atual: ReadonlySet<string>, ids: string[], marcar: boolean): Set<string> {
  const proximo = new Set(atual);
  for (const id of ids) {
    if (marcar) proximo.add(id);
    else proximo.delete(id);
  }
  return proximo;
}
