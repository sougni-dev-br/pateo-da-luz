// 13º de quem tem salário combinado: diferença da GORJETA INTEGRAL — regras puras (sem banco).
//
// O extrato do 13º da contabilidade já paga a carteira e a gorjeta DECLARADA (dentro da rubrica
// "MEDIA VALOR 13o ADIANTADO"). A diferença do combinado (combinado − base) é somada à parte (decimo-terceiro-combinado.ts).
// Decisão do Eli (18/11/2026): o 13º também soma a diferença entre a gorjeta integral (apuração do ERP) e a declarada.
//
// Reaproveita a conta dos sem registro (calcularDecimoTerceiroSR): "variável" de cada mês apurado = gorjeta integral − declarada
// (a declarada é a média mensal que o extrato já pagou, tirada da própria rubrica). A média dessas variáveis (nunca negativa)
// entra como (diferença do combinado + média) ÷ 12 × avos ÷ 2, igual à regra da contabilidade.

import { informadasGuardadas } from "./ferias-combinado.js";

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

// Gorjeta informada à mão no modal de férias ("Complementar pelo combinado") — guardada no título FERIAS
// (details.feriasCombinado.meses, origem INFORMADA, chave AAAA-MM) — também compõe o 13º do ano-base.
// `detalhesDosTitulos` em ordem do mais antigo ao mais novo: o último prevalece no mesmo mês. Só meses 1 a 11.
export function informadasDasFerias(detalhesDosTitulos: ReadonlyArray<unknown>, ano: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const d of detalhesDosTitulos) {
    for (const [chave, valor] of Object.entries(informadasGuardadas(d))) {
      const [a, m] = chave.split("-").map(Number);
      if (a === ano && m >= 1 && m <= 11) out.set(m, round2(valor));
    }
  }
  return out;
}

// Meses da tabela única de gorjeta informada (competência AAAA-MM) que valem para o ano-base: jan a nov. Dezembro e outros anos ficam de fora.
export function informadasDaTabela(linhas: ReadonlyArray<{ competencia: string; valor: number }>, ano: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const l of linhas) {
    const m = /^(\d{4})-(\d{2})$/.exec(l.competencia);
    if (!m || Number(m[1]) !== ano) continue;
    const mes = Number(m[2]);
    if (mes >= 1 && mes <= 11 && Number.isFinite(l.valor)) out.set(mes, round2(l.valor));
  }
  return out;
}

// Gorjeta integral de cada mês do ano-base para a diferença do combinado. Precedência: valor informado na tela do 13º >
// apuração do ERP > informada nas férias (esta só PREENCHE mês sem apuração; vira "mês apurado" para entrar na média).
export function gorjetaIntegralDoCombinado(a: {
  apuracao: ReadonlyMap<number, number>; apurados: ReadonlySet<number>; doDecimo: ReadonlyMap<number, number>; dasFerias: ReadonlyMap<number, number>;
}): { integralPorMes: Map<number, number>; mesesApurados: Set<number>; mesesDasFerias: number[] } {
  const integralPorMes = new Map(a.apuracao);
  const mesesApurados = new Set(a.apurados);
  const mesesDasFerias: number[] = [];
  for (const [mes, valor] of [...a.dasFerias].sort((x, y) => x[0] - y[0])) {
    if (a.apurados.has(mes) || a.doDecimo.has(mes)) continue;
    integralPorMes.set(mes, valor);
    mesesApurados.add(mes);
    mesesDasFerias.push(mes);
  }
  for (const [mes, valor] of a.doDecimo) {
    integralPorMes.set(mes, valor);
    mesesApurados.add(mes);
  }
  return { integralPorMes, mesesApurados, mesesDasFerias };
}
