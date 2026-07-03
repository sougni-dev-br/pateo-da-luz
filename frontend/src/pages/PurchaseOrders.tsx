import { BadgeDollarSign, CheckCircle2, Download, Eye, PackageCheck, RefreshCw, Send, XCircle } from "lucide-react";
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
import {
  Button,
  EmptyState,
  FormField,
  FormGrid,
  IconButton,
  Money,
  PanelEyebrow,
  StatusBadge,
  SummaryCard,
  Table,
  Textarea,
  TextField
} from "../design-system";
import { hasPermission } from "../lib/permissions";
import { formatDate, formatNumber } from "../utils/format";

const statusLabels: Record<string, string> = {
  RASCUNHO: "Rascunho",
  EM_REVISAO: "Em revisão",
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
          <span />
          <Button variant="secondary" leadingIcon={<RefreshCw size={16} />} onClick={load}>Atualizar</Button>
        </div>

        {/* Contadores operacionais e valores em R$ separados em blocos
            semanticos — padrao do handoff, reusado em Contas a pagar/
            Faturamento/DRE nas proximas ondas. */}
        <div className="po-kpi-block">
          <PanelEyebrow>Situação operacional</PanelEyebrow>
          <div className="po-status-grid">
            <SummaryCard label="Rascunho" value={summary.RASCUNHO ?? 0} tone="warning" />
            <SummaryCard label="Em revisão" value={summary.EM_REVISAO ?? 0} tone="info" />
            <SummaryCard label="Aprovados" value={summary.APROVADO ?? 0} tone="success" />
            <SummaryCard label="Enviados" value={summary.ENVIADO ?? 0} />
            <SummaryCard label="Recebidos" value={(summary.RECEBIDO ?? 0) + (summary.RECEBIDO_PARCIAL ?? 0)} tone="success" />
            <SummaryCard label="Cancelados" value={summary.CANCELADO ?? 0} tone="danger" />
          </div>
        </div>
        <div className="po-kpi-block">
          <PanelEyebrow>Resumo financeiro</PanelEyebrow>
          <div className="po-finance-grid">
            <SummaryCard
              label="Valor estimado"
              value={<Money value={estimatedTotal} />}
              detail="Soma dos pedidos listados"
              icon={<BadgeDollarSign size={18} />}
            />
          </div>
        </div>

        <div className="filter-bar">
          <FormField label="Busca">
            <TextField value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Código ou fornecedor" />
          </FormField>
          <Button variant="secondary" onClick={load}>Filtrar</Button>
        </div>

        <Table>
          <Table.Head>
            <Table.Row>
              <Table.Th>Código</Table.Th>
              <Table.Th minWidth={180}>Fornecedor</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Origem</Table.Th>
              <Table.Th>Criação</Table.Th>
              <Table.Th>Previsão</Table.Th>
              <Table.Th align="right">Itens</Table.Th>
              <Table.Th align="right">Estimado</Table.Th>
              <Table.Th>Responsável</Table.Th>
              <Table.Th actions>Ações</Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {orders.map((order) => (
              <Table.Row key={order.id}>
                <Table.Td style={{ whiteSpace: "nowrap" }}>{order.code}</Table.Td>
                <Table.Td truncate title={order.supplierNameSnapshot}>{order.supplierNameSnapshot}</Table.Td>
                <Table.Td><StatusBadge tone={statusTone(order.status)}>{statusLabels[order.status] ?? order.status}</StatusBadge></Table.Td>
                <Table.Td style={{ whiteSpace: "nowrap" }}>{sourceLabels[order.source] ?? "Manual"}</Table.Td>
                <Table.Td style={{ whiteSpace: "nowrap" }}>{formatDate(order.createdAt)}</Table.Td>
                <Table.Td style={{ whiteSpace: "nowrap" }}>{formatDate(order.expectedDeliveryDate)}</Table.Td>
                <Table.Td align="right">{order.totalItems ?? 0}</Table.Td>
                <Table.Td align="right"><Money value={Number(order.estimatedTotal ?? 0)} /></Table.Td>
                <Table.Td truncate style={{ maxWidth: 140 }} title={order.createdByUserName ?? "-"}>{order.createdByUserName ?? "-"}</Table.Td>
                <Table.Td actions>
                  <IconButton icon={<Eye size={16} />} label="Abrir pedido" onClick={() => openOrder(order.id)} />
                </Table.Td>
              </Table.Row>
            ))}
            {!loading && orders.length === 0 && (
              <Table.Row>
                <Table.Td colSpan={10}>
                  <EmptyState title="Nenhum pedido de compra" description="Gere pedidos a partir da pré-lista do comprador." />
                </Table.Td>
              </Table.Row>
            )}
          </Table.Body>
        </Table>
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
              <Button variant="secondary" leadingIcon={<Download size={16} />} onClick={() => downloadPurchaseOrderCsv(selected.id, selected.code)}>Exportar</Button>
            </div>
          </div>

          <FormGrid cols={3}>
            <FormField label="Fornecedor">
              <TextField readOnly value={selected.supplierNameSnapshot} title={selected.supplierNameSnapshot} />
            </FormField>
            <FormField label="Origem">
              <TextField readOnly value={sourceLabels[selected.source] ?? "Manual"} />
            </FormField>
            <FormField label="Previsão de entrega">
              <TextField type="date" disabled={selected.status !== "RASCUNHO"} value={detailDraft.expectedDeliveryDate} onChange={(event) => setDetailDraft({ ...detailDraft, expectedDeliveryDate: event.target.value })} />
            </FormField>
            <div className="ds-form-grid-span-all">
              <FormField label="Observações">
                <Textarea disabled={selected.status !== "RASCUNHO"} value={detailDraft.notes} onChange={(event) => setDetailDraft({ ...detailDraft, notes: event.target.value })} />
              </FormField>
            </div>
          </FormGrid>

          <Table>
            <Table.Head>
              <Table.Row>
                <Table.Th>Código</Table.Th>
                <Table.Th minWidth={180}>Produto</Table.Th>
                <Table.Th>Un.</Table.Th>
                <Table.Th align="right">Últ. contagem</Table.Th>
                <Table.Th align="right">Mín.</Table.Th>
                <Table.Th align="right">Ideal</Table.Th>
                <Table.Th align="right">Sugestão</Table.Th>
                <Table.Th align="right">Solicitada</Table.Th>
                <Table.Th align="right">Aprovada</Table.Th>
                <Table.Th align="right">Recebida</Table.Th>
                <Table.Th>Obs.</Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {(selected.items ?? []).map((item) => (
                <Table.Row key={item.id}>
                  <Table.Td>{item.productCodeSnapshot ?? "-"}</Table.Td>
                  <Table.Td truncate title={item.productNameSnapshot}>{item.productNameSnapshot}</Table.Td>
                  <Table.Td>{item.unitSnapshot ?? "-"}</Table.Td>
                  <Table.Td align="right">{formatNumber(item.lastCountedQuantity)}</Table.Td>
                  <Table.Td align="right">{formatNumber(item.estoqueMinimoSnapshot)}</Table.Td>
                  <Table.Td align="right">{formatNumber(item.estoqueIdealSnapshot)}</Table.Td>
                  <Table.Td align="right"><span title={item.alertSnapshot ?? ""}>{formatNumber(item.suggestedQuantity)} {item.suggestionTypeSnapshot}</span></Table.Td>
                  <Table.Td align="right"><input className="compact-input" type="number" min="0" disabled={selected.status !== "RASCUNHO"} value={detailDraft.items[item.id]?.requestedQuantity ?? ""} onChange={(event) => setDetailDraft({ ...detailDraft, items: { ...detailDraft.items, [item.id]: { ...(detailDraft.items[item.id] ?? { receivedQuantity: "", notes: "" }), requestedQuantity: event.target.value } } })} /></Table.Td>
                  <Table.Td align="right">{formatNumber(item.approvedQuantity ?? item.requestedQuantity)}</Table.Td>
                  <Table.Td align="right"><input className="compact-input" type="number" min="0" disabled={!["ENVIADO", "RECEBIDO_PARCIAL"].includes(selected.status)} value={detailDraft.items[item.id]?.receivedQuantity ?? ""} onChange={(event) => setDetailDraft({ ...detailDraft, items: { ...detailDraft.items, [item.id]: { ...(detailDraft.items[item.id] ?? { requestedQuantity: String(item.requestedQuantity ?? ""), notes: "" }), receivedQuantity: event.target.value } } })} /></Table.Td>
                  <Table.Td><input disabled={selected.status !== "RASCUNHO"} value={detailDraft.items[item.id]?.notes ?? ""} onChange={(event) => setDetailDraft({ ...detailDraft, items: { ...detailDraft.items, [item.id]: { ...(detailDraft.items[item.id] ?? { requestedQuantity: String(item.requestedQuantity ?? ""), receivedQuantity: "" }), notes: event.target.value } } })} /></Table.Td>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>

          <div className="action-row end">
            {selected.status === "RASCUNHO" && canOperate && <Button variant="secondary" onClick={saveDraft}>Salvar rascunho</Button>}
            {selected.status === "RASCUNHO" && canOperate && <Button leadingIcon={<Send size={16} />} onClick={() => runStatus("SEND_REVIEW")}>Enviar para revisão</Button>}
            {selected.status === "EM_REVISAO" && canApprove && <Button leadingIcon={<CheckCircle2 size={16} />} onClick={() => runStatus("APPROVE")}>Aprovar</Button>}
            {selected.status === "APROVADO" && canOperate && <Button leadingIcon={<Send size={16} />} onClick={() => runStatus("MARK_SENT")}>Marcar enviado</Button>}
            {["ENVIADO", "RECEBIDO_PARCIAL"].includes(selected.status) && canOperate && <Button leadingIcon={<PackageCheck size={16} />} onClick={receive}>Registrar recebimento</Button>}
            {!["RECEBIDO", "CANCELADO"].includes(selected.status) && canOperate && <Button variant="danger" leadingIcon={<XCircle size={16} />} onClick={cancel}>Cancelar</Button>}
            <Button variant="secondary" onClick={refreshSelected}>Recarregar</Button>
          </div>
        </section>
      )}
    </div>
  );
}
