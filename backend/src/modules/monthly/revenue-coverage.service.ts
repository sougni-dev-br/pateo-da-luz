import { prisma } from "../../config/database.js";
import type { SaudeAgente } from "../integrations/agile/agile-heartbeat.health.js";
import { obterSaudeAgente } from "../integrations/agile/agile-heartbeat.service.js";
import { PLATAFORMA_DO_AGENTE, ROTULO_DO_AGENTE } from "../integrations/delivery/keeta/keeta-agente.constantes.js";
import {
  calcularCobertura,
  canalDaLinha,
  type CanalDeCobertura,
  type CoberturaDoCanal
} from "./revenue-coverage.js";

const BRT_OFFSET_MS = 3 * 3_600_000;

type LinhaCrua = { date: string; channel: string; sourcePlatform: string | null };

/** Hoje no calendário de Brasília — o servidor roda em UTC e viraria o dia às 21h. */
export function hojeEmBrasilia(agora: number = Date.now()): string {
  return new Date(agora - BRT_OFFSET_MS).toISOString().slice(0, 10);
}

function limitesDoMes(year: number, month: number) {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const ultimo = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from, to: `${year}-${String(month).padStart(2, "0")}-${String(ultimo).padStart(2, "0")}` };
}

export async function getRevenueCoverage(params: { year: number; month: number }): Promise<{
  period: { year: number; month: number; from: string; to: string };
  today: string;
  channels: CoberturaDoCanal[];
  agenteKeeta: SaudeAgente;
}> {
  const { from, to } = limitesDoMes(params.year, params.month);
  const today = hojeEmBrasilia();

  const rows = await prisma.$queryRaw<LinhaCrua[]>`
    SELECT DISTINCT to_char("date" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "date", "channel", "sourcePlatform"
    FROM "RevenueEntry"
    WHERE "status" <> 'CANCELLED'
      AND "date" >= ${new Date(`${from}T00:00:00Z`)}
      AND "date" <= ${new Date(`${to}T23:59:59Z`)}
  `;
  const ultimos = await prisma.$queryRaw<LinhaCrua[]>`
    SELECT to_char(MAX("date" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS "date", "channel", "sourcePlatform"
    FROM "RevenueEntry"
    WHERE "status" <> 'CANCELLED'
    GROUP BY "channel", "sourcePlatform"
  `;

  const ultimoDiaGeral: Partial<Record<CanalDeCobertura, string>> = {};
  for (const linha of ultimos) {
    const canal = canalDaLinha(linha);
    if (canal && (!ultimoDiaGeral[canal] || linha.date > ultimoDiaGeral[canal]!)) ultimoDiaGeral[canal] = linha.date;
  }

  return {
    period: { year: params.year, month: params.month, from, to },
    today,
    channels: calcularCobertura({ from, to, today, rows, ultimoDiaGeral }),
    // A Keeta entra por um agente na PDVTOUCH: o cartão dela mostra se o agente está vivo ou pediu login.
    agenteKeeta: await obterSaudeAgente(new Date(), PLATAFORMA_DO_AGENTE, ROTULO_DO_AGENTE)
  };
}
