/**
 * Leitura tolerante do que está gravado no cenário. JSON fora do formato (edição manual no banco, versão antiga) não
 * derruba a tela: vira o padrão, MAS a troca é sinalizada (`reparado`), porque o próximo salvamento apagaria o original
 * sem ninguém ver.
 */

import { caixaPadrao, type CaixaPremissas } from "./planejamento-caixa.js";
import { caixaSchema, gastosSchema, ordenadas, premissasSchema } from "./planejamento-cenario-schema.js";
import { GRUPOS_DE_GASTO, type LinhaDeGasto } from "./planejamento-gastos.js";
import { premissasNeutras, type PremissasDoMes } from "./planejamento-projecao.js";

export type Lido<T> = { valor: T; reparado: boolean };

export const AVISO_PREMISSAS = "As premissas gravadas estavam inválidas e foram trocadas pelo padrão: confira antes de salvar.";
export const AVISO_CAIXA = "As premissas de caixa gravadas estavam inválidas e foram trocadas pelo padrão: confira antes de salvar.";
export const AVISO_GASTOS = "Há linhas de gasto gravadas fora do formato e ajustadas na leitura: confira os valores antes de salvar.";

export function lerPremissas(bruto: unknown): Lido<PremissasDoMes[]> {
  const lidas = premissasSchema.safeParse(bruto);
  return lidas.success ? { valor: ordenadas(lidas.data), reparado: false } : { valor: premissasNeutras(), reparado: true };
}

/** Caixa nulo é legítimo (cenário criado antes do regime de caixa): usa o padrão sem acusar reparo. */
export function lerCaixa(bruto: unknown): Lido<CaixaPremissas> {
  if (bruto === null || bruto === undefined) return { valor: caixaPadrao(), reparado: false };
  const lida = caixaSchema.safeParse(bruto);
  return lida.success ? { valor: lida.data, reparado: false } : { valor: caixaPadrao(), reparado: true };
}

const TETO_FIXO = 1_000_000_000;

export function lerLinha(g: { grupo: string; nome: string; modo: string; valores: unknown; pagoNoMes: unknown }): Lido<LinhaDeGasto> {
  const pagoNoMes = Number(g.pagoNoMes);
  const lida = gastosSchema.safeParse([{ grupo: g.grupo, nome: g.nome, modo: g.modo, valores: g.valores, pagoNoMes }]);
  if (lida.success) return { valor: lida.data[0], reparado: false };
  const bruto = Array.isArray(g.valores) ? g.valores : [];
  const modo = g.modo === "PERCENTUAL" ? "PERCENTUAL" : "FIXO";
  return {
    reparado: true,
    valor: {
      grupo: (GRUPOS_DE_GASTO as readonly string[]).includes(g.grupo) ? (g.grupo as LinhaDeGasto["grupo"]) : "OUTROS",
      nome: g.nome.slice(0, 60),
      modo,
      pagoNoMes: Number.isFinite(pagoNoMes) ? Math.min(Math.max(pagoNoMes, 0), 1) : 1,
      valores: Array.from({ length: 12 }, (_, i) => {
        const n = Number(bruto[i]);
        if (!Number.isFinite(n) || n < 0) return 0;
        // Percentual acima de 100% é erro de digitação, não "100%": zera em vez de inventar um custo enorme.
        if (modo === "PERCENTUAL") return n > 1 ? 0 : n;
        return Math.min(n, TETO_FIXO);
      })
    }
  };
}
