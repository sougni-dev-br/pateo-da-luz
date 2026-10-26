// Chave de justificativa de um lançamento obrigatório de fornecedor. Igual à que o
// backend usa (exigencias-do-fornecedor.ts): supplier:<fornecedor>:<lançamento>.
export function chaveDaExigencia(supplierId: string, exigenciaId: string): string {
  return `supplier:${supplierId}:${exigenciaId}`;
}
