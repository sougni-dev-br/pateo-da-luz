import { normalizeText } from "../../shared/utils/normalize-text.js";

/**
 * Codigo da unidade como ele deve ser gravado: maiusculas, sem espacos.
 * O acento fica ("MÇ" e o codigo em uso para maco).
 */
export function normalizeUnitCode(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, "").toUpperCase();
  return text || null;
}

/**
 * Chave de comparacao usada para barrar duplicata na criacao.
 *
 * O @unique de "code" so pega grafia identica, entao "Maço" e "MACO" entravam
 * como duas unidades. Comparar pela forma sem acento e sem caixa fecha essa
 * porta — a lista tinha 20 unidades para 14 unidades reais, com BALD/BALDE/BDE
 * e PCT/PCTE/PACTE convivendo.
 *
 * Sinonimo de verdade ("Pacote" x "Pacotinho") nenhuma regra automatica pega;
 * para esse caso o que vale e a lista curta e a permissao de quem cria.
 */
export function unitMatchKey(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = normalizeText(String(value)).replace(/\s+/g, "");
  return normalized || null;
}
