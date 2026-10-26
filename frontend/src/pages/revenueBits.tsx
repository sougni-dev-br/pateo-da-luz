import { Money, StatusBadge as DsStatusBadge } from "../design-system";
import type { StatusTone } from "../design-system";

export const EVENT_CHANNEL = "Eventos / Empreitada";

/** Zero em tabela vira traço: números reais se destacam em vez de ficarem entre "R$ 0,00". */
export function MoneyOrDash({ value }: { value: number }) {
  return value === 0 ? <span className="revenue-dash" aria-label="zero">—</span> : <Money value={value} />;
}

export function displayChannel(value: string) {
  return value === "Salao" ? "Salão" : value;
}

function formatStatusLabel(status: string) {
  if (status === "CANCELLED") return "Cancelado";
  if (status === "ACTIVE") return "Ativo";
  return status
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w|\s\w/g, (letter) => letter.toUpperCase());
}

function statusTone(status: string): StatusTone {
  if (status === "CANCELLED") return "neutral";
  if (status === "ACTIVE") return "success";
  return "info";
}

export function RevenueStatusBadge({ status }: { status: string }) {
  return <DsStatusBadge tone={statusTone(status)}>{formatStatusLabel(status)}</DsStatusBadge>;
}
