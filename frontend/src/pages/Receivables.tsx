import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Ban, Check, RefreshCw } from "lucide-react";
import {
  cancelReceivable,
  getReceivables,
  markReceivableReceived,
  type ReceivableSourceType,
  type ReceivableStatus,
  type ReceivableView
} from "../api/client";
import { Alert, Button, Card, Money, PanelEyebrow, Select, SummaryCard, Table, TextField } from "../design-system";
import "./DeliveryFinance.css";

const STATUS_LABEL: Record<string, string> = {
  OPEN: "Em aberto",
  PARTIALLY_RECEIVED: "Parcial",
  RECEIVED: "Recebido",
  LATE: "Atrasado",
  CANCELLED: "Cancelado"
};

const STATUS_CLASS: Record<string, string> = {
  OPEN: "df-status-open",
  PARTIALLY_RECEIVED: "df-status-partial",
  RECEIVED: "df-status-received",
  LATE: "df-status-late",
  CANCELLED: "df-status-cancelled"
};

const SOURCE_LABEL: Record<ReceivableSourceType, string> = {
  IFOOD_SETTLEMENT: "Repasse iFood",
  NOVENTA_NOVE_SETTLEMENT: "Repasse 99 Food",
  KEETA_SETTLEMENT: "Repasse Keeta",
  EVENT: "Evento / Empreitada",
  DIRECT: "Recebimento direto",
  OTHER: "Outro"
};

function StatusPill({ status, isLate }: { status: ReceivableStatus; isLate: boolean }) {
  const effective = isLate && status === "OPEN" ? "LATE" : status;
  return <span className={`df-status-pill ${STATUS_CLASS[effective] ?? "df-status-open"}`}>{STATUS_LABEL[effective]}</span>;
}

function DueDateHint({ row }: { row: ReceivableView }) {
  if (row.status !== "OPEN") return null;
  if (row.isLate) return <span style={{ color: "#dc2626" }}>atrasado {Math.abs(row.daysUntilExpected)}d</span>;
  if (row.daysUntilExpected === 0) return <span>hoje</span>;
  return <span style={{ color: "var(--color-text-muted, #6b7280)" }}>em {row.daysUntilExpected}d</span>;
}

export function Receivables() {
  const [rows, setRows] = useState<ReceivableView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [payingId, setPayingId] = useState<string | null>(null);

  useEffect(() => { void reload(); }, [statusFilter, sourceFilter]);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const data = await getReceivables({
        status: statusFilter ? (statusFilter as ReceivableStatus) : undefined,
        sourceType: sourceFilter ? (sourceFilter as ReceivableSourceType) : undefined
      });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : "Falha ao carregar contas a receber.");
    } finally {
      setLoading(false);
    }
  }

  const summary = useMemo(() => {
    const s = { total: 0, open: 0, late: 0, received: 0 };
    for (const r of rows) {
      if (r.status === "CANCELLED") continue;
      s.total += r.netAmount;
      if (r.status === "RECEIVED") s.received += r.netAmount;
      else if (r.isLate) s.late += r.netAmount;
      else s.open += r.netAmount;
    }
    return s;
  }, [rows]);

  async function handleMarkReceived(receivable: ReceivableView, values: { receivedDate: string; paidAmount: number; paymentMethod: string; notes: string }) {
    setError(null);
    setFeedback(null);
    try {
      await markReceivableReceived(receivable.id, {
        receivedDate: values.receivedDate,
        paidAmount: values.paidAmount,
        paymentMethod: values.paymentMethod || null,
        notes: values.notes || null
      });
      setFeedback(`Recebimento registrado: ${receivable.description}`);
      setPayingId(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao dar baixa.");
    }
  }

  async function handleCancel(receivable: ReceivableView) {
    const reason = window.prompt("Motivo do cancelamento?", "");
    if (reason === null) return;
    setError(null);
    setFeedback(null);
    try {
      await cancelReceivable(receivable.id, reason);
      setFeedback(`Recebível cancelado: ${receivable.description}`);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao cancelar.");
    }
  }

  const paying = payingId ? rows.find((r) => r.id === payingId) ?? null : null;

  return (
    <div className="df-page">
      {error && <Alert tone="error">{error}</Alert>}
      {feedback && <Alert tone="success">{feedback}</Alert>}

      <div className="df-kpi-grid">
        <SummaryCard label="Total previsto" moneyValue={summary.total} tone="neutral" />
        <SummaryCard label="A receber" moneyValue={summary.open} tone="info" />
        <SummaryCard label="Atrasado" moneyValue={summary.late} tone="danger" icon={<AlertCircle size={18} />} />
        <SummaryCard label="Já recebido" moneyValue={summary.received} tone="success" icon={<Check size={18} />} />
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
              { value: "PARTIALLY_RECEIVED", label: "Parcial" },
              { value: "RECEIVED", label: "Recebido" },
              { value: "CANCELLED", label: "Cancelado" }
            ]}
          />
          <Select
            label="Origem"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            options={[
              { value: "", label: "Todas" },
              { value: "IFOOD_SETTLEMENT", label: "Repasse iFood" },
              { value: "EVENT", label: "Evento / Empreitada" },
              { value: "DIRECT", label: "Direto" },
              { value: "OTHER", label: "Outro" }
            ]}
          />
          <div className="df-filter-actions">
            <Button variant="secondary" onClick={reload} leadingIcon={<RefreshCw size={16} />}>Atualizar</Button>
          </div>
        </div>
      </Card>

      <Card>
        <PanelEyebrow>Contas a receber</PanelEyebrow>
        <h3 style={{ margin: "4px 0 12px 0", fontSize: "16px" }}>
          {rows.length} registro(s)
        </h3>

        {loading ? (
          <p style={{ padding: "16px", textAlign: "center", color: "var(--color-text-muted, #6b7280)" }}>Carregando…</p>
        ) : rows.length === 0 ? (
          <div style={{ padding: "24px", textAlign: "center", color: "var(--color-text-muted, #6b7280)" }}>
            Nenhum recebível cadastrado. Recebimentos do iFood aparecem aqui automaticamente após a sync.
          </div>
        ) : (
          <>
            {/* DESKTOP — tabela */}
            <div className="df-table-wrap">
              <Table>
                <thead>
                  <tr>
                    <th>Origem</th>
                    <th>Descrição</th>
                    <th>Empresa</th>
                    <th>Cliente</th>
                    <th>Previsto</th>
                    <th style={{ textAlign: "right" }}>Valor</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td><b>{SOURCE_LABEL[r.sourceType]}</b></td>
                      <td>
                        {r.description}
                        {r.installmentNumber && r.totalInstallments && (
                          <div style={{ fontSize: "11px", color: "var(--color-text-muted, #6b7280)" }}>
                            Parcela {r.installmentNumber}/{r.totalInstallments}
                          </div>
                        )}
                      </td>
                      <td>{r.companyName ?? "—"}</td>
                      <td>{r.customerName ?? "—"}</td>
                      <td>
                        {r.expectedDate}
                        <div style={{ fontSize: "11px" }}>
                          <DueDateHint row={r} />
                        </div>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <b><Money value={r.netAmount} /></b>
                        {r.paidAmount !== null && r.paidAmount !== r.netAmount && (
                          <div style={{ fontSize: "11px", color: "var(--color-text-muted, #6b7280)" }}>
                            pago: <Money value={r.paidAmount} />
                          </div>
                        )}
                      </td>
                      <td><StatusPill status={r.status} isLate={r.isLate} /></td>
                      <td>
                        <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                          {r.status !== "RECEIVED" && r.status !== "CANCELLED" && (
                            <>
                              <Button size="sm" variant="primary" leadingIcon={<Check size={14} />} onClick={() => setPayingId(r.id)}>Baixar</Button>
                              <Button size="sm" variant="secondary" leadingIcon={<Ban size={14} />} onClick={() => handleCancel(r)}>Cancelar</Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>

            {/* MOBILE — cards empilhados */}
            <div className="df-card-list">
              {rows.map((r) => (
                <div key={r.id} className="df-card">
                  <div className="df-card-header">
                    <div>
                      <div className="df-card-title">{r.description}</div>
                      <div className="df-card-subtitle">
                        {SOURCE_LABEL[r.sourceType]}
                        {r.installmentNumber && r.totalInstallments && ` · parcela ${r.installmentNumber}/${r.totalInstallments}`}
                      </div>
                    </div>
                    <StatusPill status={r.status} isLate={r.isLate} />
                  </div>

                  <div className="df-card-meta">
                    <div>
                      <span className="label">Empresa</span>
                      <span className="value">{r.companyName ?? "—"}</span>
                    </div>
                    <div>
                      <span className="label">Cliente</span>
                      <span className="value">{r.customerName ?? "—"}</span>
                    </div>
                    <div>
                      <span className="label">Data prevista</span>
                      <span className="value">
                        {r.expectedDate}
                        <span style={{ marginLeft: 6, fontWeight: 400, fontSize: 11 }}>
                          <DueDateHint row={r} />
                        </span>
                      </span>
                    </div>
                    <div>
                      <span className="label">Valor</span>
                      <span className="value"><Money value={r.netAmount} /></span>
                    </div>
                  </div>

                  {r.status !== "RECEIVED" && r.status !== "CANCELLED" && (
                    <div className="df-card-actions">
                      <Button size="sm" variant="primary" leadingIcon={<Check size={14} />} onClick={() => setPayingId(r.id)}>Baixar</Button>
                      <Button size="sm" variant="secondary" leadingIcon={<Ban size={14} />} onClick={() => handleCancel(r)}>Cancelar</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {paying && (
        <MarkReceivedModal
          receivable={paying}
          onClose={() => setPayingId(null)}
          onSubmit={(values) => handleMarkReceived(paying, values)}
        />
      )}
    </div>
  );
}

type MarkReceivedModalProps = {
  receivable: ReceivableView;
  onClose: () => void;
  onSubmit: (values: { receivedDate: string; paidAmount: number; paymentMethod: string; notes: string }) => void;
};

function MarkReceivedModal({ receivable, onClose, onSubmit }: MarkReceivedModalProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [receivedDate, setReceivedDate] = useState(today);
  const [paidAmount, setPaidAmount] = useState(String(receivable.netAmount));
  const [paymentMethod, setPaymentMethod] = useState(receivable.paymentMethod ?? "");
  const [notes, setNotes] = useState("");

  return (
    <div className="df-modal-overlay" onClick={onClose}>
      <div className="df-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Dar baixa em recebível</h3>
        <p className="df-modal-subtitle">{receivable.description}</p>
        <div className="df-modal-fields">
          <TextField
            label="Data do recebimento"
            type="date"
            value={receivedDate}
            onChange={(e) => setReceivedDate(e.target.value)}
          />
          <TextField
            label="Valor recebido (R$)"
            type="number"
            step="0.01"
            value={paidAmount}
            onChange={(e) => setPaidAmount(e.target.value)}
            hint={`Previsto: R$ ${receivable.netAmount.toFixed(2)}`}
          />
          <TextField
            label="Método de pagamento"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            placeholder="PIX, TED, iFood repasse, etc"
          />
          <TextField
            label="Observações"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="df-modal-actions">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" leadingIcon={<Check size={16} />} onClick={() => onSubmit({
            receivedDate,
            paidAmount: Number(paidAmount) || 0,
            paymentMethod,
            notes
          })}>
            Confirmar baixa
          </Button>
        </div>
      </div>
    </div>
  );
}
