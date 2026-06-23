import { CheckCircle2, ClipboardList, Copy, Eye, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  AppUser,
  CreateRequisitionPayload,
  InventoryRequisition,
  InventoryRequisitionItem,
  InventorySector,
  InventoryStock,
  Product,
  createRequisition,
  getInventoryStocks,
  getProducts,
  getRequisition,
  getRequisitions,
  getSectors
} from "../api/client";
import { EmptyState, StatusBadge } from "../components/ui";
import { Notice, useNotice } from "../components/Notice";
import { formatDate, formatNumber } from "../utils/format";

type RequisitionShift = "MORNING" | "AFTERNOON" | "NIGHT";
type RequisitionReason = "DAILY_PRODUCTION" | "PREP" | "EVENT" | "OTHER";

type RequisitionLineItem = {
  productId: string;
  productName: string;
  productCode: string | null;
  unit: string;
  quantity: string;
  currentStock: number | null;
};

const shiftLabels: Record<RequisitionShift, string> = {
  MORNING: "Manha",
  AFTERNOON: "Tarde",
  NIGHT: "Noite"
};

const reasonLabels: Record<RequisitionReason, string> = {
  DAILY_PRODUCTION: "Producao do dia",
  PREP: "Pre-preparo",
  EVENT: "Evento",
  OTHER: "Outro"
};

const shiftTone = (shift: string) =>
  shift === "MORNING" ? "info" : shift === "AFTERNOON" ? "warning" : "neutral";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function Requisitions({ user }: { user: AppUser }) {
  const [view, setView] = useState<"form" | "list">("form");
  const [sectors, setSectors] = useState<InventorySector[]>([]);
  const [stockMap, setStockMap] = useState<Map<string, number>>(new Map());
  const [form, setForm] = useState<{
    date: string;
    shift: RequisitionShift;
    reason: RequisitionReason;
    reasonNotes: string;
    sectorId: string;
    notes: string;
  }>({ date: todayIso(), shift: "MORNING", reason: "DAILY_PRODUCTION", reasonNotes: "", sectorId: "", notes: "" });
  const [items, setItems] = useState<RequisitionLineItem[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmedRequisition, setConfirmedRequisition] = useState<InventoryRequisition | null>(null);
  const [requisitions, setRequisitions] = useState<InventoryRequisition[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InventoryRequisition | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const { notice, setNotice } = useNotice();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clientRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    getSectors().then(setSectors).catch(() => {});
    getInventoryStocks().then((stocks: InventoryStock[]) => {
      setStockMap(new Map(stocks.map((s) => [s.productId, Number(s.currentQuantity)])));
    }).catch(() => {});
    loadRequisitions();
  }, []);

  // Auto-focus busca ao abrir formulário
  useEffect(() => {
    if (view === "form" && !confirmedRequisition) {
      setTimeout(() => searchInputRef.current?.focus(), 80);
    }
  }, [view, confirmedRequisition]);

  useEffect(() => {
    if (!detailId) { setDetail(null); return; }
    setLoadingDetail(true);
    getRequisition(detailId)
      .then(setDetail)
      .catch(() => setNotice({ tone: "error", message: "Nao foi possivel carregar os detalhes." }))
      .finally(() => setLoadingDetail(false));
  }, [detailId]);

  function loadRequisitions() {
    getRequisitions().then(setRequisitions).catch(() => {});
  }

  async function duplicateRequisition(id: string) {
    try {
      const req = await getRequisition(id);
      setForm({
        date: todayIso(),
        shift: req.shift as RequisitionShift,
        reason: req.reason as RequisitionReason,
        reasonNotes: req.reasonNotes ?? "",
        sectorId: req.sectorId ?? "",
        notes: req.notes ?? "",
      });
      setItems((req.items ?? [])
        .filter((i) => i.productId)
        .map((i) => ({
          productId: i.productId!,
          productName: i.productName,
          productCode: i.productCode,
          unit: i.unit ?? "UN",
          quantity: String(i.quantity),
          currentStock: stockMap.get(i.productId!) ?? null,
        }))
      );
      setConfirmedRequisition(null);
      setView("form");
    } catch {
      setNotice({ tone: "error", message: "Erro ao duplicar requisicao." });
    }
  }

  function handleProductSearchChange(value: string) {
    setProductSearch(value);
    setSearchOpen(value.trim().length > 0);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (!value.trim()) { setSearchResults([]); return; }
    searchDebounce.current = setTimeout(() => {
      getProducts({ search: value.trim(), isActive: "true" }).then((results) => {
        setSearchResults(results.filter((p) => p.controlsStock !== false));
      }).catch(() => {});
    }, 200);
  }

  function addProduct(product: Product) {
    const already = items.find((i) => i.productId === product.id);
    if (already) {
      setNotice({ tone: "warning", message: `${product.name} ja esta na lista.` });
      setProductSearch("");
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }
    const unit = product.stockUnit ?? product.unit ?? "UN";
    setItems((prev) => [
      ...prev,
      {
        productId: product.id,
        productName: product.name,
        productCode: product.externalCode ?? null,
        unit,
        quantity: "",
        currentStock: stockMap.get(product.id) ?? null
      }
    ]);
    setProductSearch("");
    setSearchResults([]);
    setSearchOpen(false);
    // Foco na quantidade do item recem adicionado
    setTimeout(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>(".req-qty-input");
      inputs[inputs.length - 1]?.focus();
    }, 50);
  }

  function removeItem(productId: string) {
    setItems((prev) => prev.filter((i) => i.productId !== productId));
  }

  function updateItemQty(productId: string, qty: string) {
    setItems((prev) => prev.map((i) => i.productId === productId ? { ...i, quantity: qty } : i));
  }

  function updateItemUnit(productId: string, unit: string) {
    setItems((prev) => prev.map((i) => i.productId === productId ? { ...i, unit } : i));
  }

  function resetForm() {
    setForm({ date: todayIso(), shift: "MORNING", reason: "DAILY_PRODUCTION", reasonNotes: "", sectorId: "", notes: "" });
    setItems([]);
    setConfirmedRequisition(null);
    setProductSearch("");
    setSearchResults([]);
    clientRequestIdRef.current = null;
  }

  async function handleSubmit() {
    const validItems = items.filter((i) => i.quantity && Number(i.quantity) > 0);
    if (validItems.length === 0) {
      setNotice({ tone: "error", message: "Adicione ao menos um item com quantidade valida." });
      return;
    }
    if (submitting) return;

    // Gera clientRequestId para idempotencia — reutiliza se ja existe (retry)
    if (!clientRequestIdRef.current) {
      clientRequestIdRef.current = crypto.randomUUID();
    }
    const clientRequestId = clientRequestIdRef.current;

    const payload: CreateRequisitionPayload = {
      clientRequestId,
      date: form.date,
      shift: form.shift,
      reason: form.reason,
      reasonNotes: form.reasonNotes || null,
      sectorId: form.sectorId || null,
      notes: form.notes || null,
      items: validItems.map((i) => ({ productId: i.productId, quantity: Number(i.quantity), unit: i.unit }))
    };

    setSubmitting(true);
    try {
      const created = await createRequisition(payload);
      clientRequestIdRef.current = null;
      setConfirmedRequisition(created);
      setNotice({ tone: "success", message: `${created.code} registrada com sucesso.` });

      // Atualiza stockMap localmente com novos saldos
      if (created.items) {
        const updates = new Map(stockMap);
        for (const item of created.items) {
          if (item.productId && item.stockAfter != null) {
            updates.set(item.productId, Number(item.stockAfter));
          }
        }
        setStockMap(updates);
      }

      // Insere no topo da lista local — sem reload completo
      const asListItem = {
        ...(created as InventoryRequisition),
        itemCount: created.items?.length ?? 0,
      };
      setRequisitions((prev) => [asListItem as InventoryRequisition, ...prev]);
    } catch (error) {
      const isAborted = error instanceof DOMException && error.name === "AbortError";
      if (isAborted) {
        // Timeout: verifica automaticamente se a requisicao foi salva
        setNotice({ tone: "warning", message: "Verificando se a requisicao foi registrada..." });
        try {
          const found = await getRequisitions({ clientRequestId });
          if (found.length > 0) {
            clientRequestIdRef.current = null;
            const created = found[0];
            setConfirmedRequisition(created);
            setRequisitions((prev) => [created, ...prev]);
            setNotice({ tone: "success", message: `${created.code} registrada com sucesso (verificado apos timeout).` });
          } else {
            setNotice({
              tone: "error",
              message: "Requisicao nao foi registrada. Clique em Registrar novamente para tentar de novo."
            });
          }
        } catch {
          setNotice({
            tone: "error",
            message: "Requisicao nao foi registrada. Clique em Registrar novamente para tentar de novo."
          });
        }
      } else {
        setNotice({
          tone: "error",
          message: error instanceof Error ? error.message : "Erro ao registrar a requisicao."
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  const hasInsufficient = items.some((i) => {
    const qty = Number(i.quantity);
    if (!qty || i.currentStock == null) return false;
    return qty > i.currentStock;
  });

  return (
    <div className="stack">
      <Notice notice={notice} />

      {/* Header */}
      <div className="section-heading">
        <div style={{ flex: 1 }}>
          <p>Estoque</p>
          <h2>Requisicoes de Insumos</h2>
          <span className="muted">Registre retiradas de produtos do estoque para uso na cozinha.</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button
          type="button"
          className={view === "form" ? "active" : ""}
          onClick={() => { setView("form"); }}
        >
          <Plus size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
          Nova requisicao
        </button>
        <button
          type="button"
          className={view === "list" ? "active" : ""}
          onClick={() => { setView("list"); if (view !== "list") loadRequisitions(); }}
        >
          <ClipboardList size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
          Historico{requisitions.length > 0 ? ` (${requisitions.length})` : ""}
        </button>
      </div>

      {/* ── FORMULARIO ─────────────────────────────────────────────────── */}
      {view === "form" && !confirmedRequisition && (
        <div className="form-section">

          {/* Dados da requisicao */}
          <div className="req-meta-section">
            <h4 className="req-section-title">Dados da requisicao</h4>
            <div className="req-meta-fields">
              <label className="req-field">
                <span>Data</span>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </label>
              <label className="req-field">
                <span>Turno</span>
                <select value={form.shift} onChange={(e) => setForm({ ...form, shift: e.target.value as RequisitionShift })}>
                  {(Object.keys(shiftLabels) as RequisitionShift[]).map((k) => (
                    <option key={k} value={k}>{shiftLabels[k]}</option>
                  ))}
                </select>
              </label>
              <label className="req-field">
                <span>Setor</span>
                <select value={form.sectorId} onChange={(e) => setForm({ ...form, sectorId: e.target.value })}>
                  <option value="">Todos os setores</option>
                  {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="req-field">
                <span>Motivo</span>
                <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value as RequisitionReason })}>
                  {(Object.keys(reasonLabels) as RequisitionReason[]).map((k) => (
                    <option key={k} value={k}>{reasonLabels[k]}</option>
                  ))}
                </select>
              </label>
              {form.reason === "OTHER" && (
                <label className="req-field req-field-wide">
                  <span>Especificar motivo</span>
                  <input
                    value={form.reasonNotes}
                    placeholder="Descreva o motivo"
                    onChange={(e) => setForm({ ...form, reasonNotes: e.target.value })}
                  />
                </label>
              )}
              <label className="req-field req-field-wide">
                <span>Observacoes</span>
                <input
                  value={form.notes}
                  placeholder="Opcional"
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </label>
            </div>
          </div>

          {/* Itens da requisicao */}
          <div className="req-items-section">
            <h4 className="req-section-title">
              Itens retirados
              {items.length > 0 && <span className="req-item-count">{items.length}</span>}
            </h4>

            {/* Busca de produto */}
            <div className="req-search-wrap">
              <div className="filter-input-wrap" style={{ flex: 1 }}>
                <Search size={14} />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Buscar produto pelo nome ou codigo..."
                  value={productSearch}
                  onChange={(e) => handleProductSearchChange(e.target.value)}
                  onFocus={() => productSearch.trim() && setSearchOpen(true)}
                  onBlur={() => setTimeout(() => setSearchOpen(false), 180)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && searchResults.length > 0) {
                      e.preventDefault();
                      addProduct(searchResults[0]);
                    }
                    if (e.key === "Escape") { setSearchOpen(false); setProductSearch(""); }
                  }}
                  autoComplete="off"
                />
              </div>
              {searchOpen && searchResults.length > 0 && (
                <div className="req-dropdown">
                  {searchResults.slice(0, 20).map((product) => {
                    const stock = stockMap.get(product.id);
                    return (
                      <button
                        key={product.id}
                        type="button"
                        className="req-dropdown-item"
                        onMouseDown={() => addProduct(product)}
                      >
                        <div>
                          <strong>{product.name}</strong>
                          {product.externalCode && <small style={{ color: "var(--muted)", marginLeft: 6 }}>{product.externalCode}</small>}
                          <small style={{ display: "block", color: "var(--muted)", fontSize: 11 }}>{product.stockUnit ?? product.unit ?? ""}</small>
                        </div>
                        {stock != null && (
                          <span className={`req-stock-badge ${stock <= 0 ? "danger" : stock < 5 ? "warning" : "ok"}`}>
                            {formatNumber(stock)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              {searchOpen && productSearch.trim() && searchResults.length === 0 && (
                <div className="req-dropdown" style={{ padding: "12px 16px", color: "var(--muted)", fontSize: 13 }}>
                  Nenhum produto encontrado para "{productSearch}"
                </div>
              )}
            </div>

            {/* Lista de itens */}
            {items.length > 0 ? (
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th className="numeric-cell">Saldo atual</th>
                      <th style={{ width: 130 }}>Quantidade</th>
                      <th style={{ width: 80 }}>Unidade</th>
                      <th style={{ width: 36 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => {
                      const qty = Number(item.quantity);
                      const isInsufficient = qty > 0 && item.currentStock != null && qty > item.currentStock;
                      return (
                        <tr key={item.productId} className={isInsufficient ? "req-row-danger" : undefined}>
                          <td>
                            <strong>{item.productName}</strong>
                            {item.productCode && <small style={{ display: "block", color: "var(--muted)" }}>{item.productCode}</small>}
                          </td>
                          <td className="numeric-cell" style={{ color: (item.currentStock ?? 0) <= 0 ? "var(--danger)" : undefined }}>
                            {item.currentStock != null ? formatNumber(item.currentStock) : "—"}
                          </td>
                          <td>
                            <input
                              className="req-qty-input"
                              type="number"
                              min="0.001"
                              step="0.001"
                              placeholder="0"
                              value={item.quantity}
                              onChange={(e) => updateItemQty(item.productId, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  // Vai para proxima quantidade ou busca
                                  const inputs = document.querySelectorAll<HTMLInputElement>(".req-qty-input");
                                  const next = inputs[idx + 1];
                                  if (next) next.focus();
                                  else searchInputRef.current?.focus();
                                }
                              }}
                              style={{ border: isInsufficient ? "1px solid var(--danger)" : undefined }}
                            />
                            {isInsufficient && (
                              <small style={{ color: "var(--danger)", fontSize: 11, display: "block" }}>Insuficiente</small>
                            )}
                          </td>
                          <td>
                            <input
                              type="text"
                              value={item.unit}
                              onChange={(e) => updateItemUnit(item.productId, e.target.value)}
                              style={{ width: "100%" }}
                            />
                          </td>
                          <td style={{ textAlign: "center" }}>
                            <button type="button" className="btn-icon-sm danger" onClick={() => removeItem(item.productId)} title="Remover">
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="req-items-empty">
                <Search size={20} style={{ color: "var(--muted)", marginBottom: 6 }} />
                <p>Busque um produto acima para adicionar</p>
              </div>
            )}

            {hasInsufficient && (
              <div className="req-alert-danger" style={{ marginTop: 10 }}>
                Alguns itens excedem o saldo disponivel. A requisicao sera recusada pelo servidor.
              </div>
            )}
          </div>

          {/* Acoes */}
          <div className="req-form-actions">
            <button
              className="primary-button"
              type="button"
              disabled={submitting || items.length === 0}
              onClick={handleSubmit}
            >
              {submitting ? "Registrando..." : "Registrar requisicao"}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={resetForm}
              disabled={submitting}
            >
              <X size={14} /> Limpar
            </button>
          </div>
        </div>
      )}

      {/* ── CONFIRMACAO ────────────────────────────────────────────────── */}
      {view === "form" && confirmedRequisition && (
        <div className="form-section">
          <div className="req-success-header">
            <CheckCircle2 size={28} className="req-success-icon" />
            <div>
              <strong style={{ fontSize: 17 }}>{confirmedRequisition.code} registrada</strong>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, marginTop: 2 }}>
                {shiftLabels[confirmedRequisition.shift as RequisitionShift] ?? confirmedRequisition.shift}
                {confirmedRequisition.sectorName ? ` — ${confirmedRequisition.sectorName}` : ""}
                {" — "}{reasonLabels[confirmedRequisition.reason as RequisitionReason] ?? confirmedRequisition.reason}
              </p>
            </div>
          </div>

          {confirmedRequisition.items && confirmedRequisition.items.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className="numeric-cell">Retirado</th>
                    <th>Un.</th>
                    <th className="numeric-cell">Antes</th>
                    <th className="numeric-cell">Apos</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmedRequisition.items.map((item: InventoryRequisitionItem) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.productName}</strong>
                        {item.productCode && <small style={{ display: "block", color: "var(--muted)" }}>{item.productCode}</small>}
                      </td>
                      <td className="numeric-cell">{formatNumber(Number(item.quantity))}</td>
                      <td>{item.unit ?? "—"}</td>
                      <td className="numeric-cell">{item.stockBefore != null ? formatNumber(Number(item.stockBefore)) : "—"}</td>
                      <td className="numeric-cell" style={{ color: Number(item.stockAfter ?? 0) <= 0 ? "var(--danger)" : "var(--success)" }}>
                        {item.stockAfter != null ? formatNumber(Number(item.stockAfter)) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button className="primary-button" type="button" onClick={resetForm}>
              <Plus size={14} /> Nova requisicao
            </button>
            <button className="secondary-button" type="button" onClick={() => { setView("list"); setConfirmedRequisition(null); }}>
              <ClipboardList size={14} /> Ver historico
            </button>
          </div>
        </div>
      )}

      {/* ── HISTORICO ──────────────────────────────────────────────────── */}
      {view === "list" && (
        <div className="form-section">
          <div className="section-heading compact-heading" style={{ marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <p>Estoque</p>
              <h3>Historico de requisicoes</h3>
              <span className="muted">Retiradas de insumos registradas do estoque.</span>
            </div>
            <button type="button" className="primary-button" onClick={() => setView("form")}>
              <Plus size={14} /> Nova requisicao
            </button>
          </div>

          {/* Tabela desktop */}
          {requisitions.length === 0 ? (
            <EmptyState
              title="Nenhuma requisicao registrada"
              description="As retiradas de insumos aparecero aqui apos serem registradas."
            />
          ) : (
            <>
            <div className="table-wrap req-history-table">
              <table>
                <thead>
                  <tr>
                    <th>Codigo</th>
                    <th>Data</th>
                    <th>Turno</th>
                    <th>Setor</th>
                    <th>Motivo</th>
                    <th className="numeric-cell">Itens</th>
                    <th>Registrado por</th>
                    <th>Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {requisitions.map((req) => (
                    <tr key={req.id}>
                      <td><strong>{req.code}</strong></td>
                      <td>{formatDate(req.date)}</td>
                      <td>
                        <StatusBadge tone={shiftTone(req.shift)}>
                          {shiftLabels[req.shift as RequisitionShift] ?? req.shift}
                        </StatusBadge>
                      </td>
                      <td>{req.sectorName ?? "—"}</td>
                      <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {reasonLabels[req.reason as RequisitionReason] ?? req.reason}
                      </td>
                      <td className="numeric-cell">{req.itemCount ?? "—"}</td>
                      <td>{req.requestedByName ?? "—"}</td>
                      <td className="actions-cell">
                        <button type="button" className="secondary-button" onClick={() => setDetailId(req.id)}>
                          <Eye size={13} /> Ver
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          title="Duplicar esta requisicao"
                          onClick={() => void duplicateRequisition(req.id)}
                        >
                          <Copy size={13} /> Duplicar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          {/* Cards mobile */}
          <div className="mobile-cards">
            {requisitions.map((req) => (
              <div key={req.id} className="mobile-card">
                <div className="mobile-card-header">
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: "0.85rem" }}>{req.code}</strong>
                    <span style={{ display: "block", fontSize: "0.78rem", color: "var(--muted)", marginTop: 2 }}>
                      {formatDate(req.date)}
                    </span>
                  </div>
                  <StatusBadge tone={shiftTone(req.shift)}>
                    {shiftLabels[req.shift as RequisitionShift] ?? req.shift}
                  </StatusBadge>
                </div>
                <div className="mobile-card-body">
                  <div className="mobile-card-row">
                    <span>Setor</span>
                    <strong>{req.sectorName ?? "—"}</strong>
                  </div>
                  <div className="mobile-card-row">
                    <span>Motivo</span>
                    <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "55%" }}>
                      {reasonLabels[req.reason as RequisitionReason] ?? req.reason}
                    </strong>
                  </div>
                  <div className="mobile-card-row">
                    <span>Itens</span>
                    <strong>{req.itemCount ?? "—"}</strong>
                  </div>
                  {req.requestedByName && (
                    <div className="mobile-card-row">
                      <span>Por</span>
                      <strong>{req.requestedByName}</strong>
                    </div>
                  )}
                </div>
                <div className="mobile-card-actions">
                  <button type="button" className="secondary-button" onClick={() => setDetailId(req.id)}>
                    <Eye size={13} /> Ver
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void duplicateRequisition(req.id)}
                  >
                    <Copy size={13} /> Duplicar
                  </button>
                </div>
              </div>
            ))}
          </div>
          </>
          )}
        </div>
      )}

      {/* ── MODAL DE DETALHE ───────────────────────────────────────────── */}
      {detailId && (
        <div className="modal-backdrop" onClick={() => setDetailId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 700 }}>
            <div className="modal-header">
              <div>
                <p className="muted" style={{ margin: 0, fontSize: 12 }}>Detalhes da requisicao</p>
                <strong>{detail?.code ?? "Carregando..."}</strong>
              </div>
              <button type="button" onClick={() => setDetailId(null)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              {loadingDetail && <p className="muted">Carregando...</p>}
              {detail && !loadingDetail && (
                <>
                  <div className="req-detail-meta">
                    <div><small className="muted">Data</small><p>{formatDate(detail.date)}</p></div>
                    <div>
                      <small className="muted">Turno</small>
                      <p><StatusBadge tone={shiftTone(detail.shift)}>{shiftLabels[detail.shift as RequisitionShift] ?? detail.shift}</StatusBadge></p>
                    </div>
                    <div><small className="muted">Setor</small><p>{detail.sectorName ?? "—"}</p></div>
                    <div>
                      <small className="muted">Motivo</small>
                      <p>{reasonLabels[detail.reason as RequisitionReason] ?? detail.reason}{detail.reasonNotes ? `: ${detail.reasonNotes}` : ""}</p>
                    </div>
                    <div><small className="muted">Registrado por</small><p>{detail.requestedByName ?? "—"}</p></div>
                  </div>
                  {detail.notes && <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }}>{detail.notes}</p>}
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Produto</th>
                          <th className="numeric-cell">Qtd</th>
                          <th>Un.</th>
                          <th className="numeric-cell">Antes</th>
                          <th className="numeric-cell">Apos</th>
                          <th className="numeric-cell">Atual</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail.items ?? []).map((item: InventoryRequisitionItem) => (
                          <tr key={item.id}>
                            <td>
                              <strong>{item.productName}</strong>
                              {item.productCode && <small style={{ display: "block", color: "var(--muted)" }}>{item.productCode}</small>}
                            </td>
                            <td className="numeric-cell">{formatNumber(Number(item.quantity))}</td>
                            <td>{item.unit ?? "—"}</td>
                            <td className="numeric-cell">{item.stockBefore != null ? formatNumber(Number(item.stockBefore)) : "—"}</td>
                            <td className="numeric-cell">{item.stockAfter != null ? formatNumber(Number(item.stockAfter)) : "—"}</td>
                            <td className="numeric-cell" style={{ color: Number(item.currentStock ?? 0) <= 0 ? "var(--danger)" : undefined }}>
                              {item.currentStock != null ? formatNumber(Number(item.currentStock)) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
