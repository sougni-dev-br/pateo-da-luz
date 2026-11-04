// Leitura do "Cartão de Ponto" em CSV exportado pelo RHiD (Apuração de Ponto → Imprimir → Cartão de Ponto → CSV).
// Uma linha por pessoa e dia, separada por ";". As colunas usadas:
//
//   CPF do funcionário · Nome do funcionário · Dia ("01/10/2026 QUI") · Entrada 1 · Saída 1 · Entrada 2 · Saída 2
//
// Cada uma das quatro células é uma batida "HH:mm (C)" (coletada no relógio) ou "HH:mm (I)" (incluída à mão),
// ou um rótulo do dia inteiro: "Folga", "Falta", "Feriado: <nome>", "Justificado <tipo>".
// O dia com batida vale pelas batidas; o dia sem batida vale pelo rótulo.

import type { TipoDiaEscala } from "./ponto-jornada.js";

/** Tipos de dia que o cartão consegue dizer para a Escala. */
export type TipoDoCartao = Extract<TipoDiaEscala, "FOLGA" | "FOLGA_FERIADO" | "FOLGA_BANCO_HORAS" | "FALTA" | "ATESTADO" | "FERIAS" | "AFASTAMENTO">;

export interface DiaDoCartao {
  cpf: string; // 11 dígitos
  nome: string;
  data: string; // AAAA-MM-DD
  marcacoes: string[]; // HH:mm (só batidas coletadas ou incluídas)
  /** Tipo do dia sem batida; null quando há batida ou quando o dia está em branco. */
  tipo: TipoDoCartao | null;
  /** Rótulo cru do dia ("Folga", "Justificado Banco"…), para mensagens. */
  rotulo: string | null;
}

export interface LeituraCartao {
  dias: DiaDoCartao[];
  /** Rótulos de dia que o ERP não sabe traduzir (nada é gravado neles). */
  desconhecidos: string[];
  avisos: string[];
}

const COLUNAS_OBRIGATORIAS = ["CPF do funcionário", "Nome do funcionário", "Dia", "Entrada 1", "Saída 1", "Entrada 2", "Saída 2"] as const;
const BATIDA = /^(\d{2}:\d{2}) \(([A-Z])\)$/;
const INDICADORES_VALIDOS = new Set(["C", "I"]);

/** Tradução de "Justificado <tipo>" (o nome da justificativa do RHiD) para o tipo da Escala. */
function tipoDaJustificativa(nome: string): TipoDoCartao | null {
  if (/banco/i.test(nome)) return "FOLGA_BANCO_HORAS";
  if (/atestado/i.test(nome)) return "ATESTADO";
  if (/f[ée]rias/i.test(nome)) return "FERIAS";
  if (/licen[çc]a|afastamento|abon/i.test(nome)) return "AFASTAMENTO";
  return null;
}

function tipoDoRotulo(rotulo: string): TipoDoCartao | null {
  const r = rotulo.trim();
  if (/^folga$/i.test(r)) return "FOLGA";
  if (/^falta$/i.test(r)) return "FALTA";
  // "Feriado" é o próprio dia do feriado sem trabalho: folga comum. A folga em troca de feriado trabalhado o RHiD lança como "Justificado Banco".
  if (/^feriado\b/i.test(r)) return "FOLGA";
  const j = /^justificado\s+(.+)$/i.exec(r);
  return j ? tipoDaJustificativa(j[1]) : null;
}

function dataDoCartao(texto: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(texto.trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

export function ehCartaoPonto(texto: string): boolean {
  const cabecalho = texto.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const colunas = cabecalho.split(";").map((c) => c.trim());
  return COLUNAS_OBRIGATORIAS.every((c) => colunas.includes(c));
}

export function lerCartaoPonto(texto: string): LeituraCartao {
  const linhas = texto.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  const cabecalho = (linhas[0] ?? "").split(";").map((c) => c.trim());
  const idx = Object.fromEntries(COLUNAS_OBRIGATORIAS.map((c) => [c, cabecalho.indexOf(c)])) as Record<(typeof COLUNAS_OBRIGATORIAS)[number], number>;
  const avisos: string[] = [];
  if (COLUNAS_OBRIGATORIAS.some((c) => idx[c] < 0)) {
    return { dias: [], desconhecidos: [], avisos: ["O arquivo não parece o Cartão de Ponto em CSV do RHiD (faltam colunas)."] };
  }

  const dias: DiaDoCartao[] = [];
  const desconhecidos = new Set<string>();
  let ilegiveis = 0;
  for (const linha of linhas.slice(1)) {
    const c = linha.split(";");
    const cpf = (c[idx["CPF do funcionário"]] ?? "").replace(/\D/g, "");
    const data = dataDoCartao(c[idx["Dia"]] ?? "");
    if (cpf.length !== 11 || !data) {
      ilegiveis += 1;
      continue;
    }
    const celulas = [c[idx["Entrada 1"]], c[idx["Saída 1"]], c[idx["Entrada 2"]], c[idx["Saída 2"]]].map((x) => (x ?? "").trim());
    const marcacoes: string[] = [];
    const rotulos: string[] = [];
    for (const cel of celulas) {
      if (!cel) continue;
      const b = BATIDA.exec(cel);
      if (b) {
        if (INDICADORES_VALIDOS.has(b[2])) marcacoes.push(b[1]);
      } else {
        rotulos.push(cel);
      }
    }
    let tipo: TipoDoCartao | null = null;
    let rotulo: string | null = null;
    if (marcacoes.length === 0 && rotulos.length > 0) {
      rotulo = rotulos[0];
      tipo = rotulos.every((r) => r === rotulo) ? tipoDoRotulo(rotulo) : null;
      if (!tipo) desconhecidos.add(rotulos.length > 1 && !rotulos.every((r) => r === rotulos[0]) ? rotulos.join(" / ") : rotulo);
    }
    dias.push({ cpf, nome: (c[idx["Nome do funcionário"]] ?? "").trim(), data, marcacoes, tipo, rotulo });
  }
  if (ilegiveis > 0) avisos.push(`${ilegiveis} ${ilegiveis === 1 ? "linha ilegível ignorada" : "linhas ilegíveis ignoradas"}.`);
  return { dias, desconhecidos: [...desconhecidos], avisos };
}
