import { toCalendarDateKey } from "../../../shared/utils/calendar-date.js";
import { ehRecebida } from "./agile-situacao.js";
import { montarDemanda } from "./agile-analise-demanda.report.js";
import { gerarInsights, MIN_DIAS_PARA_COMPARAR_PERIODOS } from "./agile-analise-insights.js";
import {
  calcularIndicadores, diasDoPeriodo, montarSerieDiaria, periodoAnteriorDe, variacao, type VendaVisao
} from "./agile-analise-visao.report.js";
import type { Periodo } from "./agile-analise.report.js";

// Resumo executivo: indicadores do período, comparação com o período imediatamente anterior,
// série diária e os avisos "o que mudou e o que fazer".

// O período anterior só serve de comparação se teve movimento em pelo menos metade dos dias
// (e em 3 dias, no mínimo): comparar com um período em que o agente nem estava enviando dados
// faria qualquer número parecer um salto.
export const MIN_COBERTURA_ANTERIOR = 0.5;
export const MIN_DIAS_ANTERIOR = 3;

type Entrada = {
  periodo: Periodo;
  vendasAtual: VendaVisao[];
  vendasAnterior: VendaVisao[];
  itensCanceladosAtual: number;
  itensCanceladosAnterior: number;
};

const dentro = (v: VendaVisao, p: Periodo) => {
  const k = toCalendarDateKey(v.movementDate);
  return k >= p.inicio && k <= p.fim;
};

export function montarResumo({ periodo, vendasAtual, vendasAnterior, itensCanceladosAtual, itensCanceladosAnterior }: Entrada) {
  const periodoAnterior = periodoAnteriorDe(periodo);
  // Defesa: o serviço já separa as duas janelas, mas uma linha fora do intervalo não pode contaminar.
  const atualLinhas = vendasAtual.filter((v) => dentro(v, periodo));
  const anteriorLinhas = vendasAnterior.filter((v) => dentro(v, periodoAnterior));

  const atual = calcularIndicadores(atualLinhas, itensCanceladosAtual);
  const anteriorIndicadores = calcularIndicadores(anteriorLinhas, itensCanceladosAnterior);
  const temAnterior = anteriorIndicadores.comandas > 0;
  // Período curto contra o anterior compara dias da semana diferentes (sexta a domingo contra terça a quinta):
  // a variação seria efeito do calendário, não do negócio. Mesma regra dos insights e do cardápio.
  const periodoCurto = diasDoPeriodo(periodo) < MIN_DIAS_PARA_COMPARAR_PERIODOS;
  const anteriorConfiavel =
    temAnterior &&
    !periodoCurto &&
    anteriorIndicadores.diasComMovimento >= MIN_DIAS_ANTERIOR &&
    anteriorIndicadores.diasComMovimento / diasDoPeriodo(periodoAnterior) >= MIN_COBERTURA_ANTERIOR;

  const dias = [...new Set(atualLinhas.filter((v) => ehRecebida(v.saleStatus)).map((v) => toCalendarDateKey(v.movementDate)))].sort();
  const anterior = temAnterior ? anteriorIndicadores : null;
  const comparacao = anterior && anteriorConfiavel
    ? {
        faturamentoPorDia: variacao(atual.faturamentoPorDia, anterior.faturamentoPorDia),
        pessoasPorDia: variacao(atual.pessoasPorDia, anterior.pessoasPorDia),
        ticketPessoa: variacao(atual.ticketPessoa, anterior.ticketPessoa),
        ticketComanda: variacao(atual.ticketComanda, anterior.ticketComanda),
        faturamento: variacao(atual.faturamento, anterior.faturamento),
        pessoas: variacao(atual.pessoas, anterior.pessoas),
        perdaPct: variacao(atual.perdaPct, anterior.perdaPct)
      }
    : null;

  const demanda = montarDemanda(atualLinhas, periodo);
  return {
    periodo,
    periodoAnterior,
    cobertura: {
      diasNoPeriodo: diasDoPeriodo(periodo),
      diasComMovimento: atual.diasComMovimento,
      primeiroDia: dias[0] ?? null,
      ultimoDia: dias[dias.length - 1] ?? null,
      vendasComDetalhe: atualLinhas.length
    },
    atual,
    anterior,
    anteriorConfiavel,
    // Por que não há comparação: o período é curto demais ("periodo-curto") ou a base anterior é fraca ou inexistente ("base-fraca").
    // null = há comparação.
    motivoSemComparacao: anteriorConfiavel ? null : periodoCurto ? ("periodo-curto" as const) : ("base-fraca" as const),
    comparacao,
    serie: montarSerieDiaria(atualLinhas, periodo),
    insights: gerarInsights({ periodo, atual, anterior, anteriorConfiavel, demanda })
  };
}
