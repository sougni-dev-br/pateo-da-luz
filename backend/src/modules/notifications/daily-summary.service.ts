import { prisma } from "../../config/database.js";
import { REVENUE_CHANNEL_SALON } from "../monthly/revenue-channels.js";

// Constrói o texto do resumo diário do Pateo da Luz para envio via WhatsApp.
//
// Fontes de dados (todas já em produção):
// - Salão (Agile PDV): RevenueEntry com channel="Salão", sourcePlatform="AGILE_PDV".
//   Cada dia = 1 linha, já com breakdown por turno (salesFirstShift/salesSecondShift,
//   shift1Service/shift2Service, ticketsFirstShift/ticketsSecondShift) e peopleServed total.
// - Eventos: RevenueEntry com channel="Eventos / Empreitada", 0..N linhas por dia.
// - Delivery iFood: agregado direto de IfoodSale por orderDate (⚠️ homologação).
// - Delivery 99Food: agregado direto de NoventaNoveSale por orderDate (⚠️ homologação).
// - Keeta: sem integração diária — linha estática (⚠️ homologação).

const SALON_CHANNEL = REVENUE_CHANNEL_SALON;
const AGILE_SOURCE = "AGILE_PDV";
const EVENT_CHANNEL = "Eventos / Empreitada";

type ShiftBreakdown = {
  bruto: number;
  gorjeta: number;
  liquido: number;
  mesas: number;
};

type EventItem = {
  description: string;
  bruto: number;
};

type DeliveryPlatform = {
  name: string;
  bruto: number;
  liquido: number;
  pedidos: number;
  homologacao: boolean;
  semIntegracao?: boolean;
};

type MonthlyTotals = {
  bruto: number;
  liquido: number;
  gorjeta: number;
};

// Formata número em BRL. Sem símbolo — quem chama coloca "R$ ".
function fmtBRL(value: number): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? "0,0%" : "N/A";
  const pct = ((current - previous) / previous) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1).replace(".", ",")}%`;
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  // Prisma Decimal has toString/toNumber
  const asAny = value as { toNumber?: () => number; toString: () => string };
  if (typeof asAny.toNumber === "function") return asAny.toNumber();
  const parsed = Number(asAny.toString());
  return Number.isFinite(parsed) ? parsed : 0;
}

// Retorna o intervalo [start, endExclusive) em UTC para uma data YYYY-MM-DD
// tratada como dia no fuso America/Sao_Paulo. Isso evita off-by-one quando
// o servidor Render roda em UTC — se um evento foi lançado às 23h em SP,
// ele deve entrar no dia SP correto, não no seguinte.
function dayRangeSP(date: string): { start: Date; endExclusive: Date } {
  // -03:00 fixo — o Brasil não observa mais horário de verão desde 2019.
  const start = new Date(`${date}T00:00:00-03:00`);
  const endExclusive = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, endExclusive };
}

// Retorna YYYY-MM-DD para "hoje" em São Paulo. Usado como default quando
// o caller não passa data explícita.
export function todayInSP(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(now);
}

// ─── Salão ──────────────────────────────────────────────────────────────────

type SalaoData = {
  turnoAlmoco: ShiftBreakdown;
  turnoJantar: ShiftBreakdown;
  outrosBruto: number; // vendas com turno != Almoço/Jantar (não perde valor)
  pessoas: number;
};

async function fetchSalao(date: string): Promise<SalaoData> {
  const row = await prisma.revenueEntry.findFirst({
    where: {
      channel: SALON_CHANNEL,
      sourcePlatform: AGILE_SOURCE,
      status: "ACTIVE",
      date: dayRangeSP(date).start
    }
  });

  if (!row) {
    return {
      turnoAlmoco: { bruto: 0, gorjeta: 0, liquido: 0, mesas: 0 },
      turnoJantar: { bruto: 0, gorjeta: 0, liquido: 0, mesas: 0 },
      outrosBruto: 0,
      pessoas: 0
    };
  }

  const brutoTotal = toNumber(row.grossAmount);
  const brutoT1 = toNumber(row.salesFirstShift);
  const brutoT2 = toNumber(row.salesSecondShift);
  const gorjetaT1 = toNumber(row.shift1Service);
  const gorjetaT2 = toNumber(row.shift2Service);

  return {
    turnoAlmoco: {
      bruto: brutoT1,
      gorjeta: gorjetaT1,
      liquido: brutoT1 - gorjetaT1,
      mesas: row.ticketsFirstShift ?? 0
    },
    turnoJantar: {
      bruto: brutoT2,
      gorjeta: gorjetaT2,
      liquido: brutoT2 - gorjetaT2,
      mesas: row.ticketsSecondShift ?? 0
    },
    outrosBruto: Math.max(0, brutoTotal - brutoT1 - brutoT2),
    pessoas: row.peopleServed ?? 0
  };
}

// ─── Eventos ────────────────────────────────────────────────────────────────

async function fetchEventos(date: string): Promise<EventItem[]> {
  const { start, endExclusive } = dayRangeSP(date);
  const rows = await prisma.revenueEntry.findMany({
    where: {
      channel: EVENT_CHANNEL,
      status: "ACTIVE",
      date: { gte: start, lt: endExclusive }
    },
    orderBy: { createdAt: "asc" }
  });
  return rows.map((r) => ({
    description: r.description || r.sourcePlatform || "Evento",
    bruto: toNumber(r.grossAmount)
  }));
}

function aggregateEventos(items: EventItem[]): { bruto: number; servico: number; liquido: number } {
  // Eventos usam a mesma convenção do salão: serviço = 10% do bruto.
  const bruto = items.reduce((acc, e) => acc + e.bruto, 0);
  const servico = Number((bruto * 0.1).toFixed(2));
  return { bruto, servico, liquido: bruto - servico };
}

// ─── Delivery (iFood + 99Food) ──────────────────────────────────────────────

async function fetchIfood(date: string): Promise<DeliveryPlatform> {
  const { start, endExclusive } = dayRangeSP(date);
  const rows = await prisma.ifoodSale.findMany({
    where: { orderDate: { gte: start, lt: endExclusive } },
    select: { grossAmount: true, netAmount: true }
  });
  const bruto = rows.reduce((acc, r) => acc + toNumber(r.grossAmount), 0);
  const liquido = rows.reduce((acc, r) => acc + toNumber(r.netAmount), 0);
  return {
    name: "iFood",
    bruto,
    liquido,
    pedidos: rows.length,
    homologacao: true // remover quando iFood sair de homologação
  };
}

async function fetch99Food(date: string): Promise<DeliveryPlatform> {
  const { start, endExclusive } = dayRangeSP(date);
  const rows = await prisma.noventaNoveSale.findMany({
    where: { orderDate: { gte: start, lt: endExclusive } },
    select: { grossAmount: true, netAmount: true }
  });
  const bruto = rows.reduce((acc, r) => acc + toNumber(r.grossAmount), 0);
  const liquido = rows.reduce((acc, r) => acc + toNumber(r.netAmount), 0);
  return {
    name: "99Food",
    bruto,
    liquido,
    pedidos: rows.length,
    homologacao: true // remover quando 99Food sair de homologação
  };
}

function keetaPlaceholder(): DeliveryPlatform {
  return {
    name: "Keeta",
    bruto: 0,
    liquido: 0,
    pedidos: 0,
    homologacao: true,
    semIntegracao: true
  };
}

// ─── Mês vs mês anterior ────────────────────────────────────────────────────

// Totais mensais = soma de todos os RevenueEntry não-cancelados na COMPETÊNCIA
// (competenceYear/competenceMonth) do intervalo, até a data-limite (date < endExclusive).
// Bate com o cálculo da tela de Faturamento (dashboard.routes.ts:200-213), que também
// filtra por competência e status <> 'CANCELLED', mas amarrado ao "até hoje".
// Não somamos IfoodSale/NoventaNoveSale por cima — delivery já foi consolidado no
// RevenueEntry pelo sync existente; somar duas vezes dobra o valor.
async function fetchMonthlyTotals(
  competenceYear: number,
  competenceMonth: number,
  endExclusive: Date
): Promise<MonthlyTotals> {
  const revenue = await prisma.revenueEntry.aggregate({
    where: {
      competenceYear,
      competenceMonth,
      status: { not: "CANCELLED" },
      date: { lt: endExclusive }
    },
    _sum: {
      grossAmount: true,
      netAmount: true,
      serviceAmount: true
    }
  });

  return {
    bruto: toNumber(revenue._sum.grossAmount),
    liquido: toNumber(revenue._sum.netAmount),
    gorjeta: toNumber(revenue._sum.serviceAmount)
  };
}

// Constrói os dois intervalos: [1º dia do mês, dia_atual+1) e o equivalente
// no mês anterior. Datas em SP.
function monthRanges(date: string): {
  atual: { competenceYear: number; competenceMonth: number; endExclusive: Date; label: string };
  anterior: { competenceYear: number; competenceMonth: number; endExclusive: Date };
} {
  const [y, m, d] = date.split("-").map(Number);
  const { endExclusive: atualEnd } = dayRangeSP(date);

  // Mês anterior. Se janeiro → ano-1.
  const prevMonth = m === 1 ? 12 : m - 1;
  const prevYear = m === 1 ? y - 1 : y;
  const prevMonthStr = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;

  // Dia atual pode não existir no mês anterior (ex.: 31/03 → não existe 31/02).
  // Nesse caso, cap no último dia do mês anterior.
  const lastDayPrev = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
  const capDay = Math.min(d, lastDayPrev);
  const prevDateStr = `${prevMonthStr}-${String(capDay).padStart(2, "0")}`;
  const { endExclusive: anteriorEnd } = dayRangeSP(prevDateStr);

  return {
    atual: {
      competenceYear: y,
      competenceMonth: m,
      endExclusive: atualEnd,
      label: `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`
    },
    anterior: {
      competenceYear: prevYear,
      competenceMonth: prevMonth,
      endExclusive: anteriorEnd
    }
  };
}

// ─── Formatação da mensagem ─────────────────────────────────────────────────

// Formatação para WhatsApp:
// - Fonte é PROPORCIONAL — nunca tentar alinhar colunas com espaços.
// - Divisores longos "━━━" quebram feio no mobile — usar linha em branco.
// - `*negrito*` e `_itálico_` são renderizados nativamente pelo WhatsApp.
// - Linhas curtas para não sofrer reflow em telas estreitas.

function formatTurno(icon: string, label: string, s: ShiftBreakdown): string {
  return [
    `*${icon} ${label}*`,
    `Bruto: R$ ${fmtBRL(s.bruto)}`,
    `Gorjeta: R$ ${fmtBRL(s.gorjeta)}`,
    `Líquido: R$ ${fmtBRL(s.liquido)}`,
    `Mesas: ${s.mesas}`
  ].join("\n");
}

function formatEventos(items: EventItem[]): string {
  if (items.length === 0) return "";
  const { bruto, servico, liquido } = aggregateEventos(items);
  const linhas = items.map((e) => `• ${e.description} — R$ ${fmtBRL(e.bruto)}`);
  return [
    `*🎉 Eventos (${items.length})*`,
    ...linhas,
    `Bruto: R$ ${fmtBRL(bruto)}`,
    `Serviço: R$ ${fmtBRL(servico)}`,
    `Líquido: R$ ${fmtBRL(liquido)}`
  ].join("\n");
}

// Bloco Delivery agora é lista com bullets curtos. Uma única marca
// "(em homologação)" no cabeçalho, em vez de tag repetida por plataforma.
// Enquanto todas estão em homologação a nota fica; quando alguma sair,
// removemos.
function formatDeliveryBlock(platforms: DeliveryPlatform[]): string {
  const todasHomologacao = platforms.every((p) => p.homologacao);
  const header = todasHomologacao ? "*🛵 Delivery* _(em homologação)_" : "*🛵 Delivery*";
  const linhas = platforms.map((p) => {
    if (p.semIntegracao) return `• ${p.name} — sem integração diária`;
    return `• ${p.name} — R$ ${fmtBRL(p.bruto)} · ${p.pedidos} pedidos`;
  });
  return [header, ...linhas].join("\n");
}

export type DailySummaryResult = {
  date: string;
  text: string;
};

export async function buildDailySummary(dateInput?: string): Promise<DailySummaryResult> {
  const date = dateInput ?? todayInSP();

  const [salao, eventos, ifood, noventa, ranges] = await Promise.all([
    fetchSalao(date),
    fetchEventos(date),
    fetchIfood(date),
    fetch99Food(date),
    Promise.resolve(monthRanges(date))
  ]);

  const [totaisAtual, totaisAnterior] = await Promise.all([
    fetchMonthlyTotals(ranges.atual.competenceYear, ranges.atual.competenceMonth, ranges.atual.endExclusive),
    fetchMonthlyTotals(ranges.anterior.competenceYear, ranges.anterior.competenceMonth, ranges.anterior.endExclusive)
  ]);

  // Ticket médio por pessoa (dia inteiro, salão + eventos).
  const eventosAgg = aggregateEventos(eventos);
  const brutoDia =
    salao.turnoAlmoco.bruto +
    salao.turnoJantar.bruto +
    salao.outrosBruto +
    eventosAgg.bruto +
    ifood.bruto +
    noventa.bruto;
  const gorjetaDia = salao.turnoAlmoco.gorjeta + salao.turnoJantar.gorjeta + eventosAgg.servico;
  const liquidoDia =
    salao.turnoAlmoco.liquido +
    salao.turnoJantar.liquido +
    salao.outrosBruto + // "outros" não tem breakdown de gorjeta separado no salão
    eventosAgg.liquido +
    ifood.liquido +
    noventa.liquido;
  const mesasDia = salao.turnoAlmoco.mesas + salao.turnoJantar.mesas;
  const ticketPorPessoa =
    salao.pessoas > 0 ? Math.round((liquidoDia / salao.pessoas) * 100) / 100 : 0;

  const dd = date.slice(8, 10);
  const mm = date.slice(5, 7);

  const secoes: string[] = [];
  secoes.push(`*📊 Pateo da Luz — ${dd}/${mm}*`);
  secoes.push("");
  secoes.push(formatTurno("🍽️", "1º turno (Almoço)", salao.turnoAlmoco));
  secoes.push("");
  secoes.push(formatTurno("🌙", "2º turno (Jantar)", salao.turnoJantar));

  if (salao.outrosBruto > 0) {
    secoes.push("");
    secoes.push(`_ℹ️ Outros (não-turno): R$ ${fmtBRL(salao.outrosBruto)}_`);
  }

  const eventosBloco = formatEventos(eventos);
  if (eventosBloco) {
    secoes.push("");
    secoes.push(eventosBloco);
  }

  secoes.push("");
  secoes.push(formatDeliveryBlock([ifood, noventa, keetaPlaceholder()]));

  secoes.push("");
  secoes.push("*📈 Consolidado do dia*");
  secoes.push(`Bruto: R$ ${fmtBRL(brutoDia)}`);
  secoes.push(`Gorjeta/Serviço: R$ ${fmtBRL(gorjetaDia)}`);
  secoes.push(`Líquido: R$ ${fmtBRL(liquidoDia)}`);
  secoes.push(`Mesas: ${mesasDia} · Pessoas: ${salao.pessoas}`);
  if (ticketPorPessoa > 0) {
    secoes.push(`Ticket médio (por pessoa): R$ ${fmtBRL(ticketPorPessoa)}`);
  }

  secoes.push("");
  secoes.push(`*📅 Mês até ${ranges.atual.label}*`);
  secoes.push(`Bruto: R$ ${fmtBRL(totaisAtual.bruto)}`);
  secoes.push(
    `_mês anterior: R$ ${fmtBRL(totaisAnterior.bruto)} (${fmtPct(totaisAtual.bruto, totaisAnterior.bruto)})_`
  );
  secoes.push(`Líquido: R$ ${fmtBRL(totaisAtual.liquido)}`);
  secoes.push(
    `_mês anterior: R$ ${fmtBRL(totaisAnterior.liquido)} (${fmtPct(totaisAtual.liquido, totaisAnterior.liquido)})_`
  );
  secoes.push(`Gorjeta: R$ ${fmtBRL(totaisAtual.gorjeta)}`);
  secoes.push(
    `_mês anterior: R$ ${fmtBRL(totaisAnterior.gorjeta)} (${fmtPct(totaisAtual.gorjeta, totaisAnterior.gorjeta)})_`
  );

  return { date, text: secoes.join("\n") };
}
