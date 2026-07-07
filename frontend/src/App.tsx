import {
  BadgeDollarSign,
  BarChart3,
  Building2,
  Calculator,
  ChefHat,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  Database,
  FileCog,
  FileSpreadsheet,
  Layers,
  LogOut,
  Menu,
  Package,
  ReceiptText,
  RefreshCw,
  ScrollText,
  Shield,
  Truck,
  WalletCards,
  Warehouse,
  X
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes, matchPath, useLocation, useNavigate, useParams } from "react-router-dom";
import { AppUser, addMenuFavorite, getMe, getMenuFavorites, getStockCountSessions, logout, removeMenuFavorite, type PermissionAction } from "./api/client";
import { PageHeader } from "./components/ui";
import { SessionContext } from "./context/SessionContext";
import { MockUserBadge } from "./components/MockUserBadge";
import {
  AppShell,
  ContentErrorBoundary,
  HideValuesProvider,
  LoginShell,
  Sidebar,
  SidebarNav,
  Topbar,
  withFavoritesGroup
} from "./design-system";
import type { SidebarSectionGroup } from "./design-system";
import { isMockUserMode, MOCK_USER } from "./lib/mockUser";
import { canAccessModule, hasPermission as userHasPermission } from "./lib/permissions";
import { ForcedPasswordChange } from "./pages/ForcedPasswordChange";
import type { ImportTab } from "./pages/ImportsHub";
import { Login } from "./pages/Login";
import { isLocal } from "./utils/env";

const Audit = lazy(() => import("./pages/Audit").then((module) => ({ default: module.Audit })));
const CatalogImports = lazy(() => import("./pages/CatalogImports").then((module) => ({ default: module.CatalogImports })));
const Cards = lazy(() => import("./pages/Cards").then((module) => ({ default: module.Cards })));
const Cash = lazy(() => import("./pages/Cash").then((module) => ({ default: module.Cash })));
const CmvReal = lazy(() => import("./pages/CmvReal").then((module) => ({ default: module.CmvReal })));
const Dashboard = lazy(() => import("./pages/Dashboard").then((module) => ({ default: module.Dashboard })));
const ImportsHub = lazy(() => import("./pages/ImportsHub").then((module) => ({ default: module.ImportsHub })));
const Inventory = lazy(() => import("./pages/Inventory").then((module) => ({ default: module.Inventory })));
const MasterData = lazy(() => import("./pages/MasterData").then((module) => ({ default: module.MasterData })));
const MonthlyClosing = lazy(() => import("./pages/MonthlyClosing").then((module) => ({ default: module.MonthlyClosing })));
const Payables = lazy(() => import("./pages/Payables").then((module) => ({ default: module.Payables })));
const PaymentMethods = lazy(() => import("./pages/PaymentMethods").then((module) => ({ default: module.PaymentMethods })));
const Products = lazy(() => import("./pages/Products").then((module) => ({ default: module.Products })));
const PurchaseOrders = lazy(() => import("./pages/PurchaseOrders").then((module) => ({ default: module.PurchaseOrders })));
const PurchasePlanning = lazy(() => import("./pages/PurchasePlanning").then((module) => ({ default: module.PurchasePlanning })));
const Purchases = lazy(() => import("./pages/Purchases").then((module) => ({ default: module.Purchases })));
const Revenue = lazy(() => import("./pages/Revenue").then((module) => ({ default: module.Revenue })));
const FaturamentoSalao = lazy(() => import("./pages/FaturamentoSalao").then((module) => ({ default: module.FaturamentoSalao })));
const Suppliers = lazy(() => import("./pages/Suppliers").then((module) => ({ default: module.Suppliers })));
const Companies = lazy(() => import("./pages/Companies").then((module) => ({ default: module.Companies })));
const Requisitions = lazy(() => import("./pages/Requisitions").then((module) => ({ default: module.Requisitions })));
const Users = lazy(() => import("./pages/Users").then((module) => ({ default: module.Users })));
const Dishes = lazy(() => import("./pages/Dishes").then((module) => ({ default: module.Dishes })));
const DRE = lazy(() => import("./pages/DRE").then((module) => ({ default: module.DRE })));
const SupplierCycles = lazy(() => import("./pages/SupplierCycles").then((module) => ({ default: module.SupplierCycles })));
const TaxPayments = lazy(() => import("./pages/TaxPayments").then((module) => ({ default: module.TaxPayments })));
// Rota /design-system: dev-only (isLocal). Em prod, o ternario resolve para null
// no build e Vite tree-shake o chunk. Nao aparece na sidebar (nao esta em sections).
const DesignSystem = isLocal
  ? lazy(() => import("./pages/DesignSystem").then((module) => ({ default: module.DesignSystem })))
  : null;

type InventoryView = "overview" | "movements" | "counting" | "inventory" | "reports";

type SectionDefinition = {
  id: string;
  label: string;
  icon: typeof BarChart3;
  showInSidebar: boolean;
  group: string;
  path: string;
  matchers: string[];
  /** Contexto do módulo exibido como description do PageHeader (regra Fase 5). */
  description?: string;
};

const sections = [
  { id: "dashboard", label: "Dashboard", icon: BarChart3, showInSidebar: true, group: "Visão geral", path: "/", matchers: ["/", "/dashboard"] },
  { id: "purchases", label: "Compras", icon: ReceiptText, showInSidebar: true, group: "Operação", path: "/compras", matchers: ["/compras", "/compras/nova", "/compras/:id/editar"], description: "Registro e controle de compras do período" },
  { id: "purchase-orders", label: "Pedidos de compra", icon: ClipboardList, showInSidebar: true, group: "Operação", path: "/compras/pedidos", matchers: ["/compras/pedidos"], description: "Pedidos operacionais gerados a partir da pré-lista do comprador. Ainda não integram contas a pagar." },
  { id: "payables", label: "Contas a pagar", icon: WalletCards, showInSidebar: true, group: "Financeiro", path: "/financeiro/contas-a-pagar", matchers: ["/financeiro/contas-a-pagar"] },
  { id: "revenue", label: "Faturamento", icon: BadgeDollarSign, showInSidebar: true, group: "Financeiro", path: "/financeiro/faturamento", matchers: ["/financeiro/faturamento"] },
  { id: "faturamento-salao", label: "Salão (Agile PDV)", icon: BadgeDollarSign, showInSidebar: true, group: "Financeiro", path: "/financeiro/faturamento-salao", matchers: ["/financeiro/faturamento-salao"], description: "Faturamento do salão sincronizado automaticamente pelo agente do PDV" },
  { id: "cards", label: "Cartões", icon: CreditCard, showInSidebar: true, group: "Financeiro", path: "/financeiro/cartoes", matchers: ["/financeiro/cartoes"] },
  { id: "cash", label: "Caixa", icon: BadgeDollarSign, showInSidebar: true, group: "Financeiro", path: "/financeiro/caixa", matchers: ["/financeiro/caixa"] },
  { id: "cmv-real", label: "CMV Real", icon: Calculator, showInSidebar: true, group: "CMV", path: "/cmv/real", matchers: ["/cmv/real"] },
  { id: "monthly-closing", label: "Fechamento mensal", icon: FileCog, showInSidebar: true, group: "CMV", path: "/cmv/fechamento-mensal", matchers: ["/cmv/fechamento-mensal"] },
  { id: "inventory", label: "Visão Geral", icon: Warehouse, showInSidebar: true, group: "Estoque", path: "/estoque/visao-geral", matchers: ["/estoque/visao-geral"] },
  { id: "products", label: "Produtos", icon: Package, showInSidebar: true, group: "Estoque", path: "/estoque/produtos", matchers: ["/estoque/produtos"] },
  { id: "inventory-movements", label: "Movimentações", icon: Truck, showInSidebar: true, group: "Estoque", path: "/estoque/movimentacoes", matchers: ["/estoque/movimentacoes"] },
  { id: "inventory-counting", label: "Contagem de Estoque", icon: ClipboardList, showInSidebar: true, group: "Estoque", path: "/estoque/contagens", matchers: ["/estoque/contagens", "/estoque/contagens/:sessionId/lancar"] },
  { id: "inventory-official", label: "Inventário", icon: FileSpreadsheet, showInSidebar: true, group: "Estoque", path: "/estoque/inventario", matchers: ["/estoque/inventario", "/estoque/planejamento-compra"] },
  { id: "inventory-reports", label: "Relatórios", icon: BarChart3, showInSidebar: true, group: "Estoque", path: "/estoque/relatorios", matchers: ["/estoque/relatorios"] },
  { id: "requisitions", label: "Requisições", icon: ClipboardCheck, showInSidebar: true, group: "Estoque", path: "/estoque/requisicoes", matchers: ["/estoque/requisicoes"] },
  { id: "dishes", label: "Fichas Técnicas", icon: ChefHat, showInSidebar: true, group: "Cardápio", path: "/cardapio/fichas-tecnicas", matchers: ["/cardapio/fichas-tecnicas"] },
  { id: "dre", label: "DRE Gerencial", icon: BarChart3, showInSidebar: true, group: "Financeiro", path: "/financeiro/dre", matchers: ["/financeiro/dre"] },
  { id: "tax-payments", label: "Impostos e Guias", icon: ScrollText, showInSidebar: true, group: "Financeiro", path: "/financeiro/impostos", matchers: ["/financeiro/impostos"] },
  { id: "supplier-cycles", label: "Ciclos de fornecedor", icon: RefreshCw, showInSidebar: true, group: "Financeiro", path: "/financeiro/ciclos-fornecedor", matchers: ["/financeiro/ciclos-fornecedor"], description: "Agrupa compras por fornecedor para pagamento consolidado" },
  { id: "suppliers", label: "Fornecedores", icon: Truck, showInSidebar: true, group: "Cadastros", path: "/cadastros/fornecedores", matchers: ["/cadastros/fornecedores"], description: "Cadastro utilizado em compras, pagamentos e relatórios financeiros" },
  { id: "companies", label: "Empresas", icon: Building2, showInSidebar: true, group: "Cadastros", path: "/cadastros/empresas", matchers: ["/cadastros/empresas"] },
  { id: "import", label: "Importações", icon: FileSpreadsheet, showInSidebar: true, group: "Dados", path: "/dados/importacoes", matchers: ["/dados/importacoes"] },
  { id: "catalog-imports", label: "Importar cadastros", icon: Database, showInSidebar: false, group: "Dados", path: "/dados/importacoes/cadastros", matchers: ["/dados/importacoes/cadastros"] },
  { id: "payment-methods", label: "Pagamentos", icon: CreditCard, showInSidebar: true, group: "Configurações", path: "/configuracoes/pagamentos", matchers: ["/configuracoes/pagamentos"] },
  { id: "master-data", label: "Cadastros base", icon: Layers, showInSidebar: true, group: "Configurações", path: "/configuracoes/cadastros-base", matchers: ["/configuracoes/cadastros-base"] },
  { id: "users", label: "Usuários", icon: Shield, showInSidebar: true, group: "Configurações", path: "/configuracoes/usuarios", matchers: ["/configuracoes/usuarios"] },
  { id: "audit", label: "Auditoria", icon: ScrollText, showInSidebar: true, group: "Configurações", path: "/configuracoes/auditoria", matchers: ["/configuracoes/auditoria"] }
] as const satisfies readonly SectionDefinition[];

type SectionId = (typeof sections)[number]["id"];
const logoPath = "/logo-pateo-luz.png";

function fallbackSectionAllowedForUser(sectionId: SectionId, user: AppUser) {
  if (user.role === "ESTOQUISTA") {
    return ["inventory", "inventory-counting", "requisitions"].includes(sectionId);
  }

  if (user.role === "VISUALIZACAO") {
    return !["import", "catalog-imports", "cash", "users", "audit"].includes(sectionId);
  }

  return true;
}

function sectionAllowedForUser(sectionId: SectionId, user: AppUser) {
  if (user.modulePermissions?.[sectionId]) return canAccessModule(user, sectionId);
  const level = user.menuPermissions?.[sectionId];
  if (level) return level === "VIEW" || level === "FULL";
  return fallbackSectionAllowedForUser(sectionId, user);
}

function findSectionByPath(pathname: string) {
  return sections.find((section) =>
    section.matchers.some((matcher) => matchPath({ path: matcher, end: true }, pathname))
  ) ?? null;
}

type InventoryRouteViewProps = {
  user: AppUser;
  initialView: InventoryView;
  onOpenProducts: () => void;
  onOpenPurchaseOrders: () => void;
};

function InventoryRouteView({ user, initialView, onOpenProducts, onOpenPurchaseOrders }: InventoryRouteViewProps) {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId?: string }>();

  return (
    <Inventory
      user={user}
      initialView={initialView}
      countSessionId={sessionId ?? null}
      onOpenProducts={onOpenProducts}
      onOpenPurchaseOrders={onOpenPurchaseOrders}
      onOpenCountSessionRoute={(id) => navigate(`/estoque/contagens/${id}/lancar`)}
      onCloseCountSessionRoute={() => navigate("/estoque/contagens")}
    />
  );
}

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [importsTab, setImportsTab] = useState<ImportTab>("revenue");
  const [cashEntryId, setCashEntryId] = useState<string | null>(null);
  // mock-user (dev-only): bypassa auth e usa um AppUser sintetico. Sempre
  // avaliado no mount — se ligar ?mock-user=1 apos start, e preciso reload.
  const mockMode = isMockUserMode();
  const [user, setUser] = useState<AppUser | null>(mockMode ? MOCK_USER : null);
  const [checkingSession, setCheckingSession] = useState(!mockMode);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [hideSensitiveValues, setHideSensitiveValues] = useState(() => window.localStorage.getItem("hideSensitiveValues") === "true");
  const [favorites, setFavorites] = useState<string[]>([]);
  // Contagens CONCLUIDAS ainda nao convertidas em pedido/inventario — usado no badge
  // do item "Pedidos de compra" no sidebar. Derivado do endpoint que a Inventory ja consome.
  const [pendingCountSessionCount, setPendingCountSessionCount] = useState(0);
  const contentRef = useRef<HTMLElement | null>(null);

  const toggleSensitiveValues = () => {
    const next = !hideSensitiveValues;
    window.localStorage.setItem("hideSensitiveValues", String(next));
    setHideSensitiveValues(next);
  };

  const sessionContextValue = useMemo(() => ({
    user,
    setUser,
    hideSensitiveValues,
    toggleSensitiveValues,
    canAccessSection: (sectionId: string) => user ? sectionAllowedForUser(sectionId as SectionId, user) : false,
    hasPermission: (moduleId: string, action: PermissionAction) => userHasPermission(user, moduleId, action)
  }), [hideSensitiveValues, user]);

  const visibleSections = user
    ? sections.filter((section) => section.showInSidebar && sectionAllowedForUser(section.id, user))
    : sections.filter((section) => section.showInSidebar);

  const fallbackSection = visibleSections[0] ?? sections.find((section) => section.id === "inventory") ?? sections[0];
  const matchedSection = findSectionByPath(location.pathname);
  const effectiveSection = matchedSection && (!user || sectionAllowedForUser(matchedSection.id, user))
    ? matchedSection
    : fallbackSection;
  const activeLabel = effectiveSection.label;
  const activeGroup = effectiveSection.group;
  const groupedSections = visibleSections.reduce<Array<{ group: string; items: typeof visibleSections }>>((groups, section) => {
    const current = groups.find((group) => group.group === section.group);
    if (current) current.items.push(section);
    else groups.push({ group: section.group, items: [section] });
    return groups;
  }, []);

  useEffect(() => {
    if (mockMode) return;
    getMe()
      .then((me) => {
        setUser(me);
        return getMenuFavorites().then(setFavorites).catch(() => undefined);
      })
      .catch(() => setUser(null))
      .finally(() => setCheckingSession(false));
  }, [mockMode]);

  useEffect(() => {
    if (!user || checkingSession) return;
    if (matchedSection && sectionAllowedForUser(matchedSection.id, user)) return;
    navigate(fallbackSection.path, { replace: true });
  }, [checkingSession, fallbackSection.path, matchedSection, navigate, user]);

  // Badge de contagens prontas para virar pedido: refetch em mudanca de rota (natural,
  // sem polling). Falhas silenciosas: badge simplesmente nao renderiza se usuario nao
  // tiver permissao no endpoint.
  useEffect(() => {
    if (mockMode) return;
    if (!user || checkingSession) return;
    let active = true;
    getStockCountSessions()
      .then((rows) => {
        if (!active) return;
        const count = rows.filter((s) => s.status === "CONCLUIDA" && !s.generatedInventoryId).length;
        setPendingCountSessionCount(count);
      })
      .catch(() => { if (active) setPendingCountSessionCount(0); });
    return () => { active = false; };
  }, [mockMode, user, checkingSession, location.pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileMenuOpen]);

  // Rede de seguranca: qualquer troca de rota fecha o drawer, independentemente
  // do caminho de navegacao que disparou.
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  function scrollToPageTop() {
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
      contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function toggleFavorite(sectionId: SectionId) {
    const isFav = favorites.includes(sectionId);
    if (isFav) {
      setFavorites((prev) => prev.filter((k) => k !== sectionId));
      removeMenuFavorite(sectionId).catch(() => {
        setFavorites((prev) => (prev.includes(sectionId) ? prev : [...prev, sectionId]));
      });
    } else {
      setFavorites((prev) => [...prev, sectionId]);
      addMenuFavorite(sectionId).catch(() => {
        setFavorites((prev) => prev.filter((k) => k !== sectionId));
      });
    }
  }

  function handleNavigate(sectionId: SectionId) {
    const section = sections.find((entry) => entry.id === sectionId);
    if (!section) return;
    setMobileMenuOpen(false);
    navigate(section.path);
    scrollToPageTop();
  }

  // Props reutilizadas pela <Sidebar /> desktop e pelo <SidebarNav /> do mobile drawer.
  const sidebarGroups: SidebarSectionGroup[] = groupedSections.map((group) => ({
    group: group.group,
    items: group.items.map((section) => ({
      id: section.id,
      label: section.label,
      icon: section.icon
    }))
  }));
  const sidebarBadges: Record<string, number> =
    pendingCountSessionCount > 0 ? { "purchase-orders": pendingCountSessionCount } : {};
  const mobileDrawerGroups = withFavoritesGroup(sidebarGroups, favorites);

  // Topbar: breadcrumb "Pateo da Luz / <grupo atual>" + periodo em pt-BR
  // corrente. Search e sino sao stubs por enquanto — apenas visuais.
  const MONTH_NAMES_PT = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];
  const _now = new Date();
  const topbarPeriod = `${MONTH_NAMES_PT[_now.getMonth()]} ${_now.getFullYear()}`;
  const topbarBreadcrumb = ["Pateo da Luz", activeGroup];

  // /design-system e dev-only e nao depende de auth. Renderiza antes das checagens
  // de sessao para permitir preview sem backend/login em desenvolvimento.
  if (isLocal && DesignSystem && location.pathname === "/design-system") {
    return (
      <SessionContext.Provider value={sessionContextValue}>
        <HideValuesProvider>
          <Suspense fallback={<div className="page-loading">Carregando DS...</div>}>
            <DesignSystem />
          </Suspense>
        </HideValuesProvider>
      </SessionContext.Provider>
    );
  }

  if (checkingSession) {
    return (
      <SessionContext.Provider value={sessionContextValue}>
        <HideValuesProvider>
          <LoginShell formTitle="Carregando sessão" formSubtitle={null} legal={null}>
            <p style={{ textAlign: "center", color: "var(--muted)", margin: 0 }}>Carregando sessão...</p>
          </LoginShell>
        </HideValuesProvider>
      </SessionContext.Provider>
    );
  }

  if (!user) {
    return (
      <SessionContext.Provider value={sessionContextValue}>
        <HideValuesProvider>
          <Login onLogin={setUser} />
        </HideValuesProvider>
      </SessionContext.Provider>
    );
  }

  if (user.mustChangePassword) {
    return (
      <SessionContext.Provider value={sessionContextValue}>
        <HideValuesProvider>
          <ForcedPasswordChange user={user} onChanged={setUser} />
        </HideValuesProvider>
      </SessionContext.Provider>
    );
  }

  const mobileHeaderNode = (
    <header className="mobile-app-header">
      <button type="button" aria-label="Abrir menu" onClick={() => setMobileMenuOpen(true)}>
        <Menu size={22} />
      </button>
      <strong>{activeLabel}</strong>
    </header>
  );

  const drawerNode = (
    <AnimatePresence>
      {mobileMenuOpen && (
        <>
          <motion.button
            aria-label="Fechar menu"
            className="mobile-drawer-backdrop"
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onClick={() => setMobileMenuOpen(false)}
          />
          <motion.aside
            className="mobile-drawer"
            initial={{ x: "-104%" }}
            animate={{ x: 0 }}
            exit={{ x: "-104%" }}
            transition={{ type: "spring", stiffness: 420, damping: 38, mass: 0.8 }}
          >
            <div className="mobile-drawer-header">
              <div className="ds-sidebar-brand">
                <div className="ds-sidebar-brand-logo-wrap">
                  <img
                    src={logoPath}
                    alt="Pateo da Luz"
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                  <span className="ds-sidebar-brand-logo-fallback">PL</span>
                </div>
                <div className="ds-sidebar-brand-meta">
                  <strong className="ds-sidebar-brand-name">Pateo da Luz</strong>
                  <span className="ds-sidebar-brand-tag">Gestão eficiente</span>
                </div>
              </div>
              <button className="mobile-drawer-close" type="button" aria-label="Fechar menu" onClick={() => setMobileMenuOpen(false)}>
                <X size={21} />
              </button>
            </div>
            <div className="mobile-drawer-body">
              <SidebarNav
                groups={mobileDrawerGroups}
                activeId={effectiveSection.id}
                favorites={favorites}
                onNavigate={(id) => handleNavigate(id as SectionId)}
                onToggleFavorite={(id) => toggleFavorite(id as SectionId)}
                badges={sidebarBadges}
              />
              <div className="ds-sidebar-footer mobile-drawer-user">
                <div className="ds-sidebar-footer-meta">
                  <span className="ds-sidebar-footer-meta-name">{user.name}</span>
                  <small className="ds-sidebar-footer-meta-role">{user.role}</small>
                </div>
                <div className="ds-sidebar-footer-actions">
                  <button
                    className="ds-sidebar-footer-button"
                    type="button"
                    aria-pressed={hideSensitiveValues}
                    onClick={toggleSensitiveValues}
                  >
                    {hideSensitiveValues ? "Mostrar valores" : "Ocultar valores"}
                  </button>
                  <button
                    className="ds-sidebar-footer-button ds-sidebar-footer-button-danger"
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      setUser(null);
                      logout();
                    }}
                  >
                    <LogOut size={16} />
                    Sair
                  </button>
                </div>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );

  const sidebarNode = (
    <Sidebar
      groups={sidebarGroups}
      activeId={effectiveSection.id}
      user={{ name: user.name, role: user.role }}
      favorites={favorites}
      onNavigate={(id) => handleNavigate(id as SectionId)}
      onToggleFavorite={(id) => toggleFavorite(id as SectionId)}
      badges={sidebarBadges}
      hideValues={hideSensitiveValues}
      onToggleValues={toggleSensitiveValues}
      onLogout={() => {
        setUser(null);
        logout();
      }}
      showDevBadge={isLocal}
      logoPath={logoPath}
    />
  );

  return (
    <SessionContext.Provider value={sessionContextValue}>
      <HideValuesProvider>
        <MockUserBadge />
        <AppShell
          ref={contentRef}
          mobileHeader={mobileHeaderNode}
          drawer={drawerNode}
          sidebar={sidebarNode}
          topbar={(
            <Topbar
              breadcrumb={topbarBreadcrumb}
              period={topbarPeriod}
              hideValues={hideSensitiveValues}
              onToggleValues={toggleSensitiveValues}
            />
          )}
        >
          <PageHeader title={activeLabel} description={(effectiveSection as SectionDefinition).description} />

          <Suspense fallback={<div className="page-loading">Carregando módulo...</div>}>
            <ContentErrorBoundary>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/dashboard" element={<Navigate to="/" replace />} />
              <Route path="/dados/importacoes" element={<ImportsHub activeTab={importsTab} onTabChange={setImportsTab} onNavigate={handleNavigate} />} />
              <Route path="/dados/importacoes/cadastros" element={<CatalogImports />} />
              <Route path="/compras" element={<Purchases user={user} />} />
              <Route path="/compras/nova" element={<Purchases user={user} />} />
              <Route path="/compras/:id/editar" element={<Purchases user={user} />} />
              <Route path="/compras/pedidos" element={<PurchaseOrders user={user} />} />
              <Route path="/financeiro/contas-a-pagar" element={<Payables user={user} />} />
              <Route path="/financeiro/cartoes" element={<Cards user={user} />} />
              <Route
                path="/financeiro/faturamento"
                element={(
                  <Revenue
                    user={user}
                    onOpenCash={(entryId) => {
                      setCashEntryId(entryId ?? null);
                      handleNavigate("cash");
                    }}
                    onOpenImports={(tab) => {
                      setImportsTab(tab);
                      handleNavigate("import");
                    }}
                  />
                )}
              />
              <Route path="/financeiro/faturamento-salao" element={<FaturamentoSalao user={user} />} />
              <Route
                path="/financeiro/caixa"
                element={(
                  <Cash
                    user={user}
                    entryId={cashEntryId}
                    onOpenRevenue={() => {
                      setCashEntryId(null);
                      handleNavigate("revenue");
                    }}
                  />
                )}
              />
              <Route path="/cmv/real" element={<CmvReal user={user} />} />
              <Route path="/cmv/fechamento-mensal" element={<MonthlyClosing user={user} />} />
              <Route path="/estoque/visao-geral" element={<InventoryRouteView user={user} initialView="overview" onOpenProducts={() => handleNavigate("products")} onOpenPurchaseOrders={() => handleNavigate("purchase-orders")} />} />
              <Route path="/estoque/movimentacoes" element={<InventoryRouteView user={user} initialView="movements" onOpenProducts={() => handleNavigate("products")} onOpenPurchaseOrders={() => handleNavigate("purchase-orders")} />} />
              <Route path="/estoque/contagens" element={<InventoryRouteView user={user} initialView="counting" onOpenProducts={() => handleNavigate("products")} onOpenPurchaseOrders={() => handleNavigate("purchase-orders")} />} />
              <Route path="/estoque/contagens/:sessionId/lancar" element={<InventoryRouteView user={user} initialView="counting" onOpenProducts={() => handleNavigate("products")} onOpenPurchaseOrders={() => handleNavigate("purchase-orders")} />} />
              <Route path="/estoque/inventario" element={<InventoryRouteView user={user} initialView="inventory" onOpenProducts={() => handleNavigate("products")} onOpenPurchaseOrders={() => handleNavigate("purchase-orders")} />} />
              <Route path="/estoque/relatorios" element={<InventoryRouteView user={user} initialView="reports" onOpenProducts={() => handleNavigate("products")} onOpenPurchaseOrders={() => handleNavigate("purchase-orders")} />} />
              <Route path="/estoque/planejamento-compra" element={<PurchasePlanning />} />
              <Route path="/inventory/counts/:agendaId" element={<Navigate to="/estoque/contagens" replace />} />
              <Route path="/estoque/requisicoes" element={<Requisitions user={user} />} />
              <Route path="/cardapio/fichas-tecnicas" element={<Dishes />} />
              <Route path="/financeiro/dre" element={<DRE />} />
              <Route path="/financeiro/impostos" element={<TaxPayments user={user} />} />
              <Route path="/financeiro/ciclos-fornecedor" element={<SupplierCycles />} />
              <Route path="/estoque/produtos" element={<Products />} />
              <Route path="/cadastros/fornecedores" element={<Suppliers onOpenPurchases={() => handleNavigate("purchases")} />} />
              <Route path="/cadastros/empresas" element={<Companies />} />
              <Route path="/configuracoes/pagamentos" element={<PaymentMethods />} />
              <Route path="/configuracoes/cadastros-base" element={<MasterData />} />
              <Route path="/configuracoes/usuarios" element={<Users />} />
              <Route path="/configuracoes/auditoria" element={<Audit />} />
              <Route path="*" element={<Navigate to={fallbackSection.path} replace />} />
            </Routes>
            </ContentErrorBoundary>
          </Suspense>
        </AppShell>
      </HideValuesProvider>
    </SessionContext.Provider>
  );
}
