// Auxiliares compartilhados pelas rotas da Folha da Gorjeta (validação de entrada, trava de período fechado, cálculo para a tela).

import { type Request, type Response } from "express";
import { prisma } from "../../config/database.js";
import { podeVerDadosPessoais } from "./dados-pessoais.js";
import { closeTipPeriod, computeTipCommission } from "./tip-commission.service.js";
import { hojeEmSaoPaulo } from "./extras-comum.js";
import { carregarMesAnterior } from "./tip-mes-anterior.js";

export function fmtDay(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
// Converte "YYYY-MM-DD" em Date UTC à meia-noite; retorna null se inválida.
export function parseDateUTC(v: unknown): Date | null {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isNaN(d.getTime()) ? null : d;
}


// ─── Trava de período fechado ───────────────────────────────────
// closeTipPeriod só sela o período depois de conferir que a soma dos rateios
// bate com o pool líquido e que os pontos estão completos. Mas nenhuma rota de
// escrita olhava esse selo: dava para apagar participante, lançar ou apagar
// vale e re-sincronizar o cadastro de um período já CLOSED, refazendo por baixo
// uma conferência que já tinha sido assinada — e sem deixar rastro, porque
// nenhuma dessas rotas auditava. Quem quiser mexer reabre antes, pela rota
// /periods/:year/:month/reopen, que registra a reabertura.
export async function periodoDeGorjetaFechado(periodId: string) {
  const periodo = await prisma.tipPeriod.findUnique({
    where: { id: periodId },
    select: { status: true, competenceYear: true, competenceMonth: true },
  });
  if (!periodo || periodo.status !== "CLOSED") return null;
  return `${String(periodo.competenceMonth).padStart(2, "0")}/${periodo.competenceYear}`;
}

// Responde 409 e devolve true quando a escrita foi barrada.
export async function barrouPorFechamento(periodId: string | null, response: Response, acao: string) {
  if (!periodId) return false;
  const mes = await periodoDeGorjetaFechado(periodId);
  if (!mes) return false;
  response.status(409).json({
    message: `A gorjeta de ${mes} está fechada. ${acao} mudaria um rateio já conferido — reabra o período antes.`,
  });
  return true;
}

// Sobe do participante (ou do vale) até o período dono.
export async function periodIdDoParticipante(participantId: string) {
  const p = await prisma.tipParticipant.findUnique({
    where: { id: participantId }, select: { periodId: true },
  });
  return p?.periodId ?? null;
}

export function parseYearMonth(q: { year?: unknown; month?: unknown }) {
  const now = new Date();
  const year = parseInt(String(q.year ?? ""), 10) || now.getFullYear();
  let month = parseInt(String(q.month ?? ""), 10) || now.getMonth() + 1;
  if (month < 1) month = 1;
  if (month > 12) month = 12;
  return { year, month };
}

export function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// Inteiro ≥ 0 ou null (campo vazio = "usar o cálculo/Escala").
export function intOrNull(v: unknown): number | null {
  const n = numOrNull(v);
  return n == null ? null : Math.max(0, Math.round(n));
}

export function intOrUndefined(v: unknown, min: number, max: number): number | undefined {
  const n = numOrNull(v);
  return n == null ? undefined : Math.min(max, Math.max(min, Math.round(n)));
}

export function textoOuNull(v: unknown): string | null {
  return v != null && String(v).trim() !== "" ? String(v).trim() : null;
}

// Hoje do operador (São Paulo) à meia-noite UTC, como as datas @db.Date. Antes usava a
// data local do servidor (UTC no Render): das 21h às 24h em São Paulo já era "amanhã",
// e a vigência padrão de uma função ou de uma mudança na equipe caía no dia seguinte.
export function hojeSaoPaulo(): Date {
  return new Date(`${hojeEmSaoPaulo()}T00:00:00.000Z`);
}

export function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

export function boolOrUndefined(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

// ─── Prévia do cálculo (não persiste) ───────────────────────────────────────
// Salário e PIX só vão para quem também pode ver a ficha de Funcionários: delegar a
// gorjeta não entrega junto o salário de todo mundo (ver /roster abaixo).
// Participantes cuja gorjeta paga foi gravada por uma rescisão viva (qualquer parcela).
export async function participantesTravadosPelaRescisao(employeeIds: string[]): Promise<Set<string>> {
  if (employeeIds.length === 0) return new Set();
  const rescisoes = await prisma.payrollItem.findMany({
    where: { type: "RESCISAO", deletedAt: null, status: { not: "CANCELED" }, employeeId: { in: employeeIds } },
    select: { details: true },
  });
  return new Set(rescisoes
    .map((x) => (x.details as { gorjetaNaApuracao?: { participantId?: string } } | null)?.gorjetaNaApuracao?.participantId)
    .filter((id): id is string => Boolean(id)));
}

// O cálculo como a tela o recebe: com o mês anterior ao lado, para comparar. Sem fechamento
// anterior vigente (ou se a leitura falhar), segue sem a comparação — ela é só apoio.
export async function calcularParaTela(year: number, month: number, request: Request) {
  const computation = await computeTipCommission(year, month, { incluirDadosPessoais: await podeVerDadosPessoais(request) });
  const anterior = await carregarMesAnterior(year, month).catch((erro: unknown) => {
    console.error("[gorjeta] mês anterior indisponível:", erro);
    return null;
  });
  return { ...computation, anterior };
}

