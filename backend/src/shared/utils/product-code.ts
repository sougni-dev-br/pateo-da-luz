/**
 * Forma canonica do codigo de produto: numero sem zeros a esquerda.
 *
 * "externalCode" e texto e o @unique compara texto, entao "001185" e "1185"
 * conviviam como registros distintos apesar de serem o mesmo numero para quem
 * le a etiqueta — e o mesmo numero para o MAX("externalCode"::int) que gerava
 * o proximo codigo. Canonizar na escrita e o que impede o par voltar.
 *
 * O formato sem padding foi escolhido por ser o da base legada: 802 dos 831
 * codigos ja estavam assim, e a importacao de catalogo casa codigo por
 * igualdade exata de string — repadronizar com padding quebraria toda planilha
 * antiga.
 */
export function normalizeProductCode(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  const text = String(value).trim();
  if (!text) return null;

  if (!/^\d+$/.test(text)) return text;

  const withoutLeadingZeros = text.replace(/^0+/, "");
  return withoutLeadingZeros || "0";
}

/** Codigo a partir do numero da sequencia. */
export function formatProductCode(sequenceValue: number): string {
  return String(sequenceValue);
}
