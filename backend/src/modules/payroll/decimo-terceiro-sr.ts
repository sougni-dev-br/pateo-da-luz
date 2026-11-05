// 13º salário de quem NÃO tem registro (NAO_CLT) — decisões do Eli, 05/11/2026:
// - Avos contam desde o início real (Employee.admissionDate), mesmo que a carteira seja
//   posterior ou que a pessoa nunca tenha sido registrada. Mês com 15 dias ou mais = 1 avo.
// - Base: salário base vigente em 20/12 + média mensal das variáveis do ano (gorjeta, hora
//   extra, adicional noturno e DSR; soma ÷ avos, como o CLT faz), ÷ 12 × avos.
// - Duas parcelas: 50% até 30/11 e o restante até 20/12.
// CLT não passa por aqui: o valor vem do extrato da contabilidade.
import { avos13 } from "./rescisao-verbas-opcionais.js";
import { round2 } from "./vt-calc.js";

export const PARCELA_1_DIA = { mes: 11, dia: 30 } as const;
export const PARCELA_2_DIA = { mes: 12, dia: 20 } as const;
export const ROTULO_13_PARCELA_1 = "13º Salário - 1ª parcela";
export const ROTULO_13_PARCELA_2 = "13º Salário - 2ª parcela";

export type Decimo13SR = {
  ano: number; avos: number; desde: string; salario: number; mediaVariaveis: number; base: number; total: number;
  parcela1: number; parcela2: number; vencimento1: string; vencimento2: string; memoria: string;
};

const br = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = (ano: number, mes: number, dia: number) => new Date(Date.UTC(ano, mes - 1, dia)).toISOString().slice(0, 10);

// null = não há 13º a gerar (sem início, sem salário, saiu antes do ano, ou 0 avos).
export function calcularDecimoTerceiroSR(e: {
  ano: number; salarioBase: number | null; inicio: Date | null; desligamento: Date | null;
  // Soma das variáveis (gorjeta, extras) recebidas no ano; a média é soma ÷ avos.
  variaveisSoma?: number;
}): Decimo13SR | null {
  if (!e.inicio || e.salarioBase == null || !(e.salarioBase > 0)) return null;
  const fimDoAno = new Date(Date.UTC(e.ano, 11, 31));
  if (e.inicio.getTime() > fimDoAno.getTime()) return null;
  if (e.desligamento && e.desligamento.getUTCFullYear() < e.ano) return null;
  const ate = e.desligamento && e.desligamento.getUTCFullYear() === e.ano ? e.desligamento : fimDoAno;
  const { avos, desde } = avos13(e.inicio, ate);
  if (avos <= 0) return null;
  const salario = round2(e.salarioBase);
  const mediaVariaveis = round2(Math.max(0, e.variaveisSoma ?? 0) / avos);
  const base = round2(salario + mediaVariaveis);
  const total = round2((base / 12) * avos);
  const parcela1 = round2(total / 2);
  const parcela2 = round2(total - parcela1);
  return {
    ano: e.ano, avos, desde, salario, mediaVariaveis, base, total, parcela1, parcela2,
    vencimento1: iso(e.ano, PARCELA_1_DIA.mes, PARCELA_1_DIA.dia),
    vencimento2: iso(e.ano, PARCELA_2_DIA.mes, PARCELA_2_DIA.dia),
    memoria: `(S ${br(salario)}${mediaVariaveis > 0 ? ` + média variáveis ${br(mediaVariaveis)}` : ""}) ÷ 12 × ${avos} ${avos === 1 ? "avo" : "avos"} = ${br(total)} (desde ${desde.split("-").reverse().join("/")})`,
  };
}
