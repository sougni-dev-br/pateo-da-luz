import type { EventArea, EventOrigin, EventSize, ServiceMode } from "../../../api/client";

export const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export const TAMANHO: Record<EventSize, { curto: string; nome: string }> = {
  PEQUENO: { curto: "P", nome: "Pequeno" },
  MEDIO: { curto: "M", nome: "Médio" },
  GRANDE: { curto: "G", nome: "Grande" },
};

export const MODALIDADE: Record<ServiceMode, string> = {
  BUFFET: "Buffet",
  BUFFET_EXECUTIVO: "Buffet executivo",
  A_LA_CARTE: "À la carte",
};

export const ORIGEM: Record<EventOrigin, string> = {
  CENTRO_CONVENCOES: "Centro de convenções",
  TEATRO: "Teatro",
  GRUPO: "Grupo com pacote",
};

export const AREA: Record<EventArea, string> = {
  SAUDE: "Saúde",
  CORPORATIVO: "Corporativo",
  TECNOLOGIA: "Tecnologia",
  JURIDICO: "Jurídico",
  FINANCEIRO: "Financeiro e contábil",
  FEIRA_VAREJO: "Feira",
  EDUCACAO: "Educação",
  ENTRETENIMENTO: "Entretenimento",
  OUTRO: "Outro",
};

export const opcoes = <K extends string>(mapa: Record<K, string>) =>
  (Object.entries(mapa) as Array<[K, string]>).map(([value, label]) => ({ value, label }));

const dataUtc = (iso: string) => new Date(`${iso}T12:00:00Z`);

export function diaDaSemana(iso: string): string {
  return SEMANA[dataUtc(iso).getUTCDay()];
}

export function ehFimDeSemana(iso: string): boolean {
  const d = dataUtc(iso).getUTCDay();
  return d === 0 || d === 6;
}

/** 07/10 */
export function diaMes(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/** 07/10/2026 */
export function dataBr(iso: string): string {
  return iso.split("-").reverse().join("/");
}

export function hojeIso(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`;
}

export function reais(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return "—";
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

export function ticket(valor: number | null, pessoas: number | null): string {
  if (!valor || !pessoas) return "—";
  return (valor / pessoas).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Preço digitado: "82,90", "1.082,90" ou "82.90" (com ponto, no celular). Vazio vira null;
 * texto que não é número vira NaN, para a tela avisar.
 */
export function lerPreco(texto: string): number | null {
  const t = texto.trim().replace(/^R\$\s*/i, "");
  if (!t) return null;
  if (t.includes(",")) return Number(t.replace(/\./g, "").replace(",", "."));
  return Number(t);
}

export function diaDoEvento(dia: number, total: number): string {
  return total <= 1 ? "1 dia" : `${dia}º de ${total}`;
}
