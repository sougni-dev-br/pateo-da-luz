import {
  AlertTriangle,
  ArrowRightLeft,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock,
  Edit2,
  FileText,
  Lock,
  Plus,
  Search,
  Trash2,
  X
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  AvailablePurchaseForCycle,
  addPurchaseToSupplierCycle,
  checkSupplierCycleItem,
  closeSupplierCycle,
  createSupplierCycle,
  getAvailablePurchasesForCycle,
  getPaymentMethods,
  getSupplierCycle,
  getSupplierCycles,
  getSuppliers,
  movePurchaseToSupplierCycle,
  PaymentMethod,
  removePurchaseFromSupplierCycle,
  Supplier,
  SupplierCycle,
  SupplierCycleDetail,
  SupplierCycleItem,
  updateSupplierCycle
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { Dialog } from "../components/ui/Dialog";
import { formatCurrency, formatDate } from "../utils/format";

// ── helpers ──────────────────────────────────────────────────────────────────

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDaysToDate(dateStr: string, days: number): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthBounds(offset: -1 | 0 | 1): { startDate: string; endDate: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + offset;
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { startDate: fmt(first), endDate: fmt(last) };
}

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Aberto",
  CHECKED: "Conferido",
  CLOSED: "Fechado",
  PAID: "Pago",
  CANCELLED: "Cancelado"
};

const STATUS_COLORS: Record<string, string> = {
  OPEN: "#c18a1f",
  CHECKED: "#2563a8",
  CLOSED: "#276749",
  PAID: "#276749",
  CANCELLED: "#888"
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      padding: "2px 8px",
      borderRadius: 99,
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: "0.03em",
      background: `${STATUS_COLORS[status] ?? "#888"}18`,
      color: STATUS_COLORS[status] ?? "#888",
      border: `1px solid ${STATUS_COLORS[status] ?? "#888"}40`
    }}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ── check-item mini-form ──────────────────────────────────────────────────────

type CheckFormState = { hasDivergence: boolean; divergenceAmount: string; notes: string };
function emptyCheckForm(): CheckFormState {
  return { hasDivergence: false, divergenceAmount: "", notes: "" };
}

// ── main component ────────────────────────────────────────────────────────────

export function SupplierCycles() {
  const { notice, setNotice } = useNotice();

  // list state
  const [cycles, setCycles] = useState<SupplierCycle[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSupplier, setFilterSupplier] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");

  // detail modal
  const [detail, setDetail] = useState<SupplierCycleDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  // check-item state
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [checkForms, setCheckForms] = useState<Record<string, CheckFormState>>({});
  const [checkingSaving, setCheckingSaving] = useState<string | null>(null);

  // create cycle modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ supplierId: "", startDate: todayKey(), endDate: "", notes: "" });
  const [creating, setCreating] = useState(false);

  // edit cycle modal
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ startDate: "", endDate: "", notes: "" });
  const [editing, setEditing] = useState(false);

  // available purchases panel
  const [availOpen, setAvailOpen] = useState(false);
  const [availPurchases, setAvailPurchases] = useState<AvailablePurchaseForCycle[]>([]);
  const [availLoading, setAvailLoading] = useState(false);
  const [addingPurchaseId, setAddingPurchaseId] = useState<string | null>(null);

  // remove purchase
  const [removingPurchaseId, setRemovingPurchaseId] = useState<string | null>(null);

  // move purchase modal
  const [moveOpen, setMoveOpen] = useState(false);
  const [movePurchaseId, setMovePurchaseId] = useState<string | null>(null);
  const [movePurchaseNumber, setMovePurchaseNumber] = useState<string | null>(null);
  const [targetCycles, setTargetCycles] = useState<SupplierCycle[]>([]);
  const [targetCycleId, setTargetCycleId] = useState("");
  const [moving, setMoving] = useState(false);

  // close cycle modal
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeForm, setCloseForm] = useState({
    paymentMethodId: "",
    installmentCount: 2 as 1 | 2,
    baseDate: todayKey(),
    firstOffset: 15,
    secondOffset: 30,
    firstDueDate: addDaysToDate(todayKey(), 15),
    secondDueDate: addDaysToDate(todayKey(), 30),
    notes: ""
  });
  const [closing, setClosing] = useState(false);

  // ── load list ───────────────────────────────────────────────────────────────

  async function loadCycles() {
    setLoading(true);
    try {
      const [cycleList, supplierList, pmList] = await Promise.all([
        getSupplierCycles({ supplierId: filterSupplier || undefined, status: filterStatus || undefined }),
        getSuppliers(),
        getPaymentMethods()
      ]);
      setCycles(cycleList);
      setSuppliers(supplierList);
      setPaymentMethods(pmList.filter((m) => m.isActive && m.type !== "CREDIT_CARD"));
    } catch {
      setNotice({ tone: "error", message: "Erro ao carregar ciclos." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadCycles(); }, [filterSupplier, filterStatus]); // eslint-disable-line

  const filteredCycles = useMemo(() => {
    if (!search.trim()) return cycles;
    const q = search.toLowerCase();
    return cycles.filter((c) => c.supplierName.toLowerCase().includes(q));
  }, [cycles, search]);

  // ── open detail ─────────────────────────────────────────────────────────────

  async function openDetail(cycleId: string) {
    setDetailLoading(true);
    setDetailOpen(true);
    setExpandedItemId(null);
    setCheckForms({});
    setAvailOpen(false);
    try {
      const d = await getSupplierCycle(cycleId);
      setDetail(d);
    } catch {
      setNotice({ tone: "error", message: "Erro ao carregar detalhe do ciclo." });
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setDetailOpen(false);
    setDetail(null);
    setExpandedItemId(null);
    setCheckForms({});
    setAvailOpen(false);
  }

  // ── check item ──────────────────────────────────────────────────────────────

  function toggleItemExpand(itemId: string) {
    if (expandedItemId === itemId) {
      setExpandedItemId(null);
    } else {
      setExpandedItemId(itemId);
      if (!checkForms[itemId]) {
        setCheckForms((prev) => ({ ...prev, [itemId]: emptyCheckForm() }));
      }
    }
  }

  async function handleCheckItem(item: SupplierCycleItem, checked: boolean) {
    if (!detail) return;
    const form = checkForms[item.id] ?? emptyCheckForm();
    setCheckingSaving(item.id);
    try {
      const result = await checkSupplierCycleItem(detail.id, {
        itemId: item.id,
        checked,
        hasDivergence: form.hasDivergence,
        divergenceAmount: form.hasDivergence && form.divergenceAmount ? Number(form.divergenceAmount) : null,
        notes: form.notes || null
      });
      setNotice({ tone: "success", message: checked ? "Item conferido." : "Conferência removida." });
      setExpandedItemId(null);
      const d = await getSupplierCycle(detail.id);
      setDetail(d);
      setCycles((prev) => prev.map((c) => c.id === detail.id
        ? { ...c, status: result.cycleStatus as SupplierCycle["status"], checkedCount: result.checkedCount, itemCount: result.itemCount }
        : c
      ));
    } catch (err: unknown) {
      setNotice({ tone: "error", message: err instanceof Error ? err.message : "Erro ao conferir item." });
    } finally {
      setCheckingSaving(null);
    }
  }

  // ── create cycle ────────────────────────────────────────────────────────────

  function openCreate() {
    setCreateForm({ supplierId: "", startDate: todayKey(), endDate: "", notes: "" });
    setCreateOpen(true);
  }

  function applyMonthToCreate(offset: -1 | 0 | 1) {
    const { startDate, endDate } = monthBounds(offset);
    setCreateForm((f) => ({ ...f, startDate, endDate }));
  }

  async function handleCreate() {
    if (!createForm.supplierId) {
      setNotice({ tone: "error", message: "Selecione o fornecedor." });
      return;
    }
    if (!createForm.startDate) {
      setNotice({ tone: "error", message: "Informe a data de início do ciclo." });
      return;
    }
    if (createForm.endDate && createForm.endDate < createForm.startDate) {
      setNotice({ tone: "error", message: "Data de fim deve ser maior ou igual à data de início." });
      return;
    }
    setCreating(true);
    try {
      await createSupplierCycle({
        supplierId: createForm.supplierId,
        startDate: createForm.startDate,
        endDate: createForm.endDate || undefined,
        notes: createForm.notes || undefined,
      });
      setNotice({ tone: "success", message: "Ciclo criado com sucesso." });
      setCreateOpen(false);
      await loadCycles();
    } catch (err: unknown) {
      setNotice({ tone: "error", message: err instanceof Error ? err.message : "Erro ao criar ciclo." });
    } finally {
      setCreating(false);
    }
  }

  // ── edit cycle ──────────────────────────────────────────────────────────────

  function openEdit() {
    if (!detail) return;
    setEditForm({
      startDate: detail.periodStart.substring(0, 10),
      endDate: detail.periodEnd?.substring(0, 10) ?? "",
      notes: detail.notes ?? ""
    });
    setEditOpen(true);
  }

  async function handleEdit() {
    if (!detail) return;
    if (!editForm.startDate) {
      setNotice({ tone: "error", message: "Data de início obrigatória." });
      return;
    }
    setEditing(true);
    try {
      await updateSupplierCycle(detail.id, {
        startDate: editForm.startDate,
        endDate: editForm.endDate || "",
        notes: editForm.notes || undefined
      });
      setNotice({ tone: "success", message: "Ciclo atualizado." });
      setEditOpen(false);
      const d = await getSupplierCycle(detail.id);
      setDetail(d);
      await loadCycles();
    } catch (err: unknown) {
      setNotice({ tone: "error", message: err instanceof Error ? err.message : "Erro ao editar ciclo." });
    } finally {
      setEditing(false);
    }
  }

  // ── available purchases ─────────────────────────────────────────────────────

  async function openAvailPurchases() {
    if (!detail) return;
    setAvailOpen(true);
    setAvailLoading(true);
    try {
      const data = await getAvailablePurchasesForCycle(detail.id);
      setAvailPurchases(data);
    } catch {
      setAvailPurchases([]);
      setNotice({ tone: "error", message: "Erro ao carregar compras disponíveis." });
    } finally {
      setAvailLoading(false);
    }
  }

  async function handleAddPurchase(purchaseId: string) {
    if (!detail) return;
    setAddingPurchaseId(purchaseId);
    try {
      await addPurchaseToSupplierCycle(detail.id, purchaseId);
      const [avail, d] = await Promise.all([
        getAvailablePurchasesForCycle(detail.id),
        getSupplierCycle(detail.id)
      ]);
      setAvailPurchases(avail);
      setDetail(d);
      await loadCycles();
      setNotice({ tone: "success", message: "Compra adicionada ao ciclo." });
    } catch (err: unknown) {
      setNotice({ tone: "error", message: err instanceof Error ? err.message : "Erro ao adicionar compra." });
    } finally {
      setAddingPurchaseId(null);
    }
  }

  // ── remove purchase ─────────────────────────────────────────────────────────

  async function handleRemovePurchase(purchaseId: string, purchaseNumber: string | null) {
    if (!detail) return;
    if (!window.confirm(`Remover a compra ${purchaseNumber ?? purchaseId} deste ciclo?`)) return;
    setRemovingPurchaseId(purchaseId);
    try {
      await removePurchaseFromSupplierCycle(detail.id, purchaseId);
      const d = await getSupplierCycle(detail.id);
      setDetail(d);
      await loadCycles();
      setNotice({ tone: "success", message: "Compra removida do ciclo." });
    } catch (err: unknown) {
      setNotice({ tone: "error", message: err instanceof Error ? err.message : "Erro ao remover compra." });
    } finally {
      setRemovingPurchaseId(null);
    }
  }

  // ── move purchase ───────────────────────────────────────────────────────────

  async function openMove(purchaseId: string, purchaseNumber: string | null) {
    if (!detail) return;
    setMovePurchaseId(purchaseId);
    setMovePurchaseNumber(purchaseNumber);
    setTargetCycleId("");
    setMoveOpen(true);
    try {
      const all = await getSupplierCycles({ supplierId: detail.supplierId });
      setTargetCycles(all.filter((c) => (c.status === "OPEN" || c.status === "CHECKED") && c.id !== detail.id));
    } catch {
      setTargetCycles([]);
    }
  }

  async function handleMove() {
    if (!detail || !movePurchaseId || !targetCycleId) return;
    setMoving(true);
    try {
      await movePurchaseToSupplierCycle(detail.id, movePurchaseId, targetCycleId);
      setMoveOpen(false);
      const d = await getSupplierCycle(detail.id);
      setDetail(d);
      await loadCycles();
      setNotice({ tone: "success", message: "Compra movida para outro ciclo." });
    } catch (err: unknown) {
      setNotice({ tone: "error", message: err instanceof Error ? err.message : "Erro ao mover compra." });
    } finally {
      setMoving(false);
      setMovePurchaseId(null);
    }
  }

  // ── close cycle ─────────────────────────────────────────────────────────────

  function openClose() {
    if (!detail) return;
    const firstOffset = detail.cycleFirstDueDays ?? 15;
    const secondOffset = detail.cycleSecondDueDays ?? 30;
    const baseDate = detail.periodEnd?.substring(0, 10) ?? todayKey();
    const installmentCount: 1 | 2 = secondOffset > 0 ? 2 : 1;
    setCloseForm({
      paymentMethodId: paymentMethods[0]?.id ?? "",
      installmentCount,
      baseDate,
      firstOffset,
      secondOffset,
      firstDueDate: addDaysToDate(baseDate, firstOffset),
      secondDueDate: secondOffset > 0 ? addDaysToDate(baseDate, secondOffset) : addDaysToDate(baseDate, firstOffset),
      notes: ""
    });
    setCloseOpen(true);
  }

  function applyPreset(first: number, second: number) {
    const base = closeForm.baseDate;
    setCloseForm((f) => ({
      ...f,
      installmentCount: second > 0 ? 2 : 1,
      firstOffset: first,
      secondOffset: second,
      firstDueDate: addDaysToDate(base, first),
      secondDueDate: second > 0 ? addDaysToDate(base, second) : f.secondDueDate
    }));
  }

  function recalcDatesFromBase(base: string) {
    setCloseForm((f) => ({
      ...f,
      baseDate: base,
      firstDueDate: addDaysToDate(base, f.firstOffset),
      secondDueDate: f.secondOffset > 0 ? addDaysToDate(base, f.secondOffset) : f.secondDueDate
    }));
  }

  async function handleClose() {
    if (!detail) return;
    if (!closeForm.paymentMethodId) {
      setNotice({ tone: "error", message: "Selecione a forma de pagamento." });
      return;
    }
    if (!closeForm.firstDueDate) {
      setNotice({ tone: "error", message: "Informe o vencimento do 1° boleto." });
      return;
    }
    if (closeForm.installmentCount === 2 && !closeForm.secondDueDate) {
      setNotice({ tone: "error", message: "Informe o vencimento do 2° boleto." });
      return;
    }
    setClosing(true);
    try {
      await closeSupplierCycle(detail.id, {
        paymentMethodId: closeForm.paymentMethodId,
        installmentCount: closeForm.installmentCount,
        firstDueDate: closeForm.firstDueDate,
        secondDueDate: closeForm.installmentCount === 2 ? closeForm.secondDueDate : undefined,
        notes: closeForm.notes || undefined
      });
      setNotice({ tone: "success", message: "Ciclo fechado. Título(s) gerado(s) no Contas a Pagar." });
      setCloseOpen(false);
      const [d] = await Promise.all([getSupplierCycle(detail.id), loadCycles()]);
      setDetail(d);
    } catch (err: unknown) {
      setNotice({ tone: "error", message: err instanceof Error ? err.message : "Erro ao fechar ciclo." });
    } finally {
      setClosing(false);
    }
  }

  // ── derived ──────────────────────────────────────────────────────────────────

  const selectedPm = paymentMethods.find((m) => m.id === closeForm.paymentMethodId);
  const totalAmount = Number(detail?.totalAmount ?? 0);
  const firstAmount = closeForm.installmentCount === 2 ? Math.floor(totalAmount * 100 / 2) / 100 : totalAmount;
  const secondAmount = closeForm.installmentCount === 2 ? totalAmount - firstAmount : 0;
  const uncheckedCount = detail ? detail.items.filter((i) => !i.checked).length : 0;
  const canClose = detail && (detail.status === "OPEN" || detail.status === "CHECKED") && uncheckedCount === 0 && totalAmount > 0;
  const isEditable = detail?.status === "OPEN" || detail?.status === "CHECKED";

  // ── render ───────────────────────────────────────────────────────────────────

  return (
    <div className="page-content">
      <Notice notice={notice} />

      {/* ── Cabeçalho ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Ciclos de fornecedor</h1>
          <p style={{ fontSize: 13, color: "var(--ink-faint)", margin: "2px 0 0" }}>
            Agrupa compras por fornecedor para pagamento consolidado
          </p>
        </div>
        <button type="button" className="primary-button" style={{ display: "flex", alignItems: "center", gap: 6 }} onClick={openCreate}>
          <Plus size={14} /> Novo ciclo
        </button>
      </div>

      {/* ── Filtros ── */}
      <div className="filter-bar" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18, alignItems: "center" }}>
        <div className="form-group" style={{ margin: 0, minWidth: 200, flex: 1 }}>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--ink-faint)" }} />
            <input className="form-input" placeholder="Buscar fornecedor…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: 30 }} />
          </div>
        </div>
        <div className="form-group" style={{ margin: 0, minWidth: 180 }}>
          <select className="form-input" value={filterSupplier} onChange={(e) => setFilterSupplier(e.target.value)}>
            <option value="">Todos os fornecedores</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ margin: 0, minWidth: 140 }}>
          <select className="form-input" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">Todos os status</option>
            <option value="OPEN">Aberto</option>
            <option value="CHECKED">Conferido</option>
            <option value="CLOSED">Fechado</option>
            <option value="PAID">Pago</option>
            <option value="CANCELLED">Cancelado</option>
          </select>
        </div>
        {(filterSupplier || filterStatus || search) && (
          <button type="button" className="secondary-button" style={{ display: "flex", alignItems: "center", gap: 4 }}
            onClick={() => { setFilterSupplier(""); setFilterStatus(""); setSearch(""); }}>
            <X size={13} /> Limpar
          </button>
        )}
      </div>

      {/* ── Lista ── */}
      {loading ? (
        <div className="page-loading">Carregando ciclos…</div>
      ) : filteredCycles.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--ink-faint)" }}>
          <FileText size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
          <p>Nenhum ciclo encontrado.</p>
          {!filterStatus && !filterSupplier && (
            <p style={{ fontSize: 13, marginTop: 4 }}>
              Ciclos são criados automaticamente quando uma compra é lançada para um fornecedor com faturamento por ciclo.
            </p>
          )}
        </div>
      ) : (
        <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
          <table className="data-table" style={{ width: "100%", minWidth: 640 }}>
            <thead>
              <tr>
                <th>Fornecedor</th>
                <th>Período</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th style={{ textAlign: "center" }}>Compras</th>
                <th style={{ textAlign: "center" }}>Conferidas</th>
                <th style={{ textAlign: "center" }}>Divergência</th>
                <th style={{ textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredCycles.map((cycle) => (
                <tr key={cycle.id}>
                  <td style={{ fontWeight: 500 }}>{cycle.supplierName}</td>
                  <td style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                    {formatDate(cycle.periodStart)}
                    {cycle.periodEnd ? ` – ${formatDate(cycle.periodEnd)}` : " – aberto"}
                  </td>
                  <td><StatusBadge status={cycle.status} /></td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{formatCurrency(cycle.totalAmount)}</td>
                  <td style={{ textAlign: "center" }}>{cycle.itemCount}</td>
                  <td style={{ textAlign: "center" }}>
                    <span style={{ color: cycle.checkedCount === cycle.itemCount && cycle.itemCount > 0 ? "var(--success)" : undefined }}>
                      {cycle.checkedCount}/{cycle.itemCount}
                    </span>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    {cycle.hasDivergence
                      ? <span title="Há divergências"><AlertTriangle size={14} color="var(--warning)" /></span>
                      : <span style={{ color: "var(--ink-faint)", fontSize: 12 }}>—</span>}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button type="button" className="secondary-button" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => openDetail(cycle.id)}>
                      Ver
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modal novo ciclo ── */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => { if (!open && !creating) setCreateOpen(false); }}
        title="Novo ciclo de fornecedor"
        description="Cria um ciclo aberto. As compras lançadas para este fornecedor serão adicionadas automaticamente."
        size="md"
      >
        <div className="form-group">
          <label className="form-label">Fornecedor *</label>
          <select className="form-input" value={createForm.supplierId} onChange={(e) => setCreateForm((f) => ({ ...f, supplierId: e.target.value }))}>
            <option value="">Selecione o fornecedor…</option>
            {suppliers.filter((s) => s.isActive).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.billingMode === "CYCLE" ? " ★" : ""}</option>
            ))}
          </select>
          <span style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 4, display: "block" }}>
            Fornecedores com ★ usam faturamento por ciclo.
          </span>
        </div>

        {/* Atalhos de mês */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--ink-faint)", alignSelf: "center", marginRight: 2 }}>
            <CalendarDays size={12} style={{ verticalAlign: "middle", marginRight: 3 }} />Período:
          </span>
          {([-1, 0, 1] as const).map((offset) => {
            const label = offset === -1 ? "Mês anterior" : offset === 0 ? "Mês atual" : "Próximo mês";
            return (
              <button key={offset} type="button" className="secondary-button" style={{ fontSize: 11, padding: "3px 8px" }}
                onClick={() => applyMonthToCreate(offset)}>
                {label}
              </button>
            );
          })}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Data de início *</label>
            <input className="form-input" type="date" value={createForm.startDate}
              onChange={(e) => setCreateForm((f) => ({ ...f, startDate: e.target.value }))} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Data de fim (opcional)</label>
            <input className="form-input" type="date" value={createForm.endDate} min={createForm.startDate}
              onChange={(e) => setCreateForm((f) => ({ ...f, endDate: e.target.value }))} />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Observação</label>
          <input className="form-input" placeholder="Opcional" value={createForm.notes}
            onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))} />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 8 }}>
          <button type="button" className="secondary-button" onClick={() => setCreateOpen(false)} disabled={creating}>Cancelar</button>
          <button type="button" className="primary-button" onClick={handleCreate}
            disabled={creating || !createForm.supplierId || !createForm.startDate}
            style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Plus size={14} />
            {creating ? "Criando…" : "Criar ciclo"}
          </button>
        </div>
      </Dialog>

      {/* ── Modal editar ciclo ── */}
      <Dialog
        open={editOpen}
        onOpenChange={(open) => { if (!open && !editing) setEditOpen(false); }}
        title="Editar ciclo"
        description="Ajuste o período e a observação. Status e compras não são alterados aqui."
        size="md"
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Data de início *</label>
            <input className="form-input" type="date" value={editForm.startDate}
              onChange={(e) => setEditForm((f) => ({ ...f, startDate: e.target.value }))} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Data de fim (opcional)</label>
            <input className="form-input" type="date" value={editForm.endDate} min={editForm.startDate}
              onChange={(e) => setEditForm((f) => ({ ...f, endDate: e.target.value }))} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Observação</label>
          <input className="form-input" placeholder="Opcional" value={editForm.notes}
            onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 8 }}>
          <button type="button" className="secondary-button" onClick={() => setEditOpen(false)} disabled={editing}>Cancelar</button>
          <button type="button" className="primary-button" onClick={handleEdit} disabled={editing || !editForm.startDate}
            style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Edit2 size={14} />
            {editing ? "Salvando…" : "Salvar alterações"}
          </button>
        </div>
      </Dialog>

      {/* ── Modal mover compra ── */}
      <Dialog
        open={moveOpen}
        onOpenChange={(open) => { if (!open && !moving) { setMoveOpen(false); setMovePurchaseId(null); } }}
        title="Mover compra para outro ciclo"
        description={movePurchaseNumber ? `Compra ${movePurchaseNumber}` : "Selecione o ciclo de destino."}
        size="sm"
      >
        {targetCycles.length === 0 ? (
          <div style={{ textAlign: "center", padding: "24px 0", color: "var(--ink-faint)", fontSize: 13 }}>
            Nenhum outro ciclo aberto para este fornecedor.
          </div>
        ) : (
          <div className="form-group">
            <label className="form-label">Ciclo destino *</label>
            <select className="form-input" value={targetCycleId} onChange={(e) => setTargetCycleId(e.target.value)}>
              <option value="">Selecione…</option>
              {targetCycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {formatDate(c.periodStart)}{c.periodEnd ? ` – ${formatDate(c.periodEnd)}` : " – aberto"} · {STATUS_LABELS[c.status]} · {formatCurrency(c.totalAmount)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 8 }}>
          <button type="button" className="secondary-button" onClick={() => { setMoveOpen(false); setMovePurchaseId(null); }} disabled={moving}>Cancelar</button>
          <button type="button" className="primary-button" onClick={handleMove} disabled={moving || !targetCycleId}
            style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <ArrowRightLeft size={14} />
            {moving ? "Movendo…" : "Mover compra"}
          </button>
        </div>
      </Dialog>

      {/* ── Modal detalhe do ciclo ── */}
      <Dialog
        open={detailOpen}
        onOpenChange={(open) => { if (!open) closeDetail(); }}
        title={detail ? `Ciclo — ${detail.supplierName}` : "Ciclo de fornecedor"}
        size="xl"
      >
        {detailLoading || !detail ? (
          <div className="page-loading">Carregando…</div>
        ) : (
          <>
            {/* Cabeçalho do ciclo */}
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 20, padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Período</div>
                <div style={{ fontWeight: 500 }}>
                  {formatDate(detail.periodStart)}
                  {detail.periodEnd ? ` – ${formatDate(detail.periodEnd)}` : " – em aberto"}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Status</div>
                <div style={{ marginTop: 2 }}><StatusBadge status={detail.status} /></div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Total do ciclo</div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>{formatCurrency(detail.totalAmount)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Conferência</div>
                <div style={{ fontWeight: 500, color: uncheckedCount === 0 ? "var(--success)" : undefined }}>
                  {detail.checkedCount}/{detail.items.length} itens
                </div>
              </div>
              {detail.generatedPurchaseId && (
                <div>
                  <div style={{ fontSize: 11, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Título gerado</div>
                  <div style={{ fontWeight: 500, color: "var(--success)", display: "flex", alignItems: "center", gap: 4 }}>
                    <CheckCircle2 size={14} /> Contas a Pagar
                  </div>
                </div>
              )}
            </div>

            {/* Avisos */}
            {isEditable && uncheckedCount > 0 && (
              <div className="alert" style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                <Clock size={15} />
                <span>{uncheckedCount} compra(s) ainda não conferida(s). Confira todos os itens para habilitar o fechamento.</span>
              </div>
            )}
            {(detail.status === "CLOSED" || detail.status === "PAID") && (
              <div className="alert" style={{ marginBottom: 14, background: "var(--success-bg, #edfcf2)", color: "var(--success)", border: "1px solid #9fe9c0", display: "flex", alignItems: "center", gap: 8 }}>
                <CheckCircle2 size={15} />
                <span>
                  Ciclo {detail.status === "PAID" ? "pago" : "fechado"}.
                  {detail.installments.length > 0 && ` ${detail.installments.length} título(s) gerado(s) no Contas a Pagar.`}
                </span>
              </div>
            )}

            {/* Tabela de itens */}
            <div style={{ overflowX: "auto", marginBottom: 16 }}>
              <table className="data-table" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>Compra</th>
                    <th>NF</th>
                    <th>Data</th>
                    <th style={{ textAlign: "right" }}>Valor</th>
                    <th>Status</th>
                    <th style={{ textAlign: "center" }}>Conf.</th>
                    <th style={{ textAlign: "center" }}>Diverg.</th>
                    <th style={{ textAlign: "center" }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((item) => (
                    <Fragment key={item.id}>
                      <tr style={{ background: expandedItemId === item.id ? "var(--paper-soft)" : undefined }}>
                        <td style={{ fontWeight: 500, fontSize: 13 }}>{item.purchaseNumber ?? "—"}</td>
                        <td style={{ fontSize: 13, color: "var(--ink-soft)" }}>{item.invoiceNumber ?? "—"}</td>
                        <td style={{ fontSize: 13 }}>{formatDate(item.purchaseDate)}</td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>{formatCurrency(item.amount)}</td>
                        <td>
                          <span style={{ fontSize: 12, color: item.purchaseStatus === "ACTIVE" ? "var(--success)" : "var(--ink-faint)" }}>
                            {item.purchaseStatus === "ACTIVE" ? "Ativa" : item.purchaseStatus}
                          </span>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {item.checked ? <CheckCircle2 size={16} color="var(--success)" /> : <Circle size={16} color="var(--ink-faint)" />}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {item.hasDivergence
                            ? <span title={item.divergenceAmount ? `Divergência: ${formatCurrency(item.divergenceAmount)}` : "Divergência"}><AlertTriangle size={14} color="var(--warning)" /></span>
                            : <span style={{ color: "var(--ink-faint)", fontSize: 12 }}>—</span>}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {isEditable ? (
                            <div style={{ display: "flex", gap: 4, justifyContent: "center", flexWrap: "wrap" }}>
                              <button type="button" className="secondary-button"
                                style={{ fontSize: 11, padding: "2px 7px", display: "inline-flex", alignItems: "center", gap: 2 }}
                                onClick={() => toggleItemExpand(item.id)}
                                disabled={checkingSaving === item.id}>
                                {expandedItemId === item.id ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                                Conferir
                              </button>
                              <button type="button" className="secondary-button"
                                style={{ fontSize: 11, padding: "2px 7px", display: "inline-flex", alignItems: "center", gap: 2, color: "var(--warning)" }}
                                onClick={() => openMove(item.purchaseId, item.purchaseNumber)}
                                title="Mover para outro ciclo">
                                <ArrowRightLeft size={11} />
                              </button>
                              <button type="button" className="secondary-button"
                                style={{ fontSize: 11, padding: "2px 7px", display: "inline-flex", alignItems: "center", gap: 2, color: "#c53030" }}
                                onClick={() => handleRemovePurchase(item.purchaseId, item.purchaseNumber)}
                                disabled={removingPurchaseId === item.purchaseId}
                                title="Remover do ciclo">
                                <Trash2 size={11} />
                              </button>
                            </div>
                          ) : (
                            <span title="Ciclo fechado"><Lock size={13} color="var(--ink-faint)" /></span>
                          )}
                        </td>
                      </tr>

                      {/* Painel expandido de conferência */}
                      {expandedItemId === item.id && (
                        <tr>
                          <td colSpan={8} style={{ padding: "12px 16px", background: "var(--paper-soft)", borderTop: "1px solid var(--border)" }}>
                            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
                              <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label">Divergência?</label>
                                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginTop: 6 }}>
                                  <input type="checkbox"
                                    checked={checkForms[item.id]?.hasDivergence ?? false}
                                    onChange={(e) => setCheckForms((prev) => ({
                                      ...prev,
                                      [item.id]: { ...prev[item.id], hasDivergence: e.target.checked, divergenceAmount: e.target.checked ? prev[item.id]?.divergenceAmount ?? "" : "" }
                                    }))} />
                                  Há divergência no valor
                                </label>
                              </div>
                              {checkForms[item.id]?.hasDivergence && (
                                <div className="form-group" style={{ margin: 0, minWidth: 140 }}>
                                  <label className="form-label">Valor divergente (R$)</label>
                                  <input className="form-input" type="number" min="0" step="0.01" placeholder="0,00"
                                    value={checkForms[item.id]?.divergenceAmount ?? ""}
                                    onChange={(e) => setCheckForms((prev) => ({ ...prev, [item.id]: { ...prev[item.id], divergenceAmount: e.target.value } }))} />
                                </div>
                              )}
                              <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 180 }}>
                                <label className="form-label">Observação</label>
                                <input className="form-input" placeholder="Opcional"
                                  value={checkForms[item.id]?.notes ?? ""}
                                  onChange={(e) => setCheckForms((prev) => ({ ...prev, [item.id]: { ...prev[item.id], notes: e.target.value } }))} />
                              </div>
                              <div style={{ display: "flex", gap: 8, marginBottom: 1 }}>
                                <button type="button" className="primary-button"
                                  style={{ display: "flex", alignItems: "center", gap: 4 }}
                                  disabled={checkingSaving === item.id}
                                  onClick={() => handleCheckItem(item, true)}>
                                  <CheckCircle2 size={13} />
                                  {checkingSaving === item.id ? "Salvando…" : "Confirmar conferência"}
                                </button>
                                {item.checked && (
                                  <button type="button" className="secondary-button"
                                    disabled={checkingSaving === item.id}
                                    onClick={() => handleCheckItem(item, false)}>
                                    Remover conferência
                                  </button>
                                )}
                                <button type="button" className="secondary-button" onClick={() => setExpandedItemId(null)}>Cancelar</button>
                              </div>
                            </div>
                            {item.notes && (
                              <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-soft)" }}>
                                Obs. atual: {item.notes}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Painel adicionar compras */}
            {isEditable && (
              <div style={{ marginBottom: 16 }}>
                <button type="button" className="secondary-button"
                  style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}
                  onClick={availOpen ? () => setAvailOpen(false) : openAvailPurchases}>
                  {availOpen ? <ChevronUp size={14} /> : <Plus size={14} />}
                  {availOpen ? "Fechar painel" : "Adicionar compras ao ciclo"}
                </button>

                {availOpen && (
                  <div style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
                    {availLoading ? (
                      <div style={{ padding: 20, textAlign: "center", color: "var(--ink-faint)", fontSize: 13 }}>Carregando compras disponíveis…</div>
                    ) : availPurchases.length === 0 ? (
                      <div style={{ padding: 20, textAlign: "center", color: "var(--ink-faint)", fontSize: 13 }}>
                        Nenhuma compra disponível para adicionar a este ciclo.
                      </div>
                    ) : (
                      <table className="data-table" style={{ width: "100%", margin: 0 }}>
                        <thead>
                          <tr>
                            <th>Compra</th>
                            <th>NF</th>
                            <th>Data</th>
                            <th style={{ textAlign: "right" }}>Valor</th>
                            <th>Situação</th>
                            <th style={{ textAlign: "center" }}>Ação</th>
                          </tr>
                        </thead>
                        <tbody>
                          {availPurchases.map((p) => (
                            <tr key={p.id}>
                              <td style={{ fontSize: 13, fontWeight: 500 }}>{p.purchaseNumber ?? "—"}</td>
                              <td style={{ fontSize: 13, color: "var(--ink-soft)" }}>{p.invoiceNumber ?? "—"}</td>
                              <td style={{ fontSize: 13 }}>
                                {formatDate(p.purchaseDate)}
                                {p.isOutsidePeriod && (
                                  <span title="Fora do período do ciclo" style={{ marginLeft: 4 }}>
                                    <AlertTriangle size={12} color="var(--warning)" />
                                  </span>
                                )}
                              </td>
                              <td style={{ textAlign: "right", fontWeight: 600 }}>{formatCurrency(p.totalAmount)}</td>
                              <td style={{ fontSize: 12 }}>
                                {p.currentCycleId
                                  ? <span style={{ color: "var(--warning)" }}>Em outro ciclo ({STATUS_LABELS[p.currentCycleStatus ?? ""] ?? p.currentCycleStatus})</span>
                                  : <span style={{ color: "var(--ink-faint)" }}>Sem ciclo</span>}
                              </td>
                              <td style={{ textAlign: "center" }}>
                                <button type="button" className="primary-button"
                                  style={{ fontSize: 11, padding: "3px 10px" }}
                                  disabled={addingPurchaseId === p.id}
                                  onClick={() => handleAddPurchase(p.id)}>
                                  {addingPurchaseId === p.id ? "Adicionando…" : "Adicionar"}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Títulos gerados */}
            {detail.installments.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--ink-soft)" }}>
                  Títulos gerados no Contas a Pagar
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {detail.installments.map((inst) => (
                    <div key={inst.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 16px", minWidth: 180, background: "var(--paper)" }}>
                      <div style={{ fontSize: 11, color: "var(--ink-faint)", marginBottom: 2 }}>
                        Parcela {inst.installment}/{detail.installments.length} · {inst.paymentMethodName}
                      </div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{formatCurrency(inst.amount)}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>Venc. {formatDate(inst.dueDate)}</div>
                      <div style={{ marginTop: 4 }}><StatusBadge status={inst.status} /></div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Botões de ação */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 8, borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
              <button type="button" className="secondary-button" onClick={closeDetail}>Fechar</button>
              {isEditable && (
                <button type="button" className="secondary-button"
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                  onClick={openEdit}>
                  <Edit2 size={14} /> Editar ciclo
                </button>
              )}
              {isEditable && (
                <button type="button" className="primary-button"
                  disabled={!canClose}
                  title={!canClose ? `${uncheckedCount} item(s) não conferido(s)` : "Fechar ciclo e gerar título(s) no Contas a Pagar"}
                  onClick={openClose}
                  style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <CheckCircle2 size={14} />
                  Fechar ciclo e gerar títulos
                </button>
              )}
            </div>
          </>
        )}
      </Dialog>

      {/* ── Modal fechar ciclo ── */}
      <Dialog
        open={closeOpen}
        onOpenChange={(open) => { if (!open && !closing) setCloseOpen(false); }}
        title="Fechar ciclo e gerar títulos"
        description="O ciclo será fechado e os títulos gerados no Contas a Pagar."
        size="md"
      >
        {detail && (
          <>
            <div style={{ background: "var(--paper-soft)", borderRadius: 8, padding: "12px 16px", marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: "var(--ink-faint)" }}>Fornecedor</div>
              <div style={{ fontWeight: 600 }}>{detail.supplierName}</div>
              <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 4 }}>
                {detail.items.length} compra(s) · Total: <strong>{formatCurrency(detail.totalAmount)}</strong>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Forma de pagamento *</label>
              <select className="form-input" value={closeForm.paymentMethodId}
                onChange={(e) => setCloseForm((f) => ({ ...f, paymentMethodId: e.target.value }))}>
                <option value="">Selecione…</option>
                {paymentMethods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Número de boletos *</label>
              <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
                {([1, 2] as const).map((n) => (
                  <label key={n} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input type="radio" name="installmentCount"
                      checked={closeForm.installmentCount === n}
                      onChange={() => setCloseForm((f) => ({ ...f, installmentCount: n }))} />
                    {n === 1 ? "1 boleto (à vista)" : "2 boletos (parcelado)"}
                  </label>
                ))}
              </div>
            </div>

            {/* Data base + presets */}
            <div style={{ background: "var(--paper-soft)", borderRadius: 8, padding: "12px 14px", marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-soft)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <CalendarDays size={13} /> Calcular vencimentos
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 8 }}>
                <div className="form-group" style={{ margin: 0, minWidth: 150 }}>
                  <label className="form-label" style={{ fontSize: 11 }}>Data base</label>
                  <input className="form-input" type="date" value={closeForm.baseDate}
                    onChange={(e) => recalcDatesFromBase(e.target.value)} />
                </div>
                <div style={{ display: "flex", gap: 5, alignSelf: "flex-end", paddingBottom: 1, flexWrap: "wrap" }}>
                  {detail.cycleFirstDueDays != null && (
                    <button type="button" className="secondary-button" style={{ fontSize: 11, padding: "4px 8px" }}
                      onClick={() => applyPreset(detail.cycleFirstDueDays!, detail.cycleSecondDueDays ?? 0)}>
                      Padrão ({detail.cycleFirstDueDays}/{detail.cycleSecondDueDays ?? "—"})
                    </button>
                  )}
                  <button type="button" className="secondary-button" style={{ fontSize: 11, padding: "4px 8px" }}
                    onClick={() => applyPreset(7, 15)}>7/15d</button>
                  <button type="button" className="secondary-button" style={{ fontSize: 11, padding: "4px 8px" }}
                    onClick={() => applyPreset(15, 30)}>15/30d</button>
                  <button type="button" className="secondary-button" style={{ fontSize: 11, padding: "4px 8px" }}
                    onClick={() => applyPreset(30, 0)}>30d único</button>
                </div>
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>
                +{closeForm.firstOffset}d → {closeForm.firstDueDate || "—"}
                {closeForm.installmentCount === 2 && closeForm.secondOffset > 0 && ` · +${closeForm.secondOffset}d → ${closeForm.secondDueDate || "—"}`}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: closeForm.installmentCount === 2 ? "1fr 1fr" : "1fr", gap: 12 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Vencimento {closeForm.installmentCount === 2 ? "1° boleto" : ""} *</label>
                <input className="form-input" type="date" value={closeForm.firstDueDate} min={todayKey()}
                  onChange={(e) => setCloseForm((f) => ({ ...f, firstDueDate: e.target.value }))} />
              </div>
              {closeForm.installmentCount === 2 && (
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">Vencimento 2° boleto *</label>
                  <input className="form-input" type="date" value={closeForm.secondDueDate} min={closeForm.firstDueDate || todayKey()}
                    onChange={(e) => setCloseForm((f) => ({ ...f, secondDueDate: e.target.value }))} />
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Observação</label>
              <input className="form-input" placeholder="Opcional" value={closeForm.notes}
                onChange={(e) => setCloseForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>

            {/* Preview dos boletos */}
            {closeForm.paymentMethodId && closeForm.firstDueDate && (
              <div style={{ background: "var(--paper-soft)", borderRadius: 8, padding: "12px 16px", marginBottom: 8, marginTop: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-soft)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Preview dos títulos
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", background: "var(--paper)", minWidth: 150 }}>
                    <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>Boleto 1/{closeForm.installmentCount} · {selectedPm?.name}</div>
                    <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{formatCurrency(firstAmount)}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>Venc. {formatDate(closeForm.firstDueDate)}</div>
                  </div>
                  {closeForm.installmentCount === 2 && closeForm.secondDueDate && (
                    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", background: "var(--paper)", minWidth: 150 }}>
                      <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>Boleto 2/2 · {selectedPm?.name}</div>
                      <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{formatCurrency(secondAmount)}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>Venc. {formatDate(closeForm.secondDueDate)}</div>
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 8 }}>
                  Total: {formatCurrency(totalAmount)} · Os títulos serão criados em Contas a Pagar com origem SUPPLIER_CYCLE.
                </div>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 8 }}>
              <button type="button" className="secondary-button" onClick={() => setCloseOpen(false)} disabled={closing}>Cancelar</button>
              <button type="button" className="primary-button" onClick={handleClose}
                disabled={closing || !closeForm.paymentMethodId || !closeForm.firstDueDate}
                style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Lock size={14} />
                {closing ? "Fechando…" : "Confirmar fechamento"}
              </button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}
