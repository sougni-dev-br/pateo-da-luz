// Contas do painel de planejamento: quanta gente fica fora mês a mês e os prazos de aviso e pagamento.
import type { ListaFerias } from "../../../api/client";
import { type Ausencia, diasEntre } from "./eixoDoTempo";
import { somaDias } from "./feriasFormato";
import { DIAS_ANTES_PARA_PAGAR, DIAS_DE_AVISO } from "./regrasFerias";

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const primeiroDoMes = (iso: string, deslocar: number): string => {
  const [a, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 + deslocar, 1)).toISOString().slice(0, 10);
};

export type ResumoDoMes = { iso: string; nome: string; ano: number; diasFora: number; pico: number; pessoas: number };

/** Para cada um dos próximos `meses` meses: dias de férias somados (pessoa-dia), pico ao mesmo tempo e quantas pessoas saem. */
export function resumoPorMes(ausencias: Ausencia[], hoje: string, meses = 12): ResumoDoMes[] {
  const resultado: ResumoDoMes[] = [];
  for (let i = 0; i < meses; i++) {
    const inicio = primeiroDoMes(hoje, i);
    const fim = somaDias(primeiroDoMes(hoje, i + 1), -1);
    const doMes = ausencias.filter((a) => a.inicio <= fim && a.fim >= inicio);
    const total = diasEntre(inicio, fim) + 1;
    const porDia = new Array<number>(total).fill(0);
    for (const a of doMes) {
      const de = Math.max(0, diasEntre(inicio, a.inicio));
      const ate = Math.min(total - 1, diasEntre(inicio, a.fim));
      for (let d = de; d <= ate; d++) porDia[d] += 1;
    }
    const [ano, numero] = inicio.split("-").map(Number);
    resultado.push({
      iso: inicio, nome: MESES_CURTOS[numero - 1], ano,
      diasFora: porDia.reduce((s, n) => s + n, 0), pico: porDia.reduce((m, n) => Math.max(m, n), 0), pessoas: new Set(doMes.map((a) => a.employeeId)).size,
    });
  }
  return resultado;
}

export type PrazoDeAviso = {
  chave: string; nome: string; inicio: string; avisarAte: string; pagarAte: string;
  /** Dias até o último dia de avisar e de pagar (negativo = já passou). */
  diasParaAvisar: number; diasParaPagar: number;
};

/** O que falta fazer antes de cada férias programada que ainda não começou: avisar a pessoa e pagar. */
export function prazosDeAviso(lista: ListaFerias): PrazoDeAviso[] {
  return lista.pessoas
    .flatMap((pessoa) => pessoa.periodos.flatMap((p) => p.programacoes.flatMap((g) => {
      if (g.status !== "PROGRAMADA" || !g.gozoInicio || g.gozoInicio <= lista.hoje) return [];
      const avisarAte = somaDias(g.gozoInicio, -DIAS_DE_AVISO);
      const pagarAte = somaDias(g.gozoInicio, -DIAS_ANTES_PARA_PAGAR);
      return [{
        chave: g.id, nome: pessoa.nome, inicio: g.gozoInicio, avisarAte, pagarAte,
        diasParaAvisar: diasEntre(lista.hoje, avisarAte), diasParaPagar: diasEntre(lista.hoje, pagarAte),
      }];
    })))
    .sort((a, b) => a.pagarAte.localeCompare(b.pagarAte) || a.nome.localeCompare(b.nome, "pt-BR"));
}
