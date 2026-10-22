// Histórico do Fechamento Mensal.
//
// Duas leituras que o painel não dava:
//
//  - A LINHA DO TEMPO de um mês, vinda do AuditLog: quem justificou, conferiu,
//    removeu, travou e reabriu, e quando. É o único lugar onde sobra rastro do que
//    some da tela — uma justificativa removida sai de `justifications`, e reabrir
//    o mês sobrescreve o motivo da reabertura anterior.
//  - A VISÃO DOS MESES: situação de cada mês de relance.
//
// Funções puras, sem banco, para poder testar o mapeamento. As consultas ficam
// em monthly-closure.service.ts.

export type AcaoDoHistorico = "JUSTIFICOU" | "REMOVEU_JUSTIFICATIVA" | "TRAVOU" | "REABRIU";

/** Ações que as rotas do fechamento gravam no AuditLog (monthly-closure.routes.ts). */
const ACAO_POR_EVENTO: Record<string, AcaoDoHistorico> = {
  JUSTIFY_MONTHLY_CLOSURE_BLOCK: "JUSTIFICOU",
  REMOVE_MONTHLY_CLOSURE_JUSTIFICATION: "REMOVEU_JUSTIFICATIVA",
  LOCK_MONTHLY_CLOSURE: "TRAVOU",
  UNLOCK_MONTHLY_CLOSURE: "REABRIU"
};

export const ACOES_DO_FECHAMENTO = Object.keys(ACAO_POR_EVENTO);

/**
 * `AuditLog.entityId` do fechamento. As rotas gravam `${year}-${month}` SEM zero à
 * esquerda ("2026-9"): procurar por "2026-09" não acha nada.
 */
export function entidadeDoMes(year: number, month: number): string {
  return `${year}-${month}`;
}

export type LinhaDeAuditoria = {
  id: string;
  action: string;
  createdAt: Date;
  userName: string | null;
  newValue: unknown;
};

export type EventoDoHistorico = {
  id: string;
  em: string;
  acao: AcaoDoHistorico;
  porNome: string | null;
  blockKey: string | null;
  texto: string | null;
};

function comoObjeto(valor: unknown): Record<string, unknown> {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

const textoOuNulo = (valor: unknown): string | null =>
  typeof valor === "string" && valor.trim() !== "" ? valor : null;

export function montarHistoricoDoMes(linhas: LinhaDeAuditoria[]): EventoDoHistorico[] {
  const eventos: EventoDoHistorico[] = [];
  for (const l of linhas) {
    const acao = ACAO_POR_EVENTO[l.action];
    if (!acao) continue;
    const dados = comoObjeto(l.newValue);
    eventos.push({
      id: l.id,
      em: l.createdAt.toISOString(),
      acao,
      porNome: l.userName,
      blockKey: textoOuNulo(dados.blockKey),
      texto: textoOuNulo(dados.reason)
    });
  }
  return eventos;
}

// ── Visão dos meses ────────────────────────────────────────────────────────

export type LinhaDeMes = {
  competenceYear: number;
  competenceMonth: number;
  status: string;
  closedAt: Date | null;
  closedByName: string | null;
  reopenedAt: Date | null;
  reopenedByName: string | null;
  reopenReason: string | null;
  /** Quantidade de justificativas/conferências registradas hoje no mês. */
  justificativas: number | bigint;
  revenueGrossValue: number | string | null;
  cmvAttributedValue: number | string | null;
};

export type MesDoHistorico = {
  ano: number;
  mes: number;
  travado: boolean;
  travadoEm: string | null;
  travadoPor: string | null;
  reabertoEm: string | null;
  reabertoPor: string | null;
  motivoDaReabertura: string | null;
  justificativas: number;
  faturamentoBruto: number;
  cmvAtribuido: number | null;
};

const paraNumero = (valor: number | string | bigint | null | undefined): number => Number(valor ?? 0);

export function montarVisaoDosMeses(linhas: LinhaDeMes[]): MesDoHistorico[] {
  return linhas.map((m) => {
    const travado = m.status === "CLOSED";
    return {
      ano: m.competenceYear,
      mes: m.competenceMonth,
      travado,
      travadoEm: travado && m.closedAt ? m.closedAt.toISOString() : null,
      travadoPor: travado ? m.closedByName : null,
      reabertoEm: m.reopenedAt ? m.reopenedAt.toISOString() : null,
      reabertoPor: m.reopenedByName,
      motivoDaReabertura: m.reopenReason,
      justificativas: paraNumero(m.justificativas),
      faturamentoBruto: paraNumero(m.revenueGrossValue),
      cmvAtribuido: m.cmvAttributedValue === null ? null : paraNumero(m.cmvAttributedValue)
    };
  });
}
