// Auditoria SOMENTE LEITURA do salário combinado (férias, 13º e salário do mês) — regras puras, sem banco.
//
// O que a contabilidade paga (recibo de férias / extrato do 13º) e o que o ERP soma por cima (complemento do combinado
// e da gorjeta integral) não pode ser pago duas vezes. Cada regra recebe os títulos como estão no banco e o que o
// cálculo ATUAL daria, e devolve achados: ERRO (para o relatório e sai com código 1), ATENÇÃO (conferir) e OK.
// Quem carrega os dados e imprime é backend/scripts/auditar-combinado.ts.
import {
  complementoDeFerias, diasDoRecibo, mediaDaGorjeta, type MesDaGorjeta,
} from "./ferias-combinado.js";

export type Severidade = "ERRO" | "ATENCAO" | "OK";
export type Achado = { severidade: Severidade; regra: string; pessoa: string; titulo: string | null; mensagem: string };

export type TituloAuditado = {
  id: string; tipo: "FERIAS" | "DECIMO_TERCEIRO" | "SALARIO"; rotulo: string; ano: number; mes: number;
  periodStart: string | null; periodEnd: string | null; // AAAA-MM-DD
  amount: number; paidAmount: number | null; pago: boolean; differenceReason?: string | null; details: unknown;
};

const CENTAVO = 0.01;
const round2 = (v: number) => Math.round(v * 100) / 100;
const reais = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const difere = (a: number, b: number) => Math.abs(a - b) >= CENTAVO - 1e-9;
const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const numero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const rotuloDe = (t: TituloAuditado) => { const tipo = t.tipo === "FERIAS" ? "Férias" : t.tipo === "SALARIO" ? "Salário" : "13º"; return `${t.rotulo.startsWith(tipo) ? t.rotulo : `${tipo} ${t.rotulo}`} (${String(t.mes).padStart(2, "0")}/${t.ano})`; };

const achado = (severidade: Severidade, regra: string, pessoa: string, t: TituloAuditado | null, mensagem: string): Achado =>
  ({ severidade, regra, pessoa, titulo: t ? rotuloDe(t) : null, mensagem });

const ORIGENS_SOMADAS = ["FERIAS_COMBINADO", "DECIMO_COMBINADO", "SALARIO_COMBINADO"];
const somado = (t: TituloAuditado) => ORIGENS_SOMADAS.includes(String(objeto(t.details).origemValor));

// ── 1. Um só título por período ───────────────────────────────────────────────────────────
/** Nenhum segundo título de férias para o mesmo gozo, nem de 13º com o mesmo rótulo; a diferença do combinado não entra duas vezes. */
export function auditarDuplicidade(pessoa: string, titulos: ReadonlyArray<TituloAuditado>): Achado[] {
  const out: Achado[] = [];
  const ferias = titulos.filter((t) => t.tipo === "FERIAS");
  for (let i = 0; i < ferias.length; i += 1) {
    for (let j = i + 1; j < ferias.length; j += 1) {
      const a = ferias[i], b = ferias[j];
      const sobrepoe = a.periodStart && a.periodEnd && b.periodStart && b.periodEnd
        ? a.periodStart <= b.periodEnd && b.periodStart <= a.periodEnd
        : a.ano === b.ano && a.mes === b.mes;
      if (sobrepoe) out.push(achado("ERRO", "duplicidade-ferias", pessoa, b, `Dois títulos de férias para o mesmo período (${rotuloDe(a)} e ${rotuloDe(b)}): um deles paga em dobro.`));
    }
  }
  const salarios = new Set<string>();
  for (const t of titulos.filter((x) => x.tipo === "SALARIO")) {
    const chave = `${t.ano}|${t.mes}|${t.rotulo}`;
    if (salarios.has(chave)) out.push(achado("ERRO", "duplicidade-salario", pessoa, t, `Mais de um título de salário "${t.rotulo}": o salário do mês seria pago em dobro.`));
    salarios.add(chave);
  }
  const decimos = titulos.filter((t) => t.tipo === "DECIMO_TERCEIRO");
  const vistos = new Set<string>();
  for (const t of decimos) {
    const chave = `${t.ano}|${t.rotulo}`;
    if (vistos.has(chave)) out.push(achado("ERRO", "duplicidade-13", pessoa, t, `Mais de um título "${t.rotulo}" em ${t.ano}: o 13º seria pago em dobro.`));
    vistos.add(chave);
  }
  const extratoSomado = decimos.find((t) => /1ª\s*parcela\s*\(extrato\)/i.test(t.rotulo) && somado(t));
  const propria = decimos.find((t) => /1ª\s*parcela\s*\(combinado\)/i.test(t.rotulo));
  if (extratoSomado && propria) {
    out.push(achado("ERRO", "duplicidade-13", pessoa, propria, `A diferença do combinado da 1ª parcela do 13º está somada ao título do extrato (${reais(extratoSomado.amount)}) e também em lançamento próprio (${reais(propria.amount)}): paga duas vezes.`));
  }
  if (out.length === 0 && (ferias.length > 0 || decimos.length > 0)) out.push(achado("OK", "duplicidade", pessoa, null, "Um único título por período de férias e de 13º."));
  return out;
}

// ── 2. Título somado: o valor bate com o que a soma explica; pago bate com o título ─────
export function auditarTituloSomado(pessoa: string, t: TituloAuditado): Achado[] {
  const out: Achado[] = [];
  const d = objeto(t.details);
  const liquido = numero(d.liquidoExtrato) ?? numero(objeto(d.recibo).liquido) ?? numero(d.liquido);
  if (somado(t)) {
    const complemento = numero(d.complemento);
    if (liquido == null || complemento == null) {
      out.push(achado("ERRO", "titulo-somado", pessoa, t, "Título marcado como somado ao combinado, mas sem o líquido do contador ou sem o complemento nos detalhes."));
    } else if (difere(t.amount, liquido + complemento)) {
      out.push(achado("ERRO", "titulo-mexido-a-mao", pessoa, t, `Valor do título ${reais(t.amount)} ≠ líquido ${reais(liquido)} + complemento ${reais(complemento)} = ${reais(round2(liquido + complemento))}: foi mexido à mão.`));
    }
  } else if (liquido != null && difere(t.amount, liquido) && t.tipo !== "SALARIO") {
    out.push(achado("ATENCAO", "titulo-mexido-a-mao", pessoa, t, `Valor do título ${reais(t.amount)} difere do líquido do contador ${reais(liquido)} e não há soma do combinado registrada: confira se foi mexido à mão.`));
  }
  if (t.pago && t.paidAmount != null && difere(t.paidAmount, t.amount)) {
    out.push(achado(t.differenceReason ? "ATENCAO" : "ERRO", "pago-diferente", pessoa, t,
      `Pago ${reais(t.paidAmount)} para um título de ${reais(t.amount)} (diferença ${reais(round2(t.paidAmount - t.amount))})${t.differenceReason ? `: motivo "${t.differenceReason}"` : " sem motivo da diferença"}.`));
  }
  return out;
}

// ── 3. Férias: o complemento gravado recalcula igual aos dados de hoje ────────────────────
export type FeriasAtual = {
  combinado: number | null; meses: ReadonlyArray<MesDaGorjeta>; liquidoRecibo: number | null; dias?: number;
  /** Competências da janela cuja apuração de gorjeta ainda não está FECHADA (a média delas pode mudar). */
  mesesAbertos: ReadonlyArray<string>;
  /** Competências com valor da planilha (GorjetaIntegralInformada ou DecimoTerceiroVariavel): não são "zerados" nem "abertos". */
  daPlanilha?: ReadonlySet<string>;
};

export function auditarFerias(pessoa: string, t: TituloAuditado, atual: FeriasAtual): Achado[] {
  const out: Achado[] = [];
  const d = objeto(t.details);
  const fc = objeto(d.feriasCombinado);
  const recibo = objeto(d.recibo);
  const liquidoRecibo = numero(recibo.liquido);
  const gravado = d.origemValor === "FERIAS_COMBINADO";
  if (liquidoRecibo == null) {
    out.push(achado("ATENCAO", "ferias-sem-recibo", pessoa, t, "Título de férias sem o líquido do recibo da contabilidade: o complemento não pode ser conferido."));
    return out;
  }
  if (atual.liquidoRecibo != null && difere(atual.liquidoRecibo, liquidoRecibo)) {
    out.push(achado("ERRO", "ferias-recibo", pessoa, t, `O líquido do recibo nos detalhes (${reais(liquidoRecibo)}) difere do recibo lido agora (${reais(atual.liquidoRecibo)}).`));
  }
  if (gravado && numero(d.liquidoExtrato) != null && difere(numero(d.liquidoExtrato)!, liquidoRecibo)) {
    out.push(achado("ERRO", "ferias-recibo", pessoa, t, `O líquido guardado na soma (${reais(numero(d.liquidoExtrato)!)}) difere do líquido do recibo (${reais(liquidoRecibo)}): a soma foi feita sobre outro recibo.`));
  }
  const dias = diasDoRecibo(t.details);
  const media = mediaDaGorjeta(atual.meses);
  const calc = atual.combinado == null ? null : complementoDeFerias({ combinado: atual.combinado, mediaGorjeta: media.media, liquidoRecibo, dias });
  const complementoGravado = gravado ? numero(d.complemento) ?? 0 : 0;

  if (!gravado) {
    if (calc && calc.complemento > 0) out.push(achado("ATENCAO", "ferias-sem-complemento", pessoa, t, `O título está só com o líquido do recibo (${reais(t.amount)}), mas a fórmula do combinado daria um complemento de ${reais(calc.complemento)}: aplique em RH > Férias.`));
    return out;
  }
  if (atual.combinado == null || calc == null) {
    out.push(achado("ATENCAO", "ferias-sem-combinado", pessoa, t, "O título tem complemento, mas a pessoa não tem mais salário combinado vigente: a soma deveria ser desfeita."));
    return out;
  }
  // Soma dupla: o que a contabilidade pagou + o complemento tem de dar exatamente a remuneração devida.
  const remuneracaoGravada = numero(fc.remuneracao);
  if (remuneracaoGravada != null && difere(liquidoRecibo + complementoGravado, remuneracaoGravada)) {
    out.push(achado("ERRO", "soma-dupla", pessoa, t, `Líquido do recibo ${reais(liquidoRecibo)} + complemento ${reais(complementoGravado)} = ${reais(round2(liquidoRecibo + complementoGravado))}, mas a remuneração devida gravada é ${reais(remuneracaoGravada)}: o total pago não fecha com o devido.`));
  }
  const mesesGravados = Array.isArray(fc.meses) ? (fc.meses as MesDaGorjeta[]) : [];
  const mediaGravada = numero(fc.mediaGorjeta);
  if (mediaGravada != null && mesesGravados.length > 0 && difere(mediaGravada, mediaDaGorjeta(mesesGravados).media)) {
    out.push(achado("ERRO", "ferias-media", pessoa, t, `A média gravada (${reais(mediaGravada)}) não bate com a média dos meses gravados (${reais(mediaDaGorjeta(mesesGravados).media)}).`));
  }
  // A base mudou desde que o complemento foi gravado?
  const combinadoGravado = numero(fc.combinado);
  const mudouCombinado = combinadoGravado != null && difere(combinadoGravado, atual.combinado);
  if (difere(complementoGravado, calc.complemento) || mudouCombinado) {
    const mudaram = mesesGravados.filter((g) => { const n = atual.meses.find((x) => x.chave === g.chave); return !n || difere(n.valor ?? NaN, g.valor ?? NaN) || (n.valor == null) !== (g.valor == null); });
    out.push(achado("ATENCAO", "ferias-base-mudou", pessoa, t,
      `Complemento gravado ${reais(complementoGravado)} ≠ recalculado hoje ${reais(calc.complemento)} (média ${reais(mediaGravada ?? 0)} → ${reais(media.media)}; combinado ${reais(combinadoGravado ?? 0)} → ${reais(atual.combinado)}). `
      + `${mudaram.length > 0 ? `Meses que mudaram: ${mudaram.map((m) => { const n = atual.meses.find((x) => x.chave === m.chave); return `${m.chave} ${reais(m.valor ?? 0)} → ${n?.valor == null ? "sem valor" : reais(n.valor)}`; }).join("; ")}. ` : ""}`
      + `${t.pago ? "O título JÁ FOI PAGO com a base antiga." : "Reaplique em RH > Férias para atualizar."}`));
  }
  const abertos = atual.mesesAbertos.filter((c) => !atual.daPlanilha?.has(c));
  if (abertos.length > 0 && !t.pago) out.push(achado("ATENCAO", "ferias-mes-aberto", pessoa, t, `Gorjeta ainda não fechada em ${abertos.join(", ")}: a média das férias pode mudar até o fechamento. Reaplique o complemento depois de fechar e antes de pagar.`));
  if (media.mesesAusentes.length > 0) out.push(achado("ATENCAO", "ferias-mes-ausente", pessoa, t, `Sem valor para ${media.mesesAusentes.join(", ")} (informe o valor; antes de 2026-09 a apuração do ERP não vale): ficaram fora da média (${media.mesesContados} mês(es) contados).`));
  const zerados = atual.meses.filter((m) => m.origem === "APURACAO" && m.valor === 0 && !atual.daPlanilha?.has(m.chave)).map((m) => m.chave);
  if (zerados.length > 0) out.push(achado("ATENCAO", "mes-apuracao-zero", pessoa, t, `Mês(es) com apuração zero e sem valor informado à mão: ${zerados.join(", ")} entram na média como R$ 0,00. Se houve gorjeta (planilha), informe o valor.`));
  const informadoSobreErp = atual.meses.filter((m) => m.origem === "INFORMADA" && m.apuracaoErp != null && difere(m.apuracaoErp, m.valor ?? NaN));
  if (informadoSobreErp.length > 0) out.push(achado("OK", "informado-vale", pessoa, t, `Valor informado (planilha) vale sobre a apuração do ERP em: ${informadoSobreErp.map((m) => `${m.chave} ${reais(m.valor ?? 0)} (ERP ${reais(m.apuracaoErp ?? 0)})`).join("; ")}.`));
  if (out.every((a) => a.severidade === "OK")) out.push(achado("OK", "ferias", pessoa, t, `Complemento ${reais(complementoGravado)} confere com o cálculo de hoje: (${reais(atual.combinado)} + média ${reais(media.media)}) × 4/3 = ${reais(calc.remuneracao)}, menos o líquido do recibo ${reais(liquidoRecibo)}; total do título ${reais(t.amount)}.`));
  return out;
}

// ── 4. 13º: a diferença somada ao extrato recalcula igual ─────────────────────────────────
export type DecimoAtual = { parcela1: number | null; mediaDeclaradaMensal: number | null };

export function auditarDecimo(pessoa: string, t: TituloAuditado, atual: DecimoAtual): Achado[] {
  const d = objeto(t.details);
  if (d.origemValor !== "DECIMO_COMBINADO") {
    return atual.parcela1 != null && atual.parcela1 > 0 && !t.pago
      ? [achado("ATENCAO", "decimo-sem-complemento", pessoa, t, `O título está só com o líquido do extrato, mas a diferença do combinado calculada hoje é ${reais(atual.parcela1)}: gere a 1ª parcela em RH > 13º.`)]
      : [];
  }
  const out: Achado[] = [];
  const gravado = numero(d.complemento) ?? 0;
  if (atual.mediaDeclaradaMensal == null) out.push(achado("ATENCAO", "decimo-sem-declarada", pessoa, t, "O extrato do 13º não trouxe a média declarada (rubrica 'MEDIA VALOR 13o ADIANTADO'): a diferença da gorjeta integral não pode ser conferida."));
  if (atual.parcela1 == null) out.push(achado("ATENCAO", "decimo-base-mudou", pessoa, t, `O título tem complemento ${reais(gravado)}, mas hoje não há diferença do combinado a somar.`));
  else if (difere(gravado, atual.parcela1)) {
    out.push(achado("ATENCAO", "decimo-base-mudou", pessoa, t, `Complemento gravado ${reais(gravado)} ≠ recalculado hoje ${reais(atual.parcela1)} (diferença ${reais(round2(atual.parcela1 - gravado))}). ${t.pago ? "O título JÁ FOI PAGO com a base antiga." : "Gere a 1ª parcela de novo em RH > 13º para atualizar."}`));
  } else out.push(achado("OK", "decimo", pessoa, t, `Complemento ${reais(gravado)} confere com o cálculo de hoje.`));
  return out;
}

// ── 5. Gorjeta declarada do extrato ≤ integral onde a diferença é somada ──────────────────
export function auditarGorjetaDeclarada(pessoa: string, a: {
  declaradaMensal: number; integralPorMes: ReadonlyMap<number, number>; mesesApurados: ReadonlySet<number>;
}): Achado[] {
  const meses = [...a.mesesApurados].filter((m) => m <= 10).sort((x, y) => x - y);
  if (meses.length === 0) return [];
  const media = round2(meses.reduce((s, m) => s + (a.integralPorMes.get(m) ?? 0), 0) / meses.length);
  const abaixo = meses.filter((m) => (a.integralPorMes.get(m) ?? 0) < a.declaradaMensal);
  if (media < a.declaradaMensal) {
    return [achado("ATENCAO", "declarada-maior", pessoa, null, `A gorjeta integral média (${reais(media)}) é MENOR que a declarada que o extrato já pagou (${reais(a.declaradaMensal)}): a diferença somada é zero e o extrato pagou mais do que o ERP apura. Confira os meses.`)];
  }
  return [achado("OK", "declarada", pessoa, null, `Integral média ${reais(media)} ≥ declarada ${reais(a.declaradaMensal)} do extrato; só a diferença (${reais(round2(media - a.declaradaMensal))}) é somada${abaixo.length > 0 ? ` (em ${abaixo.length} mês(es) a integral ficou abaixo da declarada e abate a média)` : ""}.`)];
}

// ── 6. Salário pago, férias e 13º usam a MESMA gorjeta em cada mês ───────────────────────
/** Gorjeta integral que cada consumidor usou no mês. `planilha`: o valor veio da planilha (informado), não da apuração do ERP. */
export type ConsumoDoMes = { chave: string; salario?: number | null; ferias?: number | null; decimo?: number | null; planilha?: boolean };

export function auditarConsumidores(pessoa: string, meses: ReadonlyArray<ConsumoDoMes>): Achado[] {
  const out: Achado[] = [];
  const consistentesDaPlanilha: string[] = [];
  for (const m of [...meses].sort((a, b) => a.chave.localeCompare(b.chave))) {
    const usos = ([["salário pago", m.salario], ["férias", m.ferias], ["13º", m.decimo]] as const).filter(([, v]) => v !== undefined) as Array<[string, number | null]>;
    if (usos.length < 2) continue;
    const base = usos.find(([, v]) => v != null)?.[1] ?? null;
    const diverge = usos.some(([, v]) => (v == null) !== (base == null) || (v != null && base != null && difere(v, base)));
    if (!diverge) { if (m.planilha) consistentesDaPlanilha.push(m.chave); continue; }
    const texto = usos.map(([nome, v]) => `${nome} ${v == null ? "sem valor" : reais(v)}`).join(" × ");
    const ferias = usos.find(([n]) => n === "férias")?.[1];
    const outro = usos.find(([n, v]) => n !== "férias" && v != null)?.[1];
    const efeito = ferias !== undefined && outro != null ? ` Nas férias isso muda o complemento em ${reais(round2(((outro - (ferias ?? 0)) / 12) * 4 / 3))} (média de 12 meses).` : "";
    out.push(achado("ATENCAO", "gorjeta-entre-titulos", pessoa, null, `${m.chave}${m.planilha ? " (gorjeta da planilha)" : ""}: ${texto}. É a mesma gorjeta integral: salário, férias e 13º devem usar o mesmo valor.${efeito}`));
  }
  if (consistentesDaPlanilha.length > 0) out.push(achado("OK", "gorjeta-planilha", pessoa, null, `Meses com gorjeta da planilha usada igual em todos os títulos: ${consistentesDaPlanilha.join(", ")}.`));
  return out;
}

// ── 7. Salário do mês (combinado): recalculado ≈ gravado; dias de férias descontados ──────
/** `daPlanilha`: o mês foi fechado pela planilha; o salário não é comparado com a apuração do ERP (só entre títulos, regra 6). */
export type SalarioAtual = { valor: number; diasDeFerias: number; pendenteGorjeta: boolean; daPlanilha?: boolean };

export function auditarSalario(pessoa: string, t: TituloAuditado, atual: SalarioAtual): Achado[] {
  const out: Achado[] = [];
  const d = objeto(t.details);
  const diasGravados = numero(d.diasDeFerias) ?? 0;
  if (diasGravados !== atual.diasDeFerias) {
    out.push(achado("ERRO", "salario-ferias", pessoa, t, `O salário do mês foi calculado com ${diasGravados} dia(s) de férias descontado(s), mas as férias lançadas cobrem ${atual.diasDeFerias} dia(s) do mês: ${atual.diasDeFerias > diasGravados ? "os dias de gozo estão pagos duas vezes (salário e título de férias)" : "dias descontados sem férias lançadas"}.`));
  }
  if (atual.pendenteGorjeta) {
    out.push(achado("ATENCAO", "salario-pendente", pessoa, t, "Gorjeta do mês ainda não apurada: o salário está só com o líquido do extrato."));
  } else if (atual.daPlanilha || t.pago) {
    out.push(achado("OK", "salario-planilha", pessoa, t, `Salário ${reais(t.amount)} ${t.pago ? "já pago" : "com a gorjeta da planilha"}: não comparado com a apuração do ERP (hoje daria ${reais(atual.valor)}); a conferência é entre salário, férias e 13º (gorjeta de cada mês).`));
  } else if (difere(t.amount, atual.valor)) {
    out.push(achado("ATENCAO", "salario-diferente", pessoa, t, `Título ${reais(t.amount)} ≠ cálculo de hoje ${reais(atual.valor)}: sincronize os salários combinados do mês.`));
  } else out.push(achado("OK", "salario", pessoa, t, `Salário ${reais(t.amount)} confere com o cálculo de hoje.`));
  return out;
}

// ── Apresentação ─────────────────────────────────────────────────────────────────────────
const ORDEM: Record<Severidade, number> = { ERRO: 0, ATENCAO: 1, OK: 2 };

export function resumir(achados: ReadonlyArray<Achado>): { erros: number; atencoes: number; oks: number } {
  return {
    erros: achados.filter((a) => a.severidade === "ERRO").length,
    atencoes: achados.filter((a) => a.severidade === "ATENCAO").length,
    oks: achados.filter((a) => a.severidade === "OK").length,
  };
}

/** 1 se houver ERRO; ATENÇÃO sozinha não derruba a auditoria. */
export const codigoDeSaida = (achados: ReadonlyArray<Achado>): number => (resumir(achados).erros > 0 ? 1 : 0);

export function formatarRelatorio(achados: ReadonlyArray<Achado>, cabecalho: string): string {
  const linhas = [cabecalho, ""];
  const pessoas = [...new Set(achados.map((a) => a.pessoa))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  for (const p of pessoas) {
    linhas.push(`■ ${p}`);
    for (const a of achados.filter((x) => x.pessoa === p).sort((x, y) => ORDEM[x.severidade] - ORDEM[y.severidade])) {
      linhas.push(`  [${a.severidade === "ATENCAO" ? "ATENÇÃO" : a.severidade}] ${a.titulo ? `${a.titulo} — ` : ""}${a.mensagem}`);
    }
    linhas.push("");
  }
  const r = resumir(achados);
  linhas.push(`Resumo: ${r.erros} ERRO(s), ${r.atencoes} ATENÇÃO(ões), ${r.oks} OK.`);
  linhas.push(r.erros > 0 ? "Resultado: REPROVADA (há ERRO)." : r.atencoes > 0 ? "Resultado: sem ERRO, mas há itens para conferir." : "Resultado: APROVADA.");
  return linhas.join("\n");
}

