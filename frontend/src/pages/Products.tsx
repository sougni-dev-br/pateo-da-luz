import { History, Pencil, PowerOff, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  addProductAlias,
  bulkPatchProductDreCategory,
  Category,
  DRECategory,
  getNextProductCode,
  getProductFormOptions,
  getProductsSummary,
  getProductHistory,
  getProducts,
  InventorySector,
  Product,
  ProductHistory,
  ProductSummary,
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
import { useRevealScroll } from "../lib/useRevealScroll";
import { SimpleBarChart } from "../components/SimpleBarChart";
import {
  EmptyState,
  IconButton,
  Money,
  PanelEyebrow,
  RowMenu,
  StatusBadge,
  SummaryCard,
  Table
} from "../design-system";
import { formatDate, formatNumber } from "../utils/format";

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

// Ciclo 2: snapshot canônico para dirty-check.
// Campos transitórios (newCategoryName, newSubcategoryName, id) ficam de fora.
// null/undefined/"" colapsam para ""; booleanos são coeridos; strings são trim.
function normalizeForm(f: typeof emptyProduct): string {
  const s = (v: string | null | undefined) => (v == null ? "" : String(v).trim());
  const b = (v: boolean | null | undefined) => v === true;
  return JSON.stringify({
    externalCode: s(f.externalCode),
    name: s(f.name),
    unit: s(f.unit),
    unitMeasureId: s(f.unitMeasureId),
    stockUnit: s(f.stockUnit),
    purchaseUnit: s(f.purchaseUnit),
    baseUnit: s(f.baseUnit),
    conversionFactor: s(f.conversionFactor),
    packageWeight: s(f.packageWeight),
    conversionNotes: s(f.conversionNotes),
    logisticsNotes: s(f.logisticsNotes),
    storageLocation: s(f.storageLocation),
    storageCorridor: s(f.storageCorridor),
    storageShelf: s(f.storageShelf),
    storagePosition: s(f.storagePosition),
    storageNotes: s(f.storageNotes),
    unitConversions: (f.unitConversions ?? []).map((c) => ({
      fromUnit: s(c.fromUnit),
      toUnit: s(c.toUnit),
      factor: s(c.factor),
      averagePackageWeight: s(c.averagePackageWeight),
      notes: s(c.notes),
      isActive: b(c.isActive)
    })),
    categoryId: s(f.categoryId),
    subcategoryId: s(f.subcategoryId),
    inventorySectorId: s(f.inventorySectorId),
    dreCategoryId: s(f.dreCategoryId),
    accountType: s(f.accountType),
    controlsStock: b(f.controlsStock),
    estoqueMinimo: s(f.estoqueMinimo),
    estoqueIdeal: s(f.estoqueIdeal),
    leadTimeCompraDias: s(f.leadTimeCompraDias),
    fornecedorPrincipalId: s(f.fornecedorPrincipalId),
    notes: s(f.notes),
    isActive: b(f.isActive)
  });
}

// Ciclo 2: rascunho de conversão de unidade (seção "Conversões futuras")
// também conta como dirty — usuário não pode perder digitação silenciosamente.
function normalizeConversion(c: typeof emptyConversion): string {
  const s = (v: string | null | undefined) => (v == null ? "" : String(v).trim());
  return JSON.stringify({
    fromUnit: s(c.fromUnit),
    toUnit: s(c.toUnit),
    factor: s(c.factor),
    averagePackageWeight: s(c.averagePackageWeight),
    notes: s(c.notes),
    isActive: c.isActive === true
  });
}

const EMPTY_CONVERSION_KEY = normalizeConversion({
  fromUnit: "",
  toUnit: "",
  factor: "",
  averagePackageWeight: "",
  notes: "",
  isActive: true
});

const PAGE_SIZE = 50;

const DIRTY_CONFIRM_MESSAGE = "Existem alterações não salvas. Deseja descartá-las?";

const productFormTabs = [
  { id: "identification", label: "Identificação" },
  { id: "classification", label: "Classificação" },
  { id: "units", label: "Unidades" },
  { id: "purchase", label: "Compra" },
  // Localizacao tinha 4 campos e Observacoes 5: duas abas para pouco conteudo,
  // com "Obs. da localizacao" separada dos campos que descreve.
  { id: "location", label: "Local e notas" }
] as const;

type ProductFormTab = (typeof productFormTabs)[number]["id"];

export function Products() {
  const { user } = useSession();
  const canEdit = hasPermission(user, "products", "edit");
  const canDelete = hasPermission(user, "products", "delete");
  const canCreateMasterData = hasPermission(user, "master-data", "create");
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [sectors, setSectors] = useState<InventorySector[]>([]);
  const [units, setUnits] = useState<UnitMeasure[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [dreCategories, setDreCategories] = useState<DRECategory[]>([]);
  const [filters, setFilters] = useState({ search: "", category: "", semDreCategoria: false, status: "ativos" });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalFiltrado, setTotalFiltrado] = useState(0);
  const [summary, setSummary] = useState<ProductSummary | null>(null);
  const [semDreProducts, setSemDreProducts] = useState<Product[]>([]);
  const temFiltroAtivo = Boolean(filters.search || filters.category || filters.semDreCategoria || filters.status !== "ativos");

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
  const [formOpenKey, setFormOpenKey] = useState(0);
  const [tabRevealKey, setTabRevealKey] = useState(0);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [aliasSnapshot, setAliasSnapshot] = useState("");
  const initialSnapshotSet = useRef(false);
  // Altura estimada da barra sticky superior (.product-form-toolbar).
  // Usada só para o cálculo de "já está visível" — o posicionamento fino fica com scroll-margin-top.
  const STICKY_TOP_INSET = 72;
  const formHeaderRef = useRevealScroll<HTMLElement>({
    when: formOpenKey,
    focus: true,
    focusSelector: "[data-autofocus]",
    topInset: STICKY_TOP_INSET
  });
  const activeTabPanelRef = useRevealScroll<HTMLDivElement>({
    when: tabRevealKey,
    focus: false,
    topInset: STICKY_TOP_INSET
  });
  const [alias, setAlias] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { notice, setNotice } = useNotice();
  // Os totais vem do servidor: somar `products` daria o total da pagina, nao o
  // do filtro. Enquanto o resumo nao chega, cai para a pagina atual.
  const totalProdutos = summary?.total ?? products.length;
  const totalAtivos = summary?.ativos ?? products.filter((product) => product.isActive !== false).length;
  const totalInativos = summary?.inativos ?? products.filter((product) => product.isActive === false).length;
  const totalControlamEstoque = summary?.controlamEstoque ?? products.filter((product) => product.controlsStock).length;
  const productsByCategory = summary?.porCategoria ?? countProductsBy(products, (product) => product.category?.name);
  const productsBySector = summary?.porSetor ?? countProductsBy(products, (product) => product.inventorySector?.name);
  const productsByStockControl = useMemo(
    () => summary
      ? [
          { label: "Controla estoque", value: summary.controlamEstoque },
          { label: "Nao controla", value: summary.total - summary.controlamEstoque }
        ]
      : countProductsBy(products, (product) => product.controlsStock ? "Controla estoque" : "Nao controla"),
    [summary, products]
  );
  const selectedSector = sectors.find((sector) => sector.id === form.inventorySectorId) ?? null;
  const classificationPending = !form.inventorySectorId;

  // Ponto na aba avisa onde falta preencher, para nao ter que abrir uma a uma
  // ate descobrir. So o que o cadastro realmente precisa entra aqui.
  const pendenciasPorAba: Record<ProductFormTab, string> = {
    identification: form.name.trim() ? "" : "descrição do produto",
    classification: [
      form.categoryId ? "" : "categoria",
      form.inventorySectorId ? "" : "setor",
      form.dreCategoryId ? "" : "categoria DRE"
    ].filter(Boolean).join(", "),
    units: form.unitMeasureId ? "" : "unidade padrão",
    purchase: "",
    location: ""
  };
  const totalPendencias = Object.values(pendenciasPorAba).filter(Boolean).length;
  const isDirty = useMemo(() => {
    if (snapshot === null) return false;
    return normalizeForm(form) !== snapshot
      || alias !== aliasSnapshot
      || normalizeConversion(conversionForm) !== EMPTY_CONVERSION_KEY;
  }, [form, alias, snapshot, aliasSnapshot, conversionForm]);

  const filtrosAtivos = {
    search: filters.search.trim() || undefined,
    category: filters.category || undefined,
    semDreCategoria: filters.semDreCategoria ? "true" : undefined,
    // A tela abre nos ativos: inativo e excecao e so atrapalhava a busca.
    isActive: filters.status === "todos" ? undefined : filters.status === "ativos" ? "true" : "false"
  };

  async function loadProducts(paginaDesejada = page) {
    setLoading(true);
    setError(null);

    try {
      // Os indicadores sao da base inteira, sem filtro: sao um panorama do
      // cadastro. Seguindo o filtro, buscar "alcool" fazia os cartoes dizerem
      // "2 produtos, 0 sem DRE" — numeros verdadeiros que respondem a pergunta
      // errada. Quem mostra o recorte filtrado e o rodape da paginacao.
      //
      // O resumo pode nao existir ainda (backend anterior ao deploy deste
      // recurso). Falhando, os totais caem para a contagem da pagina, que era
      // o comportamento antigo — a tela nao quebra por causa disso.
      const [pagina, resumo] = await Promise.all([
        getProducts({ ...filtrosAtivos, page: paginaDesejada, pageSize: PAGE_SIZE }),
        getProductsSummary().catch(() => null)
      ]);
      setProducts(pagina.items);
      setTotalPages(pagina.totalPages);
      setTotalFiltrado(pagina.total);
      setSummary(resumo);
      // Filtro que encurta a lista pode deixar a pagina atual alem do fim.
      if (paginaDesejada > pagina.totalPages) {
        setPage(pagina.totalPages);
        return;
      }
      setPage(paginaDesejada);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Erro ao carregar produtos.");
    } finally {
      setLoading(false);
    }
  }

  async function loadBaseData() {
    // Uma chamada so, sob a permissao de products. Antes eram cinco, cada uma
    // num modulo de permissao diferente, num Promise.all sem catch: o primeiro
    // 403 rejeitava tudo e a tela abria com os seletores vazios e nenhum aviso.
    const options = await getProductFormOptions();
    const nextCode = { code: options.nextCode ?? "" };

    // Guards defensivos: se o endpoint retornar payload parcial (mock, backend
    // com bug, resposta antes de terminar), Array.isArray filtra em silencio.
    const categoryRows = Array.isArray(options.categories) ? options.categories : [];
    const subcategoryRows = Array.isArray(options.subcategories) ? options.subcategories : [];
    const sectorRows = Array.isArray(options.sectors) ? options.sectors : [];
    const unitRows = Array.isArray(options.units) ? options.units : [];
    const supplierRows = Array.isArray(options.suppliers) ? options.suppliers : [];
    const dreCategoryRows = Array.isArray(options.dreCategories) ? options.dreCategories : [];

    setCategories(categoryRows);
    setSubcategories(subcategoryRows);
    // Setor desativado nao entra no seletor — mesma regra ja aplicada a
    // unidades e fornecedores logo abaixo.
    setSectors(sanitizeSectorOptions(sectorRows.filter((sector) => sector.isActive !== false)));
    setUnits(unitRows.filter((unit) => unit.isActive));
    setSuppliers(supplierRows.filter((supplier) => supplier.isActive));
    setDreCategories(dreCategoryRows);
    // Categoria e unidade comecam vazias, pedindo escolha.
    // Antes vinha o primeiro item da lista alfabetica: quem nao trocasse
    // gravava classificacao errada sem perceber — e e a categoria que alimenta
    // a sugestao de categoria DRE.
    setForm((current) => ({
      ...current,
      externalCode: current.id ? current.externalCode : current.externalCode || nextCode.code,
      unitMeasureId: current.unitMeasureId || unitRows.find((unit) => unit.code === current.unit)?.id || "",
      unit: current.unit || ""
    }));
    // Ciclo 2: inicializa snapshot uma única vez (mount inicial em novo cadastro).
    // Rechamadas de loadBaseData (após criar categoria/subcategoria) não alteram o baseline.
    if (!initialSnapshotSet.current) {
      const baseline: typeof emptyProduct = {
        ...emptyProduct,
        externalCode: nextCode.code || ""
      };
      setSnapshot(normalizeForm(baseline));
      setAliasSnapshot("");
      initialSnapshotSet.current = true;
    }
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
  // As sugestoes agrupam TODOS os produtos sem categoria DRE, nao os da pagina.
  // Carregados a parte, e so quando o painel abre — a contagem do botao ja vem
  // pronta no resumo.
  const suggestionGroups = useMemo(() => {
    const withoutDre = semDreProducts;
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
  }, [semDreProducts, dreCategories]);

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
      // O painel de sugestoes tem lista propria: sem recarregar, os produtos
      // recem-classificados continuariam listados como pendentes.
      if (showSuggestions) await loadSemDre();
      setNotice({ tone: "success", message: `${res.updated} produto(s) classificado(s).` });
    } catch {
      setNotice({ tone: "error", message: "Erro ao aplicar classificação em lote." });
    } finally {
      setBulkSaving(false);
    }
  }

  // Ciclo 2: separa "reset de dados" de "intenção de revelar/focar".
  // withReveal=true incrementa formOpenKey (reveal + autofocus na Descrição).
  // withReveal=false só reseta os dados — usado por Cancelar.
  async function loadFreshProduct(withReveal: boolean) {
    const nextCode = await getNextProductCode().catch(() => ({ code: "" }));
    // Sem unidade pre-escolhida: o primeiro da lista alfabetica nao tem relacao
    // nenhuma com o produto que esta sendo cadastrado.
    const fresh = {
      ...emptyProduct,
      externalCode: nextCode.code
    };
    setForm(fresh);
    setConversionForm(emptyConversion);
    setAlias("");
    setActiveFormTab("identification");
    setSnapshot(normalizeForm(fresh));
    setAliasSnapshot("");
    if (withReveal) setFormOpenKey((n) => n + 1);
  }

  async function handleCancel() {
    if (isDirty && !window.confirm(DIRTY_CONFIRM_MESSAGE)) return;
    await loadFreshProduct(false);
  }

  async function handleNewDuringEdit() {
    if (isDirty && !window.confirm(DIRTY_CONFIRM_MESSAGE)) return;
    await loadFreshProduct(true);
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

      // O apelido e gravado depois do produto. Se ele conflitar com outro
      // produto, o cadastro ja foi salvo — dizer "erro ao salvar" mandaria o
      // usuario refazer um trabalho que deu certo.
      let aliasError: string | null = null;
      if (alias.trim()) {
        try {
          await addProductAlias(saved.id, alias);
        } catch (error) {
          aliasError = error instanceof Error ? error.message : "Nao foi possivel gravar o apelido.";
        }
      }

      await loadFreshProduct(true);
      await loadProducts();

      if (aliasError) {
        setError(aliasError);
        setNotice({
          tone: "warning",
          message: `${isUpdate ? "Cadastro atualizado" : "Cadastro criado"}, mas o apelido nao foi gravado.`
        });
        return;
      }

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

  // Busca enquanto digita: antes so acontecia no Enter ou no botao Filtrar, e
  // quem digitava e esperava ficava olhando a lista sem mudar.
  const buscaDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const primeiraCarga = useRef(true);
  useEffect(() => {
    if (primeiraCarga.current) { primeiraCarga.current = false; return; }
    if (buscaDebounce.current) clearTimeout(buscaDebounce.current);
    buscaDebounce.current = setTimeout(() => loadProducts(1), 350);
    return () => { if (buscaDebounce.current) clearTimeout(buscaDebounce.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search, filters.category, filters.semDreCategoria, filters.status]);

  async function loadSemDre() {
    try {
      const pagina = await getProducts({ semDreCategoria: "true" });
      setSemDreProducts(pagina.items);
    } catch {
      setSemDreProducts([]);
    }
  }

  useEffect(() => {
    if (showSuggestions) loadSemDre();
  }, [showSuggestions]);

  useEffect(() => {
    loadProducts();
    // Sem o catch, uma falha aqui virava promessa rejeitada solta: os seletores
    // ficavam vazios e a tela nao dizia nada.
    loadBaseData().catch((loadError) => {
      setError(
        loadError instanceof Error
          ? `Nao foi possivel carregar categorias, setores, unidades e fornecedores: ${loadError.message}`
          : "Nao foi possivel carregar os dados de apoio do cadastro."
      );
    });
  }, []);

  // Guard defensivo: mesmo com o setter garantindo array acima, protege
  // renders inicial quando o state ainda nao chegou.
  const filteredSubcategories = (Array.isArray(subcategories) ? subcategories : [])
    .filter((subcategory) => subcategory.categoryId === form.categoryId);

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
          <SummaryCard label="Produtos cadastrados" value={totalProdutos} />
          <SummaryCard label="Ativos" value={totalAtivos} tone="success" />
          <SummaryCard label="Inativos" value={totalInativos} tone={totalInativos ? "warning" : "success"} />
          <SummaryCard label="Controlam estoque" value={totalControlamEstoque} />
        </div>
        <div className="chart-grid">
          <SimpleBarChart title="Distribuição por categoria" items={productsByCategory} />
          <SimpleBarChart title="Produtos por setor" items={productsBySector} />
          <SimpleBarChart title="Controle de estoque" items={productsByStockControl} />
        </div>
      </section>

      <section className="panel scroll-target" ref={formHeaderRef}>
        <div className="section-heading">
          <div>
            <p>Tabela mestre</p>
            <h2>Produto</h2>
          </div>
        </div>

        <div className="product-form-toolbar">
          <div>
            <strong>
              {form.id
                ? `Editando: ${form.externalCode || "-"} — ${form.name || "Sem descrição"}`
                : "Novo produto"}
            </strong>
            <span>
              {isDirty
                ? "Alterações não salvas"
                : form.id
                  ? "Edite os campos e salve as alterações."
                  : "Preencha os blocos abaixo para concluir o cadastro."}
              {totalPendencias > 0 && (
                <em className="pendencia-resumo">
                  {" · "}{totalPendencias} bloco{totalPendencias > 1 ? "s" : ""} com campo pendente
                </em>
              )}
            </span>
          </div>
          {form.id && (
            <div className="actions-cell wrap">
              <button className="secondary-button" type="button" onClick={handleNewDuringEdit}>Novo produto</button>
            </div>
          )}
        </div>

        <div className="product-form-tabs" role="tablist" aria-label="Blocos do cadastro de produto">
          {productFormTabs.map((tab) => (
            <button
              key={tab.id}
              className={`${activeFormTab === tab.id ? "active" : ""}${pendenciasPorAba[tab.id] ? " has-pending" : ""}`}
              type="button"
              role="tab"
              aria-selected={activeFormTab === tab.id}
              title={pendenciasPorAba[tab.id] ? `Falta preencher: ${pendenciasPorAba[tab.id]}` : undefined}
              onClick={() => { setActiveFormTab(tab.id); setTabRevealKey((n) => n + 1); }}
            >
              {tab.label}
              {pendenciasPorAba[tab.id] && <span className="tab-pending-dot" aria-label="tem campo pendente" />}
            </button>
          ))}
        </div>

        <div className="form-section-grid scroll-target" ref={activeTabPanelRef}>
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
                  <input data-autofocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
                </label>
                <article className={`stock-control-card ${form.controlsStock ? "is-enabled" : "is-disabled"}`}>
                  <div>
                    <strong>Controla estoque</strong>
                    <p>{form.controlsStock ? "Participa de contagem e inventario. A entrada no CMV depende da categoria DRE/CMV." : "Fica fora da contagem operacional. A entrada no CMV depende da categoria DRE/CMV."}</p>
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
                <span>Setor, categoria e subcategoria definem contagem, inventario e a leitura contábil do CMV.</span>
              </div>
              <div className="alert info">
                Setor, categoria e subcategoria impactam a contagem setorial, os inventarios oficiais e a leitura do CMV. A categoria DRE define se o item entra em CMV. "Sem setor" deve ser tratado como pendencia.
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
                {/* Criar cadastro base e acao de master-data: quem so tem
                    Produtos le as listas, mas nao cria categoria nova. */}
                {canCreateMasterData && (
                <div className="inline-create-field">
                  <label>
                    Nova categoria
                    <input value={form.newCategoryName} onChange={(event) => setForm({ ...form, newCategoryName: event.target.value })} />
                  </label>
                  <button className="secondary-button" type="button" onClick={handleCreateCategory}>Criar categoria</button>
                </div>
                )}
                {canCreateMasterData && (
                <div className="inline-create-field">
                  <label>
                    Nova subcategoria
                    <input value={form.newSubcategoryName} onChange={(event) => setForm({ ...form, newSubcategoryName: event.target.value })} disabled={!form.categoryId} />
                  </label>
                  <button className="secondary-button" type="button" onClick={handleCreateSubcategory} disabled={!form.categoryId}>Criar subcategoria</button>
                </div>
                )}
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
                    {units.map((unit) => <option key={unit.id} value={unit.code}>{unit.code} - {unit.name}</option>)}
                  </select>
                </label>
                <label>
                  Unidade de compra
                  <select value={form.purchaseUnit} onChange={(event) => setForm({ ...form, purchaseUnit: event.target.value })}>
                    <option value="">Usar unidade padrao</option>
                    {units.map((unit) => <option key={unit.id} value={unit.code}>{unit.code} - {unit.name}</option>)}
                  </select>
                </label>
                <label>
                  Unidade base futura
                  <select value={form.baseUnit} onChange={(event) => setForm({ ...form, baseUnit: event.target.value })}>
                    <option value="">Selecione</option>
                    {units.map((unit) => <option key={unit.id} value={unit.code}>{unit.code} - {unit.name}</option>)}
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
            <>
              <section className="form-section">
                <div className="form-section-header">
                  <h3>Localização no estoque</h3>
                  <span>Ajuda a ordenar a contagem operacional dentro do setor.</span>
                </div>
                <div className="form-grid">
                  <label>Localização<input value={form.storageLocation} onChange={(event) => setForm({ ...form, storageLocation: event.target.value })} /></label>
                  <label>Corredor<input value={form.storageCorridor} onChange={(event) => setForm({ ...form, storageCorridor: event.target.value })} /></label>
                  <label>Prateleira<input value={form.storageShelf} onChange={(event) => setForm({ ...form, storageShelf: event.target.value })} /></label>
                  <label>Posição<input value={form.storagePosition} onChange={(event) => setForm({ ...form, storagePosition: event.target.value })} /></label>
                  {/* Vinha da aba de observacoes: descreve a localizacao, entao
                      fica junto dos campos que complementa. */}
                  <label className="span-2">Obs. da localização<input value={form.storageNotes} onChange={(event) => setForm({ ...form, storageNotes: event.target.value })} /></label>
                </div>
              </section>

              <section className="form-section">
                <div className="form-section-header">
                  <h3>Observações</h3>
                  <span>Notas internas e campos complementares do cadastro.</span>
                </div>
                <div className="form-grid">
                  <label className="span-2">Observações<input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
                  <label>Observação logística<input value={form.logisticsNotes} onChange={(event) => setForm({ ...form, logisticsNotes: event.target.value })} /></label>
                  <label>Obs. de conversão<input value={form.conversionNotes} onChange={(event) => setForm({ ...form, conversionNotes: event.target.value })} /></label>
                  <label>Tipo de conta<input value={form.accountType} onChange={(event) => setForm({ ...form, accountType: event.target.value })} /></label>
                  <label className="checkbox-label"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />Produto ativo</label>
                </div>
              </section>
            </>
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
                <label>Lead time compra (dias)<input type="number" min="0" inputMode="numeric" value={form.leadTimeCompraDias} onChange={(event) => setForm({ ...form, leadTimeCompraDias: event.target.value })} /></label>
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

        </div>

        <div className="form-actions sticky-form-actions">
          <button className="secondary-button" type="button" onClick={handleCancel}>Cancelar</button>
          <button className="primary-button" type="button" disabled={!canEdit} onClick={handleSubmit}>
            {form.id ? "Salvar alterações" : "Salvar produto"}
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div className="prod-page-heading">
            <PanelEyebrow>Tabela mestre</PanelEyebrow>
            <h2>Produtos</h2>
          </div>
          <IconButton icon={<RefreshCw size={16} />} label="Atualizar produtos" onClick={() => loadProducts()} />
        </div>

        <div className="filters-row">
          <label className="search-field">
            Busca
            <span className="search-input-wrap">
              <Search size={15} aria-hidden="true" />
              <input
                placeholder="Nome, código ou apelido"
                value={filters.search}
                onChange={(event) => setFilters({ ...filters, search: event.target.value })}
              />
              {filters.search && (
                <button type="button" className="search-clear" onClick={() => setFilters({ ...filters, search: "" })} aria-label="Limpar busca">
                  <X size={14} />
                </button>
              )}
            </span>
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
          <label>
            Situação
            <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
              <option value="ativos">Ativos</option>
              <option value="inativos">Inativos</option>
              <option value="todos">Todos</option>
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
          {temFiltroAtivo && (
            <button
              type="button"
              className="link-button"
              onClick={() => setFilters({ search: "", category: "", semDreCategoria: false, status: "ativos" })}
            >
              Limpar filtros
            </button>
          )}
          <button
            type="button"
            style={{ marginLeft: "auto" }}
            onClick={() => setShowSuggestions((v) => !v)}
          >
            {showSuggestions ? "Ocultar sugestões" : `Sugestões por categoria (${summary?.semDre ?? 0} sem DRE)`}
          </button>
        </div>

        {/* Painel de sugestões por categoria */}
        {showSuggestions && (
          <div style={{ border: "1px solid var(--line)", borderRadius: "8px", padding: "1rem", marginBottom: "0.5rem" }}>
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
                        ? <span style={{ color: "var(--success)", fontSize: "0.88em" }}>{g.dreCatName}</span>
                        : <span style={{ color: "var(--muted)", fontStyle: "italic", fontSize: "0.88em" }}>— sem sugestão —</span>}
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
                  <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--success)" }}>Todos os produtos têm Categoria DRE!</td></tr>
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
              style={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: "12px", padding: "1.5rem", maxWidth: "420px", width: "90%" }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ marginTop: 0 }}>Confirmar classificação em lote</h3>
              <p>Aplicar <strong>{pendingSuggestion.dreCatName}</strong> em <strong>{pendingSuggestion.ids.length}</strong> produto(s) da categoria <strong>{pendingSuggestion.catName}</strong>?</p>
              <p style={{ fontSize: "0.85em", color: "var(--muted)" }}>Essa ação pode ser desfeita editando cada produto individualmente.</p>
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
              style={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: "12px", padding: "1.5rem", maxWidth: "420px", width: "90%" }}
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
          <div style={{ position: "sticky", top: 0, zIndex: 10, background: "var(--paper-soft)", border: "1px solid var(--line)", borderRadius: "8px", padding: "0.75rem 1rem", display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
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
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.Th style={{ width: "2rem" }}>
                  <input
                    type="checkbox"
                    title="Selecionar todos visíveis"
                    checked={products.length > 0 && products.every((p) => selected.has(p.id))}
                    onChange={(e) => {
                      if (e.target.checked) setSelected(new Set(products.map((p) => p.id)));
                      else setSelected(new Set());
                    }}
                  />
                </Table.Th>
                <Table.Th>Código</Table.Th>
                <Table.Th minWidth={200}>Produto</Table.Th>
                <Table.Th>Categoria</Table.Th>
                <Table.Th>Setor</Table.Th>
                <Table.Th align="center">Estoque</Table.Th>
                <Table.Th>Categoria DRE</Table.Th>
                <Table.Th actions>Ações</Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
                {products.map((product) => (
                  <Table.Row key={product.id} style={selected.has(product.id) ? { backgroundColor: "var(--gold-tint)" } : undefined}>
                    <Table.Td>
                      <input
                        type="checkbox"
                        checked={selected.has(product.id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(product.id); else next.delete(product.id);
                          setSelected(next);
                        }}
                      />
                    </Table.Td>
                    <Table.Td style={{ whiteSpace: "nowrap" }}>{product.externalCode ?? "-"}</Table.Td>
                    <Table.Td truncate title={product.name}>
                      {/* Coluna Status virou selo ao lado do nome: com o filtro
                          abrindo em Ativos, "Ativo" repetido em toda linha so
                          gastava largura. Inativo continua visivel. */}
                      {!product.isActive && <StatusBadge tone="danger">Inativo</StatusBadge>}{" "}
                      {product.name}
                      {/* Apelido extra e informacao util na busca. O
                          normalizedName que ficava aqui era chave interna. */}
                      {(product.aliases?.length ?? 0) > 1 && (
                        <small title={product.aliases?.map((a) => a.alias).join(" · ")}>
                          {(product.aliases?.length ?? 0) - 1} apelido{(product.aliases?.length ?? 0) - 1 > 1 ? "s" : ""}
                        </small>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {product.category?.name ?? <span className="cell-pendente">sem categoria</span>}
                      {product.subcategory && <small>{product.subcategory.name}</small>}
                    </Table.Td>
                    <Table.Td>
                      {product.inventorySector?.name ?? <span className="cell-pendente">sem setor</span>}
                    </Table.Td>
                    <Table.Td align="center">{product.controlsStock === false ? "Não" : "Sim"}</Table.Td>
                    <Table.Td truncate style={{ maxWidth: 180 }}>
                      {product.dreCategory
                        ? <span title={product.dreCategory.name} style={{ fontSize: "0.82em" }}>{product.dreCategory.name}</span>
                        : <span className="cell-pendente">pendente</span>}
                    </Table.Td>
                    <Table.Td actions>
                      <IconButton icon={<Pencil size={16} />} label="Editar" disabled={!canEdit} onClick={() => {
                        if (isDirty && !window.confirm(DIRTY_CONFIRM_MESSAGE)) return;
                        const hydrated: typeof emptyProduct & { id: string } = {
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
                        };
                        setActiveFormTab("identification");
                        setFormOpenKey((n) => n + 1);
                        setForm(hydrated);
                        setAlias("");
                        setSnapshot(normalizeForm(hydrated));
                        setAliasSnapshot("");
                      }} />
                      <RowMenu
                        label={`Mais ações — ${product.name}`}
                        items={[
                          { label: "Ver histórico", icon: <History size={15} />, onClick: () => openHistory(product) },
                          { separator: true },
                          {
                            label: product.isActive ? "Inativar" : "Reativar",
                            icon: <PowerOff size={15} />,
                            tone: product.isActive ? "danger" : "default",
                            disabled: !canDelete,
                            onClick: () => toggleStatus(product)
                          }
                        ]}
                      />
                    </Table.Td>
                  </Table.Row>
                ))}
                {products.length === 0 && (
                  <Table.Row>
                    <Table.Td colSpan={8}>
                      {/* Lista vazia por filtro nao e o mesmo que base vazia:
                          antes as duas diziam "nenhum produto cadastrado". */}
                      {temFiltroAtivo ? (
                        <EmptyState
                          title="Nenhum produto encontrado com esses filtros."
                          action={
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => setFilters({ search: "", category: "", semDreCategoria: false, status: "ativos" })}
                            >
                              Limpar filtros
                            </button>
                          }
                        />
                      ) : (
                        <EmptyState title="Nenhum produto cadastrado." />
                      )}
                    </Table.Td>
                  </Table.Row>
                )}
            </Table.Body>
          </Table>
        )}

        {/* O rodape mostra o recorte filtrado. Aparece mesmo com uma pagina so,
            senao uma busca com poucos resultados nao diz quantos encontrou. */}
        {(totalPages > 1 || temFiltroAtivo) && products.length > 0 && (
          <nav className="pagination-row" aria-label="Paginação de produtos">
            {totalPages > 1 && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => loadProducts(page - 1)}
                disabled={page <= 1 || loading}
              >
                Anterior
              </button>
            )}
            <span className="pagination-status">
              {totalFiltrado} produto{totalFiltrado === 1 ? "" : "s"}
              {temFiltroAtivo ? " no filtro" : ""}
              {totalPages > 1 ? ` · página ${page} de ${totalPages}` : ""}
            </span>
            {totalPages > 1 && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => loadProducts(page + 1)}
                disabled={page >= totalPages || loading}
              >
                Próxima
              </button>
            )}
          </nav>
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
                      <td><Money value={purchase.unitPrice} /></td>
                      <td><Money value={purchase.totalPrice} /></td>
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
