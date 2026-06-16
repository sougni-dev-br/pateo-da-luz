import { ChefHat, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  deactivateDish,
  getDishCategories,
  getDishDetail,
  getDishes,
  saveDish,
  saveDishCategory,
  searchDishProducts,
  type DishCategory,
  type DishDetail,
  type DishIngredient,
  type DishListItem,
  type DishProductSearchResult,
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { useSession } from "../context/SessionContext";
import { formatCurrency } from "../utils/format";

type FormItem = {
  tempId: string;
  productId: string;
  productName: string;
  productUnit: string | null;
  quantity: string;
  unit: string;
  wasteFactor: string;
  unitCost: number;
  notes: string;
};

type Mode = "list" | "categories";

// ──────────────────────────────────────────────
// CMV badge helper
// ──────────────────────────────────────────────

function cmvBadge(cmv: number | null) {
  if (cmv == null) return null;
  const cls = cmv > 40 ? "badge-error" : cmv > 32 ? "badge-warning" : "badge-success";
  return <span className={`badge ${cls}`}>{cmv.toFixed(1)}%</span>;
}

// ──────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────

export function Dishes() {
  const { user } = useSession();
  const canEdit = user?.role === "ADMIN" || user?.role === "GESTAO_COMPLETA";

  const [mode, setMode] = useState<Mode>("list");
  const [dishes, setDishes] = useState<DishListItem[]>([]);
  const [categories, setCategories] = useState<DishCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [selected, setSelected] = useState<DishDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const { notice, setNotice } = useNotice();

  async function load() {
    setLoading(true);
    try {
      const [dishList, catList] = await Promise.all([
        getDishes({ search, categoryId: filterCategory || undefined, showInactive }),
        getDishCategories()
      ]);
      setDishes(dishList);
      setCategories(catList);
    } catch {
      setNotice({ tone: "error", message: "Erro ao carregar fichas técnicas." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [search, filterCategory, showInactive]);

  async function openDetail(id: string) {
    try {
      const detail = await getDishDetail(id);
      setSelected(detail);
      setEditing(false);
    } catch {
      setNotice({ tone: "error", message: "Erro ao carregar prato." });
    }
  }

  async function handleDeactivate(id: string) {
    if (!window.confirm("Inativar este prato?")) return;
    try {
      await deactivateDish(id);
      await load();
      if (selected?.id === id) setSelected(null);
      setNotice({ tone: "success", message: "Prato inativado." });
    } catch {
      setNotice({ tone: "error", message: "Erro ao inativar prato." });
    }
  }

  return (
    <div className="stack">
      <Notice notice={notice} />

      <div className="tabs-row">
        <button className={mode === "list" ? "active" : ""} type="button" onClick={() => setMode("list")}>
          Fichas técnicas
        </button>
        <button className={mode === "categories" ? "active" : ""} type="button" onClick={() => setMode("categories")}>
          Categorias de pratos
        </button>
      </div>

      {mode === "categories" && (
        <CategoriesPanel categories={categories} canEdit={canEdit} onSaved={load} notify={(t, m) => setNotice({ tone: t, message: m })} />
      )}

      {mode === "list" && (
        <>
          <div className="filter-row">
            <div className="search-wrap">
              <Search size={15} />
              <input
                placeholder="Buscar prato..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
              <option value="">Todas as categorias</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <label className="checkbox-label">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Mostrar inativos
            </label>
            <button type="button" className="btn-icon" onClick={load} title="Atualizar">
              <RefreshCw size={15} />
            </button>
            {canEdit && (
              <button type="button" className="btn-primary" onClick={() => { setSelected(null); setEditing(true); }}>
                <Plus size={15} /> Novo prato
              </button>
            )}
          </div>

          {loading ? (
            <p className="text-muted">Carregando...</p>
          ) : dishes.length === 0 ? (
            <div className="empty-state">
              <ChefHat size={32} />
              <p>Nenhum prato encontrado.</p>
              {canEdit && (
                <button type="button" className="btn-primary" onClick={() => setEditing(true)}>
                  <Plus size={15} /> Cadastrar primeiro prato
                </button>
              )}
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Prato</th>
                    <th>Categoria</th>
                    <th className="text-right">Custo</th>
                    <th className="text-right">Venda</th>
                    <th className="text-right">Margem</th>
                    <th className="text-center">CMV%</th>
                    <th className="text-center">Itens</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {dishes.map((dish) => (
                    <tr
                      key={dish.id}
                      className={`clickable-row ${!dish.isActive ? "row-inactive" : ""}`}
                      onClick={() => openDetail(dish.id)}
                    >
                      <td className="text-muted">{dish.code ?? "—"}</td>
                      <td><strong>{dish.name}</strong></td>
                      <td>{dish.category?.name ?? "—"}</td>
                      <td className="text-right">{formatCurrency(dish.calculatedCost)}</td>
                      <td className="text-right">{dish.salePriceDefault != null ? formatCurrency(dish.salePriceDefault) : "—"}</td>
                      <td className="text-right">{dish.margemBruta != null ? formatCurrency(dish.margemBruta) : "—"}</td>
                      <td className="text-center">{cmvBadge(dish.cmvPercentual)}</td>
                      <td className="text-center">{dish.itemsCount}</td>
                      <td className="actions-cell" onClick={(e) => e.stopPropagation()}>
                        {canEdit && dish.isActive && (
                          <button type="button" className="btn-icon-sm btn-danger" title="Inativar" onClick={() => handleDeactivate(dish.id)}>
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selected && !editing && (
            <DishDetailPanel
              dish={selected}
              canEdit={canEdit}
              onEdit={() => setEditing(true)}
              onClose={() => setSelected(null)}
              onDeactivate={handleDeactivate}
            />
          )}

          {editing && (
            <DishFormPanel
              initial={selected}
              categories={categories}
              onClose={() => { setEditing(false); }}
              onSaved={async (id) => {
                setEditing(false);
                await load();
                await openDetail(id);
                setNotice({ tone: "success", message: selected ? "Prato atualizado." : "Prato criado." });
              }}
              notify={(t, m) => setNotice({ tone: t, message: m })}
            />
          )}
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// Detail panel
// ──────────────────────────────────────────────

function DishDetailPanel({
  dish, canEdit, onEdit, onClose, onDeactivate
}: {
  dish: DishDetail;
  canEdit: boolean;
  onEdit: () => void;
  onClose: () => void;
  onDeactivate: (id: string) => void;
}) {
  return (
    <div className="detail-panel">
      <div className="detail-panel-header">
        <div>
          <strong>{dish.name}</strong>
          {dish.code && <span className="text-muted"> · {dish.code}</span>}
          {dish.category && <span className="badge badge-neutral" style={{ marginLeft: 8 }}>{dish.category.name}</span>}
          {!dish.isActive && <span className="badge badge-error" style={{ marginLeft: 8 }}>Inativo</span>}
        </div>
        <div className="detail-panel-actions">
          {canEdit && dish.isActive && (
            <>
              <button type="button" className="btn-secondary" onClick={onEdit}>Editar</button>
              <button type="button" className="btn-danger-outline" onClick={() => onDeactivate(dish.id)}>Inativar</button>
            </>
          )}
          <button type="button" className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
      </div>

      <div className="kpi-row" style={{ marginBottom: 16 }}>
        <div className="kpi-card">
          <span>Custo calculado</span>
          <strong>{formatCurrency(dish.calculatedCost)}</strong>
        </div>
        <div className="kpi-card">
          <span>Preço de venda</span>
          <strong>{dish.salePriceDefault != null ? formatCurrency(dish.salePriceDefault) : "—"}</strong>
        </div>
        <div className="kpi-card">
          <span>Margem bruta</span>
          <strong>{dish.margemBruta != null ? formatCurrency(dish.margemBruta) : "—"}</strong>
        </div>
        <div className="kpi-card">
          <span>CMV%</span>
          <strong>{dish.cmvPercentual != null ? `${dish.cmvPercentual.toFixed(1)}%` : "—"}</strong>
        </div>
      </div>

      {dish.notes && <p className="text-muted" style={{ marginBottom: 12 }}>{dish.notes}</p>}

      <table className="data-table">
        <thead>
          <tr>
            <th>Ingrediente</th>
            <th className="text-right">Qtd.</th>
            <th>Un.</th>
            <th className="text-right">Perda%</th>
            <th className="text-right">Custo unit.</th>
            <th className="text-right">Custo item</th>
            <th className="text-right">% do total</th>
          </tr>
        </thead>
        <tbody>
          {dish.items.map((item) => (
            <tr key={item.id}>
              <td>
                <div>{item.productName}</div>
                {item.productCode && <div className="text-muted" style={{ fontSize: "0.8em" }}>{item.productCode}</div>}
              </td>
              <td className="text-right">{item.quantity}</td>
              <td>{item.unit}</td>
              <td className="text-right">{item.wasteFactor > 0 ? `${(item.wasteFactor * 100).toFixed(1)}%` : "—"}</td>
              <td className="text-right">{formatCurrency(item.unitCost)}</td>
              <td className="text-right">{formatCurrency(item.itemCost)}</td>
              <td className="text-right">
                {dish.calculatedCost > 0 ? `${((item.itemCost / dish.calculatedCost) * 100).toFixed(1)}%` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5}><strong>Total</strong></td>
            <td className="text-right"><strong>{formatCurrency(dish.calculatedCost)}</strong></td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ──────────────────────────────────────────────
// Form panel
// ──────────────────────────────────────────────

const emptyForm = {
  id: "",
  code: "",
  name: "",
  categoryId: "",
  salePriceDefault: "",
  yieldQty: "1",
  yieldUnit: "UN",
  notes: ""
};

function DishFormPanel({
  initial, categories, onClose, onSaved, notify
}: {
  initial: DishDetail | null;
  categories: DishCategory[];
  onClose: () => void;
  onSaved: (id: string) => void;
  notify: (tone: "success" | "error", message: string) => void;
}) {
  const [form, setForm] = useState(() => initial
    ? {
        id: initial.id,
        code: initial.code ?? "",
        name: initial.name,
        categoryId: initial.category?.id ?? "",
        salePriceDefault: initial.salePriceDefault != null ? String(initial.salePriceDefault) : "",
        yieldQty: String(initial.yieldQty),
        yieldUnit: initial.yieldUnit,
        notes: initial.notes ?? ""
      }
    : emptyForm
  );

  const [items, setItems] = useState<FormItem[]>(() =>
    initial?.items.map((i) => ({
      tempId: i.id,
      productId: i.productId,
      productName: i.productName,
      productUnit: i.productUnit,
      quantity: String(i.quantity),
      unit: i.unit,
      wasteFactor: String(i.wasteFactor * 100),
      unitCost: i.unitCost,
      notes: i.notes ?? ""
    })) ?? []
  );

  const [productSearch, setProductSearch] = useState("");
  const [productResults, setProductResults] = useState<DishProductSearchResult[]>([]);
  const [searchTimeout, setSearchTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [saving, setSaving] = useState(false);

  function setField(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleProductSearch(value: string) {
    setProductSearch(value);
    if (searchTimeout) clearTimeout(searchTimeout);
    if (!value.trim()) { setProductResults([]); return; }
    const t = setTimeout(async () => {
      try {
        setProductResults(await searchDishProducts(value));
      } catch {
        setProductResults([]);
      }
    }, 300);
    setSearchTimeout(t);
  }

  function addProduct(product: DishProductSearchResult) {
    setItems((prev) => [...prev, {
      tempId: `new-${Date.now()}`,
      productId: product.id,
      productName: product.name,
      productUnit: product.unit,
      quantity: "1",
      unit: product.unit ?? "UN",
      wasteFactor: "0",
      unitCost: product.averageCost,
      notes: ""
    }]);
    setProductSearch("");
    setProductResults([]);
  }

  function removeItem(tempId: string) {
    setItems((prev) => prev.filter((i) => i.tempId !== tempId));
  }

  function updateItem(tempId: string, key: keyof FormItem, value: string) {
    setItems((prev) => prev.map((i) => i.tempId === tempId ? { ...i, [key]: value } : i));
  }

  const previewCost = items.reduce((sum, item) => {
    const qty = Number(item.quantity) || 0;
    const waste = (Number(item.wasteFactor) || 0) / 100;
    return sum + qty * (1 + waste) * item.unitCost;
  }, 0);

  const salePrice = Number(form.salePriceDefault) || null;
  const previewMargem = salePrice != null ? salePrice - previewCost : null;
  const previewCmv = salePrice != null && salePrice > 0 ? (previewCost / salePrice) * 100 : null;

  async function handleSubmit() {
    if (!form.name.trim()) { notify("error", "Nome do prato é obrigatório."); return; }
    setSaving(true);
    try {
      const result = await saveDish({
        ...form,
        salePriceDefault: form.salePriceDefault !== "" ? Number(form.salePriceDefault) : null,
        yieldQty: Number(form.yieldQty) || 1,
        items: items.map((i, idx) => ({
          productId: i.productId,
          quantity: Number(i.quantity),
          unit: i.unit,
          wasteFactor: (Number(i.wasteFactor) || 0) / 100,
          notes: i.notes || null,
          sortOrder: idx
        }))
      });
      onSaved(result.id);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Erro ao salvar prato.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="form-panel">
      <div className="form-panel-header">
        <strong>{form.id ? "Editar prato" : "Novo prato"}</strong>
        <button type="button" className="btn-icon" onClick={onClose}><X size={16} /></button>
      </div>

      <div className="form-grid">
        <div className="form-group">
          <label>Nome do prato *</label>
          <input value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="Ex: Risoto de Camarão" />
        </div>
        <div className="form-group">
          <label>Código</label>
          <input value={form.code} onChange={(e) => setField("code", e.target.value)} placeholder="Ex: PRAT-001" />
        </div>
        <div className="form-group">
          <label>Categoria</label>
          <select value={form.categoryId} onChange={(e) => setField("categoryId", e.target.value)}>
            <option value="">Sem categoria</option>
            {categories.filter((c) => c.isActive).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Preço de venda (R$)</label>
          <input type="number" step="0.01" min="0" value={form.salePriceDefault} onChange={(e) => setField("salePriceDefault", e.target.value)} placeholder="0,00" />
        </div>
        <div className="form-group">
          <label>Rendimento</label>
          <input type="number" step="0.001" min="0.001" value={form.yieldQty} onChange={(e) => setField("yieldQty", e.target.value)} />
        </div>
        <div className="form-group">
          <label>Unidade de rendimento</label>
          <input value={form.yieldUnit} onChange={(e) => setField("yieldUnit", e.target.value)} placeholder="UN" />
        </div>
        <div className="form-group form-group-full">
          <label>Observações</label>
          <textarea value={form.notes} onChange={(e) => setField("notes", e.target.value)} rows={2} />
        </div>
      </div>

      {/* Preview */}
      <div className="kpi-row" style={{ margin: "12px 0" }}>
        <div className="kpi-card">
          <span>Custo calculado</span>
          <strong>{formatCurrency(previewCost)}</strong>
        </div>
        <div className="kpi-card">
          <span>Margem bruta</span>
          <strong>{previewMargem != null ? formatCurrency(previewMargem) : "—"}</strong>
        </div>
        <div className="kpi-card">
          <span>CMV%</span>
          <strong>{previewCmv != null ? `${previewCmv.toFixed(1)}%` : "—"}</strong>
        </div>
      </div>

      {/* Ingredients */}
      <div className="section-title" style={{ marginBottom: 8 }}>Ingredientes</div>

      <div style={{ marginBottom: 10 }}>
        <div className="search-wrap">
          <Search size={14} />
          <input
            placeholder="Buscar produto para adicionar..."
            value={productSearch}
            onChange={(e) => handleProductSearch(e.target.value)}
          />
        </div>
        {productResults.length > 0 && (
          <div className="dropdown-list">
            {productResults.map((p) => (
              <button key={p.id} type="button" className="dropdown-item" onClick={() => addProduct(p)}>
                <span>{p.name}</span>
                <span className="text-muted">{p.externalCode} · {p.unit} · custo: {formatCurrency(p.averageCost)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {items.length > 0 && (
        <table className="data-table" style={{ marginBottom: 12 }}>
          <thead>
            <tr>
              <th>Ingrediente</th>
              <th>Qtd.</th>
              <th>Un.</th>
              <th>Perda%</th>
              <th className="text-right">Custo unit.</th>
              <th className="text-right">Custo item</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const qty = Number(item.quantity) || 0;
              const waste = (Number(item.wasteFactor) || 0) / 100;
              const itemCost = qty * (1 + waste) * item.unitCost;
              return (
                <tr key={item.tempId}>
                  <td>{item.productName}</td>
                  <td>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={item.quantity}
                      onChange={(e) => updateItem(item.tempId, "quantity", e.target.value)}
                      style={{ width: 70 }}
                    />
                  </td>
                  <td>
                    <input
                      value={item.unit}
                      onChange={(e) => updateItem(item.tempId, "unit", e.target.value)}
                      style={{ width: 60 }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      value={item.wasteFactor}
                      onChange={(e) => updateItem(item.tempId, "wasteFactor", e.target.value)}
                      style={{ width: 60 }}
                    />
                  </td>
                  <td className="text-right">{formatCurrency(item.unitCost)}</td>
                  <td className="text-right">{formatCurrency(itemCost)}</td>
                  <td>
                    <button type="button" className="btn-icon-sm btn-danger" onClick={() => removeItem(item.tempId)}>
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="form-actions">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn-primary" disabled={saving} onClick={handleSubmit}>
          {saving ? "Salvando..." : form.id ? "Salvar alterações" : "Criar prato"}
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Categories panel
// ──────────────────────────────────────────────

const emptyCategory = { id: "", name: "", sortOrder: 0, notes: "" };

function CategoriesPanel({
  categories, canEdit, onSaved, notify
}: {
  categories: DishCategory[];
  canEdit: boolean;
  onSaved: () => void;
  notify: (tone: "success" | "error", message: string) => void;
}) {
  const [form, setForm] = useState(emptyCategory);

  function setField(key: keyof typeof form, value: string | number) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    if (!form.name.trim()) return;
    try {
      await saveDishCategory(form);
      setForm(emptyCategory);
      onSaved();
      notify("success", form.id ? "Categoria atualizada." : "Categoria criada.");
    } catch {
      notify("error", "Erro ao salvar categoria.");
    }
  }

  return (
    <div className="stack">
      {canEdit && (
        <div className="form-grid">
          <div className="form-group">
            <label>Nome *</label>
            <input value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="Ex: Prato Principal" />
          </div>
          <div className="form-group">
            <label>Ordem</label>
            <input type="number" value={form.sortOrder} onChange={(e) => setField("sortOrder", Number(e.target.value))} />
          </div>
          <div className="form-group">
            <label>Observações</label>
            <input value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
          </div>
          <div className="form-group" style={{ alignSelf: "flex-end" }}>
            <button type="button" className="btn-primary" onClick={handleSubmit}>
              {form.id ? "Salvar" : <><Plus size={14} /> Criar categoria</>}
            </button>
          </div>
        </div>
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Ordem</th>
            <th>Status</th>
            <th>Observações</th>
            {canEdit && <th></th>}
          </tr>
        </thead>
        <tbody>
          {categories.map((cat) => (
            <tr key={cat.id}>
              <td>{cat.name}</td>
              <td>{cat.sortOrder}</td>
              <td>{cat.isActive ? <span className="badge badge-success">Ativo</span> : <span className="badge badge-error">Inativo</span>}</td>
              <td className="text-muted">{cat.notes ?? "—"}</td>
              {canEdit && (
                <td>
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => setForm({ id: cat.id, name: cat.name, sortOrder: cat.sortOrder, notes: cat.notes ?? "" })}
                  >
                    Editar
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
