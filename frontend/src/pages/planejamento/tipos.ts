import type { PlanejamentoLado } from "../../api/client";

// Campos que o servidor manda (ou passa a mandar) além do contrato tipado em api/client. A tela lê se vierem e
// ignora se não vierem: nada aqui muda o que é enviado.

/** `avisos` da prévia e do cenário (ex.: base incompleta). Sempre uma lista de textos, vazia se não houver. */
export function avisosDe(resposta: object | null): string[] {
  if (!resposta) return [];
  const avisos = (resposta as { avisos?: unknown }).avisos;
  return Array.isArray(avisos) ? avisos.filter((a): a is string => typeof a === "string" && a.trim() !== "") : [];
}

/** O lado do comparativo veio de um mês que o ERP não cobre inteiro (menos de 90% dos dias com venda)? */
export function ladoParcial(lado: PlanejamentoLado): boolean {
  return (lado as { parcial?: unknown }).parcial === true;
}

/** Dia do mês de "hoje" (aaaa-mm-dd) para rotular o mês em andamento como "parcial: até dia X". */
export function diaDeHoje(hoje: string): number | null {
  const dia = Number(hoje.slice(8, 10));
  return Number.isInteger(dia) && dia > 0 ? dia : null;
}
