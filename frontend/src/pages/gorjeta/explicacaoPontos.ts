// A conta dos pontos de quem não trabalhou o ciclo inteiro, em palavras de quem opera.
// pontos apurados = base × dias computados ÷ dias de referência (26 no mês cheio); o que a
// pessoa trabalhou (previstos) é proporcional aos dias corridos do vínculo no ciclo, e as
// ocorrências (faltas, atestados, férias…) tiram dos previstos.
type Pontuado = {
  kind: "PONTOS" | "FIXO";
  basePoints: number;
  pontosApurados: number;
  pointsAdjustment: number;
  diasElegiveis: number;
  diasPrevistos: number;
  diasReferencia: number;
  diasComputados: number;
};

export type ExplicacaoPontos = { curta: string; longa: string };

const pts = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

export function explicarPontos(p: Pontuado, diasCorridosDoCiclo: number | null): ExplicacaoPontos | null {
  if (p.kind !== "PONTOS" || p.diasReferencia <= 0 || p.diasComputados === p.diasReferencia) return null;
  const conta = `${pts(p.basePoints)} × ${p.diasComputados}/${p.diasReferencia} dias = ${pts(p.pontosApurados)}`;
  const ajuste = p.pointsAdjustment ? ` ${p.pointsAdjustment > 0 ? "+" : "−"} ${pts(Math.abs(p.pointsAdjustment))} de ajuste` : "";
  const motivos: string[] = [];
  if (p.diasPrevistos < p.diasReferencia) {
    const ciclo = diasCorridosDoCiclo ? ` de ${diasCorridosDoCiclo}` : "";
    motivos.push(`entrou ou saiu dentro do ciclo: ${p.diasElegiveis} dias corridos${ciclo} no vínculo, ${p.diasPrevistos} dos ${p.diasReferencia} dias de trabalho`);
  }
  const descontados = p.diasPrevistos - p.diasComputados;
  if (descontados > 0) motivos.push(`${descontados} dia(s) descontado(s) por faltas, atestados, férias, afastamento ou outros`);
  return {
    curta: `${p.diasComputados}/${p.diasReferencia} dias`,
    longa: [`${conta}${ajuste}`, ...motivos].join(". "),
  };
}
