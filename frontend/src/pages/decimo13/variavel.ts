// Valor digitado em reais ("638,16", "1.234,50", "638.16") → número, ou null se não for um valor válido (>= 0).
export function lerValorBr(texto: string): number | null {
  const t = texto.trim().replace(/^R\$\s*/, "");
  if (t === "") return null;
  // Com vírgula: ponto é separador de milhar. Sem vírgula: ponto é decimal.
  const normal = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return null;
  const n = Number(normal);
  return Number.isFinite(n) && n <= 1_000_000 ? n : null;
}

export const NOMES_MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro"];
