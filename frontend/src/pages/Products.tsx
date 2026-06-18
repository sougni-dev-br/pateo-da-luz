import { RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  addProductAlias,
  bulkPatchProductDreCategory,
  Category,
  DRECategory,
  getCategories,
  getDRECategories,
  getNextProductCode,
  getProductHistory,
  getProducts,
  getSectors,
  getSuppliers,
  getSubcategories,
  getUnits,
  InventorySector,
  Product,
  ProductHistory,
  saveCategory,
  saveProduct,
  saveSubcategory,
  setProductStatus,
  Supplier,
  Subcategory,
  UnitMeasure
} from "../api/client";
import { DRECategoryOptions, DRE_GROUPS } from "../components/DRECategoryOptions";
import { Notice, useNotice } from "../components/Notice";
import { useSession } from "../context/SessionContext";
import { hasPermission } from "../lib/permissions";
import { SimpleBarChart } from "../components/SimpleBarChart";
import { EmptyState, StatusBadge, SummaryCard } from "../components/ui";
import { formatCurrency, formatDate, formatNumber } from "../utils/format";

const emptyProduct = {
  id: "",
  externalCode: "",
  name: "",
  unit: "",
  unitMeasureId: "",
  stockUnit: "",
  purchaseUnit: "",
  baseUnit: "",
  conversionFactor: "",
  packageWeight: "",
  conversionNotes: "",
  logisticsNotes: "",
  storageLocation: "",
  storageCorridor: "",
  storageShelf: "",
  storagePosition: "",
  storageNotes: "",
  unitConversions: [] as Array<{
    fromUnit: string;
    toUnit: string;
    factor: string;
    averagePackageWeight: string;
    notes: string;
    isActive: boolean;
  }>,
  categoryId: "",
  subcategoryId: "",
  inventorySectorId: "",
  dreCategoryId: "",
  accountType: "",
  controlsStock: true,
  estoqueMinimo: "",
  estoqueIdeal: "",
  leadTimeCompraDias: "",
  fornecedorPrincipalId: "",
  newCategoryName: "",
  newSubcategoryName: "",
  notes: "",
  isActive: true
};

const emptyConversion = {
  fromUnit: "",
  toUnit: "",
  factor: "",
  averagePackageWeight: "",
  notes: "",
  isActive: true
};

function countProductsBy(products: Product[], getKey: (product: Product) => string | null | undefined) {
  const totals = new Map<string, number>();
  products.forEach((product) => {
    const key = getKey(product) || "Sem classificacao";
    totals.set(key, (totals.get(key) ?? 0) + 1);
  });
  return [...totals.entries()].map(([label, value]) => ({ label, value }));
}

function normalizeSectorOptionName(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function sanitizeSectorOptions(sectors: InventorySector[]) {
  const invalid = new Set(["", "object object", "sem setor", "undefined", "null", "revisao/pendencias"]);
  const unique = new Map<string, InventorySector>();
  for (const sector of sectors) {
    const key = normalizeSectorOptionName(sector.name);
    if (invalid.has(key)) continue;
    if (!unique.has(key)) unique.set(key, sector);
  }
  return [...unique.values()];
}

const productFormTabs = [
  { id: "identification", label: "Identificacao" },
  { id: "classification", label: "Classificação" },
  { id: "units", label: "Unidades" },
  { id: "location", label: "Localização" },
  { id: "purchase", label: "Compra" },
  { id: "notes", label: "Observações" }
] as const;

type ProductFormTab = (typeof productFormTabs)[number]["id"];

export function Products() {
  const { user } = useSession();
  const canEdit = hasPermission(user, "products", "edit");
  const canDelete = hasPermission(user, "products", "delete");
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [sectors, setSectors] = useState<InventorySector[]>([]);
  const [units, setUnits] = useState<UnitMeasure[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [dreCategories, setDreCategories] = useState<DRECategory[]>([]);
  const [filters, setFilters] = useState({ search: "", category: "", semDreCategoria: false });

  // bulk DRE
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDreCategoryId, setBulkDreCategoryId] = useState("");
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const flashTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const [form, setForm] = useState(emptyProduct);
  const [history, setHistory] = useState<ProductHistory | null>(null);
  const [conversionForm, setConversionForm] = useState(emptyConversion);
  const [activeFormTab, setActiveFormTab] = useState<ProductFormTab>("identification");
  const [alias, setAlias] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { notice, setNotice } = useNotice();
  const activeProducts = useMemo(() => products.filter((product) => product.isActive !== false), [products]);
  const inactiveProducts = useMemo(() => products.filter((product) => product.isActive === false), [products]);
  const productsByCategory = useMemo(() => countProductsBy(products, (product) => product.category?.name), [products]);
  const productsBySector = useMemo(() => countProductsBy(products, (product) => product.inventorySector?.name), [products]);
  const productsByStockControl = useMemo(() => countProductsBy(products, (product) => product.controlsStock ? "Controla estoque" : "Nao controla"), [products]);
  const selectedSector = sectors.find((sector) => sector.id === form.inventorySectorId) ?? null;
  const classificationPending = !form.inventorySectorId;

  async function loadProducts() {
    setLoading(true);
    setError(null);

    try {
      setProducts(await getProducts({
        search: filters.search || undefined,
        category: filters.category || undefined,
        semDreCategoria: filters.semDreCategoria ? "true" : undefined,
      }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Erro ao carregar produtos.");
    } finally {
      setLoading(false);
    }
  }

  async function loadBaseData() {
    const [categoryRows, subcategoryRows, sectorRows, unitRows, supplierRows, nextCode, dreCategoryRows] = await Promise.all([
      getCategories(),
      getSubcategories(),
      getSectors(),
      getUnits(),
      getSuppliers(),
      getNextProductCode().catch(() => ({ code: "" })),
      getDRECategories(true)
    ]);
    setCategories(categoryRows);
    setSubcategories(subcategoryRows);
    setSectors(sanitizeSectorOptions(sectorRows));
    setUnits(unitRows.filter((unit) => unit.isActive));
    setSuppliers(supplierRows.filter((supplier) => supplier.isActive));
    setDreCategories(dreCategoryRows);
    setForm((current) => ({
      ...current,
      externalCode: current.id ? current.externalCode : current.externalCode || nextCode.code,
      unitMeasureId: current.unitMeasureId || unitRows.find((unit) => unit.code === current.unit)?.id || unitRows[0]?.id || "",
      unit: current.unit || unitRows[0]?.code || "",
      categoryId: current.categoryId || categoryRows[0]?.id || "",
      subcategoryId:
        current.subcategoryId ||
      subcategoryRows.find((subcategory) => subcategory.categoryId === (current.categoryId || categoryRows[0]?.id))
          ?.id ||
        ""
    }));
  }

  // Mapa de sugestão: nome da categoria do produto → nome da categoria DRE
  const SUGGESTION_MAP: Record<string, string> = {
    "BEBIDAS":       "Bebidas",
    "FLV":           "Custo de Alimentos",
    "CARNES E AVES": "Custo de Alimentos",
    "PEIXES":        "Custo de Alimentos",
    "INSUMOS":       "Custo de Alimentos",
    "EMBALAGEM":     "Embalagens",
    "DESCARTAVEIS":  "Descartáveis / Delivery",
    "UTENSILIOS":    "Utensílios Operacionais",
    "LIMPEZA":       "Material de Limpeza",
    "EQUIPAMENTOS":  "Equipamentos",
    "INVESTIMENTOS": "Investimentos",
  };

  // Agrupa produtos sem DRE por categoria e computa sugestão
  const suggestionGroups = useMemo(() => {
    const withoutDre = products.filter((p) => !p.dreCategoryId);
    const byCategory = new Map<string, { products: Product[]; dreCatName: string | null; dreCatId: string | null }>();
    for (const p of withoutDre) {
      const catName = p.category?.name ?? "(sem categoria)";
      if (!byCategory.has(catName)) {
        const suggestedName = SUGGESTION_MAP[catName] ?? null;
        const suggestedCat = suggestedName ? dreCategories.find((c) => c.name === suggestedName) ?? null : null;
        byCategory.set(catName, { products: [], dreCatName: suggestedCat?.name ?? null, dreCatId: suggestedCat?.id ?? null });
      }
      byCategory.get(catName)!.products.push(p);
    }
    return [...byCategory.entries()]
      .map(([catName, data]) => ({ catName, count: data.products.length, ids: data.products.map((p) => p.id), dreCatName: data.dreCatName, dreCatId: data.dreCatId, controlsStock: data.products.filter((p) => p.controlsStock !== false).length }))
      .sort((a, b) => b.count - a.count);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, dreCategories]);

  const [pendingSuggestion, setPendingSuggestion] = useState<{ catName: string; ids: string[]; dreCatId: string; dreCatName: string } | null>(null);

  async function applyBulkDre(ids: string[], dreCategoryId: string) {
    setBulkSaving(true);
    try {
      const res = await bulkPatchProductDreCategory(ids, dreCategoryId);
      setSelected(new Set());
      setBulkDreCategoryId("");
      setShowBulkConfirm(false);
      setPendingSuggestion(null);
      await loadProducts();
      setNotice({ tone: "success", message: `${res.updated} produto(s) classificado(s).` });
    } catch {
      setNotice({ tone: "error", message: "Erro ao aplicar classificação em lote." });
    } finally {
      setBulkSaving(false);
    }
  }

  async function resetProductForm() {
    const nextCode = await getNextProductCode().catch(() => ({ code: "" }));
    const defaultUnit = units[0];
    setForm({ ...emptyProduct, externalCode: nextCode.code, unitMeasureId: defaultUnit?.id ?? "", unit: defaultUnit?.code ?? "" });
    setConversionForm(emptyConversion);
    setAlias("");
    setActiveFormTab("identification");
  }

  async function handleSubmit() {
    if (!form.name.trim()) return;
    const isUpdate = Boolean(form.id);
    setError(null);
    const category = categories.find((item) => item.id === form.categoryId);
    const subcategory = subcategories.find((item) => item.id === form.subcategoryId);

    try {
      const saved = await saveProduct({
        ...form,
        categoryName: category?.name,
        subcategoryName: subcategory?.name
      });
      if (alias.trim()) {
        await addProductAlias(saved.id, alias);
      }
      await resetProductForm();
      setConversionForm(emptyConversion);
      setAlias("");
      await loadProducts();
      setNotice({
        tone: "success",
        message: isUpdate ? "Cadastro atualizado com sucesso." : "Cadastro criado com sucesso."
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Erro ao salvar produto.");
      setNotice({ tone: "error", message: "Erro ao salvar." });
    }
  }

  async function handleCreateCategory() {
    const name = form.newCategoryName.trim();
    if (!name) return;
    setError(null);

    try {
      const created = await saveCategory({ name, isActive: true });
      await loadBaseData();
      setForm((current) => ({
        ...current,
        categoryId: created.id,
        subcategoryId: "",
        newCategoryName: ""
      }));
      setNotice({ tone: "success", message: "Cadastro criado com sucesso." });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Erro ao criar categoria.");
      setNotice({ tone: "error", message: "Erro ao salvar." });
    }
  }

  async function handleCreateSubcategory() {
    const name = form.newSubcategoryName.trim();
    if (!name || !form.categoryId) return;
    setError(null);

    try {
      const created = await saveSubcategory({ name, categoryId: form.categoryId, isActive: true });
      await loadBaseData();
      setForm((current) => ({
        ...current,
        subcategoryId: created.id,
        newSubcategoryName: ""
      }));
      setNotice({ tone: "success", message: "Cadastro criado com sucesso." });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Erro ao criar subcategoria.");
      setNotice({ tone: "error", message: "Erro ao salvar." });
    }
  }

  async function toggleStatus(product: Product) {
    setError(null);

    try {
      await setProductStatus(product.id, !product.isActive);
      await loadProducts();
      setNotice({
        tone: "success",
        message: product.isActive ? "Cadastro inativado com sucesso." : "Cadastro reativado com sucesso."
      });
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Erro ao alterar status.");
      setNotice({ tone: "error", message: "Erro ao salvar." });
    }
  }

  async function openHistory(product: Product) {
    try {
      setHistory(await getProductHistory(product.id));
    } catch (historyError) {
      setNotice({ tone: "error", message: historyError instanceof Error ? historyError.message : "Erro ao carregar historico." });
    }
  }

  useEffect(() => {
    loadProducts();
    loadBaseData();
  }, []);

  const filteredSubcategories = subcategories.filter((subcategory) => subcategory.categoryId === form.categoryId);

  return (
    <div className="stack">
      <Notice notice={notice} />

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>Cadastro operacional</p>
            <h2>Indicadores de produtos</h2>
          </div>
        </div>
        <div className="summary-grid dashboard-summary">
          <SummaryCard label="Produtos cadastrados" value={products.length} />
          <SummaryCard label="Ativos" value={activeProducts.length} tone="success" />
          <SummaryCard label="Inativos" value={inactiveProducts.length} tone={inactiveProducts.length ? "warning" : "success"} />
          <SummaryCard label="Controlam estoque" value={products.filter((product) => product.controlsStock).length} />
        </div>
        <div className="chart-grid">
          <SimpleBarChart title="Distribuição por categoria" items={productsByCategory} />
          <SimpleBarChart title="Produtos por setor" items={productsBySector} />
          <SimpleBarChart title="Controle de estoque" items={productsByStockControl} />
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>Tabela mestre</p>
            <h2>Produto</h2>
          </div>
        </div>

        <div className="product-form-toolbar">
          <div>
            <strong>{form.id ? "Edicao de produto" : "Novo produto"}</strong>
            <span>{form.id ? `${form.externalCode || "-"} - ${form.name || "Sem descricao"}` : "Preencha os blocos abaixo para concluir o cadastro."}</span>
          </div>
          <div className="actions-cell wrap">
            <button className="secondary-button" type="button" onClick={resetProductForm}>Cancelar</button>
            <button className="secondary-button" type="button" onClick={resetProductForm}>Novo produto</button>
            <button className="primary-button" type="button" disabled={!canEdit} onClick={handleSubmit}>{form.id ? "Salvar alteracoes" : "Salvar produto"}</button>
          </div>
        </div>

        <div className="product-form-tabs" role="tablist" aria-label="Blocos do cadastro de produto">
          {productFormTabs.map((tab) => (
            <button
              key={tab.id}
              className={activeFormTab === tab.id ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={activeFormTab === tab.id}
              onClick={() => setActiveFormTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="form-section-grid">
          {activeFormTab === "identification" && (
            <section className="form-section">
              <div className="form-section-header">
                <h3>Identificação</h3>
                <span>Código gerado automaticamente e card de estoque em destaque.</span>
              </div>
              <div className="form-grid product-main-grid">
                <label>
                  Código do produto
                  <input className="locked-field" value={form.externalCode || "Gerado ao salvar"} readOnly title="Código automático e não editável" />
                </label>
                <label className="span-2">
                  Descrição do produto
                  <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
                </label>
                <article className={`stock-control-card ${form.controlsStock ? "is-enabled" : "is-disabled"}`}>
                  <div>
                    <strong>Controla estoque</strong>
                    <p>{form.controlsStock ? "Participa de contagem, inventario e CMV." : "Fica fora da contagem operacional e nao alimenta CMV."}</p>
                  </div>
                  <label className="switch-label">
                    <input
                      type="checkbox"
                      checked={form.controlsStock}
                      onChange={(event) => setForm({ ...form, controlsStock: event.target.checked })}
                    />
                    <span>
                      <strong>{form.controlsStock ? "Ativo no estoque" : "Fora do estoque"}</strong>
                      <small>Revise este campo com cuidado para nao esconder itens da contagem.</small>
                    </span>
                  </label>
                </article>
                <label>
                  Alias
                  <input value={alias} onChange={(event) => setAlias(event.target.value)} />
                </label>
              </div>
            </section>
          )}

          {activeFormTab === "classification" && (
            <section className="form-section">
              <div className="form-section-header">
                <h3>Classificacao</h3>
                <span>Setor, categoria e subcategoria definem contagem, inventario e CMV.</span>
              </div>
              <div className="alert info">
                Setor, categoria e subcategoria impactam a contagem setorial, os inventarios oficiais e a leitura do CMV. "Sem setor" deve ser tratado como pendencia.
              </div>
              {classificationPending && (
                <div className="alert warning">
                  Produto sem setor operacional. Ele fica destacado como pendencia ate ser corrigido.
                </div>
              )}
              <div className="form-grid classification-grid">
                <label>
                  Categoria DRE / Classificação Gerencial
                  <select
                    value={form.dreCategoryId}
                    onChange={(event) => setForm({ ...form, dreCategoryId: event.target.value })}
                  >
                    <option value="">— Não classificado —</option>
                    <DRECategoryOptions categories={dreCategories} />
                  </select>
                </label>
                <label>
                  Setor
                  <select value={form.inventorySectorId} onChange={(event) => setForm({ ...form, inventorySectorId: event.target.value })}>
                    <option value="">Sem setor (pendencia)</option>
                    {sectors.map((sector) => <option key={sector.id} value={sector.id}>{sector.name}</option>)}
                  </select>
                </label>
                <label>
                  Categoria
                  <select
                    value={form.categoryId}
                    onChange={(event) => {
                      const categoryId = event.target.value;
                      const nextSubcategory = subcategories.find((subcategory) => subcategory.categoryId === categoryId);
                      setForm({ ...form, categoryId, subcategoryId: nextSubcategory?.id ?? "" });
                    }}
                  >
                    <option value="">Selecione</option>
                    {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                </label>
                <label>
                  Subcategoria
                  <select
                    value={form.subcategoryId}
                    onChange={(event) => setForm({ ...form, subcategoryId: event.target.value })}
                    disabled={!form.categoryId}
                  >
                    <option value="">Selecione</option>
                    {filteredSubcategories.map((subcategory) => <option key={subcategory.id} value={subcategory.id}>{subcategory.name}</option>)}
                  </select>
                </label>
                <article className={`classification-status-card ${classificationPending ? "is-warning" : "is-ok"}`}>
                  <span>Leitura operacional</span>
                  <strong>{selectedSector?.name ?? "Sem setor"}</strong>
                  <small>{classificationPending ? "Corrija antes da proxima contagem." : "Produto pronto para ser agrupado nas rotinas operacionais."}</small>
                </article>
                <div className="inline-create-field">
                  <label>
                    Nova categoria
                    <input value={form.newCategoryName} onChange={(event) => setForm({ ...form, newCategoryName: event.target.value })} />
                  </label>
                  <button className="secondary-button" type="button" onClick={handleCreateCategory}>Criar categoria</button>
                </div>
                <div className="inline-create-field">
                  <label>
                    Nova subcategoria
                    <input value={form.newSubcategoryName} onChange={(event) => setForm({ ...form, newSubcategoryName: event.target.value })} disabled={!form.categoryId} />
                  </label>
                  <button className="secondary-button" type="button" onClick={handleCreateSubcategory} disabled={!form.categoryId}>Criar subcategoria</button>
                </div>
              </div>
            </section>
          )}

          {activeFormTab === "units" && (
            <section className="form-section">
              <div className="form-section-header">
                <h3>Unidades e conversao</h3>
                <span>Unidade padrao, compra, estoque e conversoes futuras.</span>
              </div>
              <div className="form-grid">
                <label>
                  Unidade padrao
                  <select value={form.unitMeasureId} onChange={(event) => {
                    const unit = units.find((item) => item.id === event.target.value);
                    setForm({ ...form, unitMeasureId: event.target.value, unit: unit?.code ?? "" });
                  }}>
                    <option value="">Selecione</option>
                    {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} - {unit.name}</option>)}
                  </select>
                </label>
                <label>
                  Unidade de estoque
                  <select value={form.stockUnit} onChange={(event) => setForm({ ...form, stockUnit: event.target.value })}>
                    <option value="">Usar unidade padrao</option>
                    {units.map((unit) => <option key={unit.id} value={unit.code}>{unit.code}</option>)}
                  </select>
                </label>
                <label>
                  Unidade de compra
                  <select value={form.purchaseUnit} onChange={(event) => setForm({ ...form, purchaseUnit: event.target.value })}>
                    <option value="">Usar unidade padrao</option>
                    {units.map((unit) => <option key={unit.id} value={unit.code}>{unit.code}</option>)}
                  </select>
                </label>
                <label>
                  Unidade base futura
                  <select value={form.baseUnit} onChange={(event) => setForm({ ...form, baseUnit: event.target.value })}>
                    <option value="">Selecione</option>
                    {units.map((unit) => <option key={unit.id} value={unit.code}>{unit.code}</option>)}
                  </select>
                </label>
                <label>
                  Fator de conversao
                  <input value={form.conversionFactor} onChange={(event) => setForm({ ...form, conversionFactor: event.target.value })} />
                </label>
                <label>
                  Peso medio
                  <input value={form.packageWeight} onChange={(event) => setForm({ ...form, packageWeight: event.target.value })} />
                </label>
              </div>
              <div className="subsection compact-note">
                <h3>Conversoes futuras</h3>
                <div className="form-grid">
                  <label>
                    De
                    <input value={conversionForm.fromUnit} onChange={(event) => setConversionForm({ ...conversionForm, fromUnit: event.target.value })} />
                  </label>
                  <label>
                    Para
                    <input value={conversionForm.toUnit} onChange={(event) => setConversionForm({ ...conversionForm, toUnit: event.target.value })} />
                  </label>
                  <label>
                    Fator
                    <input value={conversionForm.factor} onChange={(event) => setConversionForm({ ...conversionForm, factor: event.target.value })} />
                  </label>
                  <label>
                    Peso médio
                    <input value={conversionForm.averagePackageWeight} onChange={(event) => setConversionForm({ ...conversionForm, averagePackageWeight: event.target.value })} />
                  </label>
                  <label>
                    Observações
                    <input value={conversionForm.notes} onChange={(event) => setConversionForm({ ...conversionForm, notes: event.target.value })} />
                  </label>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      if (!conversionForm.fromUnit || !conversionForm.toUnit || !conversionForm.factor) return;
                      setForm({ ...form, unitConversions: [...form.unitConversions, conversionForm] });
                      setConversionForm(emptyConversion);
                    }}
                  >
                    Adicionar conversao
                  </button>
                </div>
                {form.unitConversions.length > 0 && (
                  <div className="columns-list">
                    {form.unitConversions.map((conversion, index) => (
                      <span key={`${conversion.fromUnit}-${conversion.toUnit}-${index}`}>
                        {conversion.fromUnit} {" -> "} {conversion.toUnit}: <strong>{conversion.factor}</strong>
                        <button
                          type="button"
                          onClick={() =>
                            setForm({
                              ...form,
                              unitConversions: form.unitConversions.filter((_, currentIndex) => currentIndex !== index)
                            })
                          }
                        >
                          remover
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {activeFormTab === "location" && (
            <section className="form-section">
              <div className="form-section-header">
                <h3>Localizacao</h3>
                <span>Ajuda a ordenar a contagem operacional dentro do setor.</span>
              </div>
              <div className="form-grid">
                <label>Localizacao<input value={form.storageLocation} onChange={(event) => setForm({ ...form, storageLocation: event.target.value })} /></label>
                <label>Corredor<input value={form.storageCorridor} onChange={(event) => setForm({ ...form, storageCorridor: event.target.value })} /></label>
                <label>Prateleira<input value={form.storageShelf} onChange={(event) => setForm({ ...form, storageShelf: event.target.value })} /></label>
                <label>Posicao<input value={form.storagePosition} onChange={(event) => setForm({ ...form, storagePosition: event.target.value })} /></label>
              </div>
            </section>
          )}

          {activeFormTab === "purchase" && (
            <section className="form-section">
              <div className="form-section-header">
                <h3>Parametros de compra</h3>
                <span>Usado no apoio ao comprador e na reposicao.</span>
              </div>
              <div className="form-grid">
                <label>Estoque minimo<input inputMode="decimal" value={form.estoqueMinimo} onChange={(event) => setForm({ ...form, estoqueMinimo: event.target.value })} /></label>
                <label>Estoque ideal<input inputMode="decimal" value={form.estoqueIdeal} onChange={(event) => setForm({ ...form, estoqueIdeal: event.target.value })} /></label>
                <label>Lead time compra (dias)<input type="number" min="0" value={form.leadTimeCompraDias} onChange={(event) => setForm({ ...form, leadTimeCompraDias: event.target.value })} /></label>
                <label>
                  Fornecedor principal
                  <select value={form.fornecedorPrincipalId} onChange={(event) => setForm({ ...form, fornecedorPrincipalId: event.target.value })}>
                    <option value="">Sem fornecedor principal</option>
                    {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                  </select>
                </label>
              </div>
            </section>
          )}

          {activeFormTab === "notes" && (
            <section className="form-section">
              <div className="form-section-header">
                <h3>Observações e compatibilidade</h3>
                <span>Notas internas e campos complementares do cadastro.</span>
              </div>
              <div className="form-grid">
                <label>Observações<input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
                <label>Observação logística<input value={form.logisticsNotes} onChange={(event) => setForm({ ...form, logisticsNotes: event.target.value })} /></label>
                <label>Obs. localização<input value={form.storageNotes} onChange={(event) => setForm({ ...form, storageNotes: event.target.value })} /></label>
                <label>Obs. conversão<input value={form.conversionNotes} onChange={(event) => setForm({ ...form, conversionNotes: event.target.value })} /></label>
                <label>Tipo de conta<input value={form.accountType} onChange={(event) => setForm({ ...form, accountType: event.target.value })} /></label>
                <label className="checkbox-label"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />Ativo</label>
              </div>
            </section>
          )}
        </div>

        <div className="form-actions sticky-form-actions">
          <button className="secondary-button" type="button" onClick={resetProductForm}>Cancelar</button>
          <button className="secondary-button" type="button" onClick={resetProductForm}>Novo produto</button>
          <button className="primary-button" type="button" disabled={!canEdit} onClick={handleSubmit}>{form.id ? "Salvar alteracoes" : "Salvar produto"}</button>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>Normalizacao inicial</p>
            <h2>Produtos</h2>
          </div>
          <button className="icon-button" type="button" onClick={loadProducts} aria-label="Atualizar produtos">
            <RefreshCw size={18} />
          </button>
        </div>

        <div className="filters-row">
          <label>
            Busca
            <input
              placeholder="Nome do produto"
              value={filters.search}
              onChange={(event) => setFilters({ ...filters, search: event.target.value })}
              onKeyDown={(e) => e.key === "Enter" && loadProducts()}
            />
          </label>
          <label>
            Categoria
            <select
              value={filters.category}
              onChange={(event) => setFilters({ ...filters, category: event.target.value })}
            >
              <option value="">Todas</option>
              {categories.map((category) => (
                <option key={category.id} value={category.name}>{category.name}</option>
              ))}
            </select>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={filters.semDreCategoria}
              onChange={(event) => setFilters({ ...filters, semDreCategoria: event.target.checked })}
            />
            Sem Categoria DRE
          </label>
          <button className="primary-button" type="button" onClick={loadProducts}>Filtrar</button>
          <button
            type="button"
            style={{ marginLeft: "auto" }}
            onClick={() => setShowSuggestions((v) => !v)}
          >
            {showSuggestions ? "Ocultar sugestões" : `Sugestões por categoria (${suggestionGroups.reduce((s, g) => s + g.count, 0)} sem DRE)`}
          </button>
        </div>

        {/* Painel de sugestões por categoria */}
        {showSuggestions && (
          <div style={{ border: "1px solid var(--color-border, #334155)", borderRadius: "8px", padding: "1rem", marginBottom: "0.5rem" }}>
            <h3 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "0.95rem" }}>Sugestões de Categoria DRE por categoria de produto</h3>
            <table>
              <thead>
                <tr>
                  <th>Categoria produto</th>
                  <th style={{ textAlign: "center" }}>Produtos sem DRE</th>
                  <th style={{ textAlign: "center" }}>Controla estoque</th>
                  <th>Categoria DRE sugerida</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {suggestionGroups.map((g) => (
                  <tr key={g.catName}>
                    <td style={{ fontWeight: 500 }}>{g.catName}</td>
                    <td style={{ textAlign: "center" }}>{g.count}</td>
                    <td style={{ textAlign: "center" }}>{g.controlsStock}</td>
                    <td>
                      {g.dreCatName
                        ? <span style={{ color: "var(--color-success, #22c55e)", fontSize: "0.88em" }}>{g.dreCatName}</span>
                        : <span style={{ color: "var(--color-text-muted)", fontStyle: "italic", fontSize: "0.88em" }}>— sem sugestão —</span>}
                    </td>
                    <td className="actions-cell">
                      {g.dreCatId && (
                        <button
                          className="primary-button"
                          type="button"
                          onClick={() => setPendingSuggestion({ catName: g.catName, ids: g.ids, dreCatId: g.dreCatId!, dreCatName: g.dreCatName! })}
                        >
                          Aplicar
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(new Set(g.ids));
                          setBulkDreCategoryId(g.dreCatId ?? "");
                          setShowSuggestions(false);
                        }}
                      >
                        Selecionar
                      </button>
                    </td>
                  </tr>
                ))}
                {suggestionGroups.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--color-success, #22c55e)" }}>Todos os produtos têm Categoria DRE!</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Modal de confirmação — sugestão por categoria */}
        {pendingSuggestion && (
          <div
            style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={() => !bulkSaving && setPendingSuggestion(null)}
          >
            <div
              style={{ background: "var(--color-surface, #0f172a)", border: "1px solid var(--color-border, #334155)", borderRadius: "12px", padding: "1.5rem", maxWidth: "420px", width: "90%" }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ marginTop: 0 }}>Confirmar classificação em lote</h3>
              <p>Aplicar <strong>{pendingSuggestion.dreCatName}</strong> em <strong>{pendingSuggestion.ids.length}</strong> produto(s) da categoria <strong>{pendingSuggestion.catName}</strong>?</p>
              <p style={{ fontSize: "0.85em", color: "var(--color-text-muted)" }}>Essa ação pode ser desfeita editando cada produto individualmente.</p>
              <div className="actions-cell" style={{ marginTop: "1.25rem" }}>
                <button className="primary-button" type="button" disabled={bulkSaving} onClick={() => applyBulkDre(pendingSuggestion.ids, pendingSuggestion.dreCatId)}>
                  {bulkSaving ? "Aplicando..." : "Confirmar"}
                </button>
                <button type="button" disabled={bulkSaving} onClick={() => setPendingSuggestion(null)}>Cancelar</button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de confirmação — seleção manual */}
        {showBulkConfirm && (
          <div
            style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={() => !bulkSaving && setShowBulkConfirm(false)}
          >
            <div
              style={{ background: "var(--color-surface, #0f172a)", border: "1px solid var(--color-border, #334155)", borderRadius: "12px", padding: "1.5rem", maxWidth: "420px", width: "90%" }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ marginTop: 0 }}>Confirmar classificação em lote</h3>
              <p>Aplicar <strong>{dreCategories.find((c) => c.id === bulkDreCategoryId)?.name}</strong> em <strong>{selected.size}</strong> produto(s) selecionado(s)?</p>
              <div className="actions-cell" style={{ marginTop: "1.25rem" }}>
                <button className="primary-button" type="button" disabled={bulkSaving} onClick={() => applyBulkDre([...selected], bulkDreCategoryId)}>
                  {bulkSaving ? "Aplicando..." : "Confirmar"}
                </button>
                <button type="button" disabled={bulkSaving} onClick={() => setShowBulkConfirm(false)}>Cancelar</button>
              </div>
            </div>
          </div>
        )}

        {/* Barra de ação em lote */}
        {selected.size > 0 && (
          <div style={{ position: "sticky", top: 0, zIndex: 10, background: "var(--color-surface-raised, #1e293b)", border: "1px solid var(--color-border, #334155)", borderRadius: "8px", padding: "0.75rem 1rem", display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
            <strong style={{ whiteSpace: "nowrap" }}>{selected.size} selecionado(s)</strong>
            <select
              value={bulkDreCategoryId}
              onChange={(e) => setBulkDreCategoryId(e.target.value)}
              style={{ minWidth: "220px" }}
            >
              <option value="">— Categoria DRE —</option>
              <DRECategoryOptions categories={dreCategories} />
            </select>
            <button
              className="primary-button"
              type="button"
              disabled={!bulkDreCategoryId}
              onClick={() => setShowBulkConfirm(true)}
            >
              Aplicar em lote
            </button>
            <button type="button" style={{ marginLeft: "auto" }} onClick={() => { setSelected(new Set()); setBulkDreCategoryId(""); }} title="Cancelar seleção">
              <X size={16} />
            </button>
          </div>
        )}

        {error && <div className="alert error">{error}</div>}
        {loading && <div className="empty-state">Carregando produtos...</div>}

        {!loading && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: "2rem" }}>
                    <input
                      type="checkbox"
                      title="Selecionar todos visíveis"
                      checked={products.length > 0 && products.every((p) => selected.has(p.id))}
                      onChange={(e) => {
                        if (e.target.checked) setSelected(new Set(products.map((p) => p.id)));
                        else setSelected(new Set());
                      }}
                    />
                  </th>
                  <th>Status</th>
                  <th>Código</th>
                  <th>Produto</th>
                  <th>Categoria</th>
                  <th>Estoque</th>
                  <th>Categoria DRE</th>
                  <th>Aliases</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id} style={selected.has(product.id) ? { backgroundColor: "var(--color-primary-muted, rgba(59,130,246,0.08))" } : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(product.id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(product.id); else next.delete(product.id);
                          setSelected(next);
                        }}
                      />
                    </td>
                    <td>{product.isActive ? "Ativo" : "Inativo"}</td>
                    <td>{product.externalCode ?? "-"}</td>
                    <td>
                      {product.name}
                      <small>{product.normalizedName}</small>
                    </td>
                    <td>
                      {product.category?.name ?? "-"}
                      {product.subcategory && <small>{product.subcategory.name}</small>}
                    </td>
                    <td>{product.controlsStock === false ? "Nao" : "Sim"}</td>
                    <td>
                      {product.dreCategory
                        ? <span title={product.dreCategory.name} style={{ fontSize: "0.82em" }}>{product.dreCategory.name}</span>
                        : <span style={{ color: "var(--color-warning, #f59e0b)", fontStyle: "italic", fontSize: "0.82em" }}>— pendente —</span>}
                    </td>
                    <td>{product.aliases?.length ?? 0}</td>
                    <td className="actions-cell">
                      <button type="button" disabled={!canEdit} onClick={() => {
                        setActiveFormTab("identification");
                        setForm({
                          id: product.id,
                          externalCode: product.externalCode ?? "",
                          name: product.name,
                          unit: product.unit ?? "",
                          unitMeasureId: product.unitMeasureId ?? units.find((unit) => unit.code === product.unit)?.id ?? "",
                          stockUnit: product.stockUnit ?? product.baseUnit ?? "",
                          purchaseUnit: product.purchaseUnit ?? product.unit ?? "",
                          baseUnit: product.baseUnit ?? "",
                          conversionFactor: product.conversionFactor ?? "",
                          packageWeight: product.packageWeight ?? "",
                          conversionNotes: product.conversionNotes ?? "",
                          logisticsNotes: product.logisticsNotes ?? "",
                          storageLocation: product.storageLocation ?? "",
                          storageCorridor: product.storageCorridor ?? "",
                          storageShelf: product.storageShelf ?? "",
                          storagePosition: product.storagePosition ?? "",
                          storageNotes: product.storageNotes ?? "",
                          unitConversions: (product.unitConversions ?? []).map((conversion) => ({
                            fromUnit: conversion.fromUnit,
                            toUnit: conversion.toUnit,
                            factor: conversion.factor,
                            averagePackageWeight: conversion.averagePackageWeight ?? "",
                            notes: conversion.notes ?? "",
                            isActive: conversion.isActive
                          })),
                          categoryId: product.category?.id ?? "",
                          subcategoryId: product.subcategory?.id ?? "",
                          inventorySectorId: product.inventorySector?.id ?? "",
                          dreCategoryId: product.dreCategoryId ?? "",
                          accountType: product.accountType ?? "",
                          controlsStock: product.controlsStock ?? true,
                          estoqueMinimo: product.estoqueMinimo ?? "",
                          estoqueIdeal: product.estoqueIdeal ?? "",
                          leadTimeCompraDias: product.leadTimeCompraDias == null ? "" : String(product.leadTimeCompraDias),
                          fornecedorPrincipalId: product.fornecedorPrincipalId ?? "",
                          newCategoryName: "",
                          newSubcategoryName: "",
                          notes: product.notes ?? "",
                          isActive: product.isActive
                        });
                      }}>
                        Editar
                      </button>
                      <button type="button" disabled={!canDelete} onClick={() => toggleStatus(product)}>
                        {product.isActive ? "Inativar" : "Reativar"}
                      </button>
                      <button type="button" onClick={() => openHistory(product)}>
                        Ver historico
                      </button>
                    </td>
                  </tr>
                ))}
                {products.length === 0 && (
                  <tr>
                    <td colSpan={9}>Nenhum produto cadastrado.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {history && (
        <div className="modal-backdrop">
          <section className="panel modal-panel wide-modal">
            <div className="section-heading">
              <div>
                <p>Histórico operacional</p>
                <h2 title={history.product.name}>{history.product.externalCode ?? "-"} - {history.product.name}</h2>
              </div>
              <button className="secondary-button" type="button" onClick={() => setHistory(null)}>Fechar</button>
            </div>

            <div className="summary-grid">
              <SummaryCard label="Unidade" value={history.product.unit ?? "-"} />
              <SummaryCard label="Setor" value={history.product.inventorySector?.name ?? "-"} />
              <SummaryCard label="Categoria" value={history.product.category?.name ?? "-"} />
              <SummaryCard label="Controla estoque" value={history.product.controlsStock === false ? "Não" : "Sim"} tone={history.product.controlsStock === false ? "warning" : "success"} />
              <SummaryCard label="Status" value={history.product.isActive ? "Ativo" : "Inativo"} tone={history.product.isActive ? "success" : "danger"} />
            </div>

            <div className="subsection table-wrap">
              <h3>Histórico de contagens</h3>
              <table>
                <thead><tr><th>Data</th><th>Inventario</th><th>Tipo</th><th>Status inv.</th><th>Qtd.</th><th>Obs.</th><th>Status item</th></tr></thead>
                <tbody>
                  {history.counts.map((count) => (
                    <tr key={`${count.inventoryCode}-${count.date}`}>
                      <td>{formatDate(count.date)}</td>
                      <td>{count.inventoryCode}</td>
                      <td>{count.inventoryType}</td>
                      <td><StatusBadge>{count.inventoryStatus}</StatusBadge></td>
                      <td>{count.countedQuantity == null ? "-" : formatNumber(count.countedQuantity)}</td>
                      <td title={count.notes ?? "-"}>{count.notes ?? "-"}</td>
                      <td><StatusBadge>{count.itemStatus}</StatusBadge></td>
                    </tr>
                  ))}
                  {history.counts.length === 0 && <tr><td colSpan={7}><EmptyState title="Nenhuma contagem encontrada" description="Este produto ainda não apareceu em inventários operacionais." /></td></tr>}
                </tbody>
              </table>
            </div>

            <div className="subsection table-wrap">
              <h3>Histórico de compras</h3>
              <table>
                <thead><tr><th>Data</th><th>Fornecedor</th><th>Qtd.</th><th>Un.</th><th>Unitario</th><th>Total</th><th>Pedido/NF</th></tr></thead>
                <tbody>
                  {history.purchases.map((purchase) => (
                    <tr key={`${purchase.purchaseNumber}-${purchase.invoiceNumber}-${purchase.date}`}>
                      <td>{formatDate(purchase.date)}</td>
                      <td title={purchase.supplierName}>{purchase.supplierName}</td>
                      <td>{formatNumber(purchase.quantity)}</td>
                      <td>{purchase.unit ?? "-"}</td>
                      <td>{formatCurrency(purchase.unitPrice)}</td>
                      <td>{formatCurrency(purchase.totalPrice)}</td>
                      <td>{[purchase.purchaseNumber, purchase.invoiceNumber].filter(Boolean).join(" / ") || "-"}</td>
                    </tr>
                  ))}
                  {history.purchases.length === 0 && <tr><td colSpan={7}><EmptyState title="Nenhuma compra encontrada" description="Ainda nao ha compra vinculada a este produto." /></td></tr>}
                </tbody>
              </table>
            </div>

            <div className="subsection table-wrap">
              <h3>Uso em CMV</h3>
              <table>
                <thead><tr><th>Periodo</th><th>Inventario inicial</th><th>Inventario final</th><th>Qtd. inicial</th><th>Compras</th><th>Qtd. final</th><th>Consumo</th><th>Media diaria</th><th>Cobertura</th><th>Variacao</th></tr></thead>
                <tbody>
                  {history.cmvUsage.map((row) => (
                    <tr key={`${row.periodCode}-${row.startDate}`}>
                      <td>{row.periodCode ?? "-"}<small>{formatDate(row.startDate)} a {formatDate(row.endDate)}</small></td>
                      <td title={row.initialInventory ?? "-"}>{row.initialInventory ?? "-"}</td>
                      <td title={row.finalInventory ?? "-"}>{row.finalInventory ?? "-"}</td>
                      <td>{row.initialQuantity == null ? "-" : formatNumber(row.initialQuantity)}</td>
                      <td>{row.purchaseQuantity == null ? "-" : formatNumber(row.purchaseQuantity)}</td>
                      <td>{row.finalQuantity == null ? "-" : formatNumber(row.finalQuantity)}</td>
                      <td>{row.consumptionEstimated == null ? "Sem dados suficientes" : formatNumber(row.consumptionEstimated)}</td>
                      <td>{row.averageDailyConsumption == null ? "Sem dados suficientes" : formatNumber(row.averageDailyConsumption)}</td>
                      <td>{row.coverageDays == null ? "Sem dados suficientes" : `${formatNumber(row.coverageDays)} dias`}</td>
                      <td>{row.variation == null ? "-" : formatNumber(row.variation)}</td>
                    </tr>
                  ))}
                  {history.cmvUsage.length === 0 && <tr><td colSpan={10}><EmptyState title="Sem uso em CMV" description="Este produto ainda nao apareceu em snapshots usados no CMV Real." /></td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
