#!/usr/bin/env node
// Backfill dos últimos N meses (default 6). Roda uma vez na instalação
// para trazer histórico ao ERP. Divide em janelas mensais para não estourar
// o payload do backend (25 MB) e para permitir retomada em caso de falha.
//
// Uso: node backfill.js [--meses=6] [--inicio=2026-01-01] [--fim=2026-07-31]

import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { syncPeriod } from "./sync-core.js";

function isoDate(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function firstOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function lastOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function toIso(date) {
  return isoDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const m = arg.match(/^--(\w+)=(.+)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

function monthlyWindows(startIso, endIso) {
  const [sy, sm] = startIso.split("-").map(Number);
  const [ey, em] = endIso.split("-").map(Number);
  const windows = [];
  let cur = new Date(sy, sm - 1, 1);
  const stop = new Date(ey, em - 1, 1);
  while (cur <= stop) {
    const start = firstOfMonth(cur);
    const end = lastOfMonth(cur);
    // Recorta na borda do range solicitado.
    const startIsoW = toIso(start) < startIso ? startIso : toIso(start);
    const endIsoW = toIso(end) > endIso ? endIso : toIso(end);
    windows.push([startIsoW, endIsoW]);
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return windows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { config, path: cfgPath } = await loadConfig();
  logger.info("Backfill iniciado", { configPath: cfgPath });

  const meses = Number(args.meses ?? 6);
  const today = new Date();
  const endIsoDefault = toIso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
  const startDefault = new Date(today.getFullYear(), today.getMonth() - meses + 1, 1);
  const startIsoDefault = toIso(startDefault);

  const startIso = args.inicio ?? startIsoDefault;
  const endIso = args.fim ?? endIsoDefault;

  const windows = monthlyWindows(startIso, endIso);
  logger.info(`Backfill: ${windows.length} janela(s) mensal(is)`, { startIso, endIso });

  let ok = 0;
  let fail = 0;
  for (const [ws, we] of windows) {
    try {
      logger.info(`Janela ${ws} → ${we}`);
      const report = await syncPeriod(config, ws, we);
      logger.info(`Janela concluída`, {
        window: `${ws}..${we}`,
        diasImportados: report.diasImportados,
        totalBruto: report.totalBruto
      });
      ok += 1;
    } catch (err) {
      logger.error(`Janela ${ws}..${we} falhou`, { message: err.message });
      fail += 1;
    }
  }

  logger.info(`Backfill finalizado: ${ok} OK, ${fail} falha(s)`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
