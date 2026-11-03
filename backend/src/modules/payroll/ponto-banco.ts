// Banco de horas e resumo do fechamento (regras do dono, nov/2026):
//   atraso            entra no banco de horas (saldo negativo)
//   falta             desconta em folha, não passa pelo banco
//   folga do banco    a jornada do dia sai do saldo
//   hora extra comum  abate primeiro o que a pessoa deve no banco; só o que sobra é paga
//   extra de domingo/feriado e adicional noturno: pagos à parte, não abatem nada
// Saldo positivo antigo fica como está: a extra do mês é paga, o crédito não é consumido.

import type { PeriodoPontoApurado } from "./ponto-calc.js";

export interface EntradaBanco {
  saldoInicialMin: number; // saldo do mês anterior (negativo = devendo)
  atrasoMin: number;
  debitoFolgaMin: number;
  extraMin: number; // extra comum do período
}

export interface ResultadoBanco {
  abatidoMin: number;
  extraAPagarMin: number;
  saldoFinalMin: number;
  devendo: boolean;
}

export function fecharBanco(e: EntradaBanco): ResultadoBanco {
  const saldoBruto = e.saldoInicialMin - e.atrasoMin - e.debitoFolgaMin;
  const divida = Math.max(0, -saldoBruto);
  const abatidoMin = Math.min(divida, Math.max(0, e.extraMin));
  const saldoFinalMin = saldoBruto + abatidoMin;
  return {
    abatidoMin,
    extraAPagarMin: Math.max(0, e.extraMin) - abatidoMin,
    saldoFinalMin,
    devendo: saldoFinalMin < 0,
  };
}

export interface OpcoesFechamento {
  saldoInicialMin: number;
  debitoFolgaMin: number;
}

export interface ResumoFechamento {
  faltas: number;
  noturnoMin: number;
  extraDescansoMin: number;
  atrasoMin: number;
  abatidoMin: number;
  extraAPagarMin: number;
  saldoBancoFinalMin: number;
  devendo: boolean;
  diasComAviso: number;
  /** Dias com batida pendente ou contradição com a escala: nada foi lançado neles até corrigir. */
  diasPendentes: number;
}

export function resumirFechamento(periodo: PeriodoPontoApurado, opcoes: OpcoesFechamento): ResumoFechamento {
  const banco = fecharBanco({
    saldoInicialMin: opcoes.saldoInicialMin,
    atrasoMin: periodo.atrasoMin,
    debitoFolgaMin: opcoes.debitoFolgaMin,
    extraMin: periodo.extraMin,
  });
  return {
    faltas: periodo.faltas,
    noturnoMin: periodo.noturnoMin,
    extraDescansoMin: periodo.extraDescansoMin,
    atrasoMin: periodo.atrasoMin,
    abatidoMin: banco.abatidoMin,
    extraAPagarMin: banco.extraAPagarMin,
    saldoBancoFinalMin: banco.saldoFinalMin,
    devendo: banco.devendo,
    diasComAviso: periodo.dias.filter((d) => d.avisos.length > 0).length,
    diasPendentes: periodo.diasPendentes,
  };
}
