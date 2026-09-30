import type { ExtraMotivo, ExtraPixTipo, ExtraStatus } from "../../../api/client";

export const MOTIVO_ROTULO: Record<ExtraMotivo, string> = {
  COBERTURA_FALTA: "Cobrir falta",
  COBERTURA_FOLGA: "Cobrir folga",
  COBERTURA_FERIAS: "Cobrir férias",
  EVENTO: "Evento",
  MOVIMENTO: "Movimento alto",
  OUTRO: "Outro",
};

export const MOTIVOS = Object.keys(MOTIVO_ROTULO) as ExtraMotivo[];
export const MOTIVO_COBERTURA = new Set<ExtraMotivo>(["COBERTURA_FALTA", "COBERTURA_FOLGA", "COBERTURA_FERIAS"]);

export const STATUS_ROTULO: Record<ExtraStatus, string> = {
  PREVISTA: "Prevista",
  REALIZADA: "Realizada",
  NAO_COMPARECEU: "Não compareceu",
  CANCELADA: "Cancelada",
};
export const STATUS_TOM: Record<ExtraStatus, "neutral" | "success" | "warning" | "danger" | "info"> = {
  PREVISTA: "info",
  REALIZADA: "success",
  NAO_COMPARECEU: "danger",
  CANCELADA: "neutral",
};

export const PIX_ROTULO: Record<ExtraPixTipo, string> = {
  CPF: "CPF",
  CNPJ: "CNPJ",
  EMAIL: "E-mail",
  TELEFONE: "Telefone",
  ALEATORIA: "Aleatória",
};

export const SETORES_BASE = ["Cozinha", "Salão", "Bar", "Pia", "Pizzaria", "Buffet", "Delivery"];

export const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
// Rótulo curto (sem centavos quando redondo): cabe na barra do topo.
export const brlCurto = (n: number) => (Number.isInteger(n) ? `R$ ${n.toLocaleString("pt-BR")}` : brl(n));
export const diariasTexto = (n: number) => (n === 1 ? "1 diária" : `${n.toLocaleString("pt-BR")} diárias`);

// "2026-09-30" → "30/09 · ter"
export function dataCurta(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dia = dt.toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" }).replace(".", "");
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")} · ${dia}`;
}

export function hojeIso() {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`;
}

// "1.234,56" ou "10.5" → número
export function paraNumero(s: string) {
  const t = s.trim();
  if (!t) return 0;
  return Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
}
