import { CheckCircle2, Copy, Eye, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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

  useEffect(() => {
    getSectors().then(setSectors).catch(() => {});
    getInventoryStocks().then((stocks: InventoryStock[]) => {
      setStockMap(new Map(stocks.map((s) => [s.productId, Number(s.currentQuantity)])));
    }).catch(() => {});
    loadRequisitions();
  }, []);

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
    }, 280);
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
  }

  async function handleSubmit() {
    const validItems = items.filter((i) => i.quantity && Number(i.quantity) > 0);
    if (validItems.length === 0) {
      setNotice({ tone: "error", message: "Adicione ao menos um item com quantidade valida." });
      return;
    }

    const payload: CreateRequisitionPayload = {
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
      setConfirmedRequisition(created);
      setNotice({ tone: "success", message: `${created.code} registrada com sucesso.` });
      // Atualiza stockMap com novos saldos
      if (created.items) {
        const updates = new Map(stockMap);
        for (const item of created.items) {
          if (item.productId && item.stockAfter != null) {
            updates.set(item.productId, Number(item.stockAfter));
          }
        }
        setStockMap(updates);
      }
      loadRequisitions();
    } catch (error) {
      const isAborted = error instanceof DOMException && error.name === "AbortError";
      setNotice({
        tone: "error",
        message: isAborted
          ? "O servidor demorou para responder. A requisicao pode ter sido registrada — verifique no historico antes de tentar novamente."
          : error instanceof Error ? error.message : "Erro ao registrar a requisicao."
      });
    } finally {
      setSubmitting(false);
    }
  }

  const hasInsufficient = items.some((i) => {
    const qty = Number(i.quantity);
    if (!qty || i.currentStock == null) return false;
    return qty > i.currentStock;
  });

  const selectedSector = useMemo(() => sectors.find((s) => s.id === form.sectorId), [sectors, form.sectorId]);

  return (
    <div className="stack">
      <Notice notice={notice} />

      <div className="tab-row">
        <button type="button" className={view === "form" ? "active" : ""} onClick={() => setView("form")}>Nova requisicao</button>
        <button type="button" className={view === "list" ? "active" : ""} onClick={() => setView("list")}>Historico</button>
      </div>

      {view === "form" && !confirmedRequisition && (
        <div className="form-section">
          <div className="section-heading compact-heading">
            <div>
              <p>Insumos</p>
              <h3>Nova requisicao de insumos</h3>
              <span className="muted">Registre a retirada de produtos do estoque para uso na cozinha.</span>
            </div>
          </div>

          <div className="filters-row">
            <label>
              Data
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </label>
            <label>
              Turno
              <select value={form.shift} onChange={(e) => setForm({ ...form, shift: e.target.value as RequisitionShift })}>
                {(Object.keys(shiftLabels) as RequisitionShift[]).map((k) => (
                  <option key={k} value={k}>{shiftLabels[k]}</option>
                ))}
              </select>
            </label>
            <label>
              Setor de origem
              <select value={form.sectorId} onChange={(e) => setForm({ ...form, sectorId: e.target.value })}>
                <option value="">Todos os setores</option>
                {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label>
              Motivo
              <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value as RequisitionReason })}>
                {(Object.keys(reasonLabels) as RequisitionReason[]).map((k) => (
                  <option key={k} value={k}>{reasonLabels[k]}</option>
                ))}
              </select>
            </label>
            {form.reason === "OTHER" && (
              <label className="span-2">
                Especificar motivo
                <input
                  value={form.reasonNotes}
                  placeholder="Descreva o motivo"
                  onChange={(e) => setForm({ ...form, reasonNotes: e.target.value })}
                />
              </label>
            )}
            <label className="span-2">
              Observacoes
              <input
                value={form.notes}
                placeholder="Opcional"
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>
          </div>

          <div className="subsection" style={{ marginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <h4 style={{ margin: 0 }}>Itens da requisicao</h4>
            </div>

            <div style={{ position: "relative", marginBottom: 12 }}>
              <div className="filters-row" style={{ gap: 8 }}>
                <label style={{ flex: 1 }}>
                  <Search size={14} style={{ verticalAlign: "middle", marginRight: 4, color: "var(--muted)" }} />
                  Buscar produto
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Digite o nome do produto..."
                    value={productSearch}
                    onChange={(e) => handleProductSearchChange(e.target.value)}
                    onFocus={() => productSearch.trim() && setSearchOpen(true)}
                    onBlur={() => setTimeout(() => setSearchOpen(false), 180)}
                    autoComplete="off"
                  />
                </label>
              </div>
              {searchOpen && searchResults.length > 0 && (
                <div className="dropdown-results" style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: "#fff", border: "1px solid var(--line)", borderRadius: 8, boxShadow: "var(--shadow)", maxHeight: 280, overflowY: "auto" }}>
                  {searchResults.slice(0, 20).map((product) => {
                    const stock = stockMap.get(product.id);
                    return (
                      <button
                        key={product.id}
                        type="button"
                        style={{ display: "flex", width: "100%", textAlign: "left", padding: "10px 14px", background: "none", border: "none", borderBottom: "1px solid var(--line)", cursor: "pointer", justifyContent: "space-between", alignItems: "center", gap: 12 }}
                        onMouseDown={() => addProduct(product)}
                      >
                        <div>
                          <strong style={{ display: "block", fontSize: 13 }}>{product.name}</strong>
                          <small style={{ color: "var(--muted)" }}>{product.externalCode ?? ""} {product.stockUnit ?? product.unit ?? ""}</small>
                        </div>
                        {stock != null && (
                          <span style={{ fontSize: 12, color: stock <= 0 ? "var(--danger)" : "var(--success)", whiteSpace: "nowrap" }}>
                            {formatNumber(stock)} em estoque
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              {searchOpen && productSearch.trim() && searchResults.length === 0 && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: "#fff", border: "1px solid var(--line)", borderRadius: 8, padding: "12px 16px", color: "var(--muted)", fontSize: 13 }}>
                  Nenhum produto encontrado para "{productSearch}"
                </div>
              )}
            </div>

            {items.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th className="numeric-cell">Saldo atual</th>
                      <th style={{ width: 120 }}>Quantidade</th>
                      <th style={{ width: 80 }}>Unidade</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const qty = Number(item.quantity);
                      const isInsufficient = qty > 0 && item.currentStock != null && qty > item.currentStock;
                      return (
                        <tr key={item.productId}>
                          <td>
                            <strong>{item.productName}</strong>
                            {item.productCode && <small>{item.productCode}</small>}
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
                              style={{ border: isInsufficient ? "1px solid var(--danger)" : undefined, width: "100%" }}
                            />
                            {isInsufficient && (
                              <small style={{ color: "var(--danger)", fontSize: 11 }}>Insuficiente</small>
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
                          <td className="actions-cell">
                            <button type="button" onClick={() => removeItem(item.productId)} title="Remover">
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="Nenhum item adicionado" description="Busque produtos acima para adicionar a requisicao." />
            )}

            {hasInsufficient && (
              <div className="cash-alert-card" style={{ marginTop: 10, padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>
                Alguns itens excedem o saldo disponivel. O servidor ira recusar a requisicao se houver saldo insuficiente.
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button
              className="primary-button"
              type="button"
              disabled={submitting || items.length === 0}
              onClick={handleSubmit}
            >
              {submitting ? "Confirmando..." : "Confirmar requisicao"}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={resetForm}
              disabled={submitting}
            >
              <X size={15} />
              Limpar
            </button>
          </div>
        </div>
      )}

      {view === "form" && confirmedRequisition && (
        <div className="form-section">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <CheckCircle2 size={22} style={{ color: "var(--success)" }} />
            <div>
              <strong style={{ fontSize: 16 }}>{confirmedRequisition.code} registrada</strong>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                {shiftLabels[confirmedRequisition.shift as RequisitionShift] ?? confirmedRequisition.shift}
                {confirmedRequisition.sectorName ? ` — ${confirmedRequisition.sectorName}` : ""}
                {" — "}{reasonLabels[confirmedRequisition.reason as RequisitionReason] ?? confirmedRequisition.reason}
              </p>
            </div>
          </div>

          {confirmedRequisition.items && confirmedRequisition.items.length > 0 && (
            <div className="table-wrap subsection">
              <table>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className="numeric-cell">Qtd retirada</th>
                    <th>Unidade</th>
                    <th className="numeric-cell">Saldo antes</th>
                    <th className="numeric-cell">Saldo apos</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmedRequisition.items.map((item: InventoryRequisitionItem) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.productName}</strong>
                        {item.productCode && <small>{item.productCode}</small>}
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
              <Plus size={15} />
              Nova requisicao
            </button>
            <button className="secondary-button" type="button" onClick={() => { setView("list"); setConfirmedRequisition(null); }}>
              Ver historico
            </button>
          </div>
        </div>
      )}

      {view === "list" && (
        <div className="form-section">
          <div className="section-heading compact-heading">
            <div>
              <p>Insumos</p>
              <h3>Historico de requisicoes</h3>
              <span className="muted">Retiradas de insumos registradas do estoque.</span>
            </div>
          </div>

          {/* Tabela desktop */}
          <div className="table-wrap" style={{ marginTop: 12 }}>
            {requisitions.length === 0 ? (
              <EmptyState title="Nenhuma requisicao encontrada" description="As retiradas de insumos aparecero aqui apos serem registradas." />
            ) : (
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
                      <td><StatusBadge tone={shiftTone(req.shift)}>{shiftLabels[req.shift as RequisitionShift] ?? req.shift}</StatusBadge></td>
                      <td>{req.sectorName ?? "—"}</td>
                      <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{reasonLabels[req.reason as RequisitionReason] ?? req.reason}</td>
                      <td className="numeric-cell">{req.itemCount ?? "—"}</td>
                      <td>{req.requestedByName ?? "—"}</td>
                      <td className="actions-cell">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => { setDetailId(req.id); }}
                        >
                          <Eye size={14} />
                          Ver
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          title="Duplicar esta requisicao"
                          onClick={() => void duplicateRequisition(req.id)}
                        >
                          <Copy size={14} />
                          Duplicar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Cards mobile */}
          <div className="mobile-cards" style={{ marginTop: 8 }}>
            {requisitions.length === 0 && (
              <EmptyState title="Nenhuma requisicao encontrada" description="As retiradas de insumos aparecero aqui apos serem registradas." />
            )}
            {requisitions.map((req) => (
              <div key={req.id} className="mobile-card">
                <div className="mobile-card-header">
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: "0.85rem" }}>{req.code}</strong>
                    <span style={{ display: "block", fontSize: "0.78rem", color: "var(--muted)", marginTop: 2 }}>{formatDate(req.date)}</span>
                  </div>
                  <StatusBadge tone={shiftTone(req.shift)}>{shiftLabels[req.shift as RequisitionShift] ?? req.shift}</StatusBadge>
                </div>
                <div className="mobile-card-body">
                  <div className="mobile-card-row">
                    <span>Setor</span>
                    <strong>{req.sectorName ?? "—"}</strong>
                  </div>
                  <div className="mobile-card-row">
                    <span>Motivo</span>
                    <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "55%" }}>{reasonLabels[req.reason as RequisitionReason] ?? req.reason}</strong>
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
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => { setDetailId(req.id); }}
                  >
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
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {detailId && (
        <div className="modal-backdrop" onClick={() => setDetailId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680 }}>
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
                  <div className="filters-row" style={{ gap: 16, marginBottom: 16 }}>
                    <div>
                      <small className="muted">Data</small>
                      <p style={{ margin: 0 }}>{formatDate(detail.date)}</p>
                    </div>
                    <div>
                      <small className="muted">Turno</small>
                      <p style={{ margin: 0 }}>{shiftLabels[detail.shift as RequisitionShift] ?? detail.shift}</p>
                    </div>
                    <div>
                      <small className="muted">Setor</small>
                      <p style={{ margin: 0 }}>{detail.sectorName ?? "—"}</p>
                    </div>
                    <div>
                      <small className="muted">Motivo</small>
                      <p style={{ margin: 0 }}>{reasonLabels[detail.reason as RequisitionReason] ?? detail.reason}{detail.reasonNotes ? `: ${detail.reasonNotes}` : ""}</p>
                    </div>
                    <div>
                      <small className="muted">Registrado por</small>
                      <p style={{ margin: 0 }}>{detail.requestedByName ?? "—"}</p>
                    </div>
                  </div>
                  {detail.notes && <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>{detail.notes}</p>}
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Produto</th>
                          <th className="numeric-cell">Qtd</th>
                          <th>Unidade</th>
                          <th className="numeric-cell">Saldo antes</th>
                          <th className="numeric-cell">Saldo apos</th>
                          <th className="numeric-cell">Saldo atual</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail.items ?? []).map((item: InventoryRequisitionItem) => (
                          <tr key={item.id}>
                            <td>
                              <strong>{item.productName}</strong>
                              {item.productCode && <small>{item.productCode}</small>}
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
