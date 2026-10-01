// Regras puras da tela RH → Rescisões: quem aparece na lista, o resumo das parcelas
// lançadas e os lançamentos da Folha que vencem depois da saída (candidatos a excluir).
import { ehQuitadaNoTermo, ehQuitadaSemValor } from "./rescisao-quitada.js";
import { round2 } from "./vt-calc.js";

const DIAS_NA_LISTA = 90;
const DIA_MS = 24 * 60 * 60 * 1000;

const isoDia = (d: Date) => d.toISOString().slice(0, 10);

export type ParcelaRescisao = { id?: string; amount: unknown; paymentDate: Date | null; dueDate: Date; details?: unknown };
export type ResumoRescisaoLancada = {
  parcelas: number;
  pagas: number;
  liquido: number;
  valorPago: number;
  /** Vencimento da próxima parcela em aberto (aaaa-mm-dd), ou null se tudo pago. */
  proximoVencimento: string | null;
  /** Registrada como quitada no termo (líquido zero): o lançamento, para poder desfazer. */
  quitadaNoTermo: { itemId: string } | null;
  /** Quitada sem valor (líquido zero ou saldo devedor perdoado), com o perdoado. */
  quitadaSemValor: { itemId: string; saldoDevedorPerdoado: number } | null;
};

function perdoadoDe(details: unknown): number {
  const v = Number((details as { saldoDevedorPerdoado?: unknown } | null)?.saldoDevedorPerdoado ?? 0);
  return Number.isFinite(v) && v > 0 ? round2(v) : 0;
}

export function resumoDaRescisao(itens: ParcelaRescisao[]): ResumoRescisaoLancada | null {
  if (itens.length === 0) return null;
  const valor = (i: ParcelaRescisao) => Number(i.amount) || 0;
  const quitada = itens.find((i) => ehQuitadaNoTermo(i.details));
  const semValor = itens.find((i) => ehQuitadaSemValor(i.details));
  const pagas = itens.filter((i) => i.paymentDate != null);
  const abertas = itens.filter((i) => i.paymentDate == null).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  return {
    parcelas: itens.length,
    pagas: pagas.length,
    liquido: round2(itens.reduce((a, i) => a + valor(i), 0)),
    valorPago: round2(pagas.reduce((a, i) => a + valor(i), 0)),
    proximoVencimento: abertas[0] ? isoDia(abertas[0].dueDate) : null,
    quitadaNoTermo: quitada?.id ? { itemId: quitada.id } : null,
    quitadaSemValor: semValor?.id ? { itemId: semValor.id, saldoDevedorPerdoado: perdoadoDe(semValor.details) } : null,
  };
}

/**
 * Entra na lista quem saiu nos últimos 90 dias, quem vai sair (data futura) e quem
 * tem rescisão com parcela ainda em aberto, por mais antiga que seja.
 */
export function entraNaLista(a: {
  saida: Date | null; hoje: Date; rescisao: Pick<ResumoRescisaoLancada, "parcelas" | "pagas"> | null;
}): boolean {
  if (a.rescisao && a.rescisao.pagas < a.rescisao.parcelas) return true;
  if (!a.saida) return false;
  return a.saida.getTime() >= a.hoje.getTime() - DIAS_NA_LISTA * DIA_MS;
}

export type ItemDaFolha = {
  id: string; type: string; status: string; periodLabel: string;
  competenceYear: number; competenceMonth: number;
  amount: unknown; dueDate: Date; paymentDate: Date | null; details: unknown;
};
export type ItemAposSaida = {
  id: string; tipo: string; rotulo: string; competencia: string;
  valor: number; vencimento: string;
  /**
   * VT que fica com a pessoa no mês da saída (regra do Eli, 01/10/2026): bilhete mensal e
   * ajuda de custo. null = VT por trajeto (ou não é VT).
   */
  ficaComAPessoa: "BILHETE_MENSAL" | "AJUDA_DE_CUSTO" | null;
};

function ficaComAPessoa(details: unknown): ItemAposSaida["ficaComAPessoa"] {
  const d = (details ?? {}) as { bilheteUnicoMensal?: unknown; auxilioCombustivel?: unknown };
  if (d.bilheteUnicoMensal === true) return "BILHETE_MENSAL";
  if (d.auxilioCombustivel === true) return "AJUDA_DE_CUSTO";
  return null;
}

// Rescisão e férias têm tela própria; o resto da Folha que ainda vai sair do caixa
// depois da saída é o que a pessoa não deveria receber de novo.
const TIPOS_FORA = new Set(["RESCISAO", "FERIAS"]);

export function itensDaFolhaAposSaida(itens: ItemDaFolha[], saida: Date | null): ItemAposSaida[] {
  if (!saida) return [];
  const limite = Date.UTC(saida.getUTCFullYear(), saida.getUTCMonth(), saida.getUTCDate());
  return itens
    .filter((i) => i.paymentDate == null && i.status !== "CANCELED" && !TIPOS_FORA.has(i.type))
    .filter((i) => i.dueDate.getTime() > limite)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
    .map((i) => ({
      id: i.id,
      tipo: i.type,
      rotulo: i.periodLabel,
      competencia: `${String(i.competenceMonth).padStart(2, "0")}/${i.competenceYear}`,
      valor: round2(Number(i.amount) || 0),
      vencimento: isoDia(i.dueDate),
      ficaComAPessoa: i.type === "VALE_TRANSPORTE" ? ficaComAPessoa(i.details) : null,
    }));
}
