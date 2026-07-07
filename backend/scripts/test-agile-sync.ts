// Script de validação local da integração Agile PDV → ERP.
//
// Lê os 3 CSVs UTF-16 que o Eli baixou do AgileReport na área de trabalho,
// converte para JSON, chama POST /integrations/agile/sync no backend local,
// e compara os totais retornados com a soma bruta dos CSVs.
//
// Como rodar (com o backend rodando em localhost:3334):
//   cd backend
//   npx tsx scripts/test-agile-sync.ts
//
// Requer AGILE_INGEST_TOKEN definido no .env local.

import { readFile } from "node:fs/promises";
import path from "node:path";
import "dotenv/config";

const CSV_DIR = "C:\\Users\\elioe\\OneDrive\\Desktop";
const CSV_FATURAMENTO = path.join(CSV_DIR, "tabela_faturamento_de_01-06-2026_ate_31-07-2026.txt");
const CSV_MEIOS = path.join(CSV_DIR, "tabela_meios_pgto_de_01-06-2026_ate_31-07-2026.txt");
const CSV_PRODUTOS = path.join(CSV_DIR, "tabela_produtos_de_01-06-2026_ate_31-07-2026.txt");

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3334";
const TOKEN = process.env.AGILE_INGEST_TOKEN;

if (!TOKEN) {
  console.error("AGILE_INGEST_TOKEN não configurado no .env local.");
  process.exit(1);
}

// Os CSVs vêm em UTF-16 LE com BOM (default do ASP.NET no Windows pt-BR).
// Node não decodifica isso automaticamente com readFile("utf-8") — precisa
// ser decodificado explicitamente via TextDecoder.
async function readUtf16Csv(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return new TextDecoder("utf-16le").decode(buffer).replace(/^﻿/, "");
}

// Delimitador `;`, valores entre aspas duplas, decimal com vírgula.
// Não usamos parser genérico porque o formato é estritamente controlado
// pelo Agile — regex é suficiente e mais rápido.
function parseCsv(content: string): { header: string[]; rows: string[][] } {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  const header = lines[0].split(";").map((c) => c.trim());
  const rows = lines.slice(1).map((line) =>
    line.split(";").map((cell) => cell.replace(/^"|"$/g, "").trim())
  );
  return { header, rows };
}

// "01/06/2026" → "2026-06-01"
function brDateToIso(v: string): string {
  const [d, m, y] = v.split("/");
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// "123,45" → 123.45; string vazia → 0
function parseMoney(v: string): number {
  if (!v || v.trim() === "") return 0;
  return Number(v.replace(/\./g, "").replace(",", ".")) || 0;
}

function idx(header: string[], name: string): number {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`Coluna "${name}" não encontrada. Header: ${header.join(", ")}`);
  return i;
}

async function main() {
  console.log("→ Lendo CSVs...");
  const [txtFat, txtMeios, txtProds] = await Promise.all([
    readUtf16Csv(CSV_FATURAMENTO),
    readUtf16Csv(CSV_MEIOS),
    readUtf16Csv(CSV_PRODUTOS)
  ]);

  const fat = parseCsv(txtFat);
  const meios = parseCsv(txtMeios);
  const prods = parseCsv(txtProds);
  console.log(`   Faturamento: ${fat.rows.length} linhas`);
  console.log(`   Meios pgto : ${meios.rows.length} linhas`);
  console.log(`   Produtos   : ${prods.rows.length} linhas`);

  // Mapeamento das colunas para o formato esperado pelo backend.
  const fH = fat.header;
  const vendas = fat.rows.map((r) => ({
    nrseqvenda: r[idx(fH, "nrseqvenda")],
    dt_movimento: brDateToIso(r[idx(fH, "dt_movimento")]),
    turno: r[idx(fH, "turno")],
    situacao_da_venda: r[idx(fH, "situacao_da_venda")],
    nr_ticket: r[idx(fH, "nr_ticket")] || null,
    qtd_pessoas: Number(r[idx(fH, "qtd_pessoas")]) || 0,
    vl_subtotal_itens: parseMoney(r[idx(fH, "vl_subtotal_itens")]),
    vl_desconto: parseMoney(r[idx(fH, "vl_desconto")]),
    vl_servico_inf: parseMoney(r[idx(fH, "vl_servico_inf")]),
    vl_total: parseMoney(r[idx(fH, "vl_total")]),
    dia_da_semana: r[idx(fH, "DIA_DA_SEMANA")] || null
  }));

  const mH = meios.header;
  const pagamentos = meios.rows.map((r) => ({
    nrseqvenda: r[idx(mH, "nrseqvenda")],
    nrseqpgto: r[idx(mH, "nrseqpgto")],
    dt_movimento: brDateToIso(r[idx(mH, "dt_movimento")]),
    turno: r[idx(mH, "turno")],
    situacao_da_venda: r[idx(mH, "situacao_da_venda")],
    meio_pagamento: r[idx(mH, "meio_pagamento")],
    vl_recebido: parseMoney(r[idx(mH, "vl_recebido")])
  }));

  const pH = prods.header;
  const itens = prods.rows.map((r) => ({
    nrseqvenda: r[idx(pH, "nrseqvenda")],
    nrseqitem: r[idx(pH, "nrseqitem")],
    dt_movimento: brDateToIso(r[idx(pH, "dt_movimento")]),
    turno: r[idx(pH, "turno")],
    situacao_da_venda: r[idx(pH, "situacao_da_venda")],
    cod_produto: r[idx(pH, "cod_produto")] || null,
    produto: r[idx(pH, "produto")],
    grupo_produto: r[idx(pH, "grupo_produto")] || null,
    categoria_produto: r[idx(pH, "categoria_produto")] || null,
    qtd: Number(r[idx(pH, "qtd")].replace(",", ".")) || 0,
    vl_tot: parseMoney(r[idx(pH, "vl_tot")])
  }));

  // Totais brutos dos CSVs (fonte da verdade para conferência).
  // Deduplicamos por nrseqvenda porque o próprio export do Agile
  // ocasionalmente emite a mesma venda em 2+ linhas. O backend também
  // deduplica, então precisamos comparar apples-to-apples.
  const vendasUnicas = new Map<string, typeof vendas[number]>();
  for (const v of vendas) {
    if (!vendasUnicas.has(v.nrseqvenda)) vendasUnicas.set(v.nrseqvenda, v);
  }
  const duplicatas = vendas.length - vendasUnicas.size;
  const recebidas = Array.from(vendasUnicas.values()).filter((v) => v.situacao_da_venda === "RECEBIDA");
  const brutoRecebidas = recebidas.reduce((sum, v) => sum + v.vl_total, 0);
  const canceladas = Array.from(vendasUnicas.values()).filter((v) => v.situacao_da_venda !== "RECEBIDA").length;
  console.log("\n→ Totais brutos dos CSVs (após dedupe por nrseqvenda):");
  console.log(`   Linhas duplicadas descartadas: ${duplicatas}`);
  console.log(`   Vendas RECEBIDAs             : ${recebidas.length}`);
  console.log(`   Vendas canceladas            : ${canceladas}`);
  console.log(`   Faturamento bruto            : R$ ${brutoRecebidas.toFixed(2)}`);

  const payload = {
    periodoInicio: "2026-06-01",
    periodoFim: "2026-07-31",
    agenteVersion: "test-script-0.1",
    agenteHost: "dev-eli",
    vendas,
    pagamentos,
    itens
  };

  console.log(`\n→ Enviando para ${BACKEND_URL}/integrations/agile/sync ...`);
  const response = await fetch(`${BACKEND_URL}/integrations/agile/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agile-Token": TOKEN
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  if (!response.ok) {
    console.error(`\n✗ Falha: HTTP ${response.status}\n${text}`);
    process.exit(1);
  }

  const report = JSON.parse(text);
  console.log("\n✓ Sync respondida com sucesso:");
  console.log(JSON.stringify(report, null, 2));

  console.log("\n→ Conferência de totais:");
  const diff = report.totalBruto - brutoRecebidas;
  console.log(`   CSV bruto     : R$ ${brutoRecebidas.toFixed(2)}`);
  console.log(`   Backend bruto : R$ ${report.totalBruto.toFixed(2)}`);
  console.log(`   Diferença     : R$ ${diff.toFixed(2)}`);
  if (Math.abs(diff) > 0.02) {
    console.error("   ✗ Divergência acima de R$ 0,02 — investigar.");
    process.exit(1);
  } else {
    console.log("   ✓ Bate.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
