// Hora extra e adicional noturno de quem não tem registro, pagos na lista da gorjeta
// (regras do dono, out/2026). Funções puras.
//
//   hora normal         = salário base ÷ 220
//   hora extra          = horas × hora normal × 1,5 (sempre +50%)
//   adicional noturno   = horas × hora normal × 20% × 60 ÷ 52,5 (hora noturna reduzida)
//
// Ex.: base R$ 2.200 → hora R$ 10,00; 10h de HE = R$ 150,00; 7h de noturno = R$ 16,00.

import { round2 } from "./vt-calc.js";

export const HORAS_MES = 220;
export const FATOR_HORA_EXTRA = 1.5;
export const PERCENTUAL_NOTURNO = 0.2;
export const MINUTOS_HORA_NOTURNA = 52.5;

// Mesmas regras da tela (gorjetaUtils.parseHoras): "7:34", "7h34", "7,5" (horas
// decimais) → minutos. Vazio ou ilegível → null.
export function parseHoras(texto: string | null | undefined): number | null {
  if (!texto) return null;
  const s = texto.trim().toLowerCase().replace("h", ":");
  const hm = /^(\d{1,3}):(\d{1,2})$/.exec(s);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  const dec = Number(s.replace(",", "."));
  return isNaN(dec) ? null : Math.round(dec * 60);
}

export function fmtHoras(min: number | null): string {
  if (min == null) return "";
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

// Minutos que entram na conta: ilegível ou negativo não paga nada (vira aviso na apuração).
export const minutosValidos = (texto: string | null | undefined): number => Math.max(0, parseHoras(texto) ?? 0);

// Teto de horas por período: mais que isso é erro de digitação (ex.: "750" no lugar de "7:50").
export const MAXIMO_HORAS_PERIODO = 300;

// O que a tela manda vira h:mm gravado. Vazio = null; negativo ou acima do teto = erro.
// Ilegível fica como veio (pode ser texto antigo da contabilidade): conta zero e vira
// aviso na apuração — recusar travaria a gravação da lista inteira.
export function normalizarHorasDigitadas(valor: unknown, rotulo: string): { texto: string | null } | { erro: string } {
  if (valor == null || String(valor).trim() === "") return { texto: null };
  const texto = String(valor).trim().slice(0, 20);
  const min = parseHoras(texto);
  if (min == null) return { texto };
  if (min < 0) return { erro: `${rotulo}: ${texto} não pode ser negativo.` };
  if (min > MAXIMO_HORAS_PERIODO * 60) return { erro: `${rotulo}: ${fmtHoras(min)} passa de ${MAXIMO_HORAS_PERIODO} horas no período.` };
  return { texto: fmtHoras(min) };
}

export function valoresAdicionais(salarioBase: number | null, horaExtraMin: number, noturnoMin: number) {
  if (!salarioBase || salarioBase <= 0) return { valorHoraExtra: 0, valorAdicionalNoturno: 0 };
  const hora = salarioBase / HORAS_MES;
  return {
    valorHoraExtra: round2((Math.max(0, horaExtraMin) / 60) * hora * FATOR_HORA_EXTRA),
    valorAdicionalNoturno: round2((Math.max(0, noturnoMin) / 60) * hora * PERCENTUAL_NOTURNO * (60 / MINUTOS_HORA_NOTURNA)),
  };
}
