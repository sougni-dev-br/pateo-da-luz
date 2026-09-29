// Rateio da gorjeta pelo método da planilha de apuração (set/2026). Funções puras,
// sem banco: o serviço junta os dados e este arquivo faz a conta.
//
//   líquido = bruto − dedução (20%)
//   pontos apurados = pontos-base × (dias computados ÷ dias previstos)
//   pontos finais   = apurados + ajuste do mês (acréscimo ou desconto)
//
// Rescisões primeiro: quem saiu no período tem valor do ponto próprio, sobre o
// serviço arrecadado até a saída (ou o valor quitado, que não muda mais). O que
// as rescisões levam — em reais e em pontos — sai da apuração do mês:
//
//   valor do ponto do mês = (líquido − cotas fixas − rescisões)
//                           ÷ (pontos de referência − pontos das rescisões)
//   rateio                = pontos finais × valor do ponto do mês
//
// Assim o serviço gerado depois da saída fica com quem continua. O valor do
// ponto NÃO sobe quando alguém do mês perde pontos por falta: a diferença fica
// como saldo (retido pela casa).

import { round2 } from "./vt-calc.js";

const DIA_MS = 24 * 60 * 60 * 1000;

export type RegrasPeriodo = {
  start: Date;
  end: Date;
  diasPadrao: number;
  descontaFalta: boolean;
  descontaAtestado: boolean;
  descontaFerias: boolean;
  descontaOutros: boolean;
  // Admitido no meio do período recebe proporcional aos dias (padrão). Desligado
  // já é proporcional pelo valor do ponto próprio (serviço até a saída).
  proporcionalEntrada: boolean;
  pointsTotal: number;
  deductionPercent: number;
  netPool: number;
};

export type ValeEntrada = { type: string; amount: number };

export type ParticipanteEntrada = {
  kind: "FIXO" | "PONTOS";
  basePoints: number;
  ajuste: number;
  fixedAmount: number | null;
  admissao: Date | null;
  desligamento: Date | null;
  faltas: number;
  atestados: number;
  ferias: number;
  outrosDias: number;
  diasPrevistosOverride: number | null;
  // Decisão de quem fecha, pessoa a pessoa. null = segue a regra do período.
  regras: {
    descontaFalta: boolean | null;
    descontaAtestado: boolean | null;
    descontaFerias: boolean | null;
    descontaOutros: boolean | null;
    proporcionalEntrada: boolean | null;
  };
  rescisaoServicoBruto: number | null;
  rescisaoValorFixo: number | null;
  semRegistro: boolean;
  salarioBase: number | null;
  diasSalarioOverride: number | null;
  vales: ValeEntrada[];
};

export type TipoCalculo = "MES" | "RESCISAO" | "RESCISAO_QUITADA" | "FORA_DO_PERIODO";

export type ParticipanteCalculado = {
  tipoCalculo: TipoCalculo;
  diasElegiveis: number;
  diasPrevistos: number;
  // Base da proporção: 26 no mês cheio; menos para quem saiu (até a saída).
  diasReferencia: number;
  diasComputados: number;
  fatorPresenca: number;
  pontosApurados: number;
  pontosFinais: number;
  // Rescisão quitada: os pontos a que tinha direito × os que a gorjeta paga vale.
  pontosDireito: number;
  pontosDevolvidos: number;
  extraRescisao: number;
  justificativaExtra: string | null;
  valorPonto: number;
  rateio: number;
  descontos: number;
  creditos: number;
  comissaoLiquida: number;
  diasSalario: number;
  salarioProporcional: number;
  totalAPagar: number;
  rescisaoPendente: boolean;
  // CLT com gorjeta paga: a contabilidade já pagou na rescisão. Sem registro não
  // tem rescisão da contabilidade: o valor informado é pago na lista, com o salário.
  pagoNaRescisao: boolean;
};

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/ /g, " ");
const ptsTexto = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

function diasEntre(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DIA_MS) + 1;
}

// Dias corridos do vínculo dentro do período (admissão e desligamento inclusive).
export function diasElegiveis(regras: Pick<RegrasPeriodo, "start" | "end">, admissao: Date | null, desligamento: Date | null): number {
  const inicio = admissao && admissao > regras.start ? admissao : regras.start;
  const fim = desligamento && desligamento < regras.end ? desligamento : regras.end;
  return fim < inicio ? 0 : diasEntre(inicio, fim);
}

// Valor do ponto de quem fica: o líquido e os pontos que sobram depois das rescisões.
export function valorPontoMes(
  regras: RegrasPeriodo, totalCotasFixas: number, rescisoes: { valor: number; pontos: number } = { valor: 0, pontos: 0 },
): number {
  const pontos = regras.pointsTotal - rescisoes.pontos;
  if (pontos <= 0) return 0;
  return Math.max(0, regras.netPool - totalCotasFixas - rescisoes.valor) / pontos;
}

export function valorPontoRescisao(regras: RegrasPeriodo, servicoBruto: number): number {
  if (regras.pointsTotal <= 0) return 0;
  return (servicoBruto * (1 - regras.deductionPercent / 100)) / regras.pointsTotal;
}

// Regra efetiva de uma pessoa: a dela, se quem fecha decidiu; senão, a do período.
export function regraEfetiva(regras: RegrasPeriodo, p: ParticipanteEntrada) {
  return {
    descontaFalta: p.regras.descontaFalta ?? regras.descontaFalta,
    descontaAtestado: p.regras.descontaAtestado ?? regras.descontaAtestado,
    descontaFerias: p.regras.descontaFerias ?? regras.descontaFerias,
    descontaOutros: p.regras.descontaOutros ?? regras.descontaOutros,
    proporcionalEntrada: p.regras.proporcionalEntrada ?? regras.proporcionalEntrada,
  };
}

// Presença:
//   previstos  = dias padrão × (dias no vínculo ÷ dias corridos) — o que a pessoa deveria trabalhar
//   computados = previstos − ocorrências que descontam
//   referência = base da proporção. Mês cheio = 26. Admitido no meio conta desde o
//                início do período (recebe proporcional); desligado conta só até a
//                saída, porque o valor do ponto dele já é proporcional ao serviço
//                até ali. Sem proporcional de entrada, referência = previstos.
//   fator      = computados ÷ referência
function presenca(regras: RegrasPeriodo, p: ParticipanteEntrada) {
  const r = regraEfetiva(regras, p);
  const corridos = diasEntre(regras.start, regras.end);
  const proporcao = (dias: number) => (corridos > 0 ? Math.round(regras.diasPadrao * (dias / corridos)) : 0);
  const elegiveis = diasElegiveis(regras, p.admissao, p.desligamento);
  const previstos = p.diasPrevistosOverride ?? proporcao(elegiveis);
  const ateSaida = elegiveis > 0 ? diasElegiveis(regras, null, p.desligamento) : 0;
  const referencia = p.diasPrevistosOverride != null || !r.proporcionalEntrada
    ? previstos
    : Math.max(previstos, proporcao(ateSaida));
  const descontados =
    (r.descontaFalta ? p.faltas : 0) +
    (r.descontaAtestado ? p.atestados : 0) +
    (r.descontaFerias ? p.ferias : 0) +
    (r.descontaOutros ? p.outrosDias : 0);
  const computados = Math.max(0, previstos - descontados);
  const fator = referencia > 0 ? Math.min(1, computados / referencia) : 0;
  return { elegiveis, previstos, referencia, computados, fator };
}

// Quem não tem registro recebe o salário junto da gorjeta, calculado como se
// fosse registrado: salário ÷ 30 × dias. Mês inteiro no vínculo conta 30 dias;
// entrada ou saída no meio conta os dias corridos. Faltas injustificadas descontam.
function salarioSemRegistro(p: ParticipanteEntrada, elegiveis: number, corridos: number): { dias: number; valor: number } {
  if (!p.semRegistro || !p.salarioBase) return { dias: 0, valor: 0 };
  const base = elegiveis >= corridos ? 30 : Math.min(30, elegiveis);
  const dias = p.diasSalarioOverride ?? Math.max(0, base - p.faltas);
  return { dias, valor: round2((p.salarioBase / 30) * dias) };
}

export function calcularParticipante(regras: RegrasPeriodo, p: ParticipanteEntrada, valorPontoDoMes: number): ParticipanteCalculado {
  const { elegiveis, previstos, referencia, computados, fator } = presenca(regras, p);
  const corridos = diasEntre(regras.start, regras.end);

  const desligadoNoPeriodo = p.desligamento != null && p.desligamento <= regras.end;
  let tipoCalculo: TipoCalculo = "MES";
  if (elegiveis === 0) tipoCalculo = "FORA_DO_PERIODO";
  else if (desligadoNoPeriodo) tipoCalculo = p.rescisaoValorFixo != null ? "RESCISAO_QUITADA" : "RESCISAO";

  const pontosApurados = p.kind === "PONTOS" ? round2(p.basePoints * fator) : 0;
  const pontosFinais = p.kind === "PONTOS" && elegiveis > 0 ? Math.max(0, round2(pontosApurados + p.ajuste)) : 0;

  let valorPonto = valorPontoDoMes;
  let rateio = 0;
  let rescisaoPendente = false;
  let pontosConsumidos = pontosFinais;
  let extraRescisao = 0;
  let pontosDevolvidos = 0;
  let justificativaExtra: string | null = null;
  if (tipoCalculo === "FORA_DO_PERIODO") {
    rateio = 0;
  } else if (p.kind === "FIXO") {
    rateio = round2(p.fixedAmount ?? 0);
  } else if (tipoCalculo === "RESCISAO_QUITADA") {
    // A gorjeta paga vale (pago ÷ valor do ponto do mês) pontos. Abaixo do direito,
    // o resto volta à apuração; acima, a diferença é extra, com justificativa.
    rateio = round2(p.rescisaoValorFixo ?? 0);
    if (valorPontoDoMes > 0) {
      pontosConsumidos = round2(rateio / valorPontoDoMes);
      extraRescisao = Math.max(0, round2(pontosConsumidos - pontosFinais));
      pontosDevolvidos = Math.max(0, round2(pontosFinais - pontosConsumidos));
      if (extraRescisao > 0) {
        justificativaExtra = `Gorjeta paga na rescisão (${reais(rateio)}) equivale a ${ptsTexto(pontosConsumidos)} pts; `
          + `o direito era ${ptsTexto(pontosFinais)} pts: +${ptsTexto(extraRescisao)} pts de extra.`;
      }
    }
  } else if (tipoCalculo === "RESCISAO") {
    if (p.rescisaoServicoBruto == null) {
      rescisaoPendente = true;
      valorPonto = 0;
    } else {
      valorPonto = valorPontoRescisao(regras, p.rescisaoServicoBruto);
      rateio = round2(pontosFinais * valorPonto);
    }
  } else {
    rateio = round2(pontosFinais * valorPontoDoMes);
  }

  const creditos = round2(p.vales.filter((v) => v.type === "CREDITO").reduce((a, v) => a + v.amount, 0));
  const descontos = round2(p.vales.filter((v) => v.type !== "CREDITO").reduce((a, v) => a + v.amount, 0));
  const comissaoLiquida = round2(rateio - descontos + creditos);
  const salario = salarioSemRegistro(p, elegiveis, corridos);
  const pagoNaRescisao = tipoCalculo === "RESCISAO_QUITADA" && !p.semRegistro;

  return {
    tipoCalculo,
    diasElegiveis: elegiveis,
    diasPrevistos: previstos,
    diasReferencia: referencia,
    diasComputados: computados,
    fatorPresenca: fator,
    pontosApurados,
    pontosFinais: pontosConsumidos,
    pontosDireito: pontosFinais,
    pontosDevolvidos,
    extraRescisao,
    justificativaExtra,
    valorPonto: round2(valorPonto),
    rateio,
    descontos,
    creditos,
    comissaoLiquida,
    diasSalario: salario.dias,
    salarioProporcional: salario.valor,
    totalAPagar: pagoNaRescisao ? 0 : round2(salario.valor + comissaoLiquida),
    rescisaoPendente,
    pagoNaRescisao,
  };
}

export type ResumoRateio = {
  valorPonto: number;
  /** Sem arredondar: é o que multiplica os pontos (e a reserva). */
  valorPontoBruto: number;
  rescisoes: { valor: number; pontos: number };
  pontosDisponiveis: number;
  totalCotasFixas: number;
  distribuido: number;
  saldo: number;
  pontosUsados: number;
  linhas: ParticipanteCalculado[];
};

export function calcularRateio(regras: RegrasPeriodo, participantes: ParticipanteEntrada[]): ResumoRateio {
  const totalCotasFixas = round2(
    participantes.filter((p) => p.kind === "FIXO").reduce((a, p) => a + (p.fixedAmount ?? 0), 0),
  );
  // 1ª passada: as rescisões calculadas (serviço até a saída) não dependem do ponto do mês.
  // As quitadas ficam fora: medidas pelo próprio valor do ponto, não o alteram.
  const previa = participantes.map((p) => calcularParticipante(regras, p, 0));
  const calculadas = {
    valor: round2(previa.reduce((a, l) => a + (l.tipoCalculo === "RESCISAO" ? l.rateio : 0), 0)),
    pontos: round2(previa.reduce((a, l) => a + (l.tipoCalculo === "RESCISAO" ? l.pontosFinais : 0), 0)),
  };
  const valorPonto = valorPontoMes(regras, totalCotasFixas, calculadas);
  // 2ª passada: quem fica e as quitadas, com o valor do ponto que sobrou.
  const linhas = participantes.map((p) => calcularParticipante(regras, p, valorPonto));
  const ehRescisao = (t: string) => t === "RESCISAO" || t === "RESCISAO_QUITADA";
  const rescisoes = {
    valor: round2(linhas.reduce((a, l) => a + (ehRescisao(l.tipoCalculo) ? l.rateio : 0), 0)),
    pontos: round2(linhas.reduce((a, l) => a + (ehRescisao(l.tipoCalculo) ? l.pontosFinais : 0), 0)),
  };
  const distribuido = round2(linhas.reduce((a, l) => a + l.rateio, 0));
  return {
    valorPonto: round2(valorPonto),
    valorPontoBruto: valorPonto,
    rescisoes,
    pontosDisponiveis: round2(regras.pointsTotal - rescisoes.pontos),
    totalCotasFixas,
    distribuido,
    saldo: round2(regras.netPool - distribuido),
    pontosUsados: round2(linhas.reduce((a, l) => a + l.pontosFinais, 0)),
    linhas,
  };
}
