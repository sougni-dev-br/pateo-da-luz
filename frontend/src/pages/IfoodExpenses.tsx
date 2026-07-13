import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, RefreshCw } from "lucide-react";
import {
  cancelIfoodExpense,
  getIfoodExpenses,
  payIfoodExpense,
  type IfoodMonthlyExpenseStatus,
  type IfoodMonthlyExpenseView
} from "../api/client";
import { Alert, Button, Card, Money, PanelEyebrow, Select, SummaryCard, Table, TextField } from "../design-system";
import "./DeliveryFinance.css";

const MONTHS_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

const STATUS_LABEL: Record<string, string> = {
  OPEN: "Em aberto",
  PARTIALLY_PAID: "Parcial",
  PAID: "Pago",
  LATE: "Atrasado",
  CANCELLED: "Cancelado"
};

const STATUS_CLASS: Record<string, string> = {
  OPEN: "df-status-open",
  PARTIALLY_PAID: "df-status-partial",
  PAID: "df-status-paid",
  LATE: "df-status-late",
  CANCELLED: "df-status-cancelled"
};

function StatusPill({ status, isLate }: { status: IfoodMonthlyExpenseStatus; isLate: boolean }) {
  const effective = isLate && status === "OPEN" ? "LATE" : status;
  return <span className={`df-status-pill ${STATUS_CLASS[effective] ?? "df-status-open"}`}>{STATUS_LABEL[effective]}</span>;
}

function DueHint({ row }: { row: IfoodMonthlyExpenseView }) {
  if (row.status !== "OPEN") return null;
  if (row.isLate) return <span style={{ color: "#dc2626" }}>atrasado {Math.abs(row.daysUntilDue)}d</span>;
  if (row.daysUntilDue === 0) return <span>hoje</span>;
  return <span style={{ color: "var(--color-text-muted, #6b7280)" }}>em {row.daysUntilDue}d</span>;
}

export function IfoodExpenses() {
  const [rows, setRows] = useState<IfoodMonthlyExpenseView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [payingId, setPayingId] = useState<string | null>(null);

  useEffect(() => { void reload(); }, [statusFilter]);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const data = await getIfoodExpenses({
        status: statusFilter ? (statusFilter as IfoodMonthlyExpenseStatus) : undefined
      });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : "Falha ao carregar.");
    } finally {
      setLoading(false);
    }
  }

  const summary = useMemo(() => {
    const s = { total: 0, open: 0, late: 0, paid: 0 };
    for (const r of rows) {
      if (r.status === "CANCELLED") continue;
      s.total += r.totalAmount;
      if (r.status === "PAID") s.paid += r.totalAmount;
      else if (r.isLate) s.late += r.totalAmount;
      else s.open += r.totalAmount;
    }
    return s;
  }, [rows]);

  async function handlePay(exp: IfoodMonthlyExpenseView, values: { paidAt: string; paidAmount: number; paymentMethod: string; notes: string }) {
    setError(null);
    setFeedback(null);
    try {
      await payIfoodExpense(exp.id, {
        paidAt: values.paidAt,
        paidAmount: values.paidAmount,
        paymentMethod: values.paymentMethod || null,
        notes: values.notes || null
      });
      setFeedback(`Baixa registrada: ${exp.storeNickname} · ${MONTHS_PT[exp.competenceMonth - 1]}/${exp.competenceYear}`);
      setPayingId(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao dar baixa.");
    }
  }

  async function handleCancel(exp: IfoodMonthlyExpenseView) {
    const reason = window.prompt("Motivo do cancelamento?", "");
    if (reason === null) return;
    try {
      await cancelIfoodExpense(exp.id, reason);
      setFeedback("Despesa cancelada");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao cancelar.");
    }
  }

  const paying = payingId ? rows.find((r) => r.id === payingId) ?? null : null;

  return (
    <div className="df-page">
      <Alert tone="info" title="O que é isso">
        Consolida numa linha por loja × mês todas as taxas iFood (comissão, entrega, marketing,
        manutenção, antecipação). Gerado automaticamente pela sync — complementa o Faturamento
        (vendas viram receita, aqui ficam as despesas).
      </Alert>

      {error && <Alert tone="error">{error}</Alert>}
      {feedback && <Alert tone="success">{feedback}</Alert>}

      <div className="df-kpi-grid">
        <SummaryCard label="Total (não cancelado)" moneyValue={summary.total} tone="neutral" />
        <SummaryCard label="A pagar" moneyValue={summary.open} tone="info" />
        <SummaryCard label="Atrasado" moneyValue={summary.late} tone="danger" icon={<AlertCircle size={18} />} />
        <SummaryCard label="Já pago" moneyValue={summary.paid} tone="success" icon={<Check size={18} />} />
      </div>

      <Card>
        <div className="df-filter-bar">
          <Select
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            options={[
              { value: "", label: "Todos" },
              { value: "OPEN", label: "Em aberto" },
              { value: "PARTIALLY_PAID", label: "Parcial" },
              { value: "PAID", label: "Pago" },
              { value: "CANCELLED", label: "Cancelado" }
            ]}
          />
          <div className="df-filter-actions">
            <Button variant="secondary" onClick={reload} leadingIcon={<RefreshCw size={16} />}>Atualizar</Button>
          </div>
        </div>
      </Card>

      <Card>
        <PanelEyebrow>Despesas iFood</PanelEyebrow>
        <h3 style={{ margin: "4px 0 12px 0", fontSize: "16px" }}>{rows.length} registro(s)</h3>

        {loading ? (
          <p style={{ padding: "16px", textAlign: "center", color: "var(--color-text-muted, #6b7280)" }}>Carregando…</p>
        ) : rows.length === 0 ? (
          <div style={{ padding: "24px", textAlign: "center", color: "var(--color-text-muted, #6b7280)" }}>
            Nenhuma despesa consolidada. Rode a sync em Integração iFood para gerar.
          </div>
        ) : (
          <>
            {/* DESKTOP — tabela */}
            <div className="df-table-wrap">
              <Table>
                <thead>
                  <tr>
                    <th>Competência</th>
                    <th>Loja</th>
                    <th>Empresa</th>
                    <th>Vencimento</th>
                    <th style={{ textAlign: "right" }}>Comissão</th>
                    <th style={{ textAlign: "right" }}>Entrega</th>
                    <th style={{ textAlign: "right" }}>Marketing</th>
                    <th style={{ textAlign: "right" }}>Manut.</th>
                    <th style={{ textAlign: "right" }}>Antec.</th>
                    <th style={{ textAlign: "right" }}>Total</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{MONTHS_PT[r.competenceMonth - 1].slice(0, 3)}/{r.competenceYear}</td>
                      <td><b>{r.storeNickname}</b></td>
                      <td>{r.companyName ?? "—"}</td>
                      <td>
                        {r.dueDate}
                        <div style={{ fontSize: "11px" }}><DueHint row={r} /></div>
                      </td>
                      <td style={{ textAlign: "right" }}><Money value={r.commissionAmount} /></td>
                      <td style={{ textAlign: "right" }}><Money value={r.deliveryFeeAmount} /></td>
                      <td style={{ textAlign: "right" }}><Money value={r.marketingAmount} /></td>
                      <td style={{ textAlign: "right" }}><Money value={r.maintenanceAmount} /></td>
                      <td style={{ textAlign: "right" }}><Money value={r.anticipationAmount} /></td>
                      <td style={{ textAlign: "right" }}><b><Money value={r.totalAmount} /></b></td>
                      <td><StatusPill status={r.status} isLate={r.isLate} /></td>
                      <td>
                        {r.status !== "PAID" && r.status !== "CANCELLED" && (
                          <div style={{ display: "flex", gap: "4px", justifyContent: "flex-end" }}>
                            <Button size="sm" variant="primary" leadingIcon={<Check size={14} />} onClick={() => setPayingId(r.id)}>Pagar</Button>
                            <Button size="sm" variant="secondary" onClick={() => handleCancel(r)}>Cancelar</Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>

            {/* MOBILE — cards */}
            <div className="df-card-list">
              {rows.map((r) => (
                <div key={r.id} className="df-card">
                  <div className="df-card-header">
                    <div>
                      <div className="df-card-title">{r.storeNickname}</div>
                      <div className="df-card-subtitle">
                        {MONTHS_PT[r.competenceMonth - 1]}/{r.competenceYear} · {r.companyName ?? "sem empresa"}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-end" }}>
                      <StatusPill status={r.status} isLate={r.isLate} />
                      <span className="df-card-value"><Money value={r.totalAmount} /></span>
                    </div>
                  </div>

                  <div className="df-card-meta" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                    <div>
                      <span className="label">Vencimento</span>
                      <span className="value">
                        {r.dueDate}
                        <span style={{ marginLeft: 4, fontWeight: 400, fontSize: 10 }}><DueHint row={r} /></span>
                      </span>
                    </div>
                    <div>
                      <span className="label">Comissão</span>
                      <span className="value"><Money value={r.commissionAmount} /></span>
                    </div>
                    <div>
                      <span className="label">Entrega</span>
                      <span className="value"><Money value={r.deliveryFeeAmount} /></span>
                    </div>
                    <div>
                      <span className="label">Marketing</span>
                      <span className="value"><Money value={r.marketingAmount} /></span>
                    </div>
                    <div>
                      <span className="label">Manut.</span>
                      <span className="value"><Money value={r.maintenanceAmount} /></span>
                    </div>
                    <div>
                      <span className="label">Antec.</span>
                      <span className="value"><Money value={r.anticipationAmount} /></span>
                    </div>
                  </div>

                  {r.status !== "PAID" && r.status !== "CANCELLED" && (
                    <div className="df-card-actions">
                      <Button size="sm" variant="primary" leadingIcon={<Check size={14} />} onClick={() => setPayingId(r.id)}>Pagar</Button>
                      <Button size="sm" variant="secondary" onClick={() => handleCancel(r)}>Cancelar</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {paying && <PayModal expense={paying} onClose={() => setPayingId(null)} onSubmit={(v) => handlePay(paying, v)} />}
    </div>
  );
}

type PayModalProps = {
  expense: IfoodMonthlyExpenseView;
  onClose: () => void;
  onSubmit: (values: { paidAt: string; paidAmount: number; paymentMethod: string; notes: string }) => void;
};

function PayModal({ expense, onClose, onSubmit }: PayModalProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [paidAt, setPaidAt] = useState(today);
  const [paidAmount, setPaidAmount] = useState(String(expense.totalAmount));
  const [paymentMethod, setPaymentMethod] = useState("iFood — desconto em repasse");
  const [notes, setNotes] = useState("");

  return (
    <div className="df-modal-overlay" onClick={onClose}>
      <div className="df-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Baixar despesa iFood</h3>
        <p className="df-modal-subtitle">
          {expense.storeNickname} · {MONTHS_PT[expense.competenceMonth - 1]}/{expense.competenceYear} · Total: R$ {expense.totalAmount.toFixed(2)}
        </p>
        <div className="df-modal-fields">
          <TextField label="Data do pagamento" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          <TextField
            label="Valor pago (R$)"
            type="number"
            step="0.01"
            value={paidAmount}
            onChange={(e) => setPaidAmount(e.target.value)}
          />
          <TextField label="Método de pagamento" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} />
          <TextField label="Observações" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="df-modal-actions">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" leadingIcon={<Check size={16} />} onClick={() => onSubmit({
            paidAt,
            paidAmount: Number(paidAmount) || 0,
            paymentMethod,
            notes
          })}>Confirmar</Button>
        </div>
      </div>
    </div>
  );
}
