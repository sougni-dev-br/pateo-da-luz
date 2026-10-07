import type { PrismaClient } from "@prisma/client";
import { posicaoNoEvento, preverAlmoco, type DiaHistorico, type EventoNoDia, type Limites, type Previsao, type Tamanho } from "./eventos-previsao.js";

// O que o restaurante fez num dia, sempre SEM os 10% de serviço. Vem do PDV (RevenueEntry do
// Salão) quando existe; antes do PDV entrar no ERP, do histórico importado da planilha.
// Nunca soma as duas fontes.
export type Realizado = {
  fonte: "PDV" | "PLANILHA";
  almocos: number | null;
  valorAlmoco: number | null;
  jantares: number | null;
  valorJantar: number | null;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const dataUtc = (s: string) => new Date(`${s}T00:00:00Z`);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function limites(prisma: PrismaClient): Promise<Limites & { lunchCapacity: number | null }> {
  const s = await prisma.eventSettings.findUnique({ where: { id: "singleton" } });
  return { smallMaxLunch: s?.smallMaxLunch ?? 80, largeMinLunch: s?.largeMinLunch ?? 150, lunchCapacity: s?.lunchCapacity ?? null };
}

/** Preço de buffet cobrado no dia, lido das vendas do PDV. */
export type BuffetCobrado = {
  /** O buffet que mais vendeu no dia: é o preço "do dia". */
  principal: { produto: string; preco: number; vendidos: number };
  /** Outros preços do mesmo dia (pacote de grupo, vizinho, troca de preço no meio do dia). */
  outros: Array<{ produto: string; preco: number; vendidos: number }>;
};

/** Como o restaurante serviu o dia, segundo as vendas do PDV. */
export type ServicoDoPdv = {
  modalidade: "BUFFET" | "BUFFET_EXECUTIVO" | "A_LA_CARTE";
  /** Preço do buffet do dia; null quando não vendeu buffet (à la carte). */
  buffet: BuffetCobrado | null;
};

/**
 * O PDV vende o buffet como produto ("BUFFET PROMO 15", "BUFFET APJ/APR"…), cada um com o
 * preço daquele dia. O preço "do dia" é o do buffet que mais vendeu; a modalidade sai dele:
 * buffet do grupo executivo é Buffet executivo, os outros são Buffet. Dia com vendas e
 * nenhum buffet foi à la carte. Só vendas recebidas.
 * Os itens de venda só existem no ERP desde que o agente passou a mandá-los (set/2026);
 * antes disso, e em dia sem venda no PDV, vale o que a gerência anotou.
 */
export async function servicoDoPdvPorData(prisma: PrismaClient, de?: string, ate?: string): Promise<Map<string, ServicoDoPdv>> {
  const itens = await prisma.agileSaleItem.findMany({
    where: {
      saleStatus: "RECEBIDA",
      // Gravado ao meio-dia UTC, como o RevenueEntry.
      movementDate: { ...(de ? { gte: dataUtc(de) } : {}), ...(ate ? { lt: new Date(dataUtc(ate).getTime() + 86400000) } : {}) },
    },
    select: { movementDate: true, productName: true, productGroup: true, quantity: true, totalAmount: true },
  });

  type Preco = { produto: string; preco: number; vendidos: number; executivo: boolean };
  const diasComVenda = new Set<string>();
  const porDia = new Map<string, Map<string, Preco>>();
  for (const item of itens) {
    const data = iso(item.movementDate);
    diasComVenda.add(data);
    const produto = item.productName.replace(/\s+/g, " ").trim();
    if (!/^buffet/i.test(produto)) continue;
    const quantidade = Number(item.quantity);
    if (quantidade <= 0) continue;
    const preco = Math.round((Number(item.totalAmount) / quantidade) * 100) / 100;
    const executivo = /execut/i.test(`${produto} ${item.productGroup ?? ""}`);
    const dia = porDia.get(data) ?? new Map<string, Preco>();
    const chave = `${produto}|${preco}`;
    const atual = dia.get(chave) ?? { produto, preco, vendidos: 0, executivo };
    atual.vendidos += quantidade;
    dia.set(chave, atual);
    porDia.set(data, dia);
  }

  const mapa = new Map<string, ServicoDoPdv>();
  for (const data of diasComVenda) {
    const precos = porDia.get(data);
    if (!precos) {
      mapa.set(data, { modalidade: "A_LA_CARTE", buffet: null });
      continue;
    }
    const ordenados = [...precos.values()].sort((a, b) => b.vendidos - a.vendidos || b.preco - a.preco);
    const semMarca = ({ produto, preco, vendidos }: Preco) => ({ produto, preco, vendidos });
    mapa.set(data, {
      modalidade: ordenados[0].executivo ? "BUFFET_EXECUTIVO" : "BUFFET",
      buffet: { principal: semMarca(ordenados[0]), outros: ordenados.slice(1).map(semMarca) },
    });
  }
  return mapa;
}

export async function realizadoPorData(prisma: PrismaClient, de?: string, ate?: string): Promise<Map<string, Realizado>> {
  // O RevenueEntry grava a data ao meio-dia UTC: "até" vira "antes do dia seguinte",
  // senão o último dia do intervalo some.
  const diaSeguinte = (s: string) => new Date(dataUtc(s).getTime() + 86400000);
  const filtroData = (campo: "date") => ({
    [campo]: { ...(de ? { gte: dataUtc(de) } : {}), ...(ate ? { lt: diaSeguinte(ate) } : {}) },
  });
  const [pdv, legado] = await Promise.all([
    prisma.revenueEntry.findMany({
      where: { channel: "Salão", status: "ACTIVE", ...filtroData("date") },
      select: { date: true, peopleFirstShift: true, salesFirstShift: true, shift1Service: true, peopleSecondShift: true, salesSecondShift: true, shift2Service: true },
    }),
    prisma.operationDay.findMany({
      // Dia só com jantar na planilha também conta.
      where: { OR: [{ legacyLunchPeople: { not: null } }, { legacyDinnerPeople: { not: null } }], ...filtroData("date") },
      select: { date: true, legacyLunchPeople: true, legacyLunchSales: true, legacyDinnerPeople: true, legacyDinnerSales: true },
    }),
  ]);

  const mapa = new Map<string, Realizado>();
  for (const l of legado) {
    mapa.set(iso(l.date), {
      fonte: "PLANILHA",
      almocos: l.legacyLunchPeople,
      valorAlmoco: num(l.legacyLunchSales),
      jantares: l.legacyDinnerPeople,
      valorJantar: num(l.legacyDinnerSales),
    });
  }
  // O PDV ganha do histórico na mesma data. Mais de um lançamento do Salão no dia é somado.
  // Lançamento sem número de pessoas (digitado à mão, antes do agente do PDV) não serve:
  // viraria "0 almoços" e puxaria a previsão para baixo.
  const doPdv = new Map<string, Realizado>();
  for (const r of pdv) {
    if (r.peopleFirstShift === null) continue;
    const d = iso(r.date);
    const atual = doPdv.get(d) ?? { fonte: "PDV" as const, almocos: 0, valorAlmoco: 0, jantares: 0, valorJantar: 0 };
    atual.almocos! += r.peopleFirstShift ?? 0;
    atual.valorAlmoco! += Number(r.salesFirstShift) - Number(r.shift1Service);
    atual.jantares! += r.peopleSecondShift ?? 0;
    atual.valorJantar! += Number(r.salesSecondShift) - Number(r.shift2Service);
    doPdv.set(d, atual);
  }
  for (const [d, r] of doPdv) {
    mapa.set(d, { ...r, valorAlmoco: Math.round(r.valorAlmoco! * 100) / 100, valorJantar: Math.round(r.valorJantar! * 100) / 100 });
  }
  return mapa;
}

export type EventoDoDia = EventoNoDia & {
  editionId: string;
  editionTitle: string;
  dia: number;
  totalDias: number;
  startTime: string | null;
  endTime: string | null;
};

/** Eventos por data. Busca as edições inteiras para saber em que ponto do evento cada dia cai. */
export async function eventosPorData(prisma: PrismaClient, de?: string, ate?: string): Promise<Map<string, EventoDoDia[]>> {
  const edicoes = await prisma.eventEdition.findMany({
    where: {
      ...(ate ? { startDate: { lte: dataUtc(ate) } } : {}),
      ...(de ? { endDate: { gte: dataUtc(de) } } : {}),
    },
    include: { series: { select: { id: true, name: true, origin: true } }, days: { orderBy: { date: "asc" } } },
  });
  const mapa = new Map<string, EventoDoDia[]>();
  for (const ed of edicoes) {
    ed.days.forEach((dia, indice) => {
      const d = iso(dia.date);
      if ((de && d < de) || (ate && d > ate)) return;
      const lista = mapa.get(d) ?? [];
      lista.push({
        seriesId: ed.series.id,
        seriesName: ed.series.name,
        origin: ed.series.origin,
        posicao: posicaoNoEvento(indice, ed.days.length),
        editionId: ed.id,
        editionTitle: ed.title,
        dia: indice + 1,
        totalDias: ed.days.length,
        startTime: dia.startTime,
        endTime: dia.endTime,
      });
      mapa.set(d, lista);
    });
  }
  return mapa;
}

/** Todos os dias que já aconteceram com evento e almoço registrado: a base da previsão. */
export async function historicoParaPrevisao(prisma: PrismaClient, ate: string): Promise<DiaHistorico[]> {
  const [eventos, realizado] = await Promise.all([eventosPorData(prisma, undefined, ate), realizadoPorData(prisma, undefined, ate)]);
  const historico: DiaHistorico[] = [];
  for (const [date, lista] of eventos) {
    const r = realizado.get(date);
    if (r?.almocos === null || r?.almocos === undefined) continue;
    historico.push({ date, lunch: r.almocos, eventos: lista });
  }
  return historico.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export type DiaDaAgenda = {
  date: string;
  eventos: EventoDoDia[];
  previsao: Previsao | null;
  realizado: Realizado | null;
  /** Marcação P/M/G da Escala para a data. */
  escala: Tamanho | null;
  /** Preço do buffet cobrado no dia, lido das vendas do PDV. */
  buffetCobrado: BuffetCobrado | null;
  /** Modalidade pelo PDV (Buffet, executivo ou à la carte); null em dia sem venda no PDV. */
  modalidadePdv: ServicoDoPdv["modalidade"] | null;
  decisao: { serviceMode: string | null; buffetPrice: number | null; notes: string | null; forecastLunch: number | null; forecastSize: string | null } | null;
};

export async function agendaDoMes(prisma: PrismaClient, ano: number, mes: number): Promise<{ dias: DiaDaAgenda[]; limites: Awaited<ReturnType<typeof limites>> }> {
  const de = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const ate = `${ano}-${String(mes).padStart(2, "0")}-${String(ultimo).padStart(2, "0")}`;

  const [lim, eventos, realizado, escala, decisoes, historico, buffet] = await Promise.all([
    limites(prisma),
    eventosPorData(prisma, de, ate),
    realizadoPorData(prisma, de, ate),
    prisma.scheduleDayEvent.findMany({ where: { date: { gte: dataUtc(de), lte: dataUtc(ate) } } }),
    prisma.operationDay.findMany({ where: { date: { gte: dataUtc(de), lte: dataUtc(ate) } } }),
    historicoParaPrevisao(prisma, ate),
    servicoDoPdvPorData(prisma, de, ate),
  ]);
  const escalaPorData = new Map(escala.map((e) => [iso(e.date), e.size as Tamanho]));
  const decisaoPorData = new Map(decisoes.map((d) => [iso(d.date), d]));

  const dias: DiaDaAgenda[] = [];
  for (let dia = 1; dia <= ultimo; dia++) {
    const date = `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    const lista = eventos.get(date) ?? [];
    const decisao = decisaoPorData.get(date);
    dias.push({
      date,
      eventos: lista,
      previsao: preverAlmoco({ date, eventos: lista }, historico, lim),
      realizado: realizado.get(date) ?? null,
      escala: escalaPorData.get(date) ?? null,
      buffetCobrado: buffet.get(date)?.buffet ?? null,
      modalidadePdv: buffet.get(date)?.modalidade ?? null,
      decisao: decisao
        ? {
            serviceMode: decisao.serviceMode,
            buffetPrice: num(decisao.buffetPrice),
            notes: decisao.notes,
            forecastLunch: decisao.forecastLunch,
            forecastSize: decisao.forecastSize,
          }
        : null,
    });
  }
  return { dias, limites: lim };
}

/** Ficha do evento: todas as edições lado a lado, dia a dia, com os outros eventos do mesmo dia. */
export async function fichaDaSerie(prisma: PrismaClient, seriesId: string) {
  const serie = await prisma.eventSeries.findUnique({
    where: { id: seriesId },
    include: { editions: { orderBy: { startDate: "desc" }, include: { days: { orderBy: { date: "asc" } } } } },
  });
  if (!serie) return null;
  const datas = serie.editions.flatMap((e) => e.days.map((d) => iso(d.date))).sort();
  const de = datas[0];
  const ate = datas[datas.length - 1];
  const [realizado, eventos, notas, buffet] = de
    ? await Promise.all([
        realizadoPorData(prisma, de, ate),
        eventosPorData(prisma, de, ate),
        prisma.operationDay.findMany({ where: { date: { in: datas.map(dataUtc) } }, select: { date: true, notes: true, serviceMode: true, buffetPrice: true } }),
        servicoDoPdvPorData(prisma, de, ate),
      ])
    : [new Map<string, Realizado>(), new Map<string, EventoDoDia[]>(), [], new Map<string, ServicoDoPdv>()];
  const notaPorData = new Map(notas.map((n) => [iso(n.date), n]));

  return {
    id: serie.id,
    name: serie.name,
    origin: serie.origin,
    area: serie.area,
    organizer: serie.organizer,
    notes: serie.notes,
    editions: serie.editions.map((ed) => ({
      id: ed.id,
      title: ed.title,
      startDate: iso(ed.startDate),
      endDate: iso(ed.endDate),
      announcedAudience: ed.announcedAudience,
      floor: ed.floor,
      contact: ed.contact,
      source: ed.source,
      notes: ed.notes,
      days: ed.days.map((dia, indice) => {
        const d = iso(dia.date);
        const op = notaPorData.get(d);
        return {
          date: d,
          dia: indice + 1,
          totalDias: ed.days.length,
          startTime: dia.startTime,
          endTime: dia.endTime,
          realizado: realizado.get(d) ?? null,
          // Dia compartilhado: o faturamento é do restaurante, não só deste evento.
          outrosEventos: (eventos.get(d) ?? []).filter((e) => e.seriesId !== serie.id).map((e) => ({ seriesId: e.seriesId, seriesName: e.seriesName, dia: e.dia, totalDias: e.totalDias })),
          notes: op?.notes ?? null,
          serviceMode: op?.serviceMode ?? null,
          buffetPrice: num(op?.buffetPrice),
          buffetCobrado: buffet.get(d)?.buffet ?? null,
          modalidadePdv: buffet.get(d)?.modalidade ?? null,
        };
      }),
    })),
  };
}

/** Lista de séries com um resumo para a busca. */
export async function listaDeSeries(prisma: PrismaClient) {
  const series = await prisma.eventSeries.findMany({
    orderBy: { name: "asc" },
    include: { editions: { select: { startDate: true, endDate: true, days: { select: { date: true } } } } },
  });
  const realizado = await realizadoPorData(prisma);
  return series.map((s) => {
    const datas = s.editions.flatMap((e) => e.days.map((d) => iso(d.date)));
    const almocos = datas.map((d) => realizado.get(d)?.almocos).filter((n): n is number => typeof n === "number");
    const ultima = s.editions.map((e) => iso(e.startDate)).sort().pop() ?? null;
    return {
      id: s.id,
      name: s.name,
      origin: s.origin,
      area: s.area,
      edicoes: s.editions.length,
      ultimaEdicao: ultima,
      diasComMovimento: almocos.length,
      mediaAlmocos: almocos.length ? Math.round(almocos.reduce((a, b) => a + b, 0) / almocos.length) : null,
    };
  });
}
