import type { AnaliseSerieDia } from "../../api/client";
import { dataCurta, DIAS_CURTOS, diaDaSemana } from "./formato";

// Acima disto o gráfico passa a barras SEMANAIS: 366 colunas diárias não cabem nem informam. 45 barras
// de 3px com vão de 3px ainda cabem em 343px (celular de 375px com margens).
export const MAX_BARRAS_DIARIAS = 45;
const DIAS_NA_SEMANA = 7;

export type Barra = {
  chave: string;
  rotulo: string;
  inicial: string;
  faturamento: number;
  pessoas: number;
  fimDeSemana: boolean;
  // Dia (ou semana inteira) sem nenhuma venda.
  parado: boolean;
  // Semana cortada pelas pontas do período: não serve para comparar nem entra na média.
  parcial: boolean;
};

const UM_DIA_MS = 86_400_000;

// Segunda-feira da semana de uma data: é assim que o restaurante conta a semana.
function segundaDaSemana(iso: string): string {
  const recuar = (diaDaSemana(iso) + 6) % 7;
  return new Date(Date.parse(`${iso}T00:00:00.000Z`) - recuar * UM_DIA_MS).toISOString().slice(0, 10);
}

export function agruparSerie(serie: AnaliseSerieDia[]): { barras: Barra[]; semanal: boolean } {
  if (serie.length <= MAX_BARRAS_DIARIAS) {
    return {
      semanal: false,
      barras: serie.map((d) => ({
        chave: d.data,
        rotulo: `${DIAS_CURTOS[diaDaSemana(d.data)]} ${dataCurta(d.data)}`,
        inicial: DIAS_CURTOS[diaDaSemana(d.data)].charAt(0),
        faturamento: d.faturamento,
        pessoas: d.pessoas,
        fimDeSemana: [0, 6].includes(diaDaSemana(d.data)),
        parado: !d.temMovimento,
        parcial: false
      }))
    };
  }

  const semanas = new Map<string, AnaliseSerieDia[]>();
  for (const d of serie) {
    const chave = segundaDaSemana(d.data);
    semanas.set(chave, [...(semanas.get(chave) ?? []), d]);
  }
  return {
    semanal: true,
    barras: [...semanas.entries()].map(([segunda, dias]) => {
      const parcial = dias.length < DIAS_NA_SEMANA;
      return {
        chave: segunda,
        rotulo: `Semana de ${dataCurta(segunda)}${parcial ? " (parcial)" : ""}`,
        inicial: "",
        faturamento: dias.reduce((s, d) => s + d.faturamento, 0),
        pessoas: dias.reduce((s, d) => s + d.pessoas, 0),
        fimDeSemana: false,
        parado: dias.every((d) => !d.temMovimento),
        parcial
      };
    })
  };
}

// Média que a linha tracejada mostra: dias com movimento (modo diário) ou semanas COMPLETAS com
// movimento (modo semanal, onde a média de semanas cortadas puxaria a linha para baixo).
export function mediaDasBarras(barras: Barra[]): number {
  const validas = barras.filter((b) => !b.parado && !b.parcial);
  return validas.length ? validas.reduce((s, b) => s + b.faturamento, 0) / validas.length : 0;
}
