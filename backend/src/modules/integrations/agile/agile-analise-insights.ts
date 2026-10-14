import type { Periodo } from "./agile-analise.report.js";
import type { montarDemanda } from "./agile-analise-demanda.report.js";
import { diasDoPeriodo, type Indicadores } from "./agile-analise-visao.report.js";

// "O que mudou e o que fazer": regras determinísticas sobre os indicadores, cada uma com a
// evidência, a ação sugerida e (quando dá para estimar) o impacto mensal. Nada aqui é opinião
// solta: toda regra tem limite mínimo de amostra e diz quando o impacto é HIPÓTESE.

export type Insight = {
  id: string;
  tom: "alerta" | "oportunidade" | "info";
  titulo: string;
  detalhe: string;
  acao: string;
  // Impacto mensal estimado em R$, sempre POSITIVO (o tom diz se é ganho possível ou perda); null quando
  // não há como estimar com honestidade.
  impactoMes: number | null;
  // true = depende de uma suposição (ex.: "se o dia chegasse a 70% do melhor"), não de medição.
  hipotese: boolean;
  secao: "demanda" | "perdas" | "resumo" | "cardapio";
};

// Duas semanas inteiras: com 7 a 13 dias, um período com sábado e domingo e outro sem eles viram "queda".
export const MIN_DIAS_PARA_COMPARAR_PERIODOS = 14;
export const LIMITE_VARIACAO_PESSOAS = 0.1;
export const LIMITE_VARIACAO_TICKET = 0.05;
export const LIMITE_PERDA_ALTA = 0.03;
export const LIMITE_REFACAO_ALTA = 0.25;
export const MIN_REFACOES_PARA_AVISAR = 5;
export const MIN_CANCELAMENTOS_SEM_MOTIVO = 5;
export const LIMITE_SEM_PESSOAS = 0.05;
export const IMPACTO_MINIMO_DIA_OCIOSO = 1000;
export const MAX_INSIGHTS = 6;
const DIAS_NO_MES = 30;

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = (n: number) => `${(Math.abs(n) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const num = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const ordemTom = { alerta: 0, oportunidade: 1, info: 2 } as const;

type Demanda = ReturnType<typeof montarDemanda>;

export function gerarInsights(args: { periodo: Periodo; atual: Indicadores; anterior: Indicadores | null; anteriorConfiavel: boolean; demanda: Demanda }): Insight[] {
  const { periodo, atual, anterior, anteriorConfiavel, demanda } = args;
  const dias = diasDoPeriodo(periodo);
  const lista: Insight[] = [];
  // Dias ABERTOS em um mês no ritmo do período: o salão fecha alguns dias, e multiplicar por 30 dias
  // corridos inflaria o impacto.
  const diasAbertosNoMes = dias > 0 ? DIAS_NO_MES * (atual.diasComMovimento / dias) : DIAS_NO_MES;

  // ---- dias fracos por turno (hipótese de capacidade)
  for (const turno of demanda.capacidade.turnos) {
    const folga = turno.folgas[0];
    if (!turno.referencia || !folga || folga.faturamentoMesPotencial < IMPACTO_MINIMO_DIA_OCIOSO) continue;
    lista.push({
      id: `dia-ocioso-${turno.turno.toLowerCase()}`,
      tom: "oportunidade",
      titulo: `${folga.rotulo} no ${turno.rotulo.toLowerCase()} roda a ${pct(folga.pctDoMelhor)} do melhor dia`,
      detalhe: `Média de ${num(folga.pessoasPorDia)} pessoas por dia, contra ${num(turno.referencia.pessoasPorDia)} na ${turno.referencia.rotulo.toLowerCase()}. Chegar a ${pct(demanda.capacidade.metaRelativa)} do melhor dia seria ${num(folga.pessoasAMais)} pessoas a mais por dia.`,
      acao: `Teste uma ação para a ${folga.rotulo.toLowerCase()} (combo, parceria com empresas próximas, divulgação) e acompanhe as pessoas por dia aqui.`,
      impactoMes: folga.faturamentoMesPotencial,
      hipotese: true,
      secao: "demanda"
    });
  }

  // ---- comparação com o período anterior (só quando há base confiável)
  if (anterior && anteriorConfiavel && atual.diasComMovimento >= MIN_DIAS_PARA_COMPARAR_PERIODOS && anterior.pessoasPorDia > 0) {
    const dPessoas = (atual.pessoasPorDia - anterior.pessoasPorDia) / anterior.pessoasPorDia;
    if (Math.abs(dPessoas) >= LIMITE_VARIACAO_PESSOAS) {
      const queda = dPessoas < 0;
      lista.push({
        id: "pessoas-variacao",
        tom: queda ? "alerta" : "info",
        titulo: queda ? `Movimento caiu ${pct(dPessoas)} contra o período anterior` : `Movimento subiu ${pct(dPessoas)} contra o período anterior`,
        detalhe: `${num(atual.pessoasPorDia)} pessoas por dia agora, ${num(anterior.pessoasPorDia)} antes.`,
        acao: queda ? "Veja em Quando vendemos em quais dias e horários a queda se concentra." : "Confira se o ritmo se sustenta e se a equipe e a produção acompanham.",
        impactoMes: queda ? Math.round((anterior.pessoasPorDia - atual.pessoasPorDia) * atual.ticketPessoa * diasAbertosNoMes) : null,
        hipotese: false,
        secao: "resumo"
      });
    }
    if (anterior.ticketPessoa > 0) {
      const dTicket = (atual.ticketPessoa - anterior.ticketPessoa) / anterior.ticketPessoa;
      if (Math.abs(dTicket) >= LIMITE_VARIACAO_TICKET) {
        const queda = dTicket < 0;
        lista.push({
          id: "ticket-variacao",
          tom: queda ? "alerta" : "info",
          titulo: queda ? `Ticket por pessoa caiu ${pct(dTicket)}` : `Ticket por pessoa subiu ${pct(dTicket)}`,
          detalhe: `${brl(atual.ticketPessoa)} por pessoa agora, ${brl(anterior.ticketPessoa)} antes.`,
          acao: queda ? "Veja se mudou o mix (menos bebida, mais promoção) e se os descontos aumentaram." : "Veja o que puxou o ticket para cima e se dá para repetir.",
          impactoMes: queda ? Math.round((anterior.ticketPessoa - atual.ticketPessoa) * atual.pessoasPorDia * diasAbertosNoMes) : null,
          hipotese: false,
          secao: "resumo"
        });
      }
    }
  }

  // ---- perdas
  if (atual.perdaPct >= LIMITE_PERDA_ALTA) {
    lista.push({
      id: "perda-alta",
      tom: "alerta",
      titulo: `Perdas potenciais somam ${pct(atual.perdaPct)} do faturamento`,
      detalhe: `${brl(atual.perdaValor)} no período (até ${brl(atual.perdaTetoValor)} se nenhuma refação for real): cancelamentos sem refação ${brl(atual.canceladoValor - atual.refeitoValor)}, itens cancelados ${brl(atual.itensCanceladosValor)}, descontos ${brl(atual.descontoValor)}.`,
      acao: "É uma estimativa: nem todo cancelamento é dinheiro perdido. Abra Perdas para separar refação, valores muito altos e quem concentra.",
      impactoMes: Math.round((atual.perdaValor / dias) * DIAS_NO_MES),
      hipotese: false,
      secao: "perdas"
    });
  }
  if (atual.grandesVendas > 0) {
    lista.push({
      id: "cancelamentos-grandes",
      tom: "info",
      titulo: `${atual.grandesVendas} cancelamento${atual.grandesVendas > 1 ? "s" : ""} de valor muito alto`,
      detalhe: `Somam ${brl(atual.grandesValor)}. Valores assim costumam ser pacote ou evento, não mesa.`,
      acao: "Confirme se eram pacotes/eventos (que devem ter comanda própria) ou lançamento errado.",
      impactoMes: null,
      hipotese: false,
      secao: "perdas"
    });
  }
  if (atual.canceladoValor > 0 && atual.refeitoVendas >= MIN_REFACOES_PARA_AVISAR && atual.refeitoValor / atual.canceladoValor >= LIMITE_REFACAO_ALTA) {
    lista.push({
      id: "refacao",
      tom: "info",
      titulo: `${pct(atual.refeitoValor / atual.canceladoValor)} do valor cancelado parece comanda refeita`,
      detalhe: `${atual.refeitoVendas} cancelamentos têm uma venda paga muito parecida (mesmo dia, mesmas pessoas, valor e horário quase iguais). Pode não ser perda de venda, embora parte possa ser coincidência.`,
      acao: "Oriente a corrigir a comanda em vez de cancelar e abrir outra: limpa o relatório e reduz risco de desvio.",
      impactoMes: null,
      hipotese: false,
      secao: "perdas"
    });
  }
  if (atual.canceladoVendas >= MIN_CANCELAMENTOS_SEM_MOTIVO && atual.semMotivo === atual.canceladoVendas) {
    lista.push({
      id: "cancelamento-sem-motivo",
      tom: "info",
      titulo: "Nenhum cancelamento tem motivo registrado",
      detalhe: `${atual.canceladoVendas} cancelamentos, todos sem motivo no PDV.`,
      acao: "Peça para informar o motivo ao cancelar: sem ele a análise mostra quem e quanto, mas não por quê.",
      impactoMes: null,
      hipotese: false,
      secao: "perdas"
    });
  }
  if (atual.comandas > 0 && atual.vendasSemPessoas / atual.comandas >= LIMITE_SEM_PESSOAS) {
    lista.push({
      id: "sem-numero-de-pessoas",
      tom: "info",
      titulo: `${atual.vendasSemPessoas} comandas sem número de pessoas`,
      detalhe: "Sem esse número a comanda entra no faturamento, mas não no ticket por pessoa.",
      acao: "Reforce o preenchimento do número de pessoas na abertura da comanda.",
      impactoMes: null,
      hipotese: false,
      secao: "resumo"
    });
  }

  return lista
    .sort((a, b) => ordemTom[a.tom] - ordemTom[b.tom] || Math.abs(b.impactoMes ?? 0) - Math.abs(a.impactoMes ?? 0))
    .slice(0, MAX_INSIGHTS);
}
