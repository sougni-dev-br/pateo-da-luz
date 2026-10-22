// Resumo imprimível do Fechamento Mensal.
//
// É o documento que sustenta o fechamento perante a contabilidade: o que foi
// conferido, o que ficou pendente e o que foi justificado — com quem registrou e
// quando. Montado aqui, sem JSX, para poder ser testado: a folha impressa só
// desenha o que esta função devolve.

import type { MonthlyClosureState, MonthlyCmv } from "../api/client";
import { formatDate } from "../utils/format";
import {
  GRUPOS_DO_FECHAMENTO,
  agruparPendencias,
  grupoDaPendencia,
  nomeDaChave,
  type GrupoDoFechamento
} from "./fechamento-apresentacao";
import { ehConferencia, resumirFechamento } from "./fechamento-pendencias";

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const FUSO = "America/Sao_Paulo";

const dinheiro = (valor: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number.isFinite(valor) ? valor : 0);

/** Instante com hora, no horário da casa: quem confere precisa saber o dia E a hora. */
export function dataComHora(iso: string | Date): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: FUSO })
    .format(typeof iso === "string" ? new Date(iso) : iso)
    .replace(",", "");
}

export type SituacaoDaArea = "OK" | "PENDENTE" | "AGUARDANDO" | "JUSTIFICADO";

export type ResumoImprimivel = {
  titulo: string;
  periodo: string;
  situacao: "ABERTO" | "TRAVADO";
  situacaoTexto: string;
  numeros: Array<{ rotulo: string; valor: string }>;
  areas: Array<{ area: GrupoDoFechamento; situacao: SituacaoDaArea; observacao: string }>;
  pendencias: Array<{
    grupo: GrupoDoFechamento;
    itens: Array<{ titulo: string; detalhe: string; aguardando: boolean }>;
  }>;
  registros: Array<{ nome: string; tipo: "Conferência" | "Justificativa"; texto: string; data: string; por: string }>;
  totais: { pendentes: number; aguardando: number; registros: number };
  geradoEm: string;
  geradoPor: string;
};

type Entrada = {
  state: MonthlyClosureState;
  cmv: MonthlyCmv | null;
  hoje?: Date;
  geradoEm: Date;
  geradoPor: string;
};

/** Nome de quem foi justificado: cartão e fornecedor vêm do cadastro, o resto é fixo. */
export function nomeDaJustificativa(
  chave: string,
  state: Pick<MonthlyClosureState, "cards" | "requiredSuppliers">
): string {
  if (chave.startsWith("card:")) {
    const c = state.cards.cartoes.find((x) => `card:${x.id}` === chave);
    return c ? `Cartão ${c.name} (final ${c.last4Digits})` : "Cartão";
  }
  if (chave.startsWith("supplier:")) {
    const f = state.requiredSuppliers.find((x) => `supplier:${x.id}` === chave);
    return f ? `Fornecedor ${f.name}` : "Fornecedor";
  }
  return nomeDaChave(chave) ?? chave;
}

function observacaoDaArea(area: GrupoDoFechamento, s: MonthlyClosureState): string {
  if (area === "Faturamento") {
    const n = s.revenue.eventos.lancamentos;
    return `${s.revenue.salon.daysCount} dias de salão · ${n} evento(s) lançado(s)`;
  }
  if (area === "Compras") return `${s.purchases.count} lançamentos`;
  if (area === "Fornecedores obrigatórios") {
    const aplicam = s.requiredSuppliers.filter((f) => f.appliesThisMonth);
    return `${aplicam.filter((f) => f.present).length} de ${aplicam.length} lançados`;
  }
  if (area === "Cartões de crédito") {
    const conferidos = s.cards.cartoes.filter((c) => {
      const f = s.cards.faturas.find((x) => x.creditCardId === c.id && x.status !== "CANCELLED");
      return f && ["CHECKED", "CLOSED", "PAID"].includes(f.status) && f.itensComDivergencia === 0;
    });
    return `${conferidos.length} de ${s.cards.cartoes.length} conferidos`;
  }
  if (area === "Pessoal") return "folha e gorjeta do mês";
  if (area === "Impostos") return `${s.taxes.length} lançamento(s)`;
  if (area === "Estoque") {
    return s.finalInventory.hasSnapshot
      ? `contado em ${formatDate(s.finalInventory.countDate)}`
      : "inventário final não contado";
  }
  return "";
}

export function montarResumoDoFechamento({ state, cmv, hoje = new Date(), geradoEm, geradoPor }: Entrada): ResumoImprimivel {
  const classificacao = resumirFechamento(state.summary.pending, state.monthEnd, hoje);
  const atencao = classificacao.atencao;
  const aguardando = classificacao.aguardando;

  const travado = state.status === "CLOSED";
  const situacaoTexto = travado
    ? `Travado${state.closedAt ? ` em ${formatDate(state.closedAt)}` : ""}${state.closedByName ? ` por ${state.closedByName}` : ""}`
    : "Em aberto — ainda não travado";

  const cmvValor = !state.finalInventory.hasSnapshot
    ? "depende do inventário final"
    : cmv ? dinheiro(cmv.realCmvValue) : "—";

  const numeros = [
    { rotulo: "Faturamento bruto", valor: dinheiro(state.revenue.total.grossAmount) },
    { rotulo: "Faturamento líquido", valor: dinheiro(state.revenue.total.netAmount) },
    { rotulo: "Compras no mês", valor: dinheiro(state.purchases.total) },
    { rotulo: "Estoque final", valor: state.finalInventory.hasSnapshot ? dinheiro(state.finalInventory.totalValue) : "não contado" },
    { rotulo: "CMV do mês", valor: cmvValor }
  ];

  const registros = [...state.justifications]
    .sort((a, b) => a.justifiedAt.localeCompare(b.justifiedAt))
    .map((j) => ({
      nome: nomeDaJustificativa(j.blockKey, state),
      tipo: (ehConferencia(j.blockKey) ? "Conferência" : "Justificativa") as "Conferência" | "Justificativa",
      texto: j.reason,
      data: dataComHora(j.justifiedAt),
      por: j.justifiedByName ?? "—"
    }));

  const areas = GRUPOS_DO_FECHAMENTO
    .map((area) => {
      const emAtencao = atencao.filter((p) => grupoDaPendencia(p.key) === area).length;
      const esperando = aguardando.filter((p) => grupoDaPendencia(p.key) === area).length;
      const justificadas = state.justifications.filter((j) => grupoDaPendencia(j.blockKey) === area).length;
      const situacao: SituacaoDaArea = emAtencao > 0 ? "PENDENTE"
        : esperando > 0 ? "AGUARDANDO"
        : justificadas > 0 ? "JUSTIFICADO" : "OK";
      return { area, situacao, observacao: observacaoDaArea(area, state), usada: emAtencao + esperando + justificadas > 0 };
    })
    // "Outros" só existe quando alguma pendência de chave nova caiu nela.
    .filter((a) => a.area !== "Outros" || a.usada)
    .map(({ area, situacao, observacao }) => ({ area, situacao, observacao }));

  const pendencias = agruparPendencias([...atencao, ...aguardando]).map(({ grupo, itens }) => ({
    grupo,
    itens: itens.map((i) => ({
      titulo: i.titulo,
      detalhe: i.detalhe,
      aguardando: aguardando.some((a) => a.key === i.key)
    }))
  }));

  return {
    titulo: `Fechamento mensal — ${MESES[state.competenceMonth - 1]} / ${state.competenceYear}`,
    periodo: `${formatDate(state.monthStart)} a ${formatDate(state.monthEnd)}`,
    situacao: travado ? "TRAVADO" : "ABERTO",
    situacaoTexto,
    numeros,
    areas,
    pendencias,
    registros,
    totais: { pendentes: atencao.length, aguardando: aguardando.length, registros: registros.length },
    geradoEm: dataComHora(geradoEm),
    geradoPor
  };
}
