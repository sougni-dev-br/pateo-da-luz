export type Auxiliar<T> = { itens: T[]; falhou: boolean };

/**
 * Cargas de apoio da tela (fornecedores, formas de pagamento, empresas) só servem aos filtros.
 * Se uma falhar, a lista de títulos não pode sumir junto: devolve o que já havia e marca a falha.
 */
export async function carregarAuxiliar<T>(atuais: T[], buscar: () => Promise<T[]>): Promise<Auxiliar<T>> {
  if (atuais.length > 0) return { itens: atuais, falhou: false };
  try {
    return { itens: await buscar(), falhou: false };
  } catch {
    return { itens: atuais, falhou: true };
  }
}

/** "fornecedores", "fornecedores e formas de pagamento", "fornecedores, formas de pagamento e empresas". */
export function avisoDeAuxiliares(falhas: string[]): string | null {
  if (falhas.length === 0) return null;
  const lista = falhas.length === 1 ? falhas[0] : `${falhas.slice(0, -1).join(", ")} e ${falhas[falhas.length - 1]}`;
  return `Não foi possível carregar ${lista}. Os títulos estão na tela, mas os filtros dessas opções podem ficar incompletos. Use "Atualizar" para tentar de novo.`;
}
