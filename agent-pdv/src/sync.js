#!/usr/bin/env node
// Entry point rodado pelo Agendador de Tarefas ao logon da manhã.
// Puxa o dia anterior (D-1) do Agile e envia ao backend.
//
// Também aceita CLI: node sync.js --data=2026-06-15 para forçar um dia
// específico (útil para debugging).

import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { syncPeriod } from "./sync-core.js";

function yesterdayIso() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const m = arg.match(/^--(\w+)=(.+)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { config, path: cfgPath } = await loadConfig();
  logger.info("Sync iniciado", { configPath: cfgPath });

  const target = args.data ?? yesterdayIso();
  logger.info(`Alvo: D-1 = ${target}`);

  try {
    const report = await syncPeriod(config, target, target);
    logger.info("Sync concluído com sucesso", {
      diasImportados: report.diasImportados,
      totalBruto: report.totalBruto,
      totalTickets: report.totalTickets
    });
    process.exit(0);
  } catch (err) {
    logger.error("Sync falhou", { message: err.message });
    process.exit(1);
  }
}

main();
