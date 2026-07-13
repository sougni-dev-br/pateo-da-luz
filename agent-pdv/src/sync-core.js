// Núcleo do sync — usado tanto pelo sync.js (D-1) quanto pelo backfill.js.
// Recebe [inicio, fim] em ISO YYYY-MM-DD, baixa os 3 CSVs do AgileReport,
// parseia e envia para o backend. Retorna o report do backend.

import os from "node:os";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgileClient } from "./agile-client.js";
import { BackendClient } from "./backend-client.js";
import { parseFaturamento, parseMeiosPagamento, parseProdutos } from "./csv-parser.js";
import { logger } from "./logger.js";

// Lê versão do package.json em runtime — evita import assertions que
// não funcionam em Node 20.x, para portabilidade máxima na PDVTOUCH.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await readFile(path.resolve(__dirname, "..", "package.json"), "utf-8"));

export async function syncPeriod(config, isoStart, isoEnd) {
  const agile = new AgileClient(config.agileReport);
  const backend = new BackendClient({
    ...config.backend,
    retryMaxAttempts: config.sync?.retryMaxAttempts ?? 4,
    retryDelayMs: config.sync?.retryDelayMs ?? 15 * 60 * 1000
  });

  // Login uma vez antes dos 3 downloads paralelos. Se disparasse os 3
  // simultaneamente, cada um tentava logar em paralelo — o retry do login
  // multiplicava por 3, e um problema no AgileReport gerava 3 falhas
  // registradas ao mesmo tempo dificultando o diagnostico.
  await agile.login();

  const [txtFaturamento, txtMeios, txtProdutos] = await Promise.all([
    agile.downloadCsv("faturamento", isoStart, isoEnd),
    agile.downloadCsv("meios", isoStart, isoEnd),
    agile.downloadCsv("produtos", isoStart, isoEnd)
  ]);

  const vendas = parseFaturamento(txtFaturamento);
  const pagamentos = parseMeiosPagamento(txtMeios);
  const itens = parseProdutos(txtProdutos);

  logger.info("Parseado", {
    vendas: vendas.length,
    pagamentos: pagamentos.length,
    itens: itens.length
  });

  const report = await backend.sync({
    periodoInicio: isoStart,
    periodoFim: isoEnd,
    agenteVersion: pkg.version,
    agenteHost: os.hostname(),
    vendas,
    pagamentos,
    itens
  });

  return report;
}
