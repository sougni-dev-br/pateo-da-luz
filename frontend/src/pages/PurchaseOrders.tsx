import { CheckCircle2, Download, Eye, PackageCheck, RefreshCw, Send, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AppUser,
  cancelPurchaseOrder,
  changePurchaseOrderStatus,
  downloadPurchaseOrderCsv,
  getPurchaseOrder,
  getPurchaseOrders,
  PurchaseOrder,
  receivePurchaseOrder,
  updatePurchaseOrder
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { hasPermission } from "../lib/permissions";
import { EmptyState, StatusBadge, SummaryCard } from "../components/ui";
import { formatCurrency, formatDate, formatNumber } from "../utils/format";

const statusLabels: Record<string, string> = {
  RASCUNHO: "Rascunho",
  EM_REVISAO: "Em revisao",
  APROVADO: "Aprovado",
  ENVIADO: "Enviado",
  RECEBIDO_PARCIAL: "Recebido parcial",
  RECEBIDO: "Recebido",
  CANCELADO: "Cancelado"
};

function statusTone(status: string) {
  if (status === "APROVADO" || status === "RECEBIDO") return "success" as const;
  if (status === "EM_REVISAO" || status === "ENVIADO" || status === "RECEBIDO_PARCIAL") return "info" as const;
  if (status === "CANCELADO") return "danger" as const;
  return "warning" as const;
}

function toInputDate(value?: string | null) {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

const sourceLabels: Record<string, string> = {
  PRE_LISTA_COMPRADOR: "Pre-lista",
  PLANEJAMENTO_COMPRA: "Planejamento de compra",
  MANUAL: "Manual"
};

export function PurchaseOrders({ user }: { user: AppUser }) {
  const { notice, setNotice } = useNotice();
  const [searchParams] = useSearchParams();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<PurchaseOrder | null>(null);
  const [search, setSearch] = useState(() => (searchParams.get("search") ?? "").slice(0, 200));
  const [loading, setLoading] = useState(false);
  const [detailDraft, setDetailDraft] = useState<{ expectedDeliveryDate: string; notes: string; items: Record<string, { requestedQuantity: string; receivedQuantity: string; notes: string }> }>({
    expectedDeliveryDate: "",
    notes: "",
    items: {}
  });
  const canOperate = hasPermission(user, "purchase-orders", "edit");
  const canApprove = hasPermission(user, "purchase-orders", "approve");

  async function load() {
    setLoading(true);
    try {
      const data = await getPurchaseOrders({ search });
      setOrders(data.orders);
      setSummary(data.summary);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel carregar pedidos." });
    } finally {
      setLoading(false);
    }
  }

  async function openOrder(id: string) {
    try {
      const detail = await getPurchaseOrder(id);
      setSelected(detail);
      setDetailDraft({
        expectedDeliveryDate: toInputDate(detail.expectedDeliveryDate),
        notes: detail.notes ?? "",
        items: Object.fromEntries((detail.items ?? []).map((item) => [item.id, {
          requestedQuantity: String(item.requestedQuantity ?? ""),
          receivedQuantity: String(item.receivedQuantity ?? ""),
          notes: item.notes ?? ""
        }]))
      });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel abrir o pedido." });
    }
  }

  async function refreshSelected() {
    if (!selected) return;
    await openOrder(selected.id);
    await load();
  }

  async function saveDraft() {
    if (!selected) return;
    try {
      const detail = await updatePurchaseOrder(selected.id, {
        expectedDeliveryDate: detailDraft.expectedDeliveryDate || null,
        notes: detailDraft.notes,
        items: Object.entries(detailDraft.items).map(([id, item]) => ({ id, requestedQuantity: item.requestedQuantity, notes: item.notes }))
      });
      setSelected(detail);
      setNotice({ tone: "success", message: "Pedido atualizado." });
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel salvar o pedido." });
    }
  }

  async function runStatus(action: "SEND_REVIEW" | "APPROVE" | "MARK_SENT") {
    if (!selected) return;
    const labels = { SEND_REVIEW: "enviar para revisao", APPROVE: "aprovar", MARK_SENT: "marcar como enviado" };
    if (!window.confirm(`Confirmar ${labels[action]} do pedido ${selected.code}?`)) return;
    try {
      const detail = await changePurchaseOrderStatus(selected.id, action);
      setSelected(detail);
      setNotice({ tone: "success", message: "Status atualizado." });
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel atualizar status." });
    }
  }

  async function receive() {
    if (!selected) return;
    try {
      const detail = await receivePurchaseOrder(selected.id, Object.entries(detailDraft.items).map(([id, item]) => ({ id, receivedQuantity: item.receivedQuantity || 0 })));
      setSelected(detail);
      setNotice({ tone: "success", message: "Recebimento registrado." });
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel registrar recebimento." });
    }
  }

  async function cancel() {
    if (!selected) return;
    const reason = window.prompt(`Informe o motivo para cancelar o pedido ${selected.code}:`);
    if (!reason) return;
    try {
      const detail = await cancelPurchaseOrder(selected.id, reason);
      setSelected(detail);
      setNotice({ tone: "success", message: "Pedido cancelado." });
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel cancelar o pedido." });
    }
  }

  useEffect(() => {
    load();
  }, []);

  const estimatedTotal = useMemo(() => orders.reduce((sum, order) => sum + Number(order.estimatedTotal ?? 0), 0), [orders]);

  return (
    <div className="stack">
      <Notice notice={notice} />
      <section className="panel">
        <div className="section-header">
          <div>
            <p className="muted">Pedidos operacionais gerados a partir da pre-lista do comprador. Ainda nao integram contas a pagar.</p>
          </div>
          <button className="secondary" type="button" onClick={load}><RefreshCw size={16} /> Atualizar</button>
        </div>

        <div className="summary-grid">
          <SummaryCard label="Rascunho" value={summary.RASCUNHO ?? 0} tone="warning" />
          <SummaryCard label="Em revisao" value={summary.EM_REVISAO ?? 0} tone="info" />
          <SummaryCard label="Aprovados" value={summary.APROVADO ?? 0} tone="success" />
          <SummaryCard label="Enviados" value={summary.ENVIADO ?? 0} />
          <SummaryCard label="Recebidos" value={(summary.RECEBIDO ?? 0) + (summary.RECEBIDO_PARCIAL ?? 0)} tone="success" />
          <SummaryCard label="Cancelados" value={summary.CANCELADO ?? 0} tone="danger" />
          <SummaryCard label="Valor estimado" value={formatCurrency(estimatedTotal)} />
        </div>

        <div className="filter-bar">
          <label>Busca<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Codigo ou fornecedor" /></label>
          <button type="button" onClick={load}>Filtrar</button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Codigo</th><th>Fornecedor</th><th>Status</th><th>Origem</th><th>Criacao</th><th>Previsao</th><th>Itens</th><th>Estimado</th><th>Responsavel</th><th>Acoes</th></tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>{order.code}</td>
                  <td title={order.supplierNameSnapshot}>{order.supplierNameSnapshot}</td>
                  <td><StatusBadge tone={statusTone(order.status)}>{statusLabels[order.status] ?? order.status}</StatusBadge></td>
                  <td>{sourceLabels[order.source] ?? "Manual"}</td>
                  <td>{formatDate(order.createdAt)}</td>
                  <td>{formatDate(order.expectedDeliveryDate)}</td>
                  <td>{order.totalItems ?? 0}</td>
                  <td>{formatCurrency(order.estimatedTotal)}</td>
                  <td title={order.createdByUserName ?? "-"}>{order.createdByUserName ?? "-"}</td>
                  <td><button className="ghost" type="button" onClick={() => openOrder(order.id)}><Eye size={15} /> Abrir</button></td>
                </tr>
              ))}
              {!loading && orders.length === 0 && <tr><td colSpan={10}><EmptyState title="Nenhum pedido de compra" description="Gere pedidos a partir da pre-lista do comprador." /></td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {selected && (
        <section className="panel">
          <div className="section-header">
            <div>
              <span className="eyebrow">Pedido</span>
              <h2>{selected.code}</h2>
              <p className="muted" title={selected.supplierNameSnapshot}>{selected.supplierNameSnapshot}</p>
            </div>
            <div className="action-row">
              <StatusBadge tone={statusTone(selected.status)}>{statusLabels[selected.status] ?? selected.status}</StatusBadge>
              <button className="secondary" type="button" onClick={() => downloadPurchaseOrderCsv(selected.id, selected.code)}><Download size={16} /> Exportar</button>
            </div>
          </div>

          <div className="form-grid three">
            <label>Fornecedor<input readOnly value={selected.supplierNameSnapshot} title={selected.supplierNameSnapshot} /></label>
            <label>Origem<input readOnly value={sourceLabels[selected.source] ?? "Manual"} /></label>
            <label>Previsao entrega<input type="date" disabled={selected.status !== "RASCUNHO"} value={detailDraft.expectedDeliveryDate} onChange={(event) => setDetailDraft({ ...detailDraft, expectedDeliveryDate: event.target.value })} /></label>
            <label className="wide">Observacoes<textarea disabled={selected.status !== "RASCUNHO"} value={detailDraft.notes} onChange={(event) => setDetailDraft({ ...detailDraft, notes: event.target.value })} /></label>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Codigo</th><th>Produto</th><th>Un.</th><th>Ult. contagem</th><th>Min.</th><th>Ideal</th><th>Sugestao</th><th>Solicitada</th><th>Aprovada</th><th>Recebida</th><th>Obs.</th></tr>
              </thead>
              <tbody>
                {(selected.items ?? []).map((item) => (
                  <tr key={item.id}>
                    <td>{item.productCodeSnapshot ?? "-"}</td>
                    <td title={item.productNameSnapshot}>{item.productNameSnapshot}</td>
                    <td>{item.unitSnapshot ?? "-"}</td>
                    <td>{formatNumber(item.lastCountedQuantity)}</td>
                    <td>{formatNumber(item.estoqueMinimoSnapshot)}</td>
                    <td>{formatNumber(item.estoqueIdealSnapshot)}</td>
                    <td><span title={item.alertSnapshot ?? ""}>{formatNumber(item.suggestedQuantity)} {item.suggestionTypeSnapshot}</span></td>
                    <td><input className="compact-input" type="number" min="0" disabled={selected.status !== "RASCUNHO"} value={detailDraft.items[item.id]?.requestedQuantity ?? ""} onChange={(event) => setDetailDraft({ ...detailDraft, items: { ...detailDraft.items, [item.id]: { ...(detailDraft.items[item.id] ?? { receivedQuantity: "", notes: "" }), requestedQuantity: event.target.value } } })} /></td>
                    <td>{formatNumber(item.approvedQuantity ?? item.requestedQuantity)}</td>
                    <td><input className="compact-input" type="number" min="0" disabled={!["ENVIADO", "RECEBIDO_PARCIAL"].includes(selected.status)} value={detailDraft.items[item.id]?.receivedQuantity ?? ""} onChange={(event) => setDetailDraft({ ...detailDraft, items: { ...detailDraft.items, [item.id]: { ...(detailDraft.items[item.id] ?? { requestedQuantity: String(item.requestedQuantity ?? ""), notes: "" }), receivedQuantity: event.target.value } } })} /></td>
                    <td><input disabled={selected.status !== "RASCUNHO"} value={detailDraft.items[item.id]?.notes ?? ""} onChange={(event) => setDetailDraft({ ...detailDraft, items: { ...detailDraft.items, [item.id]: { ...(detailDraft.items[item.id] ?? { requestedQuantity: String(item.requestedQuantity ?? ""), receivedQuantity: "" }), notes: event.target.value } } })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="action-row end">
            {selected.status === "RASCUNHO" && canOperate && <button className="secondary" type="button" onClick={saveDraft}>Salvar rascunho</button>}
            {selected.status === "RASCUNHO" && canOperate && <button type="button" onClick={() => runStatus("SEND_REVIEW")}><Send size={16} /> Enviar para revisao</button>}
            {selected.status === "EM_REVISAO" && canApprove && <button type="button" onClick={() => runStatus("APPROVE")}><CheckCircle2 size={16} /> Aprovar</button>}
            {selected.status === "APROVADO" && canOperate && <button type="button" onClick={() => runStatus("MARK_SENT")}><Send size={16} /> Marcar enviado</button>}
            {["ENVIADO", "RECEBIDO_PARCIAL"].includes(selected.status) && canOperate && <button type="button" onClick={receive}><PackageCheck size={16} /> Registrar recebimento</button>}
            {!["RECEBIDO", "CANCELADO"].includes(selected.status) && canOperate && <button className="danger" type="button" onClick={cancel}><XCircle size={16} /> Cancelar</button>}
            <button className="ghost" type="button" onClick={refreshSelected}>Recarregar</button>
          </div>
        </section>
      )}
    </div>
  );
}
