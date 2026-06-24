// ─────────────────────────────────────────────────────────────────────────────
// Importação/conferência SEGURA de fornecedores a partir do Excel.
//
// DRY-RUN por padrão: NÃO grava nada. Só mostra o que faria.
// Para aplicar no banco LOCAL: passe --apply.
//
// Uso:
//   node scripts/import-suppliers-from-excel.mjs "C:\\...\\C. FORNECEDORES.xlsx"            (dry-run)
//   node scripts/import-suppliers-from-excel.mjs "C:\\...\\C. FORNECEDORES.xlsx" --apply     (aplica LOCAL)
//
// Colunas reconhecidas (cabeçalho na linha 1):
//   DATA CADASTRO  → registrationDate
//   ID. FORNECEDOR → externalCode
//   CNPJ/CPF       → document
//   RAZAO SOCIAL   → name
//
// Regras de match (dedup) por prioridade: externalCode → documento(dígitos) → nome normalizado.
// Cria os ausentes (isActive=true). Para existentes, só PREENCHE document/registrationDate
// quando estiverem vazios (nunca sobrescreve nome). Reporta divergências sem alterar.
// Conexão usa DATABASE_URL do backend/.env (banco LOCAL).
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const file = process.argv.find((a, i) => i >= 2 && !a.startsWith("--"));
if (!file) { console.error("Informe o caminho do .xlsx"); process.exit(1); }

const prisma = new PrismaClient();

function normalizeText(value) {
  return String(value ?? "")
    .replace(/[​-‍﻿]/g, "")
    .replace(/ /g, " ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function normalizeHeader(value) {
  return normalizeText(value).replace(/[./-]/g, " ").replace(/\s+/g, " ").trim();
}
const digits = (v) => String(v ?? "").replace(/\D/g, "");

function cellVal(c) {
  const v = c.value;
  if (v && typeof v === "object") {
    if (v instanceof Date) return v;
    if ("result" in v) return v.result ?? null;
    if ("text" in v) return v.text;
    if ("richText" in v) return v.richText.map((p) => p.text).join("");
  }
  return v ?? null;
}
function asText(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  const t = String(v).trim();
  return t || null;
}
function asDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const ALIASES = {
  code: ["id fornecedor", "cod fornecedor", "cod forne", "codigo fornecedor"],
  document: ["cnpj cpf", "cnpj", "cpf", "documento"],
  name: ["razao social", "fornecedor", "nome fornecedor", "nome"],
  date: ["data cadastro", "dt cadastro", "data de cadastro", "cadastro", "data do cadastro"]
};

function resolveColumn(headers, aliases) {
  const norm = headers.map((h) => ({ h, n: normalizeHeader(h) }));
  for (const a of aliases) { const hit = norm.find((x) => x.n === a); if (hit) return hit.h; }
  for (const a of aliases) { const hit = norm.find((x) => x.n.includes(a) || a.includes(x.n)); if (hit) return hit.h; }
  return null;
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];

  const headerRow = ws.getRow(1);
  const headers = [];
  for (let c = 1; c <= ws.columnCount; c += 1) headers.push(String(cellVal(headerRow.getCell(c)) ?? "").trim());

  const col = {
    code: resolveColumn(headers, ALIASES.code),
    document: resolveColumn(headers, ALIASES.document),
    name: resolveColumn(headers, ALIASES.name),
    date: resolveColumn(headers, ALIASES.date)
  };
  const idx = (name) => headers.indexOf(name) + 1;

  console.log("=== COLUNAS RECONHECIDAS ===");
  console.log(col);
  if (!col.name) { console.error("ERRO: coluna de NOME (RAZAO SOCIAL) nao reconhecida — abortando."); process.exit(1); }

  // Lê linhas
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const get = (c) => (c ? asText(cellVal(row.getCell(idx(c)))) : null);
    const hasAny = [col.code, col.document, col.name, col.date].some((c) => c && asText(cellVal(row.getCell(idx(c)))) != null);
    if (!hasAny) return;
    rows.push({
      rowNumber: n,
      code: get(col.code),
      document: get(col.document),
      name: get(col.name) ?? "",
      registrationDate: col.date ? asDate(cellVal(row.getCell(idx(col.date)))) : null
    });
  });

  const valid = rows.filter((r) => r.name);
  const semNome = rows.length - valid.length;

  // Carrega todos os fornecedores do banco p/ dedup
  const dbAll = await prisma.supplier.findMany();
  const byCode = new Map(dbAll.filter((s) => s.externalCode).map((s) => [s.externalCode, s]));
  const byDoc = new Map(dbAll.filter((s) => s.document).map((s) => [digits(s.document), s]));
  const byName = new Map(dbAll.map((s) => [normalizeText(s.name), s]));

  const toCreate = [];
  const toFill = [];
  const matched = [];
  const divergences = [];

  for (const r of valid) {
    // O ID. FORNECEDOR (code) é a chave única autoritativa da origem.
    // Se a linha TEM código: casa SÓ por código (evita falso-match por CNPJ compartilhado
    // entre sub-entidades, ex.: várias "KATIVA" com o mesmo documento mas códigos distintos).
    // Só usa documento/nome como fallback quando a linha NÃO tem código.
    let existing = null;
    if (r.code) {
      existing = byCode.get(r.code) ?? null;
    } else if (r.document && byDoc.has(digits(r.document))) {
      existing = byDoc.get(digits(r.document));
    } else if (byName.has(normalizeText(r.name))) {
      existing = byName.get(normalizeText(r.name));
    }

    if (!existing) { toCreate.push(r); continue; }

    if (existing.externalCode && r.code && existing.externalCode !== r.code) {
      divergences.push(`Linha ${r.rowNumber}: codigo planilha ${r.code} != banco ${existing.externalCode} (${existing.name})`);
    }
    if (normalizeText(existing.name) !== normalizeText(r.name)) {
      divergences.push(`Linha ${r.rowNumber}: nome planilha "${r.name}" != banco "${existing.name}"`);
    }
    const fillDoc = !existing.document && r.document;
    const fillDate = !existing.registrationDate && r.registrationDate;
    if (fillDoc || fillDate) toFill.push({ r, existing, fillDoc, fillDate });
    else matched.push(r);
  }

  const wp3 = valid.find((r) => /wp3/i.test(r.name) || r.code === "25122" || digits(r.document) === "49915452000192");

  console.log("\n=== RESUMO (DRY-RUN" + (APPLY ? " → APLICANDO" : "") + ") ===");
  console.log(`Linhas de dados na planilha:       ${rows.length}`);
  console.log(`Validas (com nome):                ${valid.length}`);
  console.log(`Ignoradas (sem nome):              ${semNome}`);
  console.log(`Fornecedores no banco (antes):     ${dbAll.length}`);
  console.log(`→ SERIAM CRIADOS:                  ${toCreate.length}`);
  console.log(`→ SERIAM COMPLEMENTADOS:           ${toFill.length} (preenche doc/data faltante)`);
  console.log(`→ JA EXISTEM (sem mudanca):        ${matched.length}`);
  console.log(`Divergencias detectadas:           ${divergences.length}`);

  console.log("\n=== WP3 ===");
  if (!wp3) console.log("WP3 nao encontrado na planilha.");
  else {
    const status = toCreate.includes(wp3) ? "SERIA CRIADO" : (toFill.find((x) => x.r === wp3) ? "SERIA COMPLEMENTADO" : "JA EXISTE");
    console.log(`WP3 → linha ${wp3.rowNumber} | cod ${wp3.code} | doc ${wp3.document} | ${wp3.name} → ${status}`);
  }

  console.log("\n=== ATE 10 QUE SERIAM CRIADOS ===");
  toCreate.slice(0, 10).forEach((r) => console.log(`  cod ${r.code} | ${r.name} | doc ${r.document ?? "—"}`));

  if (divergences.length) {
    console.log("\n=== DIVERGENCIAS (ate 15) ===");
    divergences.slice(0, 15).forEach((d) => console.log("  " + d));
  }

  if (!APPLY) {
    console.log("\n[DRY-RUN] Nada foi gravado. Rode com --apply para aplicar no banco LOCAL.");
    await prisma.$disconnect();
    return;
  }

  // ── APLICAÇÃO (somente local) ──
  let created = 0, filled = 0;
  for (const r of toCreate) {
    await prisma.supplier.create({
      data: {
        externalCode: r.code,
        document: r.document,
        name: r.name,
        normalizedName: normalizeText(r.name),
        registrationDate: r.registrationDate,
        isActive: true
      }
    });
    created += 1;
  }
  for (const { r, existing, fillDoc, fillDate } of toFill) {
    await prisma.supplier.update({
      where: { id: existing.id },
      data: {
        document: fillDoc ? r.document : undefined,
        registrationDate: fillDate ? r.registrationDate : undefined
      }
    });
    filled += 1;
  }
  const totalAfter = await prisma.supplier.count();
  console.log(`\n[APLICADO] Criados: ${created} | Complementados: ${filled} | Total no banco agora: ${totalAfter}`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
