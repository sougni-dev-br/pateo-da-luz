import type { WasteReason } from "../../api/client";

// Motivos na ordem em que a cozinha os usa. Espelha WASTE_REASONS do backend
// (backend/src/modules/waste/waste.ts): o servidor recusa valor fora dessa lista.
export const MOTIVOS: ReadonlyArray<{ value: WasteReason; label: string }> = [
  { value: "EXPIRED", label: "Vencido" },
  { value: "SPOILED", label: "Estragado" },
  { value: "BREAKAGE", label: "Quebra / avaria" },
  { value: "PREPARATION_ERROR", label: "Erro de preparo" },
  { value: "PRODUCTION_LEFTOVER", label: "Sobra de produção" },
  { value: "CUSTOMER_RETURN", label: "Devolução de cliente" },
  { value: "CONTAMINATION", label: "Contaminação" },
  { value: "OTHER", label: "Outro" },
];

export const PERIODO_PADRAO_DIAS = 30;

export function somarDiasIso(dia: string, dias: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** "1.500": mil e quinhentos ou um e meio? Não se adivinha (o servidor também recusa). */
export const pareceMilhar = (texto: string) => /^\d{1,3}\.\d{3}$/.test(texto.trim());

export type ErroDeQuantidade = "VAZIA" | "MILHAR" | "INVALIDA" | null;

/** Confere a quantidade antes de enviar, para avisar na tela em vez de esperar o servidor. */
export function erroDaQuantidade(texto: string): ErroDeQuantidade {
  const limpo = texto.trim();
  if (limpo === "") return "VAZIA";
  if (pareceMilhar(limpo)) return "MILHAR";
  // Até 4 casas (coluna DECIMAL(14,4) do servidor) e no mínimo 0,0001.
  if (!/^\d+([.,]\d{1,4})?$/.test(limpo)) return "INVALIDA";
  return Number(limpo.replace(",", ".")) >= 0.0001 ? null : "INVALIDA";
}

export const quantidadeValida = (texto: string) => erroDaQuantidade(texto) === null;
