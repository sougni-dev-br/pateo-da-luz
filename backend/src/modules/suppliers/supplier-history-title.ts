/**
 * Situação do título (Contas a Pagar) gerado por uma compra, para o histórico do fornecedor.
 *
 * "Baixado" = PAID / PAID_LATE. O resto (OPEN, OVERDUE) está em aberto; é "vencido" se
 * já está marcado OVERDUE ou se a data de vencimento é anterior a hoje.
 */
export const PAID_INSTALLMENT_STATUSES = ["PAID", "PAID_LATE"] as const;

export type TitleState = "NONE" | "OPEN" | "OVERDUE" | "PAID";

export type InstallmentRow = {
  /** Número da parcela (1, 2, 3...), quando o cadastro tem. */
  installment?: number | null;
  status: string;
  dueDate: Date | null;
  paidDate: Date | null;
  amount: number | null;
  paidAmount: number | null;
};

/** Uma parcela do título: o que vence, quanto e se já foi baixada. */
export type TitleParcel = {
  number: number;
  dueDate: string | null;
  amount: number;
  state: "OPEN" | "OVERDUE" | "PAID";
  paidDate: string | null;
  paidAmount: number;
};

export type TitleSummary = {
  state: TitleState;
  parcels: TitleParcel[];
  installments: number;
  paidInstallments: number;
  amount: number;
  paidAmount: number;
  /** Menor vencimento entre as parcelas ainda não baixadas (YYYY-MM-DD). */
  nextDueDate: string | null;
  /** Data da última baixa (YYYY-MM-DD). */
  paidDate: string | null;
  /** O título veio do fechamento de ciclo do fornecedor, não da própria compra. */
  viaCycle: boolean;
};

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const toCents = (value: number) => Math.round(value * 100) / 100;

export function summarizeTitle(rows: InstallmentRow[], today: Date, viaCycle: boolean): TitleSummary {
  const live = rows.filter((row) => row.status !== "CANCELLED");
  const isPaid = (row: InstallmentRow) => (PAID_INSTALLMENT_STATUSES as readonly string[]).includes(row.status);
  const unpaid = live.filter((row) => !isPaid(row));
  const paid = live.filter(isPaid);
  const todayDay = isoDay(today);

  const dueDays = unpaid.flatMap((row) => (row.dueDate ? [isoDay(row.dueDate)] : [])).sort();
  const paidDays = paid.flatMap((row) => (row.paidDate ? [isoDay(row.paidDate)] : [])).sort();
  const hasOverdue = unpaid.some((row) => row.status === "OVERDUE" || (row.dueDate !== null && isoDay(row.dueDate) < todayDay));

  let state: TitleState = "OPEN";
  if (live.length === 0) state = "NONE";
  else if (unpaid.length === 0) state = "PAID";
  else if (hasOverdue) state = "OVERDUE";

  // Ordem do título: pelo número da parcela; sem número, pelo vencimento.
  const ordered = [...live].sort((a, b) => {
    if (a.installment != null && b.installment != null && a.installment !== b.installment) return a.installment - b.installment;
    return (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity);
  });
  const parcels: TitleParcel[] = ordered.map((row, index) => ({
    number: row.installment ?? index + 1,
    dueDate: row.dueDate ? isoDay(row.dueDate) : null,
    amount: toCents(Number(row.amount ?? 0)),
    state: isPaid(row) ? "PAID" : row.status === "OVERDUE" || (row.dueDate !== null && isoDay(row.dueDate) < todayDay) ? "OVERDUE" : "OPEN",
    paidDate: isPaid(row) && row.paidDate ? isoDay(row.paidDate) : null,
    paidAmount: isPaid(row) ? toCents(Number(row.paidAmount ?? 0)) : 0
  }));

  return {
    state,
    parcels,
    installments: live.length,
    paidInstallments: paid.length,
    amount: toCents(live.reduce((sum, row) => sum + Number(row.amount ?? 0), 0)),
    paidAmount: toCents(paid.reduce((sum, row) => sum + Number(row.paidAmount ?? 0), 0)),
    nextDueDate: dueDays[0] ?? null,
    paidDate: paidDays.at(-1) ?? null,
    viaCycle
  };
}
