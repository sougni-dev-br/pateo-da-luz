import type { ReceivableSourceType, ReceivableView } from "../../api/client";
import { numeroBr } from "../../utils/format";
import { diasEntre, rotuloPrazo as rotuloPrazoPagar } from "../payables/regras";

export type Vista = "pendentes" | "recebidas" | "canceladas" | "todas";
/** Recorte dos cartões de total dentro de "Pendentes". As janelas são cumulativas, como no resumo do servidor. */
export type Foco = "atrasadas" | "hoje" | "proximos7" | "proximos30";

export const VISTAS: Array<{ chave: Vista; rotulo: string }> = [
  { chave: "pendentes", rotulo: "A receber" },
  { chave: "recebidas", rotulo: "Recebidas" },
  { chave: "canceladas", rotulo: "Canceladas" },
  { chave: "todas", rotulo: "Todas" }
];

export const ORIGENS: ReceivableSourceType[] = [
  "IFOOD_SETTLEMENT", "NOVENTA_NOVE_SETTLEMENT", "KEETA_SETTLEMENT", "EVENT", "DIRECT", "OTHER"
];

export const ORIGEM_ROTULO: Record<ReceivableSourceType, string> = {
  IFOOD_SETTLEMENT: "iFood",
  NOVENTA_NOVE_SETTLEMENT: "99 Food",
  KEETA_SETTLEMENT: "Keeta",
  EVENT: "Evento",
  DIRECT: "Direto",
  OTHER: "Outros"
};

/** Origens que o usuário pode lançar à mão (as de plataforma chegam por sincronização/importação). */
export const ORIGENS_MANUAIS: Array<{ value: ReceivableSourceType; label: string }> = [
  { value: "EVENT", label: "Evento / empreitada" },
  { value: "DIRECT", label: "Recebimento direto" },
  { value: "OTHER", label: "Outro" }
];

// Reaproveita as cores de selo de Contas a Pagar (tints do design system).
export const ORIGEM_SELO: Record<ReceivableSourceType, string> = {
  IFOOD_SETTLEMENT: "fatura",
  NOVENTA_NOVE_SETTLEMENT: "extra",
  KEETA_SETTLEMENT: "ciclo",
  EVENT: "folha",
  DIRECT: "legado",
  OTHER: "legado"
};

export type Situacao = "late" | "OPEN" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";

export const SITUACAO_ROTULO: Record<Situacao, string> = {
  late: "Atrasada",
  OPEN: "A receber",
  PARTIALLY_RECEIVED: "Recebida em parte",
  RECEIVED: "Recebida",
  CANCELLED: "Cancelada"
};

export const SITUACAO_TOM: Record<Situacao, "danger" | "info" | "warning" | "success" | "neutral"> = {
  late: "danger",
  OPEN: "info",
  PARTIALLY_RECEIVED: "warning",
  RECEIVED: "success",
  CANCELLED: "neutral"
};

export function situacaoDe(c: Pick<ReceivableView, "status" | "isLate">): Situacao {
  if (c.isLate) return "late";
  return c.status === "LATE" ? "late" : c.status;
}

/**
 * Descrição como a pessoa lê: os repasses das plataformas chegam com datas em ISO e seta
 * ("Repasse iFood 2026-10-12 → 2026-10-18 · Loja"); aqui viram "12/10 a 18/10".
 */
export function tituloDaConta(descricao: string): string {
  return descricao
    .replace(/\d{4}-(\d{2})-(\d{2})/g, "$2/$1")
    .replace(/\s*→\s*/g, " a ")
    .trim();
}

export const estaPendente = (c: Pick<ReceivableView, "status">) => c.status === "OPEN" || c.status === "PARTIALLY_RECEIVED";
export const podeCancelar = (c: Pick<ReceivableView, "status">) => c.status === "OPEN";
export const temRecebimento = (c: Pick<ReceivableView, "status" | "paidAmount">) =>
  c.status !== "CANCELLED" && (c.paidAmount ?? 0) > 0;

/** Taxa que a plataforma retém, em % do bruto. Null quando não há bruto. */
export function taxaEfetiva(c: Pick<ReceivableView, "grossAmount" | "fees">): number | null {
  return c.grossAmount > 0 ? Math.round((c.fees / c.grossAmount) * 1000) / 10 : null;
}

export function rotuloPrazo(c: Pick<ReceivableView, "expectedDate">, hoje: string): string {
  // "vence" é de pagar; aqui a conta é a receber.
  return rotuloPrazoPagar(c.expectedDate, hoje)
    .replace("vence hoje", "previsto para hoje")
    .replace("vence amanhã", "previsto para amanhã");
}

// ── Foco dos cartões e dia da agenda ─────────────────────────────────────

function dias(c: Pick<ReceivableView, "expectedDate">, hoje: string) {
  return diasEntre(hoje, c.expectedDate);
}

export function aplicarFoco(contas: ReceivableView[], foco: Foco | null, hoje: string): ReceivableView[] {
  if (!foco) return contas;
  return contas.filter((c) => {
    const d = dias(c, hoje);
    if (foco === "atrasadas") return d < 0;
    if (foco === "hoje") return d === 0;
    if (foco === "proximos7") return d >= 0 && d <= 7;
    return d >= 0 && d <= 30;
  });
}

export function aplicarOrigem(contas: ReceivableView[], origem: ReceivableSourceType | "all"): ReceivableView[] {
  return origem === "all" ? contas : contas.filter((c) => c.sourceType === origem);
}

export function aplicarDia(contas: ReceivableView[], dia: string | null): ReceivableView[] {
  return dia ? contas.filter((c) => c.expectedDate === dia) : contas;
}

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Busca por descrição, cliente, referência ou valor (digitando "1250", "1.250,00" ou "1250,5"). */
export function filtrarPorBusca(contas: ReceivableView[], texto: string): ReceivableView[] {
  const termo = semAcento(texto.trim());
  if (!termo) return contas;
  const valor = /^[\d.,]+$/.test(termo) ? numeroBr(termo) : null;
  return contas.filter((c) => {
    const alvo = semAcento([c.description, c.customerName ?? "", c.sourceRef ?? "", ORIGEM_ROTULO[c.sourceType]].join(" "));
    if (alvo.includes(termo)) return true;
    return valor !== null && valor > 0 && [c.netAmount, c.remainingAmount, c.paidAmount ?? 0].some((v) => Math.abs(v - valor) < 0.005);
  });
}

export function contagemPorOrigem(contas: ReceivableView[]): Record<ReceivableSourceType, number> {
  const mapa = Object.fromEntries(ORIGENS.map((o) => [o, 0])) as Record<ReceivableSourceType, number>;
  for (const c of contas) mapa[c.sourceType] += 1;
  return mapa;
}

// ── Grupos da lista ──────────────────────────────────────────────────────

export type GrupoDeContas = {
  chave: string;
  rotulo: string;
  /** Valor que ainda falta receber (pendentes) ou foi recebido/previsto (demais vistas). */
  total: number;
  contas: ReceivableView[];
};

const GRUPOS_URGENCIA: Array<{ chave: string; rotulo: string; cabe: (d: number) => boolean }> = [
  { chave: "atrasadas", rotulo: "Atrasadas", cabe: (d) => d < 0 },
  { chave: "hoje", rotulo: "Previstas para hoje", cabe: (d) => d === 0 },
  { chave: "proximos7", rotulo: "Próximos 7 dias", cabe: (d) => d > 0 && d <= 7 },
  { chave: "depois", rotulo: "Depois", cabe: (d) => d > 7 }
];

const soma = (valores: number[]) => Math.round(valores.reduce((s, v) => s + Math.round(v * 100), 0)) / 100;

/** Pendentes por urgência; dentro de cada grupo, a mais antiga primeiro. */
export function agruparPorUrgencia(contas: ReceivableView[], hoje: string): GrupoDeContas[] {
  return GRUPOS_URGENCIA
    .map((g) => {
      const doGrupo = contas
        .filter((c) => g.cabe(dias(c, hoje)))
        .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate) || a.description.localeCompare(b.description));
      return { chave: g.chave, rotulo: g.rotulo, total: soma(doGrupo.map((c) => c.remainingAmount)), contas: doGrupo };
    })
    .filter((g) => g.contas.length > 0);
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function rotuloDoMes(chave: string): string {
  const [ano, mes] = chave.split("-");
  return `${MESES[Number(mes) - 1] ?? "?"} de ${ano}`;
}

/** Histórico por mês (mais recente primeiro): do recebimento nas recebidas, da previsão nas demais. */
export function agruparPorMes(contas: ReceivableView[]): GrupoDeContas[] {
  const mapa = new Map<string, ReceivableView[]>();
  for (const c of contas) {
    const dia = c.status === "RECEIVED" && c.receivedDate ? c.receivedDate : c.expectedDate;
    const chave = dia.slice(0, 7);
    mapa.set(chave, [...(mapa.get(chave) ?? []), c]);
  }
  return [...mapa.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([chave, doMes]) => ({
      chave,
      rotulo: rotuloDoMes(chave),
      total: soma(doMes.map((c) => (c.status === "RECEIVED" ? c.paidAmount ?? c.netAmount : c.status === "CANCELLED" ? 0 : c.netAmount))),
      contas: [...doMes].sort((a, b) => b.expectedDate.localeCompare(a.expectedDate))
    }));
}

// ── Agenda dos próximos dias ─────────────────────────────────────────────

export type DiaDaAgenda = {
  chave: string;
  qtd: number;
  total: number;
  porOrigem: Array<{ origem: ReceivableSourceType; total: number }>;
};

function somarDia(chave: string, n: number): string {
  const [a, m, d] = chave.split("-").map(Number);
  const data = new Date(Date.UTC(a, m - 1, d + n));
  return data.toISOString().slice(0, 10);
}

export function diasDaAgenda(pendentes: ReceivableView[], hoje: string, quantidade = 14): DiaDaAgenda[] {
  return Array.from({ length: quantidade }, (_, i) => {
    const chave = somarDia(hoje, i);
    const doDia = pendentes.filter((c) => c.expectedDate === chave);
    const porOrigem = ORIGENS
      .map((origem) => ({ origem, total: soma(doDia.filter((c) => c.sourceType === origem).map((c) => c.remainingAmount)) }))
      .filter((o) => o.total > 0);
    return { chave, qtd: doDia.length, total: soma(doDia.map((c) => c.remainingAmount)), porOrigem };
  });
}

// ── Período das vistas de histórico ──────────────────────────────────────

export type PresetPeriodo = "mes" | "mes-passado" | "30dias" | "ano" | "tudo" | "custom";

export const PRESETS_PERIODO: Array<{ value: PresetPeriodo; label: string }> = [
  { value: "mes", label: "Este mês" },
  { value: "mes-passado", label: "Mês passado" },
  { value: "30dias", label: "Últimos 30 dias" },
  { value: "ano", label: "Este ano" },
  { value: "tudo", label: "Tudo" },
  { value: "custom", label: "Personalizado" }
];

export function periodoDoPreset(preset: PresetPeriodo, hoje: string): { startDate: string; endDate: string } {
  const [ano, mes] = hoje.split("-").map(Number);
  const dia = (a: number, m: number, d: number) => new Date(Date.UTC(a, m - 1, d)).toISOString().slice(0, 10);
  switch (preset) {
    case "mes":
      return { startDate: dia(ano, mes, 1), endDate: dia(ano, mes + 1, 0) };
    case "mes-passado":
      return { startDate: dia(ano, mes - 1, 1), endDate: dia(ano, mes, 0) };
    case "30dias":
      return { startDate: somarDia(hoje, -29), endDate: hoje };
    case "ano":
      return { startDate: dia(ano, 1, 1), endDate: dia(ano, 12, 31) };
    default:
      return { startDate: "", endDate: "" };
  }
}

export function rotuloDoPeriodo(preset: PresetPeriodo): string {
  return PRESETS_PERIODO.find((p) => p.value === preset)?.label ?? "";
}
