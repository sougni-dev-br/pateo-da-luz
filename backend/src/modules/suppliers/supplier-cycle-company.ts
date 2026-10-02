/**
 * Empresa da compra gerada no fechamento de um ciclo de fornecedor: a das compras que
 * compõem o ciclo, quando todas são da mesma. Com empresas misturadas (ou nenhuma), fica
 * sem empresa — não há uma só de onde o pagamento sai.
 */
export function empresaDoCiclo(empresasDosItens: Array<string | null>): string | null {
  const empresas = new Set(empresasDosItens);
  if (empresas.size !== 1) return null;
  const [unica] = empresas;
  return unica ?? null;
}
