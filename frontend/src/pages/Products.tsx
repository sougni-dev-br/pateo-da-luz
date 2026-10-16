import { History, Pencil, Plus, PowerOff, RefreshCw, Search, Wand2, X } from "lucide-react";
import "./products/editor/product-editor.css";
import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  bulkPatchProductDreCategory,
  Category,
  desfazerLoteDeProdutos,
  DRECategory,
  getProductFormOptions,
  getProductsSummary,
  getProductHistory,
  getProducts,
  InventorySector,
  NatureOption,
  Product,
  ProductNature,
  ProductHistory,
  ProductSummary,
  setProductStatus,
  Subcategory
} from "../api/client";
import { DRECategoryOptions } from "../components/DRECategoryOptions";
import { Notice, useNotice, type NoticeTone } from "../components/Notice";
import { useSession } from "../context/SessionContext";
import { hasPermission } from "../lib/permissions";
import { SimpleBarChart } from "../components/SimpleBarChart";
import { ConversoesAutomaticas } from "./compras/ConversoesAutomaticas";
import { LoteDeProdutos } from "./products/LoteDeProdutos";
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

const PAGE_SIZE = 50;
/** Mesmo teto do servidor: acima disso o filtro é amplo demais para conferir o resumo. */
const LIMITE_DO_LOTE = 2000;
const ROTA_DO_EDITOR = "/estoque/produtos";

const FILTROS_VAZIOS = {
  search: "",
  category: "",
  subcategory: "",
  sector: "",
  controlsStock: "",
  pendencia: "",
  nature: "",
  status: "ativos"
};

export function Products() {
  const { user } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const canEdit = hasPermission(user, "products", "edit");
  // A aplicacao em lote mexe nas compras: so quem tem cargo de gestao (o backend confere).
  const podeConverterEmLote = canEdit && ["ADMIN", "GESTAO_COMPLETA"].includes(String(user?.role ?? ""));
  const [mostrarConversoes, setMostrarConversoes] = useState(false);
  const canDelete = hasPermission(user, "products", "delete");
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [sectors, setSectors] = useState<InventorySector[]>([]);
  const [dreCategories, setDreCategories] = useState<DRECategory[]>([]);
  const [natures, setNatures] = useState<NatureOption[]>([]);
  const [filters, setFilters] = useState(FILTROS_VAZIOS);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalFiltrado, setTotalFiltrado] = useState(0);
  const [summary, setSummary] = useState<ProductSummary | null>(null);
  const [semDreProducts, setSemDreProducts] = useState<Product[]>([]);
  const temFiltroAtivo = (Object.keys(FILTROS_VAZIOS) as Array<keyof typeof FILTROS_VAZIOS>)
    .some((k) => filters[k] !== FILTROS_VAZIOS[k]);
  // Quantos dos filtros escondidos estao ligados, para o botao avisar.
  const filtrosAvancadosAtivos = [filters.subcategory, filters.sector, filters.controlsStock, filters.pendencia]
    .filter(Boolean).length;

  // bulk DRE
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDreCategoryId, setBulkDreCategoryId] = useState("");
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  // Lote de organização: marcar a página ou todo o filtro, e poder desfazer o último.
  const [selecionarFiltro, setSelecionarFiltro] = useState(false);
  const [mostrarLote, setMostrarLote] = useState(false);
  const [ultimoLote, setUltimoLote] = useState<{ id: string; alterados: number } | null>(null);
  const [desfazendo, setDesfazendo] = useState(false);

  const [history, setHistory] = useState<ProductHistory | null>(null);
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
  const filtrosAtivos = {
    search: filters.search.trim() || undefined,
    category: filters.category || undefined,
    subcategory: filters.subcategory || undefined,
    sector: filters.sector || undefined,
    controlsStock: filters.controlsStock || undefined,
    pendencia: filters.pendencia || undefined,
    nature: (filters.nature || undefined) as ProductNature | undefined,
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
    // Guards defensivos: se o endpoint retornar payload parcial (mock, backend
    // com bug, resposta antes de terminar), Array.isArray filtra em silencio.
    const categoryRows = Array.isArray(options.categories) ? options.categories : [];
    const subcategoryRows = Array.isArray(options.subcategories) ? options.subcategories : [];
    const sectorRows = Array.isArray(options.sectors) ? options.sectors : [];
    const dreCategoryRows = Array.isArray(options.dreCategories) ? options.dreCategories : [];

    setCategories(categoryRows);
    setSubcategories(subcategoryRows);
    // Setor desativado nao entra no seletor — mesma regra ja aplicada a
    // unidades e fornecedores logo abaixo.
    setSectors(sanitizeSectorOptions(sectorRows.filter((sector) => sector.isActive !== false)));
    setDreCategories(dreCategoryRows);
    setNatures(Array.isArray(options.natures) ? options.natures : []);
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

  async function desfazerUltimoLote() {
    if (!ultimoLote) return;
    setDesfazendo(true);
    try {
      const resultado = await desfazerLoteDeProdutos(ultimoLote.id);
      setUltimoLote(null);
      await loadProducts();
      setNotice({
        tone: resultado.ignorados > 0 ? "warning" : "success",
        message: resultado.ignorados > 0
          ? `${resultado.desfeitos} produto(s) voltaram ao que eram. ${resultado.ignorados} foram editados depois do lote e ficaram como estão.`
          : `${resultado.desfeitos} produto(s) voltaram ao que eram.`
      });
    } catch (falha) {
      setNotice({ tone: "error", message: falha instanceof Error ? falha.message : "Não foi possível desfazer o lote." });
    } finally {
      setDesfazendo(false);
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
    // "Todo o filtro" vale para o filtro em que foi marcado: mudou o filtro, desmarca.
    setSelecionarFiltro(false);
    buscaDebounce.current = setTimeout(() => loadProducts(1), 350);
    return () => { if (buscaDebounce.current) clearTimeout(buscaDebounce.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search, filters.category, filters.subcategory, filters.sector, filters.controlsStock, filters.pendencia, filters.nature, filters.status]);

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

  // O editor devolve o resultado do salvamento pelo state da navegação.
  useEffect(() => {
    const aviso = (location.state as { notice?: { tone: NoticeTone; message: string } } | null)?.notice;
    if (!aviso) return;
    setNotice(aviso);
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <div className="stack">
      <Notice notice={notice} />


      <section className="panel">
        <div className="section-heading">
          <div className="prod-page-heading">
            <PanelEyebrow>Tabela mestre</PanelEyebrow>
            <h2>Produtos</h2>
          </div>
          <div className="actions-cell">
            <IconButton icon={<RefreshCw size={16} />} label="Atualizar produtos" onClick={() => loadProducts()} />
            <button type="button" className="primary-button" disabled={!canEdit} onClick={() => navigate(`${ROTA_DO_EDITOR}/novo`)}>
              <Plus size={16} aria-hidden="true" /> Novo produto
            </button>
          </div>
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
            Natureza
            <select value={filters.nature} onChange={(event) => setFilters({ ...filters, nature: event.target.value })}>
              <option value="">Todas</option>
              {natures.map((opcao) => <option key={opcao.value} value={opcao.value}>{opcao.label}</option>)}
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
          <button
            type="button"
            className="secondary-button more-filters-toggle"
            aria-expanded={showMoreFilters}
            onClick={() => setShowMoreFilters((v) => !v)}
          >
            {showMoreFilters ? "Menos filtros" : "Mais filtros"}
            {!showMoreFilters && filtrosAvancadosAtivos > 0 && (
              <span className="filter-count">{filtrosAvancadosAtivos}</span>
            )}
          </button>
          {temFiltroAtivo && (
            <button
              type="button"
              className="link-button"
              onClick={() => setFilters(FILTROS_VAZIOS)}
            >
              Limpar filtros
            </button>
          )}
          {/* Sem classe, este botao herdava 26px de altura — alvo pequeno
              demais para o dedo. secondary-button ja tem area de toque. */}
          <button
            type="button"
            className="secondary-button suggestions-toggle"
            onClick={() => setShowSuggestions((v) => !v)}
          >
            {showSuggestions ? "Ocultar sugestões" : `Sugestões por categoria (${summary?.semDre ?? 0} sem DRE)`}
          </button>
        </div>

        {showMoreFilters && (
          <div className="filters-row filters-row-advanced">
            <label>
              Setor
              <select value={filters.sector} onChange={(e) => setFilters({ ...filters, sector: e.target.value })}>
                <option value="">Todos</option>
                {sectors.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </label>
            <label>
              Subcategoria
              <select
                value={filters.subcategory}
                onChange={(e) => setFilters({ ...filters, subcategory: e.target.value })}
                disabled={!filters.category}
                title={filters.category ? undefined : "Escolha uma categoria primeiro"}
              >
                {/* Sem categoria escolhida a lista teria as 40 subcategorias
                    soltas, sem indicar a qual categoria cada uma pertence. */}
                <option value="">{filters.category ? "Todas" : "Escolha a categoria"}</option>
                {subcategories
                  .filter((sub) => {
                    const cat = categories.find((c) => c.name === filters.category);
                    return cat ? sub.categoryId === cat.id : false;
                  })
                  .map((sub) => <option key={sub.id} value={sub.name}>{sub.name}</option>)}
              </select>
            </label>
            <label>
              Controla estoque
              <select value={filters.controlsStock} onChange={(e) => setFilters({ ...filters, controlsStock: e.target.value })}>
                <option value="">Tanto faz</option>
                <option value="true">Sim, entra na contagem</option>
                <option value="false">Não, é despesa direta</option>
              </select>
            </label>
            <label>
              Pendência de cadastro
              <select value={filters.pendencia} onChange={(e) => setFilters({ ...filters, pendencia: e.target.value })}>
                <option value="">Nenhuma</option>
                <option value="sem-setor">Sem setor</option>
                <option value="sem-categoria">Sem categoria</option>
                <option value="sem-subcategoria">Sem subcategoria</option>
                <option value="sem-dre">Sem categoria DRE</option>
                <option value="sem-natureza">Sem natureza</option>
              </select>
            </label>
          </div>
        )}

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

        {selected.size > 0 && (
          <div className="lote-barra" role="group" aria-label="Seleção para organizar em lote">
            {selecionarFiltro ? (
              <span><strong>{totalFiltrado}</strong> produtos do filtro selecionados.</span>
            ) : (
              <span><strong>{selected.size}</strong> selecionado{selected.size === 1 ? "" : "s"}.</span>
            )}
            {!selecionarFiltro && products.length > 0 && products.every((p) => selected.has(p.id)) && totalFiltrado > products.length && (
              <button
                type="button"
                className="link-button"
                disabled={totalFiltrado > LIMITE_DO_LOTE}
                title={totalFiltrado > LIMITE_DO_LOTE ? `O lote aceita até ${LIMITE_DO_LOTE} produtos: refine o filtro.` : undefined}
                onClick={() => setSelecionarFiltro(true)}
              >
                Selecionar os {totalFiltrado} do filtro
              </button>
            )}
            {selecionarFiltro && (
              <button type="button" className="link-button" onClick={() => setSelecionarFiltro(false)}>Voltar para a página</button>
            )}
            <button type="button" className="primary-button" disabled={!canEdit} onClick={() => setMostrarLote((v) => !v)} aria-expanded={mostrarLote}>
              Organizar…
            </button>
          </div>
        )}

        {mostrarLote && selected.size > 0 && (
          <LoteDeProdutos
            alvo={selecionarFiltro ? { filtro: filtrosAtivos } : { ids: [...selected] }}
            quantidade={selecionarFiltro ? totalFiltrado : selected.size}
            categoriaDoFiltroId={categories.find((c) => c.name === filters.category)?.id}
            categories={categories}
            subcategories={subcategories}
            sectors={sectors}
            natures={natures}
            onFechar={() => setMostrarLote(false)}
            onAplicado={(resumo) => {
              setMostrarLote(false);
              setSelected(new Set());
              setSelecionarFiltro(false);
              void loadProducts();
              if (resumo.loteId) {
                setUltimoLote({ id: resumo.loteId, alterados: resumo.alterar });
                setNotice({ tone: "success", message: `${resumo.alterar} produto(s) organizados.${resumo.recusados > 0 ? ` ${resumo.recusados} não puderam mudar.` : ""}` });
              } else {
                setNotice({ tone: "info", message: "Nada a alterar: os produtos já estavam assim." });
              }
            }}
          />
        )}

        {ultimoLote && (
          <div className="lote-desfazer" role="status">
            <span>Lote aplicado em <strong>{ultimoLote.alterados}</strong> produto(s).</span>
            <button type="button" className="secondary-button" disabled={desfazendo} onClick={() => void desfazerUltimoLote()}>
              {desfazendo ? "Desfazendo..." : "Desfazer"}
            </button>
            <button type="button" className="link-button" disabled={desfazendo} onClick={() => setUltimoLote(null)}>Dispensar</button>
          </div>
        )}

        {/* Barra de ação em lote */}
        {selected.size > 0 && (
          <div style={{ position: "sticky", top: 0, zIndex: 10, background: "var(--paper-soft)", border: "1px solid var(--line)", borderRadius: "8px", padding: "0.75rem 1rem", display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
            <strong style={{ whiteSpace: "nowrap" }}>Categoria DRE (muda o histórico):</strong>
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
                <Table.Th>Natureza</Table.Th>
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
                      {product.nature
                        ? natures.find((opcao) => opcao.value === product.nature)?.label ?? product.nature
                        : <span className="cell-pendente">sem natureza</span>}
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
                      <IconButton icon={<Pencil size={16} />} label="Editar" disabled={!canEdit} onClick={() => navigate(`${ROTA_DO_EDITOR}/${product.id}/editar`)} />
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
                    <Table.Td colSpan={9}>
                      {/* Lista vazia por filtro nao e o mesmo que base vazia:
                          antes as duas diziam "nenhum produto cadastrado". */}
                      {temFiltroAtivo ? (
                        <EmptyState
                          title="Nenhum produto encontrado com esses filtros."
                          action={
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => setFilters(FILTROS_VAZIOS)}
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

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>Cadastro operacional</p>
            <h2>Indicadores de produtos</h2>
          </div>
          {podeConverterEmLote && (
            <button type="button" className="secondary-button" aria-pressed={mostrarConversoes} onClick={() => setMostrarConversoes((v) => !v)}>
              <Wand2 size={16} /> Conversões automáticas
            </button>
          )}
        </div>
        {mostrarConversoes && <ConversoesAutomaticas onFechar={() => setMostrarConversoes(false)} onAplicado={() => void loadProducts()} />}
        <div className="summary-grid dashboard-summary">
          <SummaryCard label="Produtos cadastrados" value={totalProdutos} />
          <SummaryCard label="Ativos" value={totalAtivos} tone="success" />
          <SummaryCard label="Inativos" value={totalInativos} tone={totalInativos ? "warning" : "success"} />
          <SummaryCard label="Controlam estoque" value={totalControlamEstoque} />
        </div>
        <details className="produtos-graficos">
          <summary>Ver gráficos de distribuição</summary>
        <div className="chart-grid">
          <SimpleBarChart title="Distribuição por categoria" items={productsByCategory} />
          <SimpleBarChart title="Produtos por setor" items={productsBySector} />
          <SimpleBarChart title="Controle de estoque" items={productsByStockControl} />
        </div>
        </details>
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
