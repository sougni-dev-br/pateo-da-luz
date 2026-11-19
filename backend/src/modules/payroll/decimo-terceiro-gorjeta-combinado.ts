// 13º de quem tem salário combinado: diferença da GORJETA INTEGRAL — regras puras (sem banco).
//
// O extrato do 13º da contabilidade já paga a carteira e a gorjeta DECLARADA (dentro da rubrica
// "MEDIA VALOR 13o ADIANTADO"). A diferença do combinado (combinado − base) é somada à parte (decimo-terceiro-combinado.ts).
// Decisão do Eli (18/11/2026): o 13º também soma a diferença entre a gorjeta integral (apuração do ERP) e a declarada.
//
// Reaproveita a conta dos sem registro (calcularDecimoTerceiroSR): "variável" de cada mês apurado = gorjeta integral − declarada
// (a declarada é a média mensal que o extrato já pagou, tirada da própria rubrica). A média dessas variáveis (nunca negativa)
// entra como (diferença do combinado + média) ÷ 12 × avos ÷ 2, igual à regra da contabilidade.

import { mesesDe13 } from "./rescisao-verbas-opcionais.js";
import { avosEMedias, type Decimo13SR } from "./decimo-terceiro-sr.js";
import { chaveDoMes, informadasGuardadas, valorDoMesDaGorjeta } from "./ferias-combinado.js";

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

// Diferença da gorjeta no 13º do combinado. Os avos e a média são os do ANO TODO (desde a admissão), não os do combinado: o extrato
// divide a gorjeta declarada por todos os meses até outubro e paga 12 avos, então a mesma base evita pagar a mais ou a menos.
// Mês em que a pessoa não participava da gorjeta precisa ser INFORMADO com o valor que a contabilidade usou (diferença zero): mês sem valor
// fica FORA da média, que então sai maior que a da contabilidade. O serviço avisa (mesesSemGorjetaInformada) quando falta algum.
export type DiferencaDaGorjeta = { avos: number; avosParcela1: number; mediaParcela1: number; mediaFinal: number; parcela1: number; total: number };

// Meses de janeiro a outubro em que a pessoa tem avo e a gorjeta não tem valor (nem apuração nem informado): ficam fora da média.
export function mesesSemGorjetaInformada(e: { ano: number; inicio: Date | null; diasAfastados?: ReadonlySet<string>; mesesApurados: ReadonlySet<number> }): number[] {
  if (!e.inicio) return [];
  return mesesDe13(e.inicio, new Date(Date.UTC(e.ano, 9, 31)), e.diasAfastados).meses.filter((m) => !e.mesesApurados.has(m));
}

export function diferencaDaGorjeta(e: {
  ano: number; inicio: Date | null; diasAfastados?: ReadonlySet<string>;
  integralPorMes: ReadonlyMap<number, number>; declaradaMensal: number; mesesApurados: ReadonlySet<number>;
}): DiferencaDaGorjeta | null {
  const base = avosEMedias({
    ano: e.ano, inicio: e.inicio, desligamento: null, diasAfastados: e.diasAfastados, mesesApurados: e.mesesApurados,
    variaveis: variaveisDaDiferencaDaGorjeta(e.integralPorMes, e.declaradaMensal, e.mesesApurados),
  });
  if (!base) return null;
  return {
    avos: base.avos, avosParcela1: base.avosParcela1, mediaParcela1: round2(base.media1), mediaFinal: round2(base.mediaFinal),
    parcela1: round2(base.media1 / 12 * base.avosParcela1 / 2), total: round2(base.mediaFinal / 12 * base.avos),
  };
}

const br = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// O 13º do combinado = diferença do salário (avos do combinado) + diferença da gorjeta (avos do ano). A 2ª parcela é o resto.
export function somarGorjeta(doSalario: Decimo13SR, g: DiferencaDaGorjeta): Decimo13SR {
  const parcela1 = round2(doSalario.parcela1 + g.parcela1);
  const total = round2(doSalario.total + g.total);
  return {
    ...doSalario, mediaParcela1: g.mediaParcela1, mediaFinal: g.mediaFinal, parcela1, total, parcela2: round2(total - parcela1),
    memoria: `${doSalario.memoria} · gorjeta acima da que o extrato já pagou: média ${br(g.mediaParcela1)} → 1ª + ${br(g.parcela1)} (${g.avosParcela1} avos), 13º + ${br(g.total)} (${g.avos} avos)`,
  };
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
// informada à mão (tabela/férias; vale sobre a apuração do ERP) > apuração do ERP, esta só a partir do corte
// (GORJETA_ERP_VALE_A_PARTIR_DE): antes dele o mês sem informado sai da média (o aviso de "sem gorjeta em" do serviço já o lista).
// O mês informado vira "mês apurado" para entrar na média.
export function gorjetaIntegralDoCombinado(a: {
  ano: number; apuracao: ReadonlyMap<number, number>; apurados: ReadonlySet<number>; doDecimo: ReadonlyMap<number, number>; dasFerias: ReadonlyMap<number, number>;
}): { integralPorMes: Map<number, number>; mesesApurados: Set<number>; mesesDasFerias: number[] } {
  const integralPorMes = new Map<number, number>();
  const mesesApurados = new Set<number>();
  const mesesDasFerias: number[] = [];
  const meses = new Set<number>([...a.apuracao.keys(), ...a.apurados, ...a.dasFerias.keys(), ...a.doDecimo.keys()]);
  for (const mes of [...meses].sort((x, y) => x - y)) {
    if (a.doDecimo.has(mes)) {
      integralPorMes.set(mes, a.doDecimo.get(mes) as number);
      mesesApurados.add(mes);
      continue;
    }
    const v = valorDoMesDaGorjeta({
      chave: chaveDoMes(a.ano, mes), apuracao: a.apurados.has(mes) ? a.apuracao.get(mes) ?? 0 : null, informada: a.dasFerias.get(mes) ?? null,
    });
    if (v.origem === "INFORMADA") {
      integralPorMes.set(mes, v.valor as number);
      mesesApurados.add(mes);
      mesesDasFerias.push(mes);
    } else if (v.origem === "APURACAO") {
      integralPorMes.set(mes, v.valor as number);
      mesesApurados.add(mes);
    }
  }
  return { integralPorMes, mesesApurados, mesesDasFerias };
}
