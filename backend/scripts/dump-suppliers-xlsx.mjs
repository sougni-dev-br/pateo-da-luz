// Diagnóstico SOMENTE-LEITURA da planilha de fornecedores. Não grava nada.
// Uso: node scripts/dump-suppliers-xlsx.mjs "C:\\caminho\\C. FORNECEDORES.xlsx"
import ExcelJS from "exceljs";

const file = process.argv[2];
if (!file) { console.error("Informe o caminho do .xlsx"); process.exit(1); }

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);

console.log("=== ABAS ===");
console.log(wb.worksheets.map((w) => `${w.name} (rows=${w.rowCount}, cols=${w.columnCount})`).join("\n"));

const ws = wb.worksheets[0];
console.log(`\n=== ABA USADA: ${ws.name} ===`);

function cellVal(c) {
  const v = c.value;
  if (v && typeof v === "object") {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ("result" in v) return v.result ?? "";
    if ("text" in v) return v.text;
    if ("richText" in v) return v.richText.map((p) => p.text).join("");
  }
  return v ?? "";
}

// Primeiras 3 linhas (para ver se cabeçalho está na linha 1)
for (let r = 1; r <= 3; r += 1) {
  const row = ws.getRow(r);
  const cells = [];
  for (let c = 1; c <= ws.columnCount; c += 1) cells.push(String(cellVal(row.getCell(c))).trim());
  console.log(`LINHA ${r}: [${cells.map((x) => JSON.stringify(x)).join(", ")}]`);
}

// Contagem de linhas com algum valor
let nonEmpty = 0;
ws.eachRow((row, n) => {
  if (n === 1) return;
  let has = false;
  for (let c = 1; c <= ws.columnCount; c += 1) {
    if (String(cellVal(row.getCell(c))).trim() !== "") { has = true; break; }
  }
  if (has) nonEmpty += 1;
});
console.log(`\nLinhas de dados (não vazias, excluindo cabeçalho): ${nonEmpty}`);

// Procurar WP3 em qualquer célula
console.log("\n=== LINHAS CONTENDO 'WP3' ===");
let found = 0;
ws.eachRow((row, n) => {
  const cells = [];
  let match = false;
  for (let c = 1; c <= ws.columnCount; c += 1) {
    const v = String(cellVal(row.getCell(c))).trim();
    cells.push(v);
    if (/wp3/i.test(v)) match = true;
  }
  if (match) { found += 1; console.log(`LINHA ${n}: [${cells.map((x) => JSON.stringify(x)).join(", ")}]`); }
});
if (!found) console.log("(WP3 não encontrado em nenhuma célula)");
