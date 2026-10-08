import { CheckCheck, Eye, Lock, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  checkAllReimbursementItems,
  checkReimbursementItem,
  closeReimbursement,
  getPaymentMethods,
  getReimbursement,
  getReimbursements,
  PaymentMethod,
  ReimbursementDetail,
  ReimbursementStatus,
  ReimbursementSummary,
  reopenReimbursement
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { Dialog } from "../components/ui/Dialog";
import { useSession } from "../context/SessionContext";
import { Button, EmptyState, IconButton, Money, Select, StatusBadge, Table } from "../design-system";
import type { StatusTone } from "../design-system";
import { hojeLocalIso } from "../lib/datas";
import { parcelasNoNomeDaForma } from "../lib/formas-pagamento";
import { hasPermission } from "../lib/permissions";
import { formatDate } from "../utils/format";

// Reembolso a funcionário: as compras que a pessoa pagou do próprio bolso (cada uma com
// a loja e a data dela) e, ao fechar, um título só para a pessoa no Contas a Pagar.

const STATUS: Record<ReimbursementStatus, { label: string; tone: StatusTone }> = {
  OPEN: { label: "Aberto", tone: "warning" },
  CLOSED: { label: "Fechado · a pagar", tone: "info" },
  PAID: { label: "Pago", tone: "success" },
  CANCELLED: { label: "Cancelado", tone: "neutral" }
};

// Formas que não servem para pagar a pessoa: cartão de crédito, o próprio reembolso e as
// variantes antigas de parcelamento ("BOLETO 3X") — o reembolso vira um título só.
const naoPagaPessoa = (method: PaymentMethod) =>
  method.type === "CREDIT_CARD" || method.type === "REIMBURSEMENT" || Boolean(parcelasNoNomeDaForma(method.name));

function periodo(first: string | null, last: string | null) {
  if (!first) return "—";
  return first.slice(0, 10) === last?.slice(0, 10) ? formatDate(first) : `${formatDate(first)} a ${formatDate(last)}`;
}

function descricaoDaCompra(item: ReimbursementDetail["items"][number]) {
  const nome = item.firstItemName ?? (item.isSmallExpense ? "Pequeno gasto" : "Compra");
  return item.itemLines > 1 ? `${nome} +${item.itemLines - 1}` : nome;
}

export function Reimbursements() {
  const { notice, setNotice } = useNotice();
  const { user } = useSession();
  const navigate = useNavigate();
  const canCheck = hasPermission(user, "reimbursements", "edit");
  const canApprove = hasPermission(user, "reimbursements", "approve");

  const [rows, setRows] = useState<ReimbursementSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"" | ReimbursementStatus>("");
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);

  const [detail, setDetail] = useState<ReimbursementDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [closeForm, setCloseForm] = useState<{ paymentMethodId: string; dueDate: string; notes: string } | null>(null);

  async function loadList() {
    setLoading(true);
    try {
      setRows(await getReimbursements(statusFilter || undefined));
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao carregar reembolsos." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadList(); }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    getPaymentMethods()
      .then((methods) => setPaymentMethods(methods.filter((method) => method.isActive && !naoPagaPessoa(method))))
      .catch(() => setPaymentMethods([]));
  }, []);

  const totals = useMemo(() => ({
    aberto: rows.filter((row) => row.status === "OPEN").reduce((sum, row) => sum + Number(row.totalAmount), 0),
    aPagar: rows.filter((row) => row.status === "CLOSED").reduce((sum, row) => sum + Number(row.totalAmount), 0)
  }), [rows]);

  async function openDetail(id: string) {
    setCloseForm(null);
    try {
      setDetail(await getReimbursement(id));
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao abrir o reembolso." });
    }
  }

  async function run(action: () => Promise<ReimbursementDetail | null>, success: string) {
    setBusy(true);
    try {
      const next = await action();
      if (next) setDetail(next);
      setNotice({ tone: "success", message: success });
      void loadList();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Não foi possível concluir." });
    } finally {
      setBusy(false);
    }
  }

  const toggleItem = (itemId: string, checked: boolean) => detail && run(async () => {
    await checkReimbursementItem(detail.id, itemId, checked);
    return getReimbursement(detail.id);
  }, checked ? "Compra conferida." : "Conferência removida.");

  const checkAll = () => detail && run(async () => {
    await checkAllReimbursementItems(detail.id);
    return getReimbursement(detail.id);
  }, "Todas as compras conferidas.");

  const submitClose = () => detail && closeForm && run(async () => {
    const closed = await closeReimbursement(detail.id, closeForm);
    setCloseForm(null);
    return closed;
  }, "Reembolso fechado. O título já está no Contas a Pagar.");

  const reopen = () => detail && run(() => reopenReimbursement(detail.id), "Reembolso reaberto. O título anterior foi cancelado.");

  const pending = detail ? detail.items.filter((item) => !item.checked).length : 0;
  const titulo = detail?.installments[0] ?? null;

  return (
    <div className="page-content">
      <Notice notice={notice} />

      <p style={{ margin: "0 0 14px", color: "var(--ink-soft)", fontSize: 14, maxWidth: 760 }}>
        Como lançar: em <strong>Compras</strong>, uma nota por comprovante, com a forma de pagamento <strong>REEMBOLSO FUNCIONARIO</strong> e
        quem pagou. Cada nota fica com a data e a loja dela; o título da pessoa só nasce quando o reembolso é fechado aqui.
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <Select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as "" | ReimbursementStatus)}
          placeholder="Abertos, fechados e pagos"
          options={[
            { value: "OPEN", label: "Abertos" },
            { value: "CLOSED", label: "Fechados (a pagar)" },
            { value: "PAID", label: "Pagos" },
            { value: "CANCELLED", label: "Cancelados" }
          ]}
          containerClassName="cycles-filter-select"
        />
        {!loading && rows.length > 0 && (
          <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>
            Em aberto <strong><Money value={totals.aberto} /></strong> · Fechado a pagar <strong><Money value={totals.aPagar} /></strong>
          </span>
        )}
      </div>

      {loading ? (
        <div className="page-loading">Carregando reembolsos…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nenhum reembolso."
          description="O reembolso de uma pessoa é aberto sozinho quando a primeira compra paga por ela é lançada em Compras."
        />
      ) : (
        <>
          <div className="sc-desktop-list">
            <Table>
              <Table.Head>
                <Table.Row>
                  <Table.Th minWidth={180}>Quem pagou</Table.Th>
                  <Table.Th>Compras de</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th align="center">Conferidas</Table.Th>
                  <Table.Th>Vencimento</Table.Th>
                  <Table.Th align="right">Total</Table.Th>
                  <Table.Th actions>Ações</Table.Th>
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {rows.map((row) => (
                  <Table.Row key={row.id}>
                    <Table.Td truncate title={row.payeeName} style={{ fontWeight: 500 }}>{row.payeeName}</Table.Td>
                    <Table.Td style={{ fontSize: 13, color: "var(--ink-soft)", whiteSpace: "nowrap" }}>{periodo(row.firstPurchaseDate, row.lastPurchaseDate)}</Table.Td>
                    <Table.Td><StatusBadge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</StatusBadge></Table.Td>
                    <Table.Td align="center">
                      <span style={{ color: row.itemCount > 0 && row.checkedCount === row.itemCount ? "var(--success)" : undefined }}>
                        {row.checkedCount}/{row.itemCount}
                      </span>
                    </Table.Td>
                    <Table.Td style={{ whiteSpace: "nowrap" }}>{row.dueDate ? formatDate(row.dueDate) : "—"}</Table.Td>
                    <Table.Td align="right" style={{ fontWeight: 600 }}><Money value={Number(row.totalAmount)} /></Table.Td>
                    <Table.Td actions><IconButton icon={<Eye size={16} />} label="Abrir reembolso" onClick={() => openDetail(row.id)} /></Table.Td>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>

          <div className="sc-mobile-cards">
            {rows.map((row) => (
              <article className="purch-mobile-card" key={`${row.id}-mobile`}>
                <div className="purch-mobile-card-header">
                  <div className="purch-mobile-card-title">
                    <strong className="purch-mobile-supplier">{row.payeeName}</strong>
                    <div className="purch-mobile-meta-row"><span className="purch-mobile-date">{periodo(row.firstPurchaseDate, row.lastPurchaseDate)}</span></div>
                  </div>
                  <div className="purch-mobile-card-right">
                    <strong className="purch-mobile-amount"><Money value={Number(row.totalAmount)} /></strong>
                    <StatusBadge className="purch-mobile-status" tone={STATUS[row.status].tone}>{STATUS[row.status].label}</StatusBadge>
                  </div>
                </div>
                <div className="purch-mobile-card-body">
                  <div className="purch-mobile-row"><span>Conferidas</span><span>{row.checkedCount}/{row.itemCount}</span></div>
                  <div className="purch-mobile-row"><span>Vencimento</span><span>{row.dueDate ? formatDate(row.dueDate) : "—"}</span></div>
                </div>
                <div className="purch-mobile-card-footer">
                  <div className="purch-mobile-actions">
                    <button className="purch-mobile-btn" type="button" onClick={() => openDetail(row.id)}><Eye size={15} /> Abrir</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      <Dialog
        open={detail !== null}
        onOpenChange={(open) => { if (!open && !busy) { setDetail(null); setCloseForm(null); } }}
        title={detail ? `Reembolso de ${detail.payeeName}` : "Reembolso"}
        description={detail ? `${STATUS[detail.status].label} · ${detail.items.length} compra(s)` : undefined}
        size="lg"
      >
        {detail && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                {detail.status === "OPEN"
                  ? pending > 0 ? `${pending} compra(s) sem conferir com o comprovante.` : "Tudo conferido. Pode fechar."
                  : titulo
                    ? <>Título de <strong>{titulo.paymentMethodName ?? "pagamento"}</strong> com vencimento em <strong>{formatDate(titulo.dueDate)}</strong>
                        {titulo.paidDate ? <> · pago em {formatDate(titulo.paidDate)}</> : " · em aberto no Contas a Pagar"}</>
                    : null}
              </div>
              <strong style={{ fontSize: 22 }}><Money value={Number(detail.totalAmount)} /></strong>
            </div>

            <div className="sc-desktop-list">
            <Table>
              <Table.Head>
                <Table.Row>
                  <Table.Th align="center">Conferida</Table.Th>
                  <Table.Th>Data</Table.Th>
                  <Table.Th minWidth={160}>Loja</Table.Th>
                  <Table.Th>O quê</Table.Th>
                  <Table.Th align="right">Valor</Table.Th>
                  <Table.Th actions>Nota</Table.Th>
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {detail.items.map((item) => (
                  <Table.Row key={item.id}>
                    <Table.Td align="center">
                      <input
                        type="checkbox"
                        aria-label={`Conferida: ${item.storeName} em ${formatDate(item.purchaseDate)}`}
                        checked={item.checked}
                        disabled={!canCheck || busy || detail.status !== "OPEN"}
                        onChange={(event) => toggleItem(item.id, event.target.checked)}
                      />
                    </Table.Td>
                    <Table.Td style={{ whiteSpace: "nowrap" }}>{formatDate(item.purchaseDate)}</Table.Td>
                    <Table.Td truncate title={item.storeName}>{item.storeName}</Table.Td>
                    <Table.Td style={{ fontSize: 13, color: "var(--ink-soft)" }}>{descricaoDaCompra(item)}</Table.Td>
                    <Table.Td align="right"><Money value={Number(item.amount)} /></Table.Td>
                    <Table.Td actions>
                      <IconButton icon={<Eye size={15} />} label={`Abrir ${item.purchaseNumber ?? "compra"}`} onClick={() => navigate(`/compras/${item.purchaseId}/editar`)} />
                    </Table.Td>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
            </div>

            <div className="sc-mobile-cards">
              {detail.items.map((item) => (
                <label key={`${item.id}-mobile`} className="purch-mobile-card" style={{ display: "flex", gap: 12, alignItems: "flex-start", cursor: canCheck && detail.status === "OPEN" ? "pointer" : undefined }}>
                  <input
                    type="checkbox"
                    style={{ marginTop: 4, width: 20, height: 20 }}
                    aria-label={`Conferida: ${item.storeName} em ${formatDate(item.purchaseDate)}`}
                    checked={item.checked}
                    disabled={!canCheck || busy || detail.status !== "OPEN"}
                    onChange={(event) => toggleItem(item.id, event.target.checked)}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.storeName}</strong>
                    <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>{formatDate(item.purchaseDate)} · {descricaoDaCompra(item)}</span>
                  </span>
                  <strong style={{ whiteSpace: "nowrap" }}><Money value={Number(item.amount)} /></strong>
                </label>
              ))}
            </div>

            {detail.status === "OPEN" && closeForm && (
              <div style={{ marginTop: 16, padding: 14, border: "1px solid var(--line)", borderRadius: 10, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                <label className="form-group" style={{ margin: 0 }}>
                  <span className="form-label">Como a pessoa vai receber</span>
                  <select className="form-input" value={closeForm.paymentMethodId}
                    onChange={(event) => setCloseForm({ ...closeForm, paymentMethodId: event.target.value })}>
                    <option value="">Selecione</option>
                    {paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
                  </select>
                </label>
                <label className="form-group" style={{ margin: 0 }}>
                  <span className="form-label">Vencimento</span>
                  <input className="form-input" type="date" value={closeForm.dueDate}
                    onChange={(event) => setCloseForm({ ...closeForm, dueDate: event.target.value })} />
                </label>
                <label className="form-group" style={{ margin: 0 }}>
                  <span className="form-label">Observação</span>
                  <input className="form-input" placeholder="Opcional" value={closeForm.notes}
                    onChange={(event) => setCloseForm({ ...closeForm, notes: event.target.value })} />
                </label>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap", paddingTop: 16 }}>
              {detail.status === "OPEN" && canCheck && pending > 0 && (
                <Button variant="secondary" leadingIcon={<CheckCheck size={14} />} disabled={busy} onClick={checkAll}>Conferir todas</Button>
              )}
              {detail.status === "OPEN" && canApprove && !closeForm && (
                <Button leadingIcon={<Lock size={14} />} disabled={busy || pending > 0 || detail.items.length === 0}
                  title={pending > 0 ? "Confira todas as compras antes de fechar." : undefined}
                  onClick={() => setCloseForm({ paymentMethodId: paymentMethods.find((method) => method.type === "PIX")?.id ?? "", dueDate: hojeLocalIso(), notes: "" })}>
                  Fechar reembolso
                </Button>
              )}
              {detail.status === "OPEN" && closeForm && (
                <>
                  <Button variant="secondary" disabled={busy} onClick={() => setCloseForm(null)}>Voltar</Button>
                  <Button leadingIcon={<Lock size={14} />} disabled={busy || !closeForm.paymentMethodId || !closeForm.dueDate} onClick={submitClose}>
                    Gerar título de <Money value={Number(detail.totalAmount)} />
                  </Button>
                </>
              )}
              {detail.status === "CLOSED" && canApprove && (
                <Button variant="secondary" leadingIcon={<RotateCcw size={14} />} disabled={busy} onClick={reopen}>Reabrir</Button>
              )}
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}
