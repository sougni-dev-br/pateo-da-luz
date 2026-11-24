export type PeriodPreset = "month" | "prevMonth" | "year" | "all" | "custom";

export type HistoryPeriod = { from: string; to: string };

export const PERIOD_OPTIONS: Array<{ value: PeriodPreset; label: string }> = [
  { value: "month", label: "Mês atual" },
  { value: "prevMonth", label: "Mês anterior" },
  { value: "year", label: "Ano atual" },
  { value: "all", label: "Todo o histórico" },
  { value: "custom", label: "Personalizado" }
];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function isoDay(year: number, monthIndex: number, day: number): string {
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}

function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** Período (YYYY-MM-DD, fim inclusivo) de cada atalho; "all" e "custom" não fixam datas. */
export function resolvePeriod(preset: PeriodPreset, today: Date = new Date()): HistoryPeriod {
  const year = today.getFullYear();
  const month = today.getMonth();

  if (preset === "month") return { from: isoDay(year, month, 1), to: isoDay(year, month, lastDayOfMonth(year, month)) };
  if (preset === "prevMonth") {
    const prevYear = month === 0 ? year - 1 : year;
    const prevMonth = month === 0 ? 11 : month - 1;
    return { from: isoDay(prevYear, prevMonth, 1), to: isoDay(prevYear, prevMonth, lastDayOfMonth(prevYear, prevMonth)) };
  }
  if (preset === "year") return { from: isoDay(year, 0, 1), to: isoDay(year, 11, 31) };
  return { from: "", to: "" };
}

/** Dias corridos desde uma data ISO até hoje (ambas lidas como dia UTC, como o resto do ERP). */
export function daysSince(isoDate: string | null | undefined, today: Date = new Date()): number | null {
  if (!isoDate) return null;
  const then = Date.UTC(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)) - 1, Number(isoDate.slice(8, 10)));
  if (Number.isNaN(then)) return null;
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.round((now - then) / 86_400_000));
}

export function describeDaysSince(days: number | null): string {
  if (days === null) return "";
  if (days === 0) return "hoje";
  if (days === 1) return "ontem";
  return `há ${days} dias`;
}

export function purchaseStatusLabel(status: string): string {
  return status === "CANCELLED" ? "Cancelada" : "Ativa";
}

export function purchaseStatusTone(status: string): "danger" | "success" {
  return status === "CANCELLED" ? "danger" : "success";
}

type TitleLike = {
  state: "NONE" | "OPEN" | "OVERDUE" | "PAID";
  installments: number;
  paidInstallments: number;
  nextDueDate: string | null;
  paidDate: string | null;
  viaCycle: boolean;
};

export function titleStateLabel(title: Pick<TitleLike, "state">): string {
  if (title.state === "PAID") return "Baixado";
  if (title.state === "OVERDUE") return "Vencido";
  if (title.state === "OPEN") return "Em aberto";
  return "Sem título";
}

export function titleStateTone(title: Pick<TitleLike, "state">): "success" | "danger" | "info" | "neutral" {
  if (title.state === "PAID") return "success";
  if (title.state === "OVERDUE") return "danger";
  if (title.state === "OPEN") return "info";
  return "neutral";
}

/** "2026-07-17" → "17/07/2026", sem passar por Date (nada de fuso). */
export function brDay(isoDay: string | null): string {
  return isoDay && /^\d{4}-\d{2}-\d{2}/.test(isoDay) ? `${isoDay.slice(8, 10)}/${isoDay.slice(5, 7)}/${isoDay.slice(0, 4)}` : "";
}

/** Linha de apoio sob o selo do título: quando venceu/vence/foi baixado, parcelas e origem. */
export function describeTitle(title: TitleLike): string {
  const parts: string[] = [];
  if (title.viaCycle) parts.push(title.state === "NONE" ? "Ciclo ainda não fechado" : "Ciclo");
  if (title.state === "PAID" && title.paidDate) parts.push(`baixado em ${brDay(title.paidDate)}`);
  if (title.state === "OPEN" && title.nextDueDate) parts.push(`vence ${brDay(title.nextDueDate)}`);
  if (title.state === "OVERDUE" && title.nextDueDate) parts.push(`venceu ${brDay(title.nextDueDate)}`);
  if (title.installments > 1) {
    parts.push(title.paidInstallments > 0 && title.state !== "PAID"
      ? `${title.paidInstallments}/${title.installments} pagas`
      : `${title.installments} parcelas`);
  }
  return parts.join(" · ");
}

type ParcelLike = { state: "OPEN" | "OVERDUE" | "PAID"; dueDate: string | null; paidDate: string | null };

export function parcelStateLabel(parcel: Pick<ParcelLike, "state">): string {
  if (parcel.state === "PAID") return "Baixada";
  if (parcel.state === "OVERDUE") return "Vencida";
  return "Em aberto";
}

export function parcelStateTone(parcel: Pick<ParcelLike, "state">): "success" | "danger" | "info" {
  if (parcel.state === "PAID") return "success";
  if (parcel.state === "OVERDUE") return "danger";
  return "info";
}

/** Quando a parcela vence/venceu ou foi baixada, em texto curto. */
export function parcelDateText(parcel: ParcelLike): string {
  if (parcel.state === "PAID") return parcel.paidDate ? `baixada em ${brDay(parcel.paidDate)}` : "baixada";
  if (!parcel.dueDate) return "sem vencimento";
  return `${parcel.state === "OVERDUE" ? "venceu" : "vence"} ${brDay(parcel.dueDate)}`;
}

export type PurchaseRow<P> = {
  key: string;
  /** A parcela desta linha; nula quando a linha é a compra inteira. */
  parcel: P | null;
  /** "1/3", "2/3"...; nulo quando a linha é a compra inteira. */
  fraction: string | null;
};

/**
 * Linhas que uma compra ocupa na tabela: uma só; ou, se parcelada, a compra repetida uma vez por
 * parcela (1/3, 2/3, 3/3). Compra cancelada e compra de ciclo ficam numa linha só: a de ciclo
 * não tem parcelas próprias, o título é o do fechamento e é compartilhado com outras compras.
 */
export function splitByParcel<P extends { number: number }>(purchase: {
  id: string;
  status: string;
  title: { viaCycle: boolean; parcels: P[] };
}): Array<PurchaseRow<P>> {
  const { parcels, viaCycle } = purchase.title;
  if (purchase.status === "CANCELLED" || viaCycle || parcels.length < 2) {
    return [{ key: purchase.id, parcel: null, fraction: null }];
  }
  return parcels.map((parcel) => ({ key: `${purchase.id}:${parcel.number}`, parcel, fraction: `${parcel.number}/${parcels.length}` }));
}

/** "Historico_CASTELAO_Distribuidora_2026-11-24.pdf": ASCII puro, igual ao nome que o servidor dá à planilha. */
export function exportFileName(supplierName: string, extension: "pdf" | "xlsx", today: Date = new Date()): string {
  const slug = supplierName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
    .replace(/_+$/g, "");
  const day = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  return `Historico_${slug || "fornecedor"}_${day}.${extension}`;
}

/** "1–15 de 144": faixa exibida na página atual. */
export function pageRangeLabel(page: number, pageSize: number, total: number): string {
  if (total === 0) return "0 compras";
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return `${first}–${last} de ${total}`;
}
