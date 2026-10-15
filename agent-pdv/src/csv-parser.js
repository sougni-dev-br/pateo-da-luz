// Parser dos CSVs do AgileReport para o formato JSON esperado pelo backend.
// Cada CSV tem shape distinto (vendas, pagamentos, itens); centralizamos as
// conversões (data, dinheiro, quantidade) e devolvemos arrays prontos.

// Delimitador `;`, valores entre aspas, decimal com vírgula, datas
// DD/MM/YYYY. O AgileReport é previsível — um splitter mínimo que respeita
// aspas basta, sem puxar um parser CSV genérico.

// Divide uma linha por `;` respeitando aspas (`;` dentro de "..." não separa;
// `""` dentro de aspas é uma aspa literal).
function splitLine(line) {
  const cells = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ";") { cells.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

function parseCsv(content, kind, required) {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  const header = splitLine(lines[0]);
  // Valida todas as colunas de uma vez, para o erro listar tudo o que o
  // AgileReport mudou (e não só a primeira coluna ausente).
  const missing = required.filter((n) => !header.includes(n));
  if (missing.length > 0) {
    throw new Error(`CSV de ${kind} sem coluna(s): ${missing.join(", ")}. Header recebido: ${header.join(", ")}`);
  }
  const rows = lines.slice(1).map((line, i) => {
    const cells = splitLine(line);
    // Número de colunas diferente do header desalinharia os campos seguintes
    // (valor de um campo gravado em outro). Falha alto — o heartbeat reporta
    // o erro — em vez de mandar dado trocado ao ERP.
    if (cells.length !== header.length) {
      throw new Error(`CSV de ${kind} inválido: linha ${i + 2} tem ${cells.length} colunas, esperado ${header.length}. Trecho: ${line.slice(0, 120)}`);
    }
    return cells;
  });
  return { header, rows };
}

const COLS_FATURAMENTO = ["modo_venda", "nrseqvenda", "dt_movimento", "turno", "situacao_da_venda", "nr_ticket",
  "qtd_pessoas", "vl_subtotal_itens", "vl_desconto", "vl_servico_inf", "vl_total", "DIA_DA_SEMANA"];
const COLS_MEIOS = ["modo_venda", "nrseqvenda", "nrseqpgto", "dt_movimento", "turno", "situacao_da_venda",
  "meio_pagamento", "vl_recebido"];
const COLS_PRODUTOS = ["modo_venda", "nrseqvenda", "nrseqitem", "dt_movimento", "turno", "situacao_da_venda",
  "cod_produto", "produto", "grupo_produto", "categoria_produto", "qtd", "vl_tot"];

function brDateToIso(v) {
  if (!v) return null;
  const [d, m, y] = v.split("/");
  if (!d || !m || !y) return null;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function parseMoney(v) {
  if (!v || v.trim() === "") return 0;
  // Remove separador de milhar `.` e troca decimal `,` por `.`.
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function parseQty(v) {
  if (!v) return 0;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function idx(header, name) {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`Coluna "${name}" não encontrada. Header: ${header.join(", ")}`);
  return i;
}

// Coluna opcional: devolve -1 se não existir no header (sem lançar erro).
function idxOpt(header, name) {
  return header.indexOf(name);
}

// Texto como o PDV mandou; ausente ou vazio vira null.
function optText(row, i) {
  return i < 0 ? null : row[i] || null;
}

export function parseFaturamento(text) {
  const { header, rows } = parseCsv(text, "faturamento", COLS_FATURAMENTO);
  const iHora = idxOpt(header, "hora");
  const iFuncCancelou = idxOpt(header, "func_cancelou");
  const iMotivo = idxOpt(header, "motivo_cancelamento");
  const iDesconto = idxOpt(header, "desconto");
  return rows.map((r) => ({
    modo_venda: r[idx(header, "modo_venda")] || null,
    nrseqvenda: r[idx(header, "nrseqvenda")],
    dt_movimento: brDateToIso(r[idx(header, "dt_movimento")]),
    turno: r[idx(header, "turno")],
    situacao_da_venda: r[idx(header, "situacao_da_venda")],
    nr_ticket: r[idx(header, "nr_ticket")] || null,
    qtd_pessoas: parseQty(r[idx(header, "qtd_pessoas")]) | 0,
    vl_subtotal_itens: parseMoney(r[idx(header, "vl_subtotal_itens")]),
    vl_desconto: parseMoney(r[idx(header, "vl_desconto")]),
    vl_servico_inf: parseMoney(r[idx(header, "vl_servico_inf")]),
    vl_total: parseMoney(r[idx(header, "vl_total")]),
    dia_da_semana: r[idx(header, "DIA_DA_SEMANA")] || null,
    hora: optText(r, iHora),
    func_cancelou: optText(r, iFuncCancelou),
    motivo_cancelamento: optText(r, iMotivo),
    desconto: optText(r, iDesconto)
  }));
}

export function parseMeiosPagamento(text) {
  const { header, rows } = parseCsv(text, "meios de pagamento", COLS_MEIOS);
  return rows.map((r) => ({
    modo_venda: r[idx(header, "modo_venda")] || null,
    nrseqvenda: r[idx(header, "nrseqvenda")],
    nrseqpgto: r[idx(header, "nrseqpgto")],
    dt_movimento: brDateToIso(r[idx(header, "dt_movimento")]),
    turno: r[idx(header, "turno")],
    situacao_da_venda: r[idx(header, "situacao_da_venda")],
    meio_pagamento: r[idx(header, "meio_pagamento")],
    vl_recebido: parseMoney(r[idx(header, "vl_recebido")])
  }));
}

export function parseProdutos(text) {
  const { header, rows } = parseCsv(text, "produtos", COLS_PRODUTOS);
  const iFuncLancou = idxOpt(header, "func_lancou");
  const iFuncCancelou = idxOpt(header, "func_cancelou");
  const iMotivo = idxOpt(header, "motivo_cancelamento");
  return rows.map((r) => ({
    modo_venda: r[idx(header, "modo_venda")] || null,
    nrseqvenda: r[idx(header, "nrseqvenda")],
    nrseqitem: r[idx(header, "nrseqitem")],
    dt_movimento: brDateToIso(r[idx(header, "dt_movimento")]),
    turno: r[idx(header, "turno")],
    situacao_da_venda: r[idx(header, "situacao_da_venda")],
    cod_produto: r[idx(header, "cod_produto")] || null,
    produto: r[idx(header, "produto")],
    grupo_produto: r[idx(header, "grupo_produto")] || null,
    categoria_produto: r[idx(header, "categoria_produto")] || null,
    qtd: parseQty(r[idx(header, "qtd")]),
    vl_tot: parseMoney(r[idx(header, "vl_tot")]),
    func_lancou: optText(r, iFuncLancou),
    func_cancelou: optText(r, iFuncCancelou),
    motivo_cancelamento: optText(r, iMotivo)
  }));
}
