// Teste end-to-end do agente usando os CSVs reais que o Eli baixou do
// AgileReport (área de trabalho) como "fixtures". Pula a etapa de HTTP
// contra o pdvtouch:8091 — o resto do fluxo é idêntico ao do agente:
//
//   CSV UTF-16 → parser → backend-client → POST /integrations/agile/sync
//
// Uso: node test-with-fixtures.js
// Requer backend local rodando em http://localhost:3334 e AGILE_INGEST_TOKEN
// no .env do backend (o mesmo token vai aqui via env var ou config.json).

import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { BackendClient } from "./src/backend-client.js";
import { parseFaturamento, parseMeiosPagamento, parseProdutos } from "./src/csv-parser.js";
import { logger } from "./src/logger.js";

const CSV_DIR = "C:\\Users\\elioe\\OneDrive\\Desktop";
const CSV_FATURAMENTO = path.join(CSV_DIR, "tabela_faturamento_de_01-06-2026_ate_31-07-2026.txt");
const CSV_MEIOS = path.join(CSV_DIR, "tabela_meios_pgto_de_01-06-2026_ate_31-07-2026.txt");
const CSV_PRODUTOS = path.join(CSV_DIR, "tabela_produtos_de_01-06-2026_ate_31-07-2026.txt");

async function readUtf16(p) {
  const buf = await readFile(p);
  return new TextDecoder("utf-16le").decode(buf).replace(/^﻿/, "");
}

async function main() {
  const token = process.env.AGILE_INGEST_TOKEN;
  if (!token) {
    console.error("Defina AGILE_INGEST_TOKEN no ambiente.");
    process.exit(1);
  }

  logger.info("Fixture test: lendo CSVs");
  const [txtF, txtM, txtP] = await Promise.all([
    readUtf16(CSV_FATURAMENTO),
    readUtf16(CSV_MEIOS),
    readUtf16(CSV_PRODUTOS)
  ]);

  const vendas = parseFaturamento(txtF);
  const pagamentos = parseMeiosPagamento(txtM);
  const itens = parseProdutos(txtP);
  logger.info("Fixture test: parseado", {
    vendas: vendas.length,
    pagamentos: pagamentos.length,
    itens: itens.length
  });

  const backend = new BackendClient({
    baseUrl: process.env.BACKEND_URL ?? "http://localhost:3334",
    ingestToken: token,
    retryMaxAttempts: 1,
    retryDelayMs: 0
  });

  const report = await backend.sync({
    periodoInicio: "2026-06-01",
    periodoFim: "2026-07-31",
    agenteVersion: "fixture-test-0.1",
    agenteHost: os.hostname(),
    vendas,
    pagamentos,
    itens
  });

  console.log("\n✓ Sync end-to-end via módulos do agente OK");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
