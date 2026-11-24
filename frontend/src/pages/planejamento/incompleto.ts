import type { PlanejamentoProjecao, PlanejamentoResultado } from "../../api/client";
import { NOMES_DOS_MESES_CURTOS } from "./formato";

// Cenário incompleto: sem CMV de algum mês projetado não há margem nem lucro, e sem nenhum gasto lançado o lucro e o
// caixa saem inflados (as entradas aparecem e as saídas são zero). Nesses casos a tela não destaca saldo nem resultado
// de caixa: mostra "—" e diz o que falta.

export type Pendencia =
  | { tipo: "cmv"; meses: number[] }
  | { tipo: "gastos" };

/** Meses projetados que ainda não têm CMV definido. */
export function mesesSemCmv(projecao: PlanejamentoProjecao): number[] {
  return projecao.meses.filter((m) => m.projetado && m.cmvPercentual === null).map((m) => m.mes);
}

/** O que falta para o cenário valer um veredito (CMV primeiro, depois os gastos), ou null se está completo. */
export function pendenciaDoCenario(projecao: PlanejamentoProjecao, resultado: PlanejamentoResultado | null): Pendencia | null {
  const meses = mesesSemCmv(projecao);
  if (meses.length > 0) return { tipo: "cmv", meses };
  if (resultado !== null && resultado.total.gastosTotal === 0) return { tipo: "gastos" };
  return null;
}

/** "Jan, Fev e Mar" a partir dos números dos meses. */
export function listaDeMeses(meses: readonly number[]): string {
  const nomes = meses.map((m) => NOMES_DOS_MESES_CURTOS[m - 1]);
  return nomes.length <= 1 ? nomes.join("") : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

export function textoDaPendencia(pendencia: Pendencia): string {
  if (pendencia.tipo === "gastos") return "sem gastos lançados";
  const n = pendencia.meses.length;
  return `falta o CMV de ${n} ${n === 1 ? "mês" : "meses"}`;
}

/** Leva o foco ao campo de CMV do mês (a aba Premissas já precisa estar aberta); tolera tabela e cartões. */
export function focarCmvDoMes(mes: number): void {
  const rotulo = `CMV em ${NOMES_DOS_MESES_CURTOS[mes - 1]}`;
  const campo = Array.from(document.querySelectorAll<HTMLInputElement>("input[aria-label]")).find((i) => i.getAttribute("aria-label") === rotulo && i.offsetParent !== null);
  campo?.scrollIntoView({ block: "center", behavior: "smooth" });
  campo?.focus({ preventScroll: true });
}

/** Espera a aba trocar (dois quadros) antes de procurar o campo. */
export function focarCmvDepoisDeRenderizar(mes: number): void {
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => focarCmvDoMes(mes)));
}
