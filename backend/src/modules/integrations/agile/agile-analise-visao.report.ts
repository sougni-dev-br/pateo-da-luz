import { ehCancelada, ehRecebida } from "./agile-situacao.js";
import { encontrarRefacoes } from "./agile-analise-refacao.js";
import { toCalendarDateKey } from "../../../shared/utils/calendar-date.js";
import type { Periodo } from "./agile-analise.report.js";

// Indicadores de decisão do salão: faturamento, pessoas, ticket por pessoa, perda líquida e a
// comparação com o período imediatamente anterior. Funções puras sobre linhas já lidas do banco.

export type VendaVisao = {
  saleId: string;
  movementDate: Date;
  shift: string;
  saleStatus: string;
  saleHour: string | null;
  people: number;
  totalAmount: number;
  // null = linha gravada antes de o agente enviar o desconto (sem dado, nunca zero).
  subtotalAmount: number | null;
  discountAmount: number | null;
  discountLabel?: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
};

// Venda cancelada de valor muito acima da mesa média costuma ser pacote ou evento, não comanda de
// salão: aparece separada para alguém conferir, sem ser tratada como erro.
export const LIMITE_CANCELAMENTO_GRANDE = 1000;
const UM_DIA_MS = 24 * 60 * 60 * 1000;

export type Indicadores = {
  diasComMovimento: number;
  faturamento: number;
  comandas: number;
  pessoas: number;
  vendasSemPessoas: number;
  ticketPessoa: number;
  ticketComanda: number;
  pessoasPorDia: number;
  faturamentoPorDia: number;
  canceladoVendas: number;
  canceladoValor: number;
  refeitoVendas: number;
  refeitoValor: number;
  grandesVendas: number;
  grandesValor: number;
  semMotivo: number;
  itensCanceladosValor: number;
  descontoValor: number;
  descontoPct: number;
  descontoSemDado: number;
  // Cancelamento que NÃO reapareceu como venda recebida + itens cancelados + descontos.
  perdaValor: number;
  perdaPct: number;
  // O mesmo SEM abater a provável refação: a refação é provável, não certa, então este é o teto.
  perdaTetoValor: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const razao = (parte: number, todo: number) => (todo > 0 ? parte / todo : 0);

export function calcularIndicadores(vendas: VendaVisao[], itensCanceladosValor: number): Indicadores {
  const recebidas = vendas.filter((v) => ehRecebida(v.saleStatus));
  const canceladas = vendas.filter((v) => ehCancelada(v.saleStatus));

  const dias = new Set(recebidas.map((v) => toCalendarDateKey(v.movementDate)));
  const faturamento = recebidas.reduce((s, v) => s + v.totalAmount, 0);
  const comPessoas = recebidas.filter((v) => v.people > 0);
  const pessoas = comPessoas.reduce((s, v) => s + v.people, 0);
  // Ticket por pessoa só com as vendas em que o número de pessoas foi informado: venda com 0
  // pessoas entraria no valor e não nas pessoas, inflando o ticket.
  const faturamentoComPessoas = comPessoas.reduce((s, v) => s + v.totalAmount, 0);

  const pares = encontrarRefacoes(vendas);
  const canceladoValor = canceladas.reduce((s, v) => s + v.totalAmount, 0);
  const refeitas = canceladas.filter((v) => pares.has(v.saleId));
  const refeitoValor = refeitas.reduce((s, v) => s + v.totalAmount, 0);
  const grandes = canceladas.filter((v) => v.totalAmount >= LIMITE_CANCELAMENTO_GRANDE);

  const comDadoDeDesconto = recebidas.filter((v) => v.subtotalAmount !== null && v.discountAmount !== null);
  const descontoValor = comDadoDeDesconto.reduce((s, v) => s + Math.max(0, v.discountAmount ?? 0), 0);
  const subtotalComDado = comDadoDeDesconto.reduce((s, v) => s + (v.subtotalAmount ?? 0), 0);

  const perdaValor = canceladoValor - refeitoValor + itensCanceladosValor + descontoValor;
  const perdaTetoValor = canceladoValor + itensCanceladosValor + descontoValor;
  return {
    diasComMovimento: dias.size,
    faturamento: round2(faturamento),
    comandas: recebidas.length,
    pessoas,
    vendasSemPessoas: recebidas.length - comPessoas.length,
    ticketPessoa: round2(razao(faturamentoComPessoas, pessoas)),
    ticketComanda: round2(razao(faturamento, recebidas.length)),
    pessoasPorDia: round2(razao(pessoas, dias.size)),
    faturamentoPorDia: round2(razao(faturamento, dias.size)),
    canceladoVendas: canceladas.length,
    canceladoValor: round2(canceladoValor),
    refeitoVendas: refeitas.length,
    refeitoValor: round2(refeitoValor),
    grandesVendas: grandes.length,
    grandesValor: round2(grandes.reduce((s, v) => s + v.totalAmount, 0)),
    semMotivo: canceladas.filter((v) => !(v.cancelReason ?? "").trim()).length,
    itensCanceladosValor: round2(itensCanceladosValor),
    descontoValor: round2(descontoValor),
    descontoPct: round4(razao(descontoValor, subtotalComDado)),
    descontoSemDado: recebidas.length - comDadoDeDesconto.length,
    perdaValor: round2(perdaValor),
    perdaPct: round4(razao(perdaValor, faturamento)),
    perdaTetoValor: round2(perdaTetoValor)
  };
}

// Mesmo número de dias, imediatamente antes do início: comparar 30 dias com 30 dias.
export function periodoAnteriorDe({ inicio, fim }: Periodo): Periodo {
  const de = Date.parse(`${inicio}T00:00:00.000Z`);
  const ate = Date.parse(`${fim}T00:00:00.000Z`);
  const dias = Math.round((ate - de) / UM_DIA_MS) + 1;
  const fimAnterior = new Date(de - UM_DIA_MS);
  const inicioAnterior = new Date(de - dias * UM_DIA_MS);
  return { inicio: inicioAnterior.toISOString().slice(0, 10), fim: fimAnterior.toISOString().slice(0, 10) };
}

export function diasDoPeriodo({ inicio, fim }: Periodo): number {
  return Math.round((Date.parse(`${fim}T00:00:00.000Z`) - Date.parse(`${inicio}T00:00:00.000Z`)) / UM_DIA_MS) + 1;
}

// Variação de um indicador contra o período anterior. `pct` é nulo quando a base é zero (variação
// relativa sobre zero não existe) e a tela mostra só o valor.
export type Variacao = { atual: number; anterior: number; diferenca: number; pct: number | null };

export function variacao(atual: number, anterior: number): Variacao {
  return {
    atual,
    anterior,
    diferenca: round4(atual - anterior),
    pct: anterior === 0 ? null : round4((atual - anterior) / Math.abs(anterior))
  };
}

export type SerieDia = { data: string; faturamento: number; pessoas: number; comandas: number; temMovimento: boolean };

// Um ponto por dia do calendário, inclusive dia sem venda (zero): esconder o dia parado
// faria a tendência parecer melhor do que é.
export function montarSerieDiaria(vendas: VendaVisao[], periodo: Periodo): SerieDia[] {
  const porDia = new Map<string, { faturamento: number; pessoas: number; comandas: number }>();
  for (const v of vendas) {
    if (!ehRecebida(v.saleStatus)) continue;
    const k = toCalendarDateKey(v.movementDate);
    const atual = porDia.get(k) ?? { faturamento: 0, pessoas: 0, comandas: 0 };
    atual.faturamento += v.totalAmount;
    atual.pessoas += Math.max(0, v.people);
    atual.comandas += 1;
    porDia.set(k, atual);
  }
  const serie: SerieDia[] = [];
  const inicio = Date.parse(`${periodo.inicio}T00:00:00.000Z`);
  for (let i = 0; i < diasDoPeriodo(periodo); i += 1) {
    const data = new Date(inicio + i * UM_DIA_MS).toISOString().slice(0, 10);
    const d = porDia.get(data);
    serie.push({ data, faturamento: round2(d?.faturamento ?? 0), pessoas: d?.pessoas ?? 0, comandas: d?.comandas ?? 0, temMovimento: d !== undefined });
  }
  return serie;
}
