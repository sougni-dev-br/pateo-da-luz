import type { PlanejamentoCaixaPremissas } from "../../api/client";

// Regras de tela do regime de caixa. O servidor revalida tudo; aqui evita-se mandar o que ele recusaria.

const TOLERANCIA_DO_MIX = 0.0005;

export const somaDoMix = (caixa: PlanejamentoCaixaPremissas): number => caixa.formas.reduce((s, f) => s + f.mix, 0);

/** O mix das formas de pagamento fecha em 100%? */
export const mixFecha = (caixa: PlanejamentoCaixaPremissas): boolean => Math.abs(somaDoMix(caixa) - 1) < TOLERANCIA_DO_MIX;
