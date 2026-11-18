// Pesos do buffet: a cozinha anota em kg ("12,35"); o sistema guarda em gramas inteiras.

export const MAX_PESO_G = 200_000;

/** "12,35" ou "12.35" → 12350. Vazio, zero, negativo, texto ou acima do limite → null. */
export function lerKg(texto: string): number | null {
  const limpo = texto.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,3})?$/.test(limpo)) return null;
  const gramas = Math.round(Number(limpo) * 1000);
  return gramas > 0 && gramas <= MAX_PESO_G ? gramas : null;
}

/** 12350 → "12,35 kg". */
export function kgTexto(gramas: number): string {
  return `${(gramas / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg`;
}

/** 12350 → "12,35", para preencher campo de edição. */
export function kgCampo(gramas: number): string {
  return (gramas / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3, useGrouping: false });
}
