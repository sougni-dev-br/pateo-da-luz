import crypto from "node:crypto";
import { prisma } from "../../config/database.js";
import { assertPeriodWritableForDate } from "../cmv-real/cmv-real.service.js";
import { ensureCompetenceOpen } from "./monthly.service.js";
import type { EventGroupRow } from "./revenue-event-group.js";

/**
 * Grava todas as linhas de um evento ou nenhuma. As travas (competência fechada, período travado)
 * são conferidas para o grupo inteiro antes de qualquer INSERT, e os INSERTs entram numa só transação.
 * Devolve os ids na ordem das linhas.
 */
export async function createEventGroup(rows: EventGroupRow[], userId: string): Promise<string[]> {
  const competences = new Map(rows.map((row) => [`${row.competenceYear}-${row.competenceMonth}`, row]));
  for (const row of competences.values()) {
    await ensureCompetenceOpen(row.competenceYear, row.competenceMonth);
  }

  const days = new Map(rows.map((row) => [row.dateKey, row.date]));
  for (const date of days.values()) {
    await assertPeriodWritableForDate(date, "Cadastro de faturamento");
  }

  const ids = rows.map(() => crypto.randomUUID());
  await prisma.$transaction(
    rows.map(
      (row, index) => prisma.$executeRaw`
        INSERT INTO "RevenueEntry" (
          "id", "date", "competenceYear", "competenceMonth", "channel", "sourcePlatform", "description",
          "grossAmount", "discounts", "platformFees", "netAmount", "serviceAmount", "tickets", "ticketAverage",
          "paymentMethod", "notes", "createdByUserId", "updatedAt"
        )
        VALUES (
          ${ids[index]}, ${row.date}, ${row.competenceYear}, ${row.competenceMonth}, ${row.channel},
          ${row.sourcePlatform}, ${row.description},
          ${row.grossAmount}, 0, 0, ${row.netAmount}, ${row.serviceAmount}, ${row.tickets}, ${row.ticketAverage},
          ${row.paymentMethod}, ${row.notes}, ${userId}, CURRENT_TIMESTAMP
        )
      `
    )
  );
  return ids;
}
