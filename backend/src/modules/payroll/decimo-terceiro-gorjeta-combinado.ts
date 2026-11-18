// 13º de quem tem salário combinado: diferença da GORJETA INTEGRAL — regras puras (sem banco).
//
// O extrato do 13º da contabilidade já paga a carteira e a gorjeta DECLARADA (dentro da rubrica
// "MEDIA VALOR 13o ADIANTADO"). A diferença do combinado (combinado − base) é somada à parte (decimo-terceiro-combinado.ts).
// Decisão do Eli (18/11/2026): o 13º também soma a diferença entre a gorjeta integral (apuração do ERP) e a declarada.
//
// Reaproveita a conta dos sem registro (calcularDecimoTerceiroSR): "variável" de cada mês apurado = gorjeta integral − declarada
// (a declarada é a média mensal que o extrato já pagou, tirada da própria rubrica). A média dessas variáveis (nunca negativa)
// entra como (diferença do combinado + média) ÷ 12 × avos ÷ 2, igual à regra da contabilidade.

const round2 = (v: number) => Math.round(v * 100) / 100;

export const DESCRICAO_COMBINADO_E_GORJETA = "diferença do salário combinado e da gorjeta integral";

export type MediaValorExtrato = { valor: number; avos: number };

const brToNumber = (v: string) => Number(v.replace(/\./g, "").replace(",", "."));

// Rubrica "834 MEDIA VALOR 13o ADIANTADO P <valor> <avos>" do bloco de uma pessoa no extrato do 13º (1ª parcela).
export function lerMediaValor13(body: string): MediaValorExtrato | null {
  const m = body.match(/MEDIA VALOR 13[oº°]?\s+ADIANTADO\s+P\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s+(\d+(?:,\d+)?)/i);
  if (!m) return null;
  const valor = brToNumber(m[1]), avos = brToNumber(m[2]);
  return Number.isFinite(valor) && Number.isFinite(avos) ? { valor, avos } : null;
}

// A 1ª parcela do extrato = média ÷ 12 × avos ÷ 2, então a média mensal que ele pagou = valor × 24 ÷ avos.
export function mediaDeclaradaMensal(m: MediaValorExtrato): number {
  return m.avos > 0 ? round2((m.valor * 24) / m.avos) : 0;
}

// Variável de cada mês apurado: gorjeta integral − declarada. Mês apurado sem gorjeta da pessoa conta como zero (negativo
// aqui); a média final nunca fica abaixo de zero (calcularDecimoTerceiroSR), então nunca se desconta do que o extrato pagou.
export function variaveisDaDiferencaDaGorjeta(
  integralPorMes: ReadonlyMap<number, number>, declaradaMensal: number, mesesApurados: ReadonlySet<number>,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const mes of [...mesesApurados].sort((a, b) => a - b)) out.set(mes, round2((integralPorMes.get(mes) ?? 0) - declaradaMensal));
  return out;
}
