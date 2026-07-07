import crypto from "node:crypto";
import { prisma } from "../../../config/database.js";
import { createCalendarDate } from "../../../shared/utils/calendar-date.js";
import type {
  AgileSyncPayload,
  AgileSyncReport,
  AgileSyncStatus,
  AgileVenda,
  AgilePagamento
} from "./agile-sync.types.js";

// Origem fixa desta integração — usada para separar do faturamento manual
// e das outras origens (Delivery, iFood, etc). Toda linha vinda do Agile PDV
// carrega essa marca e vive isolada.
// "Salão" com acento é o mesmo channel usado por RevenueEntry manuais.
// Isso permite que a tela existente de Faturamento também exiba as entradas
// do Agile, filtradas pelo sourcePlatform quando necessário.
const CHANNEL = "Salão";
const SOURCE_PLATFORM = "AGILE_PDV";

// O CSV usa "RECEBIDA" para venda válida e "CANCELADA" para cancelada.
// Só faturamos as recebidas — canceladas viram contador de aviso.
const SITUACAO_RECEBIDA = "RECEBIDA";

// Turnos: o Agile grava "Almoço" e "Jantar" (com acento). O comparador é
// case+accent insensitive porque já vi variação em outros exports.
function normalizarTurno(turno: string): "PRIMEIRO" | "SEGUNDO" | "OUTRO" {
  const norm = turno.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toUpperCase();
  if (norm.startsWith("ALMOC")) return "PRIMEIRO";
  if (norm.startsWith("JANTAR") || norm.startsWith("NOITE")) return "SEGUNDO";
  return "OUTRO";
}

// Mapeia meio de pagamento do Agile para um dos 5 buckets do RevenueEntry.
// Tudo que não bate cai em voucherAmount (bucket "outros") para não perder valor.
function classificarMeioPagamento(meio: string): "cash" | "pix" | "debit" | "credit" | "voucher" {
  const norm = meio.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toUpperCase();
  if (norm.includes("DINHEIRO")) return "cash";
  if (norm.includes("PIX")) return "pix";
  if (norm.includes("DEBITO")) return "debit";
  if (norm.includes("CREDITO")) return "credit";
  return "voucher";
}

type DayAggregate = {
  date: string; // YYYY-MM-DD
  weekdayName: string | null;
  vendasRecebidas: Map<string, AgileVenda>; // nrseqvenda -> venda
  vendasCanceladas: number;
  pagamentos: AgilePagamento[];
};

// Agrupa as linhas dos CSVs por data. Trabalhamos com nrseqvenda como
// chave para deduplicar caso o mesmo pedido apareça em múltiplas
// linhas do CSV (defensivo — não deveria acontecer, mas o export do Agile
// já surpreendeu antes).
function agruparPorDia(payload: AgileSyncPayload): { dias: Map<string, DayAggregate>; duplicatasNrseqvenda: number } {
  const dias = new Map<string, DayAggregate>();
  // O export do Agile ocasionalmente emite a mesma nrseqvenda em 2+ linhas
  // (bug conhecido do relatório, não do PDV). Deduplicamos silenciosamente
  // e contamos para retornar em `avisos`.
  const nrseqvendaVistas = new Set<string>();
  let duplicatasNrseqvenda = 0;

  function pegar(date: string, weekdayName: string | null | undefined): DayAggregate {
    let agg = dias.get(date);
    if (!agg) {
      agg = {
        date,
        weekdayName: weekdayName ?? null,
        vendasRecebidas: new Map(),
        vendasCanceladas: 0,
        pagamentos: []
      };
      dias.set(date, agg);
    }
    if (!agg.weekdayName && weekdayName) agg.weekdayName = weekdayName;
    return agg;
  }

  for (const venda of payload.vendas) {
    if (nrseqvendaVistas.has(venda.nrseqvenda)) {
      duplicatasNrseqvenda += 1;
      continue;
    }
    nrseqvendaVistas.add(venda.nrseqvenda);
    const agg = pegar(venda.dt_movimento, venda.dia_da_semana);
    if (venda.situacao_da_venda === SITUACAO_RECEBIDA) {
      agg.vendasRecebidas.set(venda.nrseqvenda, venda);
    } else {
      agg.vendasCanceladas += 1;
    }
  }

  for (const pgto of payload.pagamentos) {
    if (pgto.situacao_da_venda !== SITUACAO_RECEBIDA) continue;
    const agg = pegar(pgto.dt_movimento, null);
    agg.pagamentos.push(pgto);
  }

  return { dias, duplicatasNrseqvenda };
}

type DayEntryPayload = {
  date: Date;
  competenceYear: number;
  competenceMonth: number;
  weekdayName: string | null;
  grossAmount: number; // vl_total das vendas RECEBIDAS (com serviço)
  serviceAmount: number; // vl_servico_inf somado
  discounts: number; // vl_desconto somado
  netAmount: number; // gross - service - discounts (base tributável / receita própria)
  tickets: number;
  ticketAverage: number | null;
  salesFirstShift: number;
  ticketsFirstShift: number;
  salesSecondShift: number;
  ticketsSecondShift: number;
  cashAmount: number;
  pixAmount: number;
  debitAmount: number;
  creditAmount: number;
  voucherAmount: number;
  shift1Cash: number;
  shift1Pix: number;
  shift1Card: number;
  shift1Service: number;
  shift2Cash: number;
  shift2Pix: number;
  shift2Card: number;
  shift2Service: number;
};

function calcularDia(agg: DayAggregate): DayEntryPayload {
  let grossAmount = 0;
  let serviceAmount = 0;
  let discounts = 0;
  let salesFirstShift = 0;
  let ticketsFirstShift = 0;
  let salesSecondShift = 0;
  let ticketsSecondShift = 0;
  let shift1Service = 0;
  let shift2Service = 0;

  for (const venda of agg.vendasRecebidas.values()) {
    grossAmount += venda.vl_total;
    serviceAmount += venda.vl_servico_inf;
    discounts += venda.vl_desconto;
    const turno = normalizarTurno(venda.turno);
    if (turno === "PRIMEIRO") {
      salesFirstShift += venda.vl_total;
      ticketsFirstShift += 1;
      shift1Service += venda.vl_servico_inf;
    } else if (turno === "SEGUNDO") {
      salesSecondShift += venda.vl_total;
      ticketsSecondShift += 1;
      shift2Service += venda.vl_servico_inf;
    }
  }

  const tickets = agg.vendasRecebidas.size;
  const netAmount = grossAmount - serviceAmount;

  let cashAmount = 0;
  let pixAmount = 0;
  let debitAmount = 0;
  let creditAmount = 0;
  let voucherAmount = 0;
  let shift1Cash = 0;
  let shift1Pix = 0;
  let shift1Card = 0;
  let shift2Cash = 0;
  let shift2Pix = 0;
  let shift2Card = 0;

  for (const pgto of agg.pagamentos) {
    // Só considera pagamento cuja venda entrou como RECEBIDA no agregado.
    if (!agg.vendasRecebidas.has(pgto.nrseqvenda)) continue;
    const bucket = classificarMeioPagamento(pgto.meio_pagamento);
    const valor = pgto.vl_recebido;
    if (bucket === "cash") cashAmount += valor;
    else if (bucket === "pix") pixAmount += valor;
    else if (bucket === "debit") debitAmount += valor;
    else if (bucket === "credit") creditAmount += valor;
    else voucherAmount += valor;

    const turno = normalizarTurno(pgto.turno);
    const cartao = bucket === "debit" || bucket === "credit";
    if (turno === "PRIMEIRO") {
      if (bucket === "cash") shift1Cash += valor;
      else if (bucket === "pix") shift1Pix += valor;
      else if (cartao) shift1Card += valor;
    } else if (turno === "SEGUNDO") {
      if (bucket === "cash") shift2Cash += valor;
      else if (bucket === "pix") shift2Pix += valor;
      else if (cartao) shift2Card += valor;
    }
  }

  const [year, month, day] = agg.date.split("-").map(Number);
  const date = createCalendarDate(year, month, day);

  return {
    date,
    competenceYear: year,
    competenceMonth: month,
    weekdayName: agg.weekdayName,
    grossAmount: round2(grossAmount),
    serviceAmount: round2(serviceAmount),
    discounts: round2(discounts),
    netAmount: round2(netAmount),
    tickets,
    ticketAverage: tickets > 0 ? round2(grossAmount / tickets) : null,
    salesFirstShift: round2(salesFirstShift),
    ticketsFirstShift,
    salesSecondShift: round2(salesSecondShift),
    ticketsSecondShift,
    cashAmount: round2(cashAmount),
    pixAmount: round2(pixAmount),
    debitAmount: round2(debitAmount),
    creditAmount: round2(creditAmount),
    voucherAmount: round2(voucherAmount),
    shift1Cash: round2(shift1Cash),
    shift1Pix: round2(shift1Pix),
    shift1Card: round2(shift1Card),
    shift1Service: round2(shift1Service),
    shift2Cash: round2(shift2Cash),
    shift2Pix: round2(shift2Pix),
    shift2Card: round2(shift2Card),
    shift2Service: round2(shift2Service)
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function importAgileSync(payload: AgileSyncPayload): Promise<AgileSyncReport> {
  const { dias: agregados, duplicatasNrseqvenda } = agruparPorDia(payload);
  const dias = Array.from(agregados.values())
    .map(calcularDia)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const batchId = crypto.randomUUID();
  const avisos: string[] = [];
  const vendasCanceladasIgnoradas = Array.from(agregados.values()).reduce(
    (sum, d) => sum + d.vendasCanceladas,
    0
  );
  if (duplicatasNrseqvenda > 0) {
    avisos.push(`${duplicatasNrseqvenda} linha(s) duplicada(s) por nrseqvenda foram deduplicadas.`);
  }

  let diasCriados = 0;
  let diasAtualizados = 0;
  let vendasProcessadas = 0;
  let totalBruto = 0;
  let totalLiquido = 0;
  let totalServico = 0;
  let totalTickets = 0;

  await prisma.$transaction(async (tx) => {
    // Cria o batch mesmo se não houver dias — assim /status detecta a
    // execução do agente e o Eli sabe que rodou (mesmo em dia vazio).
    await tx.$executeRaw`
      INSERT INTO "RevenueImportBatch" (
        "id", "importFileId", "originalFileName", "sheetName",
        "competenceYear", "competenceMonth", "defaultChannel", "notes",
        "totalRows", "importedRows", "ignoredRows", "overwrittenRows", "createdAt"
      ) VALUES (
        ${batchId},
        ${`agile-sync-${batchId}`},
        ${`Agile PDV ${payload.periodoInicio}..${payload.periodoFim}`},
        ${payload.agenteHost ?? null},
        ${dias[0]?.competenceYear ?? new Date().getFullYear()},
        ${dias[0]?.competenceMonth ?? new Date().getMonth() + 1},
        ${CHANNEL},
        ${`Import Agile PDV. Vendas: ${payload.vendas.length}, Pagamentos: ${payload.pagamentos.length}, Itens: ${payload.itens.length}`},
        ${payload.vendas.length},
        0, 0, 0,
        CURRENT_TIMESTAMP
      )
    `;

    for (const dia of dias) {
      const existente = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "RevenueEntry"
        WHERE "date" = ${dia.date}
          AND "channel" = ${CHANNEL}
          AND "sourcePlatform" = ${SOURCE_PLATFORM}
        LIMIT 1
      `;

      if (existente[0]) {
        await tx.$executeRaw`
          UPDATE "RevenueEntry" SET
            "competenceYear" = ${dia.competenceYear},
            "competenceMonth" = ${dia.competenceMonth},
            "weekdayName" = ${dia.weekdayName},
            "description" = ${`Agile PDV - ${dia.weekdayName ?? ""}`.trim()},
            "grossAmount" = ${dia.grossAmount},
            "discounts" = ${dia.discounts},
            "netAmount" = ${dia.netAmount},
            "serviceAmount" = ${dia.serviceAmount},
            "tickets" = ${dia.tickets},
            "ticketAverage" = ${dia.ticketAverage},
            "salesFirstShift" = ${dia.salesFirstShift},
            "ticketsFirstShift" = ${dia.ticketsFirstShift},
            "salesSecondShift" = ${dia.salesSecondShift},
            "ticketsSecondShift" = ${dia.ticketsSecondShift},
            "cashAmount" = ${dia.cashAmount},
            "pixAmount" = ${dia.pixAmount},
            "debitAmount" = ${dia.debitAmount},
            "creditAmount" = ${dia.creditAmount},
            "voucherAmount" = ${dia.voucherAmount},
            "shift1Cash" = ${dia.shift1Cash},
            "shift1Pix" = ${dia.shift1Pix},
            "shift1Card" = ${dia.shift1Card},
            "shift1Service" = ${dia.shift1Service},
            "shift2Cash" = ${dia.shift2Cash},
            "shift2Pix" = ${dia.shift2Pix},
            "shift2Card" = ${dia.shift2Card},
            "shift2Service" = ${dia.shift2Service},
            "status" = 'ACTIVE',
            "importBatchId" = ${batchId},
            "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${existente[0].id}
        `;
        diasAtualizados += 1;
      } else {
        await tx.$executeRaw`
          INSERT INTO "RevenueEntry" (
            "id", "date", "competenceYear", "competenceMonth",
            "channel", "sourcePlatform", "description",
            "grossAmount", "discounts", "platformFees", "netAmount", "serviceAmount",
            "tickets", "ticketAverage",
            "salesFirstShift", "ticketsFirstShift", "salesSecondShift", "ticketsSecondShift",
            "repiqueAmount", "salesTables", "ticketsTables",
            "weekdayName", "paymentMethod",
            "cashAmount", "pixAmount", "debitAmount", "creditAmount", "voucherAmount",
            "shift1Cash", "shift1Pix", "shift1Card", "shift1Ticket", "shift1Service", "shift1Tcs",
            "shift2Cash", "shift2Pix", "shift2Card", "shift2Ticket", "shift2Service", "shift2Tcs",
            "tcsAmount", "status", "importBatchId", "createdAt", "updatedAt"
          ) VALUES (
            ${crypto.randomUUID()}, ${dia.date}, ${dia.competenceYear}, ${dia.competenceMonth},
            ${CHANNEL}, ${SOURCE_PLATFORM}, ${`Agile PDV - ${dia.weekdayName ?? ""}`.trim()},
            ${dia.grossAmount}, ${dia.discounts}, 0, ${dia.netAmount}, ${dia.serviceAmount},
            ${dia.tickets}, ${dia.ticketAverage},
            ${dia.salesFirstShift}, ${dia.ticketsFirstShift}, ${dia.salesSecondShift}, ${dia.ticketsSecondShift},
            0, 0, 0,
            ${dia.weekdayName}, NULL,
            ${dia.cashAmount}, ${dia.pixAmount}, ${dia.debitAmount}, ${dia.creditAmount}, ${dia.voucherAmount},
            ${dia.shift1Cash}, ${dia.shift1Pix}, ${dia.shift1Card}, 0, ${dia.shift1Service}, 0,
            ${dia.shift2Cash}, ${dia.shift2Pix}, ${dia.shift2Card}, 0, ${dia.shift2Service}, 0,
            0, 'ACTIVE', ${batchId}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
        `;
        diasCriados += 1;
      }

      vendasProcessadas += dia.tickets;
      totalBruto += dia.grossAmount;
      totalLiquido += dia.netAmount;
      totalServico += dia.serviceAmount;
      totalTickets += dia.tickets;
    }

    await tx.$executeRaw`
      UPDATE "RevenueImportBatch"
        SET "importedRows" = ${diasCriados + diasAtualizados},
            "overwrittenRows" = ${diasAtualizados},
            "ignoredRows" = ${vendasCanceladasIgnoradas}
        WHERE "id" = ${batchId}
    `;
  });

  if (vendasCanceladasIgnoradas > 0) {
    avisos.push(`${vendasCanceladasIgnoradas} venda(s) cancelada(s) foram ignoradas.`);
  }

  return {
    batchId,
    periodoInicio: payload.periodoInicio,
    periodoFim: payload.periodoFim,
    diasImportados: diasCriados + diasAtualizados,
    diasCriados,
    diasAtualizados,
    vendasProcessadas,
    vendasCanceladasIgnoradas,
    totalBruto: round2(totalBruto),
    totalLiquido: round2(totalLiquido),
    totalServico: round2(totalServico),
    totalTickets,
    avisos
  };
}

export async function getAgileSyncStatus(): Promise<AgileSyncStatus> {
  const ultimoBatch = await prisma.$queryRaw<Array<{
    id: string;
    createdAt: Date;
    importedRows: number;
    originalFileName: string | null;
  }>>`
    SELECT "id", "createdAt", "importedRows", "originalFileName"
    FROM "RevenueImportBatch"
    WHERE "importFileId" LIKE 'agile-sync-%'
    ORDER BY "createdAt" DESC
    LIMIT 1
  `;

  const total = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "RevenueEntry"
    WHERE "channel" = ${CHANNEL} AND "sourcePlatform" = ${SOURCE_PLATFORM}
  `;

  // originalFileName tem o formato "Agile PDV <inicio>..<fim>" — extrai o fim.
  let ultimoPeriodoFim: string | null = null;
  if (ultimoBatch[0]?.originalFileName) {
    const match = ultimoBatch[0].originalFileName.match(/(\d{4}-\d{2}-\d{2})$/);
    if (match) ultimoPeriodoFim = match[1];
  }

  return {
    ultimaSyncEm: ultimoBatch[0]?.createdAt ? ultimoBatch[0].createdAt.toISOString() : null,
    ultimoBatchId: ultimoBatch[0]?.id ?? null,
    ultimoPeriodoFim,
    diasImportadosUltimoBatch: ultimoBatch[0]?.importedRows ?? 0,
    totalRegistrosSalaoAgile: Number(total[0]?.count ?? 0)
  };
}
