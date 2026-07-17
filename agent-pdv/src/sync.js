#!/usr/bin/env node
// Entry point rodado pelo Agendador de Tarefas em 3 momentos:
//   - Ao logon (pega dias que ficaram para tras se maquina esteve off)
//   - Diario 16:00 (pega o dia corrente ate a hora do almoco fechado)
//   - Diario 22:00 (pega o dia corrente ao fim do jantar)
//
// Por padrao sincroniza os ULTIMOS 5 DIAS em cada execucao. Isso torna
// o sistema auto-recuperavel:
//   - Se um dia falhou anteriormente, o proximo run recupera.
//   - Se a maquina ficou 4 dias off, o proximo run recupera todos.
//   - O backend eh idempotente: reimportar o mesmo dia so faz UPDATE.
//
// Aceita CLI para debugging:
//   node sync.js --data=2026-06-15                 → sincroniza 1 dia
//   node sync.js --inicio=2026-06-01 --fim=06-05   → sincroniza intervalo
//   node sync.js --dias=10                         → ultimos 10 dias

import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { syncPeriod } from "./sync-core.js";

const DIAS_PADRAO = 5;

function toIso(d) {
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

function resolvePeriod(args) {
  if (args.data) return { start: args.data, end: args.data };
  if (args.inicio && args.fim) return { start: args.inicio, end: args.fim };
  const dias = Math.max(1, Number(args.dias ?? DIAS_PADRAO));
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - (dias - 1));
  return { start: toIso(startDate), end: toIso(today) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { config, path: cfgPath } = await loadConfig();
  logger.info("Sync iniciado", { configPath: cfgPath });

  const { start, end } = resolvePeriod(args);
  logger.info(`Alvo: ${start === end ? start : `${start} → ${end}`}`);

  try {
    const report = await syncPeriod(config, start, end);
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
