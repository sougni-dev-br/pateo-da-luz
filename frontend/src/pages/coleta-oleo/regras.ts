// Contas pequenas da tela de coleta de óleo, separadas do componente para testar sem renderizar.

const DIA_MS = 24 * 60 * 60 * 1000;

/** Dias inteiros entre duas datas AAAA-MM-DD (negativo se `ate` vier antes de `de`). */
export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / DIA_MS);
}

/** "hoje", "ontem", "há 5 dias": a última coleta dita em dias vale mais que a data seca para saber se o coletor está atrasado. */
export function haQuantoTempo(dias: number): string {
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  return `há ${dias} dias`;
}

/** Aceita "70", "70,5" e "70.5"; devolve null se não for número. */
export function numeroDoCampo(texto: string): number | null {
  const limpo = texto.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(limpo)) return null;
  return Number(limpo);
}

/** R$ por litro enquanto a pessoa digita: ajuda a perceber um zero a mais no valor ou no volume. */
export function precoPorLitro(volume: string, valor: string): number | null {
  const litros = numeroDoCampo(volume);
  const reais = numeroDoCampo(valor);
  if (litros === null || reais === null || litros <= 0) return null;
  return reais / litros;
}

export type SituacaoDoPix = { tone: "warning" | "danger" | "success" | "neutral" | "info"; label: string };

/** PIX pendente de coleta de dias atrás é atraso: o coletor paga no mesmo dia. */
export function situacaoDoPix(status: "PENDING" | "PARTIAL" | "RECEIVED" | "CANCELLED", dataDaColeta: string, hoje: string): SituacaoDoPix {
  if (status === "RECEIVED") return { tone: "success", label: "PIX recebido" };
  if (status === "CANCELLED") return { tone: "neutral", label: "Cancelada" };
  if (status === "PARTIAL") return { tone: "info", label: "Recebido em parte" };
  const atraso = diasEntre(dataDaColeta, hoje);
  return atraso >= 1 ? { tone: "danger", label: `PIX atrasado · ${atraso} ${atraso === 1 ? "dia" : "dias"}` } : { tone: "warning", label: "PIX pendente" };
}
