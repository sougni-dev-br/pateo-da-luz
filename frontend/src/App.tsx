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
  Star,
  Truck,
  WalletCards,
  Warehouse,
  X
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { PanInfo } from "framer-motion";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes, matchPath, useLocation, useNavigate, useParams } from "react-router-dom";
import { AppUser, addMenuFavorite, getMe, getMenuFavorites, getStockCountSessions, logout, removeMenuFavorite, type PermissionAction } from "./api/client";
import { PageHeader, StatusBadge } from "./components/ui";
import { SessionContext } from "./context/SessionContext";
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
const Suppliers = lazy(() => import("./pages/Suppliers").then((module) => ({ default: module.Suppliers })));
const Companies = lazy(() => import("./pages/Companies").then((module) => ({ default: module.Companies })));
const Requisitions = lazy(() => import("./pages/Requisitions").then((module) => ({ default: module.Requisitions })));
const Users = lazy(() => import("./pages/Users").then((module) => ({ default: module.Users })));
const Dishes = lazy(() => import("./pages/Dishes").then((module) => ({ default: module.Dishes })));
const DRE = lazy(() => import("./pages/DRE").then((module) => ({ default: module.DRE })));
const SupplierCycles = lazy(() => import("./pages/SupplierCycles").then((module) => ({ default: module.SupplierCycles })));
const TaxPayments = lazy(() => import("./pages/TaxPayments").then((module) => ({ default: module.TaxPayments })));

type InventoryView = "overview" | "movements" | "counting" | "inventory" | "reports";

type SectionDefinition = {
  id: string;
  label: string;
  icon: typeof BarChart3;
  showInSidebar: boolean;
  group: string;
  path: string;
  matchers: string[];
};

const sections = [
  { id: "dashboard", label: "Dashboard", icon: BarChart3, showInSidebar: true, group: "Visão geral", path: "/", matchers: ["/", "/dashboard"] },
  { id: "purchases", label: "Compras", icon: ReceiptText, showInSidebar: true, group: "Operação", path: "/compras", matchers: ["/compras", "/compras/nova", "/compras/:id/editar"] },
  { id: "purchase-orders", label: "Pedidos de compra", icon: ClipboardList, showInSidebar: true, group: "Operação", path: "/compras/pedidos", matchers: ["/compras/pedidos"] },
  { id: "payables", label: "Contas a pagar", icon: WalletCards, showInSidebar: true, group: "Financeiro", path: "/financeiro/contas-a-pagar", matchers: ["/financeiro/contas-a-pagar"] },
  { id: "revenue", label: "Faturamento", icon: BadgeDollarSign, showInSidebar: true, group: "Financeiro", path: "/financeiro/faturamento", matchers: ["/financeiro/faturamento"] },
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
  { id: "supplier-cycles", label: "Ciclos de fornecedor", icon: RefreshCw, showInSidebar: true, group: "Financeiro", path: "/financeiro/ciclos-fornecedor", matchers: ["/financeiro/ciclos-fornecedor"] },
  { id: "suppliers", label: "Fornecedores", icon: Truck, showInSidebar: true, group: "Cadastros", path: "/cadastros/fornecedores", matchers: ["/cadastros/fornecedores"] },
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
  const [user, setUser] = useState<AppUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
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
    getMe()
      .then((me) => {
        setUser(me);
        return getMenuFavorites().then(setFavorites).catch(() => undefined);
      })
      .catch(() => setUser(null))
      .finally(() => setCheckingSession(false));
  }, []);

  useEffect(() => {
    if (!user || checkingSession) return;
    if (matchedSection && sectionAllowedForUser(matchedSection.id, user)) return;
    navigate(fallbackSection.path, { replace: true });
  }, [checkingSession, fallbackSection.path, matchedSection, navigate, user]);

  // Badge de contagens prontas para virar pedido: refetch em mudanca de rota (natural,
  // sem polling). Falhas silenciosas: badge simplesmente nao renderiza se usuario nao
  // tiver permissao no endpoint.
  useEffect(() => {
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
  }, [user, checkingSession, location.pathname]);

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

  function handleMobileDrawerDragEnd(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    if (info.offset.x < -80 || info.velocity.x < -450) setMobileMenuOpen(false);
  }

  function renderNavItem(section: (typeof sections)[number], onSelect: (sectionId: SectionId) => void) {
    const Icon = section.icon;
    const isFav = favorites.includes(section.id);
    // Badge no item Pedidos de compra: conta contagens CONCLUIDAS ainda nao convertidas.
    const showPendingBadge = section.id === "purchase-orders" && pendingCountSessionCount > 0;
    return (
      <div className="nav-item-wrap" key={section.id}>
        <button
          className={effectiveSection.id === section.id ? "active" : ""}
          type="button"
          title={section.label}
          aria-current={effectiveSection.id === section.id ? "page" : undefined}
          onClick={() => onSelect(section.id)}
        >
          <Icon size={18} />
          <span>{section.label}</span>
          {showPendingBadge && (
            <StatusBadge tone="info" title={`${pendingCountSessionCount} contagem(ns) concluida(s) aguardando conversao em pedido ou inventario`}>
              {pendingCountSessionCount}
            </StatusBadge>
          )}
        </button>
        <button
          className={`nav-star${isFav ? " nav-star-active" : ""}`}
          type="button"
          title={isFav ? "Remover dos favoritos" : "Adicionar aos favoritos"}
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(section.id);
          }}
        >
          <Star size={13} fill={isFav ? "currentColor" : "none"} />
        </button>
      </div>
    );
  }

  function renderNavigation(onSelect: (sectionId: SectionId) => void) {
    const favSections = visibleSections.filter((s) => favorites.includes(s.id));
    return (
      <nav>
        {favSections.length > 0 && (
          <div className="nav-group" key="__favoritos">
            <span>Favoritos</span>
            {favSections.map((section) => renderNavItem(section, onSelect))}
          </div>
        )}
        {groupedSections.map((group) => (
          <div className="nav-group" key={group.group}>
            <span>{group.group}</span>
            {group.items.map((section) => renderNavItem(section, onSelect))}
          </div>
        ))}
      </nav>
    );
  }

  if (checkingSession) {
    return (
      <SessionContext.Provider value={sessionContextValue}>
        <main className="login-shell">
          <div className="login-card">
            <img src={logoPath} alt="Pateo da Luz" />
            <p>Carregando sessão...</p>
          </div>
        </main>
      </SessionContext.Provider>
    );
  }

  if (!user) {
    return <SessionContext.Provider value={sessionContextValue}><Login onLogin={setUser} /></SessionContext.Provider>;
  }

  if (user.mustChangePassword) {
    return <SessionContext.Provider value={sessionContextValue}><ForcedPasswordChange user={user} onChanged={setUser} /></SessionContext.Provider>;
  }

  return (
    <SessionContext.Provider value={sessionContextValue}>
      <main className="app-shell">
        <header className="mobile-app-header">
          <button type="button" aria-label="Abrir menu" onClick={() => setMobileMenuOpen(true)}>
            <Menu size={22} />
          </button>
          <strong>{activeLabel}</strong>
        </header>

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
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={{ left: 0.24, right: 0 }}
                onDragEnd={handleMobileDrawerDragEnd}
              >
                <div className="mobile-drawer-header">
                  <div className="brand-block">
                    <div className="brand-logo-wrap">
                      <img
                        className="brand-logo"
                        src={logoPath}
                        alt="Pateo da Luz"
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                      <span className="brand-logo-fallback">PL</span>
                    </div>
                    <div>
                      <strong>Pateo da Luz</strong>
                      <span>Gestão eficiente</span>
                    </div>
                  </div>
                  <button className="mobile-drawer-close" type="button" aria-label="Fechar menu" onClick={() => setMobileMenuOpen(false)}>
                    <X size={21} />
                  </button>
                </div>
                <div className="mobile-drawer-body">
                  {renderNavigation(handleNavigate)}
                  <div className="sidebar-user sidebar-footer mobile-drawer-user">
                    <div className="sidebar-footer-meta">
                      <span>{user.name}</span>
                      <small>{user.role}</small>
                    </div>
                    <div className="sidebar-footer-actions">
                      <button className="sidebar-footer-button" type="button" onClick={toggleSensitiveValues}>
                        {hideSensitiveValues ? "Mostrar valores" : "Ocultar valores"}
                      </button>
                      <button
                        className="sidebar-footer-button sidebar-footer-button-danger"
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

        <aside className="sidebar">
          <div className="brand-block">
            <div className="brand-logo-wrap">
              <img
                className="brand-logo"
                src={logoPath}
                alt="Pateo da Luz"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
              <span className="brand-logo-fallback">PL</span>
            </div>
            <div>
              <strong>Pateo da Luz</strong>
              <span>Gestão eficiente</span>
            </div>
          </div>
          {renderNavigation(handleNavigate)}
          <div className="sidebar-user sidebar-footer">
            <div className="sidebar-footer-meta">
              <span>{user.name}</span>
              <small>{user.role}</small>
            </div>
            <div className="sidebar-footer-actions">
              <button className="sidebar-footer-button" type="button" onClick={toggleSensitiveValues}>
                {hideSensitiveValues ? "Mostrar valores" : "Ocultar valores"}
              </button>
              <button
                className="sidebar-footer-button sidebar-footer-button-danger"
                type="button"
                onClick={() => {
                  setUser(null);
                  logout();
                }}
              >
                <LogOut size={16} />
                Sair
              </button>
            </div>
          </div>
          {isLocal && <span className="version-badge">DEV</span>}
        </aside>

        <section className="content" ref={contentRef}>
          <div className="desktop-page-header">
            <PageHeader eyebrow={`Pateo da Luz / ${activeGroup}`} title={activeLabel} />
          </div>

          <Suspense fallback={<div className="page-loading">Carregando módulo...</div>}>
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
          </Suspense>
        </section>
      </main>
    </SessionContext.Provider>
  );
}
