// Parser dos CSVs do AgileReport para o formato JSON esperado pelo backend.
// Cada CSV tem shape distinto (vendas, pagamentos, itens); centralizamos as
// conversões (data, dinheiro, quantidade) e devolvemos arrays prontos.

// Delimitador `;`, valores entre aspas, decimal com vírgula, datas
// DD/MM/YYYY. O AgileReport é estritamente previsível — não vale a pena
// puxar um parser CSV genérico com edge cases que aqui não existem.
function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  const header = lines[0].split(";").map((c) => c.trim());
  const rows = lines.slice(1).map((line) =>
    line.split(";").map((cell) => cell.replace(/^"|"$/g, "").trim())
  );
  return { header, rows };
}

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

export function parseFaturamento(text) {
  const { header, rows } = parseCsv(text);
  return rows.map((r) => ({
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
    dia_da_semana: r[idx(header, "DIA_DA_SEMANA")] || null
  }));
}

export function parseMeiosPagamento(text) {
  const { header, rows } = parseCsv(text);
  return rows.map((r) => ({
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
  const { header, rows } = parseCsv(text);
  return rows.map((r) => ({
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
    vl_tot: parseMoney(r[idx(header, "vl_tot")])
  }));
}
