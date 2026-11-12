/** Mesmo mínimo do backend: a justificativa da reabertura precisa ter um motivo de verdade. */
export const JUSTIFICATIVA_MINIMA = 10;
export const JUSTIFICATIVA_MAXIMA = 500;

export function justificativaValida(texto: string): boolean {
  const limpo = texto.trim();
  return limpo.length >= JUSTIFICATIVA_MINIMA && limpo.length <= JUSTIFICATIVA_MAXIMA;
}

/** Mensagem de ajuda sob o campo; vazia quando a justificativa já serve. */
export function ajudaDaJustificativa(texto: string): string {
  const tamanho = texto.trim().length;
  if (tamanho >= JUSTIFICATIVA_MINIMA) return "";
  return `Escreva o motivo (faltam ${JUSTIFICATIVA_MINIMA - tamanho} caracteres).`;
}
