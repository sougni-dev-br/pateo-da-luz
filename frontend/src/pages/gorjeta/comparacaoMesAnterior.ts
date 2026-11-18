import type { TipMesAnterior } from "../../api/client";

// Gorjeta da pessoa neste ciclo contra a do mês anterior (o que foi pago no fechamento), com o
// que mudou: pontos, dias trabalhados, valor do ponto, função. Diferença menor que isso é "igual".
const TOLERANCIA_REAIS = 0.5;
const TOLERANCIA_PONTO = 0.001; // 0,1% no valor do ponto
const TOLERANCIA_PRESENCA = 0.005;

type Pessoa = {
  employeeId: string; rateioAmount: number; basePoints: number; diasComputados: number; diasReferencia: number;
  functionName: string | null; tipoCalculo: string; rescisaoPendente: boolean; foraDaGorjeta?: boolean; kind: "PONTOS" | "FIXO";
};

export type Comparacao = {
  tipo: "subiu" | "caiu" | "igual" | "novo";
  delta: number;
  curta: string;
  // Para leitor de tela: a direção por extenso (▲/▼ são lidos como "triângulo").
  rotulo: string;
  longa: string;
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (v: number) => String(Math.round(v * 100) / 100).replace(".", ",");
const pct = (v: number) => `${v > 0 ? "+" : "−"}${num(Math.abs(v) * 100)}%`;

export function variacaoDoPonto(atual: number, anterior: number | null): number | null {
  if (anterior == null || anterior <= 0 || atual <= 0) return null;
  return atual / anterior - 1;
}

export function compararComAnterior(p: Pessoa, valorPontoAtual: number, anterior: TipMesAnterior | null | undefined): Comparacao | null {
  if (!anterior || p.foraDaGorjeta || p.rescisaoPendente || p.tipoCalculo !== "MES" || p.kind !== "PONTOS") return null;
  const antes = anterior.porPessoa[p.employeeId];
  const mes = anterior.label;
  // Quem estava em rescisão ou cota fixa no mês anterior não tem base comparável.
  if (antes && ((antes.tipoCalculo != null && antes.tipoCalculo !== "MES") || (antes.tipo != null && antes.tipo !== "PONTOS"))) return null;
  if (!antes) {
    return { tipo: "novo", delta: p.rateioAmount, curta: "novo", rotulo: "novo: não recebeu gorjeta no mês anterior", longa: `Não recebeu gorjeta em ${mes}. Agora: ${brl(p.rateioAmount)}.` };
  }
  const delta = Math.round((p.rateioAmount - antes.gorjeta) * 100) / 100;
  const motivos: string[] = [];
  if (Math.abs(p.basePoints - antes.pontosBase) > 0.001) motivos.push(`pontos ${num(antes.pontosBase)} → ${num(p.basePoints)}`);
  if (antes.funcao && p.functionName && antes.funcao !== p.functionName) motivos.push(`função ${antes.funcao} → ${p.functionName}`);
  // Presença (dias computados sobre os de referência): ciclos de 28 a 31 dias não contam como mudança.
  if (antes.diasReferencia > 0 && p.diasReferencia > 0
    && Math.abs(p.diasComputados / p.diasReferencia - antes.diasComputados / antes.diasReferencia) > TOLERANCIA_PRESENCA) {
    motivos.push(`presença ${p.diasComputados}/${p.diasReferencia} dias (antes ${antes.diasComputados}/${antes.diasReferencia})`);
  }
  const v = variacaoDoPonto(valorPontoAtual, anterior.valorPonto);
  if (v != null && Math.abs(v) > TOLERANCIA_PONTO) motivos.push(`valor do ponto ${brl(anterior.valorPonto!)} → ${brl(valorPontoAtual)} (${pct(v)})`);

  const tipo = Math.abs(delta) < TOLERANCIA_REAIS ? "igual" : delta > 0 ? "subiu" : "caiu";
  const sinal = delta > 0 ? "▲" : "▼";
  const base = `${mes}: ${brl(antes.gorjeta)}. Agora: ${brl(p.rateioAmount)}.`;
  return {
    tipo, delta,
    curta: tipo === "igual" ? "= mês anterior" : `${sinal} ${brl(Math.abs(delta))}`,
    rotulo: tipo === "igual" ? "igual ao mês anterior" : `${tipo === "subiu" ? "subiu" : "caiu"} ${brl(Math.abs(delta))} em relação ao mês anterior`,
    longa: tipo === "igual" ? base : `${base} ${motivos.length ? `O que mudou: ${motivos.join("; ")}.` : "Sem mudança em pontos, função, presença ou valor do ponto; a diferença vem de ajuste de pontos, regras do ciclo ou gorjeta real."}`,
  };
}

// Uma linha acima da tabela: o valor do ponto contra o mês anterior e quantos subiram ou caíram.
export function resumirComparacao(comp: { pointValue: number; anterior?: TipMesAnterior | null }, pessoas: Pessoa[]): string | null {
  const ant = comp.anterior;
  if (!ant) return null;
  const partes: string[] = [];
  const v = variacaoDoPonto(comp.pointValue, ant.valorPonto);
  if (v != null) partes.push(`valor do ponto ${brl(ant.valorPonto!)} → ${brl(comp.pointValue)} (${pct(v)})`);
  const comparacoes = pessoas.map((p) => compararComAnterior(p, comp.pointValue, ant));
  const subiram = comparacoes.filter((c) => c?.tipo === "subiu").length;
  const cairam = comparacoes.filter((c) => c?.tipo === "caiu").length;
  const novos = comparacoes.filter((c) => c?.tipo === "novo").length;
  partes.push(`${subiram} ${subiram === 1 ? "subiu" : "subiram"}, ${cairam} ${cairam === 1 ? "caiu" : "caíram"}`);
  if (novos) partes.push(`${novos} ${novos === 1 ? "novo" : "novos"}`);
  return `Comparado com ${ant.label}: ${partes.join(" · ")}.`;
}
