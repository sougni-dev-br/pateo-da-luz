import type { PlanejamentoCaixaPremissas } from "../../api/client";

// Regras de tela do regime de caixa. O servidor revalida tudo; aqui evita-se mandar o que ele recusaria.

const TOLERANCIA_DO_MIX = 0.0005;

export const somaDoMix = (caixa: PlanejamentoCaixaPremissas): number => caixa.formas.reduce((s, f) => s + f.mix, 0);

/** O mix das formas de pagamento fecha em 100%? */
export const mixFecha = (caixa: PlanejamentoCaixaPremissas): boolean => Math.abs(somaDoMix(caixa) - 1) < TOLERANCIA_DO_MIX;

/** Ponto de partida de um cenário novo (espelha `caixaPadrao` do servidor): SUPOSIÇÕES, não o realizado do Salão. */
const FORMAS_DE_PARTIDA: readonly { forma: string; mix: number; prazoDias: number; taxa: number }[] = [
  { forma: "DINHEIRO", mix: 0.1, prazoDias: 0, taxa: 0 },
  { forma: "PIX", mix: 0.3, prazoDias: 0, taxa: 0 },
  { forma: "DEBITO", mix: 0.25, prazoDias: 1, taxa: 0 },
  { forma: "CREDITO", mix: 0.3, prazoDias: 30, taxa: 0 },
  { forma: "VOUCHER", mix: 0.05, prazoDias: 30, taxa: 0 }
];
const PRAZO_DE_PARTIDA_DAS_COMPRAS = 30;

/** O caixa ainda tem exatamente os valores de partida (nada foi preenchido com o realizado nem editado)? */
export function ehValorDePartida(caixa: PlanejamentoCaixaPremissas): boolean {
  const herdadoZerado = [...caixa.herdado.entradas, ...caixa.herdado.saidas].every((v) => v === 0);
  const formasIguais = caixa.formas.length === FORMAS_DE_PARTIDA.length
    && FORMAS_DE_PARTIDA.every((p, i) => {
      const f = caixa.formas[i];
      return f.forma === p.forma && f.mix === p.mix && f.prazoDias === p.prazoDias && f.taxa === p.taxa;
    });
  return caixa.saldoInicial === 0 && caixa.comprasPrazoDias === PRAZO_DE_PARTIDA_DAS_COMPRAS && herdadoZerado && formasIguais;
}
