import { AlertTriangle, ArrowDown, ArrowLeft, CalendarDays, CheckCircle2, ClipboardCheck, Download, FilterX, Layers, Loader2, MessageSquare, Play, Printer, RefreshCw, Search, Send, ShoppingCart, Save, SlidersHorizontal, Trash2, X } from "lucide-react";
import { Fragment, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRevealScroll } from "../lib/useRevealScroll";
import { hasPermission } from "../lib/permissions";
import { cicloDivergeDaData, cicloSugerido, hojeLocalIso, opcoesDeCiclo, rotuloDoCiclo } from "../lib/ciclo-contagem";
import { proximoPassoDoFechamento } from "../lib/fechamento-cmv";
import {
  ApiError,
  AppUser,
  approveOperationalInventory,
  BuyerSupportReport,
  cancelStockCountSession,
  cancelOperationalInventory,
  closeOperationalInventory,
  concludeStockCountSession,
  confirmInventoryAgendaItem,
  createOperationalInventory,
  createStockCountSession,
  createInventoryMovement,
  createStockCount,
  deleteInventoryAgendaRule,
  getInventoryAgendaDetail,
  getInventoryAgenda,
  getInventoryAgendaWeek,
  getInventoryMovements,
  getInventoryStocks,
  getOperationalInventories,
  getOperationalInventory,
  getStockCountSession,
  getReferenciaDaContagem,
  getStockCountSessionPdfBlob,
  getStockCountSessionPlausibility,
  getStockCountSessions,
  getBuyerSupportReport,
  getCategories,
  getProducts,
  getProductsSummary,
  getSectors,
  getSubcategories,
  getStockCounts,
  InventoryAgenda,
  InventoryAgendaItem,
  InventoryMovement,
  InventorySector,
  InventoryStock,
  markOperationalInventoryItemsZero,
  OperationalInventory,
  OperationalInventoryDetail,
  OperationalInventoryType,
  Product,
  ProductSummary,
  generateInventoryFromStockCountSession,
  consolidateMonthEndSessions,
  previewConsolidationCoverage,
  StockCoverageAudit,
  createMissingCount,
  appendMissingCount,
  getFinalCmvCoverage,
  rejectOperationalInventory,
  reshapeStockCountSessionScope,
  reopenStockCountSession,
  reopenOperationalInventory,
  saveStockCountSessionItems,
  saveInventoryAgendaRule,
  saveOperationalInventoryItems,
  downloadOperationalInventoryPdf,
  downloadStockCountSessionPdf,
  startInventoryAgendaItem,
  StockCount,
  StockCountSession,
  StockCountSessionDetail,
  StockCountSessionType,
  submitOperationalInventory,
  submitInventoryAgendaItem,
} from "../api/client";
import type { ConferenciaDoInventario, ItemDaConferencia } from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { PeriodFilter } from "../components/PeriodFilter";
import { SimpleBarChart } from "../components/SimpleBarChart";
import { ConfirmDialog } from "../components/ui";
import { Alert, Button, EmptyState, Money, PanelEyebrow, RowMenu, StatusBadge, SummaryCard, Table, Tabs } from "../design-system";
import type { RowMenuItem, RowMenuSeparator } from "../design-system";
import { ConferenciaInventario, SeloDaConferencia } from "./inventory/ConferenciaInventario";
import { EtapasDoInventario } from "./inventory/inventario/EtapasDoInventario";
import { ListaDeInventarios } from "./inventory/inventario/ListaDeInventarios";
import { tituloCurto } from "./inventory/inventario/lista";
import { PosicaoEstoque } from "./inventory/inventario/PosicaoEstoque";
import { OverviewSection } from "./inventory/OverviewSection";
import { rotuloDoStatusDaRotina } from "./inventory/routine";
import { RoutineWeekSection } from "./inventory/RoutineWeekSection";
import { formatDate, formatNumber } from "../utils/format";
import { currentMonthPeriod } from "../utils/period";
import { useNavigate, useSearchParams } from "react-router-dom";

type InventoryProps = {
  user: AppUser;
  initialView?: InventoryView;
  countSessionId?: string | null;
  onOpenProducts?: () => void;
  onOpenPurchaseOrders?: () => void;
  onOpenCountSessionRoute?: (id: string) => void;
  onCloseCountSessionRoute?: () => void;
};

type InventoryView = "overview" | "movements" | "counting" | "inventory" | "reports";

const INVENTORY_VIEW_PATHS: Record<InventoryView, string> = {
  overview: "/estoque/visao-geral",
  movements: "/estoque/movimentacoes",
  counting: "/estoque/contagens",
  inventory: "/estoque/inventario",
  reports: "/estoque/relatorios"
};
type InventoryDeskTab = "official" | "posicao";

import {
  countBy,
  countSessionColumnOptions,
  countSessionStatusLabels,
  countSessionTone,
  countSessionTypeLabels,
  dateKey,
  defaultCountSessionColumns,
  displayLabel,
  editableCountSessionStatuses,
  editableOperationalInventoryStatuses,
  inventoryClassificationSortText,
  loadCountSessionColumnPreferences,
  monthValue,
  movementSignedQuantity,
  movementTypeLabel,
  movementTypes,
  operationalStatusLabels,
  operationalTone,
  operationalTypeLabels,
  evaluateQuantity,
  inlineCountWarnings,
  quantityHint,
  packSizeFromName,
  parseMonth,
  quantityToApi,
  quantityWarningLabel,
  sameDay,
  sanitizeQuantityInput,
  sensitiveMovementTypes,
  settledValue,
  stockCountSortText,
  sumBy,
  weekdays
} from "./inventory/shared";
import type { CountSessionColumn, QuantityPlausibility } from "./inventory/shared";
import type { ReferenciaDaContagem as ReferenciaDoItem } from "../api/client";
import { ReferenciaDaContagem } from "./inventory/ReferenciaDaContagem";
import { imprimirBlobPdf } from "../utils/imprimirPdf";
import { lerContagem, totalDaContagem } from "./inventory/referencia-contagem";

// Aviso de plausibilidade da contagem: uma linha fina na largura do cartao,
// sem botao. Antes abria uma caixa com "Conferi, esta certo" dentro da coluna
// do campo — no celular cobria o proprio campo e triplicava a altura do
// cartao, e aparecia a cada tecla (digitar "250" avisava no "25"). Agora so
// fala depois que a pessoa sai do item, e a conferencia fica no "Concluir".
function CountQuantityGuard({
  itemId,
  productName,
  unit,
  value,
  plausibility,
  isActive
}: {
  itemId: string;
  productName: string;
  unit?: string | null;
  value: string;
  plausibility?: QuantityPlausibility;
  isActive: boolean;
}) {
  const packSize = isActive ? packSizeFromName(productName) : null;
  const warnings = isActive ? [] : inlineCountWarnings(evaluateQuantity(plausibility, value));
  if (!warnings.length && packSize == null) return null;
  return (
    <div className={`count-guard ${warnings.length ? "is-warning" : "is-hint"}`} role="status">
      {packSize != null && (
        <p>Embalagem com {packSize.toLocaleString("pt-BR")}: conte <strong>{unit || "pacotes"}</strong>, nao a peca avulsa.</p>
      )}
      {plausibility && warnings.map((warning) => (
        <p key={`${itemId}-${warning}`}>{quantityWarningLabel(warning, plausibility)}</p>
      ))}
    </div>
  );
}

export function Inventory({
  user,
  initialView = "overview",
  countSessionId = null,
  onOpenProducts,
  onOpenPurchaseOrders,
  onOpenCountSessionRoute,
  onCloseCountSessionRoute
}: InventoryProps) {
  // Gates derivados de permissao (Usuarios -> Permissoes), nunca do papel: o mesmo
  // funcionario acumula funcoes ao longo do tempo e o admin precisa conseguir liberar
  // modulo a modulo sem depender de trocar o cargo dele.
  const canViewStock = hasPermission(user, "inventory", "view");
  const canViewMovements = hasPermission(user, "inventory-movements", "view");
  const canViewCountSessions = hasPermission(user, "inventory-counting", "view");
  const canEditCountSession = hasPermission(user, "inventory-counting", "edit");
  const canDeleteCountSession = hasPermission(user, "inventory-counting", "delete");
  const canConfigureAgenda = hasPermission(user, "inventory-counting", "admin");
  const canStartCountSession = hasPermission(user, "inventory-counting", "create");
  const canViewOperational = hasPermission(user, "inventory-official", "view");
  const canCreateOperational = hasPermission(user, "inventory-official", "create");
  const canApproveOperational = hasPermission(user, "inventory-official", "approve");
  const canCancelOperational = hasPermission(user, "inventory-official", "delete");
  const canViewInventoryReports = hasPermission(user, "inventory-reports", "view");
  const canViewCosts = hasPermission(user, "inventory-costs", "view");
  // Modo simplificado do estoquista: vale quando o acesso ao estoque se limita a contar.
  // Quem acumulou movimentacoes/inventario/relatorios ve a tela completa, seja qual for o cargo.
  const stockkeeperMode = !canViewMovements && !canViewOperational && !canViewInventoryReports;
  const [activeView, setActiveView] = useState<InventoryView>(initialView);
  const [stocks, setStocks] = useState<InventoryStock[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [counts, setCounts] = useState<StockCount[]>([]);
  const [countSessions, setCountSessions] = useState<StockCountSession[]>([]);
  const [countSessionDetail, setCountSessionDetail] = useState<StockCountSessionDetail | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  // Totais da Visao Geral vem do banco. `products` e so o setor da agenda do
  // dia (a lista da contagem do estoquista): a tela dizia "104 cadastrados"
  // contando so o BAR, e "estoque baixo: 180" passava do total.
  const [productSummary, setProductSummary] = useState<ProductSummary | null>(null);
  const [sectors, setSectors] = useState<InventorySector[]>([]);
  const [agenda, setAgenda] = useState<InventoryAgenda | null>(null);
  const [routineWeek, setRoutineWeek] = useState<InventoryAgendaItem[]>([]);
  const [routineWeekLoading, setRoutineWeekLoading] = useState(false);
  const [startingRoutineItemId, setStartingRoutineItemId] = useState<string | null>(null);
  const [month, setMonth] = useState(monthValue());
  const [movementPeriod, setMovementPeriod] = useState(currentMonthPeriod());
  const [selectedAgendaId, setSelectedAgendaId] = useState<string>("");
  const [search] = useState("");
  const [loading, setLoading] = useState(false);
  const [movementForm, setMovementForm] = useState({ productId: "", type: "MANUAL_OUT", quantity: "", unit: "", notes: "" });
  const [movementSearch, setMovementSearch] = useState("");
  const [countForm, setCountForm] = useState({ productId: "", countedQuantity: "", unit: "", notes: "", generateAdjustment: true });
  const [ruleForm, setRuleForm] = useState({ id: "", dayOfWeek: "1", sectorId: "", sectorName: "", categoryName: "", frequency: "WEEKLY", notes: "" });
  const [countScreenOpen, setCountScreenOpen] = useState(false);
  const [countSearch, setCountSearch] = useState("");
  const [countLines, setCountLines] = useState<Record<string, { countedQuantity: string; notes: string }>>({});
  const [operationalInventories, setOperationalInventories] = useState<OperationalInventory[]>([]);
  const [operationalDetail, setOperationalDetail] = useState<OperationalInventoryDetail | null>(null);
  const [openingInventoryId, setOpeningInventoryId] = useState<string | null>(null);
  const operationalDetailRef = useRevealScroll<HTMLDivElement>({ when: operationalDetail?.id });
  const [showCanceledStockData, setShowCanceledStockData] = useState(false);
  const [countSessionVisibleColumns, setCountSessionVisibleColumns] = useState<Record<CountSessionColumn, boolean>>(loadCountSessionColumnPreferences);
  const [editingCountSessionNoteId, setEditingCountSessionNoteId] = useState<string | null>(null);
  const [editingOperationalNoteId, setEditingOperationalNoteId] = useState<string | null>(null);
  const [operationalForm, setOperationalForm] = useState({
    date: hojeLocalIso(),
    effectiveCountDate: hojeLocalIso(),
    startedAt: "",
    finishedAt: "",
    type: "GERAL" as OperationalInventoryType,
    sectorId: "",
    notes: ""
  });
  const [operationalSearch, setOperationalSearch] = useState("");
  // Conferencia do detalhe aberto. A versao sobe a cada recarga do detalhe
  // (salvar, marcar zero, reabrir) para o painel recalcular junto.
  const [conferencia, setConferencia] = useState<ConferenciaDoInventario | null>(null);
  const [versaoConferencia, setVersaoConferencia] = useState(0);
  const [itemParaLocalizar, setItemParaLocalizar] = useState<string | null>(null);
  // Conferencia e itens eram uma rolagem so de ~3.000px; viraram duas abas.
  const [abaDoDetalhe, setAbaDoDetalhe] = useState<"conferencia" | "itens">("conferencia");
  const conferenciaAtual = conferencia && conferencia.inventoryId === operationalDetail?.id ? conferencia : null;
  const conferenciaPorItem = useMemo(
    () => new Map((conferenciaAtual?.itens ?? []).map((item) => [item.itemId, item])),
    [conferenciaAtual]
  );
  // Em revisao, quem aprova corrige as quantidades ali mesmo (antes era
  // rejeitar, corrigir e reenviar). Cada correcao fica na auditoria.
  const emRascunho = operationalDetail != null && editableOperationalInventoryStatuses.has(operationalDetail.status);
  const corrigindoNaRevisao = operationalDetail?.status === "EM_REVISAO" && canApproveOperational;
  const podeEditarItens = emRascunho || corrigindoNaRevisao;
  // Alertas que pesam e ainda nao foram conferidos: o servidor recusa aprovar
  // com eles; a tela avisa antes do clique.
  const faltamConferir = conferenciaAtual?.pendentesParaAprovar ?? 0;
  // Sem a conferencia carregada nao da para saber o que falta: aprovar espera
  // (antes ficava ativo e so o servidor recusava).
  const conferenciaPendente = operationalDetail?.status === "EM_REVISAO" && !conferenciaAtual;
  const aprovacaoTravada = faltamConferir > 0 || conferenciaPendente;
  const tituloAprovacaoTravada = conferenciaPendente
    ? "Carregando a conferência… Se não carregar, use Atualizar na aba Conferência."
    : faltamConferir > 0
    ? `Faltam conferir ${faltamConferir} item(ns) na aba Conferência (alertas a partir de R$ ${conferenciaAtual?.limiteDeConferencia ?? 50} ou sem custo).`
    : undefined;
  const itensEmAlerta = conferenciaAtual
    ? conferenciaAtual.resumo.IMPOSSIVEL.itens + conferenciaAtual.resumo.ZERADO_SUSPEITO.itens + conferenciaAtual.resumo.FORA_DO_HISTORICO.itens
    : 0;
  const [operationalSectorFilter, setOperationalSectorFilter] = useState("");
  const [operationalLines, setOperationalLines] = useState<Record<string, { countedQuantity: string; notes: string }>>({});
  const [countSessionForm, setCountSessionForm] = useState(() => {
    const hoje = hojeLocalIso();
    const ciclo = cicloSugerido(hoje);
    return {
      referenceDate: hoje,
      type: "GERAL" as StockCountSessionType,
      sectorId: "",
      categoryId: "",
      subcategoryId: "",
      isMonthEnd: false,
      // O ciclo a que a contagem pertence, separado do dia em que se conta.
      // Ver lib/ciclo-contagem.ts: contagem de virada cai no mes seguinte.
      periodMonth: ciclo.mes,
      periodYear: ciclo.ano,
      cicloEditadoAMao: false,
      notes: ""
    };
  });
  const [countSessionSearch, setCountSessionSearch] = useState("");
  const [countSessionSectorFilter, setCountSessionSectorFilter] = useState("");
  const [countSessionCategoryFilter, setCountSessionCategoryFilter] = useState("");
  const [countSessionSubcategoryFilter, setCountSessionSubcategoryFilter] = useState("");
  const [countSessionUnitFilter, setCountSessionUnitFilter] = useState("");
  const [countSessionStatusFilter, setCountSessionStatusFilter] = useState<"TODOS" | "PENDENTE" | "CONTADO">("TODOS");
  const [countSessionLines, setCountSessionLines] = useState<Record<string, { countedQuantity: string; notes: string }>>({});
  // Guarda quais itens ESTA pessoa editou nesta sessao de tela. Sem isso o save
  // enviava a sessao inteira com o estado carregado na abertura, e quem salvasse
  // por ultimo devolvia os itens do colega ao valor antigo — sem erro nem aviso.
  const [countSessionDirty, setCountSessionDirty] = useState<Record<string, true>>({});
  const [operationalDirty, setOperationalDirty] = useState<Record<string, true>>({});
  // Faixa esperada por item. Guarda de plausibilidade: avisa, nunca bloqueia.
  const [countSessionPlausibility, setCountSessionPlausibility] = useState<Record<string, QuantityPlausibility>>({});
  // Anterior + compras = disponivel, e o custo: a conta da conferencia na hora de contar.
  const [countSessionReferencia, setCountSessionReferencia] = useState<Record<string, ReferenciaDoItem>>({});
  // Resposta atrasada da contagem aberta antes nao pode cair na de agora.
  const contagemAbertaRef = useRef<string | null>(null);
  const [mobileCountFiltersOpen, setMobileCountFiltersOpen] = useState(false);
  const [mobileCountMoreActionsOpen, setMobileCountMoreActionsOpen] = useState(false);
  const [mobileQuickCountMode, setMobileQuickCountMode] = useState(false);
  const [mobileCountFormOpen, setMobileCountFormOpen] = useState(false);
  const [mobileInvFormOpen, setMobileInvFormOpen] = useState(false);
  const [mobileInvMoreActionsOpen, setMobileInvMoreActionsOpen] = useState(false);
  const [activeCountSessionInputId, setActiveCountSessionInputId] = useState<string | null>(null);
  const [buyerSupport, setBuyerSupport] = useState<BuyerSupportReport | null>(null);
  const [buyerFilters] = useState({ search: "", supplier: "", sector: "", category: "", subcategory: "", status: "" });
  const [inventoryDeskTab, setInventoryDeskTab] = useState<InventoryDeskTab>("official");
  const [consolidationSelected, setConsolidationSelected] = useState<Set<string>>(new Set());
  const [isConsolidating, setIsConsolidating] = useState(false);
  const [consolidationCoverage, setConsolidationCoverage] = useState<StockCoverageAudit | null>(null);
  const [isFetchingCoverage, setIsFetchingCoverage] = useState(false);
  const [finalCmvCoverage, setFinalCmvCoverage] = useState<(StockCoverageAudit & { inventoryId: string; inventoryCode: string }) | null>(null);
  const [isFetchingFinalCmvCoverage, setIsFetchingFinalCmvCoverage] = useState(false);
  const [isCreatingComplement, setIsCreatingComplement] = useState(false);
  const [isAppendingComplement, setIsAppendingComplement] = useState(false);
  const [finalCmvCoverageMap, setFinalCmvCoverageMap] = useState<Record<string, StockCoverageAudit & { inventoryId: string; inventoryCode: string }>>({});
  const [isLoadingCoverageMap, setIsLoadingCoverageMap] = useState(false);
  const [showCmvApproveModal, setShowCmvApproveModal] = useState(false);
  const [approvingFinalCmv, setApprovingFinalCmv] = useState(false);
  // Trava o botao do proximo passo no card do fechamento enquanto a acao roda.
  const [acaoFechamentoEmCurso, setAcaoFechamentoEmCurso] = useState(false);
  const formularioInventarioRef = useRef<HTMLDivElement | null>(null);
  const { notice, setNotice } = useNotice();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const inventarioNaUrl = searchParams.get("inventario");
  const inventarioPedido = useRef<string | null>(null);
  // Aberto pela lista: o "voltar" do cabecalho volta no historico em vez de
  // empilhar outra entrada (senao o voltar do navegador reabria o detalhe).
  const abertoPelaLista = useRef(false);

  // Trocar de aba muda a rota. Antes so trocava o conteudo: o endereco e o
  // titulo da pagina continuavam "Visao Geral" mostrando as contagens, e
  // recarregar voltava para a aba errada. A rota devolve a aba pelo
  // initialView (efeito que sincroniza activeView), sem remontar a tela.
  function irParaVisao(view: InventoryView) {
    setActiveView(view);
    navigate(INVENTORY_VIEW_PATHS[view]);
  }

  const selectedAgenda = useMemo(
    () => agenda?.items.find((item) => item.id === selectedAgendaId) ?? null,
    [agenda, selectedAgendaId]
  );
  // Planejamento de compra gera Pedidos de compra: sem essa permissao o usuario seria
  // redirecionado ao abrir a tela. Esconder o botao evita o beco sem saida.
  const canPlanPurchase = hasPermission(user, "purchase-orders", "create");
  const canReshapeCountSession = canEditCountSession;

  const canCancelCountSession = (session: StockCountSession | StockCountSessionDetail) => {
    if (session.status === "CANCELADA") return false;
    if (session.generatedInventoryId && session.generatedInventoryStatus !== "CANCELADO") return false;
    if (!["ABERTA", "EM_ANDAMENTO", "CONCLUIDA"].includes(session.status)) return false;
    // Espelha exatamente canCancelStockCountSession do backend. Nao ha regra de posse:
    // a contagem e colaborativa, entao quem pode excluir cancela qualquer sessao.
    // (Antes o botao aparecia para o responsavel sem permissao de excluir e o POST dava 403.)
    return canDeleteCountSession;
  };
  const canGenerateInventoryFromCount = (session: StockCountSession | StockCountSessionDetail) =>
    canCreateOperational
    && session.status === "CONCLUIDA"
    && !session.generatedInventoryId
    && session.source !== "IMPORTACAO_PLANILHA"
    // Recontagem volta para o inventario que a pediu ("Aplicar" na conferencia).
    && session.type !== "RECONTAGEM";
  const operationalSummary = useMemo(() => {
    const activeFinalCmv = operationalInventories.find(
      (item) => item.type === "FINAL_CMV" && ["RASCUNHO", "EM_REVISAO"].includes(item.status)
    );
    const lastFinalCmv = operationalInventories.find(
      (item) => item.type === "FINAL_CMV" && ["APROVADO", "FECHADO"].includes(item.status)
    );
    const finalCmvActive = operationalInventories.filter(
      (item) => item.type === "FINAL_CMV" && !["CANCELADO", "REJEITADO"].includes(item.status)
    );
    return {
      drafts: operationalInventories.filter((item) => item.status === "RASCUNHO").length,
      review: operationalInventories.filter((item) => item.status === "EM_REVISAO").length,
      closed: operationalInventories.filter((item) => item.status === "FECHADO").length,
      activeFinalCmv,
      lastFinalCmv,
      pending: finalCmvActive.reduce((sum, item) => sum + Number(item.pendingItems ?? 0), 0),
      divergent: finalCmvActive.reduce((sum, item) => sum + Number(item.divergentItems ?? 0), 0)
    };
  }, [operationalInventories]);
  const officialInventories = useMemo(
    () => operationalInventories.filter((item) => ["APROVADO", "FECHADO", "CANCELADO"].includes(item.status)),
    [operationalInventories]
  );
  const operationalSectors = useMemo(() => {
    const names = new Set<string>();
    operationalDetail?.items.forEach((item) => { if (item.sectorName) names.add(item.sectorName); });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [operationalDetail]);
  const filteredOperationalItems = useMemo(() => {
    const normalized = operationalSearch.trim().toLowerCase();
    return [...(operationalDetail?.items ?? [])]
      .filter((item) => {
      const matchesSector = !operationalSectorFilter || item.sectorName === operationalSectorFilter;
      const matchesSearch = !normalized
        || String(item.productCode ?? "").toLowerCase().includes(normalized)
        || item.productName.toLowerCase().includes(normalized);
      return matchesSector && matchesSearch;
      })
      .sort((a, b) => {
        const valuesA = [
          inventoryClassificationSortText(a.sectorName, "zzzz_sem_setor"),
          inventoryClassificationSortText(a.categoryName, "zzzz_sem_categoria"),
          inventoryClassificationSortText(a.subcategoryName, "zzzz_sem_subcategoria"),
          inventoryClassificationSortText(a.productName),
          inventoryClassificationSortText(a.productCode, "zzzz_sem_codigo")
        ];
        const valuesB = [
          inventoryClassificationSortText(b.sectorName, "zzzz_sem_setor"),
          inventoryClassificationSortText(b.categoryName, "zzzz_sem_categoria"),
          inventoryClassificationSortText(b.subcategoryName, "zzzz_sem_subcategoria"),
          inventoryClassificationSortText(b.productName),
          inventoryClassificationSortText(b.productCode, "zzzz_sem_codigo")
        ];
        for (let index = 0; index < valuesA.length; index += 1) {
          const diff = valuesA[index].localeCompare(valuesB[index], "pt-BR");
          if (diff !== 0) return diff;
        }
        return 0;
      });
  }, [operationalDetail, operationalSearch, operationalSectorFilter]);
  const productCategories = useMemo(() => {
    const rows = new Map<string, { id: string; name: string }>();
    products.forEach((product) => {
      if (product.category?.id && product.category?.name) rows.set(product.category.id, { id: product.category.id, name: product.category.name });
    });
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [products]);
  // Categorias com produtos no setor selecionado — usado no form de "Nova contagem" SETORIAL
  // pra permitir escopo "setor + categoria" (ex: FLV da Camara Fria).
  // Vem do backend (GET /master-data/categories?sectorId=X): `products` local esta filtrado por
  // agendaItem, entao derivar client-side devolveria vazio quando sectorId != setor da agenda.
  const [categoriesForSector, setCategoriesForSector] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    if (countSessionForm.type !== "SETORIAL" || !countSessionForm.sectorId) {
      setCategoriesForSector([]);
      return;
    }
    let cancelled = false;
    getCategories(undefined, { sectorId: countSessionForm.sectorId })
      .then((rows) => { if (!cancelled) setCategoriesForSector(rows.map((c) => ({ id: c.id, name: c.name }))); })
      .catch(() => { if (!cancelled) setCategoriesForSector([]); });
    return () => { cancelled = true; };
  }, [countSessionForm.type, countSessionForm.sectorId]);
  // Se a lista recarregar em SETORIAL e o categoryId atual sair dela (ex: produto reclassificado
  // com form aberto), limpa a selecao para nao deixar o <select> com value sem <option>.
  useEffect(() => {
    if (
      countSessionForm.type === "SETORIAL" &&
      countSessionForm.categoryId &&
      !categoriesForSector.some((c) => c.id === countSessionForm.categoryId)
    ) {
      setCountSessionForm((prev) => ({ ...prev, categoryId: "" }));
    }
  }, [categoriesForSector, countSessionForm.type, countSessionForm.categoryId]);
  const productSubcategories = useMemo(() => {
    const rows = new Map<string, { id: string; name: string; categoryId?: string | null }>();
    products.forEach((product) => {
      if (product.subcategory?.id && product.subcategory?.name) rows.set(product.subcategory.id, { id: product.subcategory.id, name: product.subcategory.name, categoryId: product.category?.id });
    });
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [products]);
  const sectorByName = useMemo(() => new Map(sectors.map((sector) => [sector.name, sector])), [sectors]);
  const categoryByName = useMemo(() => new Map(productCategories.map((category) => [category.name, category])), [productCategories]);
  const subcategoryByName = useMemo(() => new Map(productSubcategories.map((subcategory) => [subcategory.name, subcategory])), [productSubcategories]);
  const activeCountSessions = useMemo(() => countSessions.filter((item) => editableCountSessionStatuses.has(item.status)), [countSessions]);
  const completedCountSessions = useMemo(() => countSessions.filter((item) => item.status === "CONCLUIDA"), [countSessions]);
  const countSessionSectors = useMemo(() => {
    const names = new Set<string>();
    countSessionDetail?.items.forEach((item) => { names.add(item.sectorLabel ?? displayLabel(item.sectorSnapshot, "Sem setor")); });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [countSessionDetail]);
  const countSessionCategories = useMemo(() => {
    const names = new Set<string>();
    countSessionDetail?.items.forEach((item) => { names.add(item.categoryLabel ?? displayLabel(item.categorySnapshot, "Sem categoria")); });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [countSessionDetail]);
  const countSessionSubcategories = useMemo(() => {
    const names = new Set<string>();
    countSessionDetail?.items.forEach((item) => { names.add(item.subcategoryLabel ?? displayLabel(item.subcategorySnapshot, "Sem subcategoria")); });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [countSessionDetail]);
  const countSessionUnits = useMemo(() => {
    const names = new Set<string>();
    countSessionDetail?.items.forEach((item) => { names.add(item.unitLabel ?? displayLabel(item.unitSnapshot, "-")); });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [countSessionDetail]);
  const filteredCountSessionItems = useMemo(() => {
    const normalized = countSessionSearch.trim().toLowerCase();
    const sorted = [...(countSessionDetail?.items ?? [])].sort((a, b) => {
      const valuesA = [
        stockCountSortText(a.sectorSnapshot, "zzzz_sem_setor"),
        stockCountSortText(a.categorySnapshot, "zzzz_sem_categoria"),
        stockCountSortText(a.subcategorySnapshot, "zzzz_sem_subcategoria"),
        stockCountSortText(a.unitSnapshot, "zzzz_sem_unidade"),
        stockCountSortText(a.productNameSnapshot),
        stockCountSortText(a.productCodeSnapshot)
      ];
      const valuesB = [
        stockCountSortText(b.sectorSnapshot, "zzzz_sem_setor"),
        stockCountSortText(b.categorySnapshot, "zzzz_sem_categoria"),
        stockCountSortText(b.subcategorySnapshot, "zzzz_sem_subcategoria"),
        stockCountSortText(b.unitSnapshot, "zzzz_sem_unidade"),
        stockCountSortText(b.productNameSnapshot),
        stockCountSortText(b.productCodeSnapshot)
      ];
      return valuesA.join("|").localeCompare(valuesB.join("|"));
    });
    return sorted.filter((item) => {
      const line = countSessionLines[item.id];
      const currentStatus = line?.countedQuantity !== undefined && line.countedQuantity !== "" ? "CONTADO" : "PENDENTE";
      const keepFocusedPendingItem = countSessionStatusFilter === "PENDENTE" && item.id === activeCountSessionInputId;
      const matchesStatus = countSessionStatusFilter === "TODOS" || currentStatus === countSessionStatusFilter || keepFocusedPendingItem;
      const matchesSector = !countSessionSectorFilter || (item.sectorLabel ?? displayLabel(item.sectorSnapshot, "Sem setor")) === countSessionSectorFilter;
      const matchesCategory = !countSessionCategoryFilter || (item.categoryLabel ?? displayLabel(item.categorySnapshot, "Sem categoria")) === countSessionCategoryFilter;
      const matchesSubcategory = !countSessionSubcategoryFilter || (item.subcategoryLabel ?? displayLabel(item.subcategorySnapshot, "Sem subcategoria")) === countSessionSubcategoryFilter;
      const matchesUnit = !countSessionUnitFilter || (item.unitLabel ?? displayLabel(item.unitSnapshot, "-")) === countSessionUnitFilter;
      const matchesSearch = !normalized
        || String(item.productCodeSnapshot ?? "").toLowerCase().includes(normalized)
        || item.productNameSnapshot.toLowerCase().includes(normalized);
      return matchesStatus && matchesSector && matchesCategory && matchesSubcategory && matchesUnit && matchesSearch;
    }) ?? [];
  }, [countSessionDetail, countSessionLines, countSessionSearch, countSessionSectorFilter, countSessionCategoryFilter, countSessionSubcategoryFilter, countSessionUnitFilter, countSessionStatusFilter, activeCountSessionInputId]);
  const countSessionProgress = useMemo(() => {
    const total = countSessionDetail?.items.length ?? 0;
    const counted = countSessionDetail?.items.filter((item) => {
      const line = countSessionLines[item.id];
      return line?.countedQuantity !== undefined && line.countedQuantity !== "";
    }).length ?? 0;
    return { total, counted, pending: Math.max(total - counted, 0), percent: total ? Math.round((counted / total) * 100) : 0 };
  }, [countSessionDetail, countSessionLines]);
  const countSessionValor = useMemo(() => totalDaContagem(
    countSessionDetail?.items.map((item) => item.id) ?? [],
    countSessionReferencia,
    Object.fromEntries(Object.entries(countSessionLines).map(([id, line]) => [id, line.countedQuantity]))
  ), [countSessionDetail, countSessionReferencia, countSessionLines]);
  const productsForCount = useMemo(() => {
    if (!selectedAgenda || selectedAgenda.sectorName === "INVENTARIO GERAL" || selectedAgenda.categoryName === "Todas as categorias") return products;
    return products.filter((product) => product.inventorySector?.name === selectedAgenda.sectorName);
  }, [products, selectedAgenda]);
  const filteredCountProducts = useMemo(() => {
    const normalized = countSearch.trim().toLowerCase();
    if (!normalized) return productsForCount;
    return productsForCount.filter((product) =>
      [product.externalCode, product.name, product.category?.name, product.subcategory?.name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized))
    );
  }, [countSearch, productsForCount]);
  const countProgress = useMemo(() => {
    const counted = productsForCount.filter((product) => countLines[product.id]?.countedQuantity !== undefined && countLines[product.id]?.countedQuantity !== "").length;
    const divergent = productsForCount.filter((product) => {
      const value = countLines[product.id]?.countedQuantity;
      if (value === undefined || value === "") return false;
      const stock = stocks.find((item) => item.productName === product.name || item.productCode === product.externalCode);
      return Number(value) !== Number(stock?.currentQuantity ?? 0);
    }).length;
    return { total: productsForCount.length, counted, pending: Math.max(productsForCount.length - counted, 0), divergent };
  }, [countLines, productsForCount, stocks]);
  const lowStockItems = useMemo(() => buyerSupport?.items.filter((item) => item.alerts.includes("ZERADO") || item.alerts.includes("ABAIXO_DO_MINIMO")) ?? [], [buyerSupport]);
  const latestCountSession = useMemo(() => [...countSessions].sort((a, b) => String(b.referenceDate).localeCompare(String(a.referenceDate)))[0] ?? null, [countSessions]);
  const latestClosedInventory = useMemo(
    () => [...operationalInventories].filter((item) => item.status === "FECHADO").sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] ?? null,
    [operationalInventories]
  );
  const movementsByType = useMemo(() => countBy(movements, (movement) => movementTypeLabel(movement.type)), [movements]);
  const movementsByProduct = useMemo(() => sumBy(movements, (movement) => movement.productName, (movement) => Math.abs(Number(movement.quantity ?? 0))), [movements]);
  const movementsTimeline = useMemo(() => countBy(movements, (movement) => formatDate(movement.createdAt)), [movements]);
  const countsByStatus = useMemo(() => countBy(countSessions, (session) => countSessionStatusLabels[session.status] ?? session.status), [countSessions]);
  const divergencesBySector = useMemo(() => sumBy(operationalInventories, (inventory) => inventory.sectorName ?? operationalTypeLabels[inventory.type], (inventory) => Number(inventory.divergentItems ?? 0)), [operationalInventories]);
  const openCounts = activeCountSessions;
  const completedCounts = completedCountSessions;
  const activeCountProgress = openCounts.length
    ? Math.round(openCounts.reduce((sum, session) => {
        const total = Number(session.totalItems ?? 0);
        return sum + (total > 0 ? (Number(session.countedItems ?? 0) / total) * 100 : 0);
      }, 0) / openCounts.length)
    : 0;
  // Cada aba do Estoque espelha o modulo correspondente do catalogo de permissoes —
  // liberar "Movimentacoes" para um usuario passa a revelar a aba, sem mexer no cargo.
  const viewItems = [
    { id: "overview" as const, label: "Visão Geral", allowed: canViewStock },
    { id: "movements" as const, label: "Movimentações", allowed: canViewMovements },
    { id: "counting" as const, label: "Contagem de Estoque", allowed: canViewCountSessions },
    { id: "inventory" as const, label: "Inventário", allowed: canViewOperational },
    { id: "reports" as const, label: "Relatórios", allowed: canViewInventoryReports }
  ].filter((item) => item.allowed).map(({ id, label }) => ({ id, label }));
  const panelClass = (views: InventoryView[]) => views.includes(activeView) ? "panel" : "panel inventory-section-hidden";
  // A rota Relatorios mostra a leitura gerencial direto, sem depender da aba
  // escolhida dentro de Inventario (que comeca em "Inventarios oficiais").
  const showManagementReport = activeView === "reports";

  async function load() {
    setLoading(true);
    try {
      const monthParts = parseMonth(month);
      // Nao buscar o que o usuario nao tem permissao de ver: evita 403 silencioso e
      // payload inutil. Cada recurso segue o modulo correspondente.
      void getProductsSummary({ controlsStock: "true" })
        .then(setProductSummary)
        .catch(() => setProductSummary(null));
      void loadRoutineWeek();
      const [stockResult, movementResult, countResult, countSessionResult, agendaResult, operationalResult, sectorResult] = await Promise.allSettled([
        getInventoryStocks(search),
        canViewMovements ? getInventoryMovements({ startDate: movementPeriod.startDate, endDate: movementPeriod.endDate }) : Promise.resolve([] as InventoryMovement[]),
        getStockCounts(),
        getStockCountSessions(showCanceledStockData),
        getInventoryAgenda({ ...monthParts, hoje: hojeLocalIso() }),
        canViewOperational ? getOperationalInventories(showCanceledStockData) : Promise.resolve([] as OperationalInventory[]),
        getSectors(undefined, { forStockCounting: true })
      ]);
      const stockRows = settledValue(stockResult, [] as InventoryStock[]);
      const movementRows = settledValue(movementResult, [] as InventoryMovement[]);
      const countRows = settledValue(countResult, [] as StockCount[]);
      const countSessionRows = settledValue(countSessionResult, [] as StockCountSession[]);
      const agendaRows = settledValue(agendaResult, null as InventoryAgenda | null);
      const operationalRows = settledValue(operationalResult, [] as OperationalInventory[]);
      const sectorRows = settledValue(sectorResult, [] as InventorySector[]);
      setStocks(stockRows);
      setMovements(movementRows);
      setCounts(countRows);
      setCountSessions(countSessionRows);
      setAgenda(agendaRows);
      setOperationalInventories(operationalRows);
      setSectors(sectorRows);

      const firstAgenda = agendaRows?.items.find((item) => sameDay(item.scheduledDate, new Date())) ?? agendaRows?.items[0];
      setSelectedAgendaId((current) => current || firstAgenda?.id || "");
      await loadProducts(firstAgenda);
      // Apoio ao comprador so alimenta os alertas de estoque da Visao Geral.
      setBuyerSupport(canViewOperational ? await getBuyerSupportReport(buyerFilters).catch(() => null) : null);
      if (!sectorRows.length && countSessionForm.type === "SETORIAL") {
        setNotice({ tone: "warning", message: "Nenhum setor disponivel para contagem." });
      }
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel carregar os dados do estoque." });
    } finally {
      setLoading(false);
    }
  }

  async function loadProducts(agendaItem?: InventoryAgendaItem | null) {
    const isGeneral = agendaItem?.sectorName === "INVENTARIO GERAL" || agendaItem?.categoryName === "Todas as categorias";
    const productRows = await getProducts({
      ...(agendaItem?.sectorName && !isGeneral ? { sector: agendaItem.sectorName } : {}),
      controlsStock: "true",
      isActive: "true"
    });
    setProducts(productRows.items);
    // Movimentacao nao pre-seleciona produto: vinha com o primeiro da lista e
    // um aviso verde "Selecionado", e quem so digitava a quantidade lancava a
    // saida no produto errado.
    if (productRows.items[0]) {
      setCountForm((current) => current.productId ? current : { ...current, productId: productRows.items[0].id, unit: productRows.items[0].unit ?? "" });
    }
  }

  async function refreshOperational(id?: string) {
    setOperationalInventories(await getOperationalInventories(showCanceledStockData));
    if (id) await openOperationalInventory(id);
  }

  async function downloadInventoryPdf(inventory: OperationalInventory) {
    try {
      await downloadOperationalInventoryPdf(inventory.id, inventory.code);
      setNotice({ tone: "success", message: "Relatorio do inventario gerado." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao gerar PDF." });
    }
  }

  async function downloadCountSessionPdf(session: StockCountSession | StockCountSessionDetail) {
    try {
      await downloadStockCountSessionPdf(session.id, session.code);
      setNotice({ tone: "success", message: "PDF da contagem gerado." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao gerar PDF da contagem." });
    }
  }

  // A folha sai do servidor: o que foi digitado e ainda nao salvo precisa ir
  // antes, senao o papel sai com quadro em branco onde a tela ja tem numero.
  async function printCountSession(session: StockCountSession | StockCountSessionDetail) {
    try {
      const abertaNaTela = countSessionDetail?.id === session.id;
      const pendentesDeSalvar = abertaNaTela ? countSessionPayload() : [];
      const podeSalvar = Boolean(countSessionDetail && editableCountSessionStatuses.has(countSessionDetail.status) && canEditCountSession);
      const salvou = pendentesDeSalvar.length > 0 && podeSalvar;
      if (salvou) {
        const invalid = invalidCountSessionItems();
        if (invalid.length) {
          setNotice({ tone: "error", message: mensagemDeQuantidade(invalid.map((item) => ({ nome: item.productNameSnapshot, valor: countSessionLines[item.id]?.countedQuantity ?? "" }))) });
          return;
        }
        await saveStockCountSessionItems(session.id, pendentesDeSalvar);
        await refreshCountSessions(session.id);
      }
      imprimirBlobPdf(await getStockCountSessionPdfBlob(session.id));
      setNotice({ tone: "success", message: salvou ? "Contagem salva e enviada para impressão." : "Contagem enviada para impressão." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel imprimir a contagem." });
    }
  }

  async function refreshCountSessions(id?: string) {
    const rows = await getStockCountSessions(showCanceledStockData);
    setCountSessions(rows);
    void loadRoutineWeek();
    if (id) await openCountSession(id, false);
  }

  async function loadRoutineWeek() {
    setRoutineWeekLoading(true);
    try {
      const week = await getInventoryAgendaWeek(hojeLocalIso());
      setRoutineWeek(week.items);
    } catch {
      setRoutineWeek([]);
    } finally {
      setRoutineWeekLoading(false);
    }
  }

  // Cria a sessao e abre; se ja houver uma em andamento para o mesmo escopo
  // (409), abre a existente em vez de falhar.
  async function iniciarSessaoDeContagem(payload: Parameters<typeof createStockCountSession>[0]) {
    try {
      const created = await createStockCountSession(payload);
      setNotice({ tone: "success", message: `${created.code} criada com ${created.totalItems} produto(s)${created.sectorName ? ` do setor ${created.sectorName}` : ""}.` });
      await refreshCountSessions(created.id);
      onOpenCountSessionRoute?.(created.id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const existingId = error.body?.existingId as string | undefined;
        const existingCode = error.body?.existingCode as string | undefined;
        setNotice({
          tone: "warning",
          message: `Ja existe uma contagem em andamento para este periodo${existingCode ? ` (${existingCode})` : ""}. Abra a contagem existente para continuar.`
        });
        if (existingId) await refreshCountSessions(existingId);
        return;
      }
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel iniciar a contagem." });
    }
  }

  // "Comecar contagem" da rotina: sessao do setor inteiro, no ciclo sugerido
  // para hoje, ja ligada ao dia da agenda.
  async function startRoutineCount(item: InventoryAgendaItem) {
    if (!item.activeSectorId) return;
    const hoje = hojeLocalIso();
    const ciclo = cicloSugerido(hoje);
    setStartingRoutineItemId(item.id);
    try {
      await iniciarSessaoDeContagem({
        referenceDate: hoje,
        type: "SETORIAL",
        sectorId: item.activeSectorId,
        periodMonth: ciclo.mes,
        periodYear: ciclo.ano,
        inventoryAgendaItemId: item.id
      });
    } finally {
      setStartingRoutineItemId(null);
    }
  }

  async function createCountSession() {
    // Backend deriva os nomes (sectorName/categoryName/subcategoryName) a partir dos IDs —
    // aqui so validamos presenca dos IDs e enviamos IDs. Sem denormalizado no payload.
    if (countSessionForm.type === "SETORIAL" && !countSessionForm.sectorId) {
      setNotice({ tone: "warning", message: "Selecione um setor para iniciar a contagem por setor." });
      return;
    }
    if (countSessionForm.type === "CATEGORIA" && !countSessionForm.categoryId) {
      setNotice({ tone: "warning", message: "Selecione uma categoria para iniciar a contagem por categoria." });
      return;
    }
    if (countSessionForm.type === "SUBCATEGORIA" && !countSessionForm.subcategoryId) {
      setNotice({ tone: "warning", message: "Selecione uma subcategoria para iniciar a contagem por subcategoria." });
      return;
    }
    await iniciarSessaoDeContagem({
      referenceDate: countSessionForm.referenceDate,
      type: countSessionForm.type,
      sectorId: countSessionForm.type === "SETORIAL" ? countSessionForm.sectorId || null : null,
      // SETORIAL aceita categoria opcional (escopo composto). CATEGORIA exige categoria.
      categoryId: countSessionForm.type === "CATEGORIA" || countSessionForm.type === "SETORIAL"
        ? countSessionForm.categoryId || null
        : null,
      subcategoryId: countSessionForm.type === "SUBCATEGORIA" ? countSessionForm.subcategoryId || null : null,
      isMonthEnd: countSessionForm.isMonthEnd || countSessionForm.type === "FINAL_MES",
      periodMonth: countSessionForm.periodMonth,
      periodYear: countSessionForm.periodYear,
      notes: countSessionForm.notes || null
    });
  }

  async function openCountSession(id: string, showMessage = true, syncRoute = true) {
    const detail = await getStockCountSession(id);
    setCountSessionDetail(detail);
    setCountSessionSearch("");
    setCountSessionSectorFilter("");
    setCountSessionCategoryFilter("");
    setCountSessionSubcategoryFilter("");
    setCountSessionUnitFilter("");
    setCountSessionStatusFilter("TODOS");
    setCountSessionDirty({});
    setCountSessionPlausibility({});
    contagemAbertaRef.current = id;
    const aindaAberta = () => contagemAbertaRef.current === id;
    // Em paralelo e sem bloquear a abertura: se falhar, a contagem segue sem a guarda.
    void getStockCountSessionPlausibility(id)
      .then((rows) => { if (aindaAberta()) setCountSessionPlausibility(Object.fromEntries(rows.map((row) => [row.itemId, row]))); })
      .catch(() => { if (aindaAberta()) setCountSessionPlausibility({}); });
    setCountSessionReferencia({});
    void getReferenciaDaContagem(id)
      .then((rows) => { if (aindaAberta()) setCountSessionReferencia(Object.fromEntries(rows.map((row) => [row.itemId, row]))); })
      .catch(() => { if (aindaAberta()) setCountSessionReferencia({}); });
    setCountSessionLines(Object.fromEntries(detail.items.map((item) => [
      item.id,
      { countedQuantity: item.countedQuantity == null ? "" : String(item.countedQuantity), notes: item.notes ?? "" }
    ])));
    if (syncRoute) onOpenCountSessionRoute?.(id);
    if (showMessage) setNotice({ tone: "success", message: `${detail.code} aberta para lancamento.` });
  }

  function updateCountSessionLine(itemId: string, patch: Partial<{ countedQuantity: string; notes: string }>) {
    setCountSessionLines((prev) => {
      const atual = prev[itemId] ?? { countedQuantity: "", notes: "" };
      return { ...prev, [itemId]: { ...atual, ...patch } };
    });
    setCountSessionDirty((prev) => (prev[itemId] ? prev : { ...prev, [itemId]: true }));
  }

  // Sobrou so o caso de texto que nao e numero. A leitura de dois sentidos
  // deixou de existir: ponto sem virgula e decimal, como no resto do ERP.
  function mensagemDeQuantidade(rotulos: Array<{ nome: string; valor: string }>) {
    return `Quantidade invalida em: ${rotulos.map((r) => r.nome).join(", ")}.`;
  }

  function countSessionPayload() {
    if (!countSessionDetail) return [];
    return countSessionDetail.items
      .filter((item) => countSessionDirty[item.id])
      .map((item) => ({
        id: item.id,
        countedQuantity: quantityToApi(countSessionLines[item.id]?.countedQuantity ?? "") ?? "",
        notes: countSessionLines[item.id]?.notes ?? ""
      }));
  }

  // Nao envia nada se alguma linha estiver ilegivel: o backend rejeitaria o lote
  // inteiro e a mensagem generica nao diria qual produto revisar.
  function invalidCountSessionItems() {
    if (!countSessionDetail) return [];
    return countSessionDetail.items.filter(
      (item) => countSessionDirty[item.id]
        && quantityToApi(countSessionLines[item.id]?.countedQuantity ?? "") === undefined
    );
  }

  async function saveCountSessionDraft() {
    if (!countSessionDetail) return;
    const invalid = invalidCountSessionItems();
    if (invalid.length) {
      setNotice({ tone: "error", message: mensagemDeQuantidade(invalid.map((item) => ({ nome: item.productNameSnapshot, valor: countSessionLines[item.id]?.countedQuantity ?? "" }))) });
      return;
    }
    try {
      await saveStockCountSessionItems(countSessionDetail.id, countSessionPayload());
      setNotice({ tone: "success", message: "Contagem salva. Voce pode continuar depois." });
      await refreshCountSessions(countSessionDetail.id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        setNotice({ tone: "error", message: "Voce nao tem permissao para realizar esta acao." });
        return;
      }
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel salvar a contagem." });
    }
  }

  async function concludeCountSession() {
    if (!countSessionDetail) return;
    const invalid = invalidCountSessionItems();
    if (invalid.length) {
      setNotice({ tone: "error", message: mensagemDeQuantidade(invalid.map((item) => ({ nome: item.productNameSnapshot, valor: countSessionLines[item.id]?.countedQuantity ?? "" }))) });
      return;
    }
    // Resumo antes de concluir: a pessoa pode ter clicado "conferi" no automatico.
    const atipicos = countSessionDetail.items.filter(
      (item) => evaluateQuantity(
        countSessionPlausibility[item.id],
        countSessionLines[item.id]?.countedQuantity ?? ""
      ).some((warning) => warning !== "CONFERIR_UNIDADE")
    );
    // Mais do que havia (anterior + compras) e zerar o que acabou de entrar
    // tambem passam pelo resumo: sao os dois avisos da referencia na linha.
    const foraDaReferencia = (itemId: string) => {
      const { situacao } = lerContagem(countSessionReferencia[itemId], countSessionLines[itemId]?.countedQuantity ?? "");
      return situacao === "ACIMA_DO_DISPONIVEL" || situacao === "ZERADO_COM_COMPRA";
    };
    const jaListados = new Set(atipicos.map((item) => item.id));
    const paraConferir = [...atipicos, ...countSessionDetail.items.filter((item) => !jaListados.has(item.id) && foraDaReferencia(item.id))];
    if (paraConferir.length) {
      const nomes = paraConferir.slice(0, 5).map((item) => item.productNameSnapshot).join(", ");
      const resto = paraConferir.length > 5 ? ` e mais ${paraConferir.length - 5}` : "";
      if (!window.confirm(
        `${paraConferir.length} item(ns) com quantidade fora do normal: ${nomes}${resto}.

` +
        "Concluir assim mesmo? Depois disso o estoquista nao edita sem reabertura."
      )) {
        return;
      }
    }
    const pendingItems = countSessionDetail.items.filter((item) => {
      const value = countSessionLines[item.id]?.countedQuantity;
      return value === undefined || value === "";
    }).length;
    if (pendingItems > 0) {
      setCountSessionStatusFilter("PENDENTE");
      setNotice({
        tone: "warning",
        message: `Existem ${pendingItems} produtos sem quantidade informada. Informe a quantidade contada ou digite 0 nos produtos sem estoque antes de concluir. Se outra pessoa ja contou esses itens, salve e reabra a contagem para carregar o que ela lancou.`
      });
      return;
    }
    if (!window.confirm("Concluir contagem? Depois disso o estoquista nao podera editar diretamente sem reabertura autorizada.")) return;
    try {
      await concludeStockCountSession(countSessionDetail.id, countSessionPayload());
      setNotice({ tone: "success", message: "Contagem concluida. Todos os itens estavam informados." });
      await refreshCountSessions(countSessionDetail.id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        setNotice({ tone: "error", message: "Voce nao tem permissao para realizar esta acao." });
        return;
      }
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel concluir a contagem." });
    }
  }

  async function reopenCountSessionAction() {
    if (!countSessionDetail) return;
    const reason = window.prompt("Motivo da reabertura");
    if (!reason) return;
    try {
      await reopenStockCountSession(countSessionDetail.id, reason);
      setNotice({ tone: "success", message: "Contagem reaberta." });
      await refreshCountSessions(countSessionDetail.id);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel reabrir a contagem." });
    }
  }

  async function reshapeCountSessionToCurrentFilters() {
    if (!countSessionDetail) return;
    if (!["GERAL", "SETORIAL"].includes(countSessionDetail.type)) {
      setNotice({ tone: "warning", message: "Este ajuste esta disponivel apenas para contagens gerais ou setoriais." });
      return;
    }
    const sector = countSessionSectorFilter ? sectorByName.get(countSessionSectorFilter) : undefined;
    let category = countSessionCategoryFilter ? categoryByName.get(countSessionCategoryFilter) : undefined;
    let subcategory = countSessionSubcategoryFilter ? subcategoryByName.get(countSessionSubcategoryFilter) : undefined;

    let nextType: "GERAL" | "SETORIAL" | "CATEGORIA" | "SUBCATEGORIA" = countSessionDetail.type === "SETORIAL" ? "SETORIAL" : "GERAL";
    if (countSessionDetail.type !== "SETORIAL") {
      if (countSessionSectorFilter) nextType = "SETORIAL";
      else if (countSessionSubcategoryFilter) nextType = "SUBCATEGORIA";
      else if (countSessionCategoryFilter) nextType = "CATEGORIA";
    }

    if (countSessionDetail.type === "GERAL" && nextType === "GERAL") {
      setNotice({ tone: "warning", message: "Selecione ao menos um filtro para recortar a contagem geral." });
      return;
    }
    if (countSessionDetail.type === "SETORIAL" && nextType !== "SETORIAL") {
      setNotice({ tone: "warning", message: "Em contagens setoriais, ajuste apenas a categoria dentro do mesmo setor." });
      return;
    }
    if (countSessionDetail.type === "SETORIAL" && sector?.id && sector.id !== countSessionDetail.sectorId) {
      setNotice({ tone: "warning", message: "Nao e possivel trocar o setor de uma contagem setorial existente." });
      return;
    }
    if (countSessionSectorFilter && !sector) {
      setNotice({ tone: "warning", message: "Nao encontrei o setor selecionado no cadastro atual." });
      return;
    }
    if (countSessionCategoryFilter && !category) {
      const categories = await getCategories();
      category = categories.find((item) => item.name === countSessionCategoryFilter);
      if (!category) {
        setNotice({ tone: "warning", message: "Nao encontrei a categoria selecionada no cadastro atual." });
        return;
      }
    }
    if (countSessionSubcategoryFilter && !subcategory) {
      const subcategories = await getSubcategories();
      subcategory = subcategories.find((item) => item.name === countSessionSubcategoryFilter);
      if (!subcategory) {
        setNotice({ tone: "warning", message: "Nao encontrei a subcategoria selecionada no cadastro atual." });
        return;
      }
    }

    const scopeLabel = [
      countSessionDetail.type === "SETORIAL" ? (countSessionSectorFilter || countSessionDetail.sectorName || "") : countSessionSectorFilter,
      countSessionCategoryFilter,
      countSessionSubcategoryFilter
    ].filter(Boolean).join(" - ");
    // A confirmacao ja existia, mas dizia "recortar para o escopo filtrado" —
    // a mesma expressao opaca que o botao usava. Aqui a pergunta passa a dizer
    // o que se perde: quantos itens saem, quantos JA FORAM CONTADOS entre eles
    // (esse e o trabalho que evapora) e que nao ha como desfazer.
    const ficam = filteredCountSessionItems.length;
    const saemItens = countSessionDetail.items.filter((item) => !filteredCountSessionItems.some((f) => f.id === item.id));
    // Conta os dois: o que ja esta gravado no servidor e o que foi digitado e
    // ainda nao foi salvo. O segundo tambem evapora, e olhar so o primeiro dava
    // "nenhum dos que saem foi contado" com valores na tela na frente do usuario.
    const saemContados = saemItens.filter((item) => {
      const gravado = item.countedQuantity != null && Number(item.countedQuantity) !== 0;
      const digitado = (countSessionLines[item.id]?.countedQuantity ?? "").trim() !== "";
      return gravado || digitado;
    }).length;
    const aviso = [
      `Reduzir ${countSessionDetail.code}${scopeLabel ? ` a ${scopeLabel}` : ""}?`,
      "",
      `Ficam ${ficam} itens. Saem ${saemItens.length}.`,
      saemContados > 0
        ? `ATENCAO: ${saemContados} dos que saem ja tem contagem (gravada ou ainda nao salva). Ela sera perdida.`
        : "Nenhum dos que saem foi contado ainda.",
      "",
      "Nao ha como desfazer."
    ].join("\n");
    if (!window.confirm(aviso)) return;
    try {
      await reshapeStockCountSessionScope({
        id: countSessionDetail.id,
        type: nextType,
        sectorId: nextType === "SETORIAL" ? (sector?.id ?? countSessionDetail.sectorId ?? null) : null,
        categoryId: nextType === "SETORIAL" || nextType === "CATEGORIA" ? (category?.id ?? null) : null,
        subcategoryId: nextType === "SETORIAL" || nextType === "SUBCATEGORIA" ? (subcategory?.id ?? null) : null,
        reason: scopeLabel
          ? `Escopo ajustado para ${scopeLabel}.`
          : "Escopo ajustado a partir dos filtros da tela."
      });
      setNotice({ tone: "success", message: `Contagem ${countSessionDetail.code} ajustada para ${scopeLabel || "o novo escopo"}.` });
      await refreshCountSessions(countSessionDetail.id);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel ajustar o escopo da contagem." });
    }
  }

  async function cancelCountSessionAction(session?: StockCountSession | StockCountSessionDetail) {
    const target = session ?? countSessionDetail;
    if (!target) return;
    if (!window.confirm("Tem certeza que deseja cancelar esta contagem? Esta acao nao apaga o historico, mas a contagem deixara de ser considerada para inventario, CMV, compras e fechamento.")) return;
    const reason = window.prompt("Motivo do cancelamento");
    if (!reason?.trim()) {
      setNotice({ tone: "warning", message: "Informe o motivo para cancelar a contagem." });
      return;
    }
    try {
      await cancelStockCountSession(target.id, reason.trim());
      setNotice({ tone: "success", message: `${target.code} cancelada. O historico foi preservado.` });
      await refreshCountSessions(countSessionDetail?.id === target.id ? target.id : undefined);
      if (countSessionDetail?.id === target.id) {
        const updated = await getStockCountSession(target.id);
        setCountSessionDetail(updated);
      }
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel cancelar a contagem." });
    }
  }

  async function generateInventoryFromCountSession() {
    if (!countSessionDetail) return;
    if (!window.confirm("Gerar inventario oficial em rascunho a partir desta contagem concluida?")) return;
    try {
      const inventory = await generateInventoryFromStockCountSession(countSessionDetail.id);
      setNotice({ tone: "success", message: `${inventory.code} gerado a partir da contagem ${countSessionDetail.code}.` });
      await Promise.all([refreshCountSessions(countSessionDetail.id), refreshOperational()]);
      irParaInventario(inventory.id);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel gerar o inventario." });
    }
  }

  async function checkConsolidationCoverage(ids: string[]) {
    if (ids.length === 0) { setConsolidationCoverage(null); return; }
    setIsFetchingCoverage(true);
    try {
      const cov = await previewConsolidationCoverage(ids);
      setConsolidationCoverage(cov);
    } catch {
      setConsolidationCoverage(null);
    } finally {
      setIsFetchingCoverage(false);
    }
  }

  async function loadFinalCmvCoverage(inventoryId: string) {
    setIsFetchingFinalCmvCoverage(true);
    try {
      const cov = await getFinalCmvCoverage(inventoryId);
      setFinalCmvCoverage(cov);
    } catch {
      setFinalCmvCoverage(null);
    } finally {
      setIsFetchingFinalCmvCoverage(false);
    }
  }

  async function handleCreateMissingCount() {
    if (!operationalDetail) return;
    await handleCreateMissingCountForInv(operationalDetail.id);
  }

  async function handleAppendMissingCount(countSessionId: string) {
    if (!operationalDetail || isAppendingComplement) return;
    await handleAppendMissingCountForInv(operationalDetail.id, countSessionId);
  }

  async function handleCreateMissingCountForInv(inventoryId: string) {
    if (isCreatingComplement) return;
    setIsCreatingComplement(true);
    try {
      const session = await createMissingCount(inventoryId);
      setNotice({ tone: "success", message: `Contagem complementar ${session.code} criada com ${session.totalItems} produto(s) pendente(s). Preencha as quantidades abaixo.` });
      await Promise.all([refreshCountSessions(), refreshOperational()]);
      irParaVisao("counting");
      await openCountSession(session.id, false);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao criar contagem complementar." });
    } finally {
      setIsCreatingComplement(false);
    }
  }

  async function handleAppendMissingCountForInv(inventoryId: string, countSessionId: string) {
    if (isAppendingComplement) return;
    setIsAppendingComplement(true);
    try {
      const currentCoverage = await getFinalCmvCoverage(inventoryId);
      setFinalCmvCoverageMap((prev) => ({ ...prev, [inventoryId]: currentCoverage }));
      if (inventoryId === operationalDetail?.id) setFinalCmvCoverage(currentCoverage);
      if (currentCoverage.isComplete) {
        setNotice({ tone: "error", message: `Inventario ja esta completo (${currentCoverage.coveredTotal}/${currentCoverage.expectedTotal}). Nao ha pendencias para incluir.` });
        return;
      }
      const result = await appendMissingCount(inventoryId, countSessionId);
      setFinalCmvCoverageMap((prev) => ({ ...prev, [inventoryId]: result }));
      if (inventoryId === operationalDetail?.id) setFinalCmvCoverage(result);
      setNotice({ tone: "success", message: `${result.appendedItems} produto(s) incluido(s) no ${result.inventoryCode}. Cobertura: ${result.coveredTotal}/${result.expectedTotal}${result.isComplete ? " — inventario completo." : "."}` });
      await refreshOperational(inventoryId === operationalDetail?.id ? inventoryId : undefined);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao incluir complemento no inventario." });
    } finally {
      setIsAppendingComplement(false);
    }
  }

  async function consolidateMonthEnd(allowIncomplete = false) {
    if (consolidationSelected.size === 0 || isConsolidating) return;
    const ids = [...consolidationSelected];

    // Verificar cobertura antes de consolidar
    setIsFetchingCoverage(true);
    let cov: StockCoverageAudit | null = null;
    try {
      cov = await previewConsolidationCoverage(ids);
      setConsolidationCoverage(cov);
    } catch {
      // se falhar, deixar o backend bloquear
    } finally {
      setIsFetchingCoverage(false);
    }

    if (cov && !cov.isComplete && !allowIncomplete) {
      setNotice({
        tone: "error",
        message: `Cobertura incompleta: ${cov.coveredTotal}/${cov.expectedTotal} produtos cobertos. Inclua todos os produtos controlados antes de consolidar.`
      });
      return;
    }

    const confirmMsg = cov && !cov.isComplete
      ? `Consolidar ${ids.length} contagem(ns) com ${cov.missingTotal} produto(s) pendente(s)? O inventario sera criado em RASCUNHO — voce podera fechar o gap via contagem complementar antes de aprovar.`
      : `Consolidar ${ids.length} contagem(ns) setorial(is) em um unico inventario Final CMV?`;
    if (!window.confirm(confirmMsg)) return;
    setIsConsolidating(true);
    try {
      const inventory = await consolidateMonthEndSessions(ids, null, allowIncomplete);
      setNotice({ tone: "success", message: `${inventory.code} gerado — ${ids.length} setor(es) consolidados.` });
      setConsolidationSelected(new Set());
      setConsolidationCoverage(null);
      await Promise.all([refreshCountSessions(), refreshOperational()]);
      irParaInventario(inventory.id);
    } catch (error) {
      const isAbort = error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"));
      setNotice({
        tone: "error",
        message: isAbort
          ? "A consolidacao demorou mais que o esperado. Verifique se o inventario foi gerado em Inventarios antes de tentar novamente."
          : error instanceof Error ? error.message : "Nao foi possivel consolidar as contagens."
      });
    } finally {
      setIsConsolidating(false);
    }
  }

  function handleCountInputBlur(itemId: string) {
    window.setTimeout(() => {
      const activeElement = document.activeElement as HTMLElement | null;
      if (activeElement?.getAttribute("data-session-count-input") === "true") return;
      setActiveCountSessionInputId((current) => current === itemId ? null : current);
    }, 80);
  }

  function getVisibleCountSessionInputs() {
    return Array.from(document.querySelectorAll<HTMLInputElement>("[data-session-count-input='true']:not(:disabled)"))
      .filter((input) => input.getClientRects().length > 0);
  }

  function scrollCountInputToComfort(input: HTMLInputElement, behavior: ScrollBehavior = "auto") {
    const target = (input.closest(".mobile-count-card-block") as HTMLElement | null) ?? input;
    const rect = target.getBoundingClientRect();
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const comfortableTop = Math.min(152, Math.max(112, viewportHeight * 0.26));
    const comfortableBottom = viewportHeight * 0.58;
    if (rect.top >= comfortableTop - 10 && rect.top <= comfortableBottom) return;
    window.scrollBy({ top: rect.top - comfortableTop, behavior });
  }

  function advanceCountSessionInput(currentInput: HTMLInputElement) {
    const inputs = getVisibleCountSessionInputs();
    const index = inputs.indexOf(currentInput);
    const nextInput = inputs[index + 1];
    if (!nextInput) {
      currentInput.blur();
      if (countSessionStatusFilter === "PENDENTE") {
        setNotice({ tone: "success", message: "Todos os itens deste filtro foram contados." });
      }
      return;
    }
    const nextItemId = nextInput.getAttribute("data-session-count-item-id");
    if (nextItemId) setActiveCountSessionInputId(nextItemId);
    // Foco na hora, dentro do proprio Enter: com o atraso de 60ms quem digita
    // rapido mandava os primeiros numeros para o item anterior ("3" + "012"
    // virava "3012"), e no iPhone foco fora do gesto pode fechar o teclado.
    nextInput.focus({ preventScroll: true });
    nextInput.select();
    scrollCountInputToComfort(nextInput);
    // O aviso do item que ficou para tras pode mudar a altura da lista.
    window.requestAnimationFrame(() => scrollCountInputToComfort(nextInput));
  }

  // Acoes secundarias de uma contagem da lista. O mesmo menu no desktop e no
  // celular: no celular Cancelar era um botao vermelho de largura total em
  // toda contagem, a um toque errado de distancia do Continuar.
  function countSessionMenuItems(session: StockCountSession): Array<RowMenuItem | RowMenuSeparator> {
    return [
      { label: "Imprimir", icon: <Printer size={15} />, onClick: () => void printCountSession(session) },
      { label: "Baixar PDF", icon: <Download size={15} />, onClick: () => downloadCountSessionPdf(session) },
      ...(canPlanPurchase && session.status === "CONCLUIDA"
        ? [{ label: "Gerar pedido de compra", icon: <ShoppingCart size={15} />, onClick: () => navigate(`/estoque/planejamento-compra?sourceType=STOCK_COUNT_SESSION&sourceId=${session.id}`) }]
        : []),
      ...(canGenerateInventoryFromCount(session)
        ? [{ label: "Gerar inventário", icon: <ClipboardCheck size={15} />, onClick: async () => { await openCountSession(session.id, false); await generateInventoryFromStockCountSession(session.id); await refreshCountSessions(session.id); await refreshOperational(); setNotice({ tone: "success", message: "Inventário gerado a partir da contagem." }); } }]
        : []),
      ...(canCancelCountSession(session)
        ? [{ separator: true as const }, { label: "Cancelar contagem", icon: <Trash2 size={15} />, tone: "danger" as const, onClick: () => cancelCountSessionAction(session) }]
        : [])
    ];
  }

  // Pedacos das linhas das listas de inventario, iguais no desktop e no celular.
  function advanceCountSessionItem(itemId: string) {
    const input = getVisibleCountSessionInputs().find((candidate) => candidate.getAttribute("data-session-count-item-id") === itemId);
    if (input) advanceCountSessionInput(input);
  }

  function focusFirstVisibleCountSessionInput() {
    const firstInput = getVisibleCountSessionInputs()[0];
    if (!firstInput) {
      if (countSessionStatusFilter === "PENDENTE") {
        setNotice({ tone: "success", message: "Todos os itens deste filtro foram contados." });
      }
      return;
    }
    const itemId = firstInput.getAttribute("data-session-count-item-id");
    if (itemId) setActiveCountSessionInputId(itemId);
    scrollCountInputToComfort(firstInput);
    window.setTimeout(() => {
      firstInput.focus();
      firstInput.select();
      scrollCountInputToComfort(firstInput);
    }, 70);
  }

  function handleCountFieldKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      advanceCountSessionInput(event.currentTarget);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    advanceCountSessionInput(event.currentTarget);
  }

  function markFilteredCountSessionItemsAsZero() {
    if (!filteredCountSessionItems.length) return;
    // Preenche SO os campos vazios. A versao anterior sobrescrevia todos os itens
    // filtrados com "0" — inclusive os ja contados — apesar de a confirmacao
    // prometer o contrario. Com o filtro em "TODOS", um clique zerava a contagem
    // inteira.
    const vazios = filteredCountSessionItems.filter((item) => {
      const atual = countSessionLines[item.id]?.countedQuantity;
      return atual === undefined || atual === "";
    });
    if (!vazios.length) {
      setNotice({ tone: "info", message: "Todos os itens filtrados ja tem quantidade informada. Nada foi alterado." });
      return;
    }
    const jaPreenchidos = filteredCountSessionItems.length - vazios.length;
    const aviso = jaPreenchidos > 0 ? ` ${jaPreenchidos} item(ns) ja contado(s) serao mantidos.` : "";
    if (!window.confirm(`Preencher com 0 os ${vazios.length} item(ns) filtrado(s) ainda sem quantidade?${aviso}`)) return;
    const next = { ...countSessionLines };
    const tocados = { ...countSessionDirty };
    vazios.forEach((item) => {
      next[item.id] = { countedQuantity: "0", notes: next[item.id]?.notes ?? "" };
      tocados[item.id] = true;
    });
    setCountSessionLines(next);
    setCountSessionDirty(tocados);
  }

  async function createOperational() {
    try {
      const sector = sectors.find((item) => item.id === operationalForm.sectorId);
      const created = await createOperationalInventory({
        date: operationalForm.date,
        effectiveCountDate: operationalForm.effectiveCountDate || operationalForm.date,
        startedAt: operationalForm.startedAt ? new Date(operationalForm.startedAt).toISOString() : null,
        finishedAt: operationalForm.finishedAt ? new Date(operationalForm.finishedAt).toISOString() : null,
        type: operationalForm.type,
        sectorId: operationalForm.type === "SETORIAL" ? operationalForm.sectorId || null : null,
        sectorName: operationalForm.type === "SETORIAL" ? sector?.name ?? null : null,
        notes: operationalForm.notes || null
      });
      setNotice({ tone: "success", message: `${created.code} criado com ${created.totalItems} item(ns).` });
      await refreshOperational();
      irParaInventario(created.id);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel criar o inventario." });
    }
  }

  // Sem aviso de "aberto": o Notice tambem rola a pagina ate ele, no topo, e
  // disputava com a rolagem ate o painel — o inventario abria 1.800px abaixo e
  // a pessoa continuava olhando a lista. O painel aparecer ja e o retorno.
  // Rascunhos sem nenhuma quantidade, criados ha mais de 30 dias: so ocupavam a
  // lista (5 inventarios "Geral" vazios de junho na base). Cancelar nao apaga.
  async function cancelarRascunhosVazios(ids: string[]) {
    const motivo = "Rascunho sem nenhuma quantidade lançada há mais de 30 dias (limpeza da lista de inventários).";
    const resultados = await Promise.allSettled(ids.map((id) => cancelOperationalInventory(id, motivo)));
    const falhas = resultados.filter((r) => r.status === "rejected").length;
    await refreshOperational().catch(() => undefined);
    setNotice(falhas === 0
      ? { tone: "success", message: `${ids.length} rascunho(s) vazio(s) cancelado(s).` }
      : { tone: "warning", message: `${ids.length - falhas} cancelado(s); ${falhas} não puderam ser cancelados. Abra-os para ver o motivo.` });
  }

  // Da conferencia para a linha editavel: filtra a tabela pelo produto e poe o
  // cursor na quantidade dele.
  function localizarItemDaConferencia(item: ItemDaConferencia) {
    setOperationalSectorFilter("");
    setOperationalSearch(item.productCode ?? item.productName);
    setAbaDoDetalhe("itens");
    setItemParaLocalizar(item.itemId);
  }

  // Depois que a tabela ja foi filtrada: rolar antes disso mirava a posicao que
  // a linha tinha na lista inteira.
  useEffect(() => {
    if (!itemParaLocalizar) return;
    const input = document.querySelector<HTMLInputElement>(`[data-op-item-id="${itemParaLocalizar}"]`);
    input?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (input && !input.disabled) input.focus({ preventScroll: true });
    setItemParaLocalizar(null);
  }, [itemParaLocalizar, filteredOperationalItems, abaDoDetalhe]);

  // O endereco manda no detalhe: abrir e navegar para ?inventario=<id>, e um
  // efeito so carrega. Assim o "voltar" do navegador fecha o detalhe, o link
  // pode ser compartilhado, e abrir a partir de Contagens (gerar, consolidar)
  // chega no inventario em vez de cair na lista.
  function irParaInventario(id: string, origem: "lista" | "outra" = "outra") {
    abertoPelaLista.current = origem === "lista";
    setInventoryDeskTab("official");
    if (activeView !== "inventory") setActiveView("inventory");
    navigate(`${INVENTORY_VIEW_PATHS.inventory}?inventario=${encodeURIComponent(id)}`);
  }

  function tirarInventarioDaUrl() {
    setSearchParams((atual) => {
      const proximo = new URLSearchParams(atual);
      proximo.delete("inventario");
      return proximo;
    }, { replace: true });
  }

  function fecharDetalheDoInventario() {
    inventarioPedido.current = null;
    setOperationalDetail(null);
    if (abertoPelaLista.current) navigate(-1);
    else tirarInventarioDaUrl();
    abertoPelaLista.current = false;
    document.querySelector(".content")?.scrollTo({ top: 0 });
  }

  useEffect(() => {
    if (activeView !== "inventory") return;
    if (inventarioNaUrl && inventarioNaUrl !== operationalDetail?.id && inventarioNaUrl !== inventarioPedido.current) {
      setInventoryDeskTab("official");
      void openOperationalInventory(inventarioNaUrl);
    } else if (!inventarioNaUrl && operationalDetail) {
      inventarioPedido.current = null;
      abertoPelaLista.current = false;
      setOperationalDetail(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reage so ao endereco
  }, [inventarioNaUrl, activeView]);

  // Carrega (ou recarrega) o detalhe. Quem quer ABRIR chama irParaInventario.
  async function openOperationalInventory(id: string) {
    inventarioPedido.current = id;
    setOpeningInventoryId(id);
    try {
      const detail = await getOperationalInventory(id);
      // Voltou para a lista (ou abriu outro) enquanto carregava: descarta.
      if (inventarioPedido.current !== id) return;
      if (detail.id !== operationalDetail?.id) {
        setConferencia(null);
        // Quem abre um rascunho com itens faltando vai lancar; o resto vai conferir.
        setAbaDoDetalhe(editableOperationalInventoryStatuses.has(detail.status) && detail.pendingItems > 0 ? "itens" : "conferencia");
      }
      setOperationalDetail(detail);
      setVersaoConferencia((v) => v + 1);
      setFinalCmvCoverage(null);
      setOperationalSectorFilter("");
      setOperationalDirty({});
      setOperationalLines(Object.fromEntries(detail.items.map((item) => [
        item.id,
        { countedQuantity: item.countedQuantity == null ? "" : String(item.countedQuantity), notes: item.notes ?? "" }
      ])));
      if (detail.type === "FINAL_CMV" && detail.status === "RASCUNHO") {
        void loadFinalCmvCoverage(id);
      }
    } catch (error) {
      if (inventarioPedido.current !== id) return;
      inventarioPedido.current = null;
      if (inventarioNaUrl === id) tirarInventarioDaUrl();
      setNotice({ tone: "error", message: error instanceof Error ? `Não foi possível abrir o inventário: ${error.message}` : "Não foi possível abrir o inventário." });
    } finally {
      setOpeningInventoryId((atual) => (atual === id ? null : atual));
    }
  }

  async function saveOperationalDraft() {
    if (!operationalDetail) return;
    const invalid = operationalDetail.items.filter(
      (item) => operationalDirty[item.id]
        && quantityToApi(operationalLines[item.id]?.countedQuantity ?? "") === undefined
    );
    if (invalid.length) {
      setNotice({ tone: "error", message: mensagemDeQuantidade(invalid.map((item) => ({ nome: item.productName, valor: operationalLines[item.id]?.countedQuantity ?? "" }))) });
      return;
    }
    // Envia apenas o que esta pessoa editou — ver countSessionDirty.
    const items = operationalDetail.items
      .filter((item) => operationalDirty[item.id])
      .map((item) => ({
        id: item.id,
        countedQuantity: quantityToApi(operationalLines[item.id]?.countedQuantity ?? "") ?? "",
        notes: operationalLines[item.id]?.notes ?? ""
      }));
    try {
      await saveOperationalInventoryItems(operationalDetail.id, items);
      setNotice({ tone: "success", message: corrigindoNaRevisao ? "Correções salvas e registradas. A conferência foi recalculada." : "Rascunho salvo." });
      await refreshOperational(operationalDetail.id);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel salvar o inventario." });
    }
  }

  // Correcao direto no cartao da conferencia. Leva junto o que a pessoa ja
  // editou na aba Itens: a recarga depois de salvar descartaria essas edicoes.
  async function corrigirPelaConferencia(item: ItemDaConferencia, valor: string): Promise<boolean> {
    if (!operationalDetail) return false;
    const quantidade = quantityToApi(valor);
    if (quantidade === undefined || quantidade === "") {
      setNotice({ tone: "error", message: mensagemDeQuantidade([{ nome: item.productName, valor }]) });
      return false;
    }
    const pendentes = operationalDetail.items.filter((i) => operationalDirty[i.id] && i.id !== item.itemId);
    const invalidos = pendentes.filter((i) => quantityToApi(operationalLines[i.id]?.countedQuantity ?? "") === undefined);
    if (invalidos.length) {
      setNotice({ tone: "error", message: mensagemDeQuantidade(invalidos.map((i) => ({ nome: i.productName, valor: operationalLines[i.id]?.countedQuantity ?? "" }))) });
      return false;
    }
    const original = operationalDetail.items.find((i) => i.id === item.itemId);
    const items = [
      ...pendentes.map((i) => ({
        id: i.id,
        countedQuantity: quantityToApi(operationalLines[i.id]?.countedQuantity ?? "") ?? "",
        notes: operationalLines[i.id]?.notes ?? ""
      })),
      { id: item.itemId, countedQuantity: quantidade, notes: operationalLines[item.itemId]?.notes ?? original?.notes ?? "" }
    ];
    try {
      await saveOperationalInventoryItems(operationalDetail.id, items);
      setNotice({
        tone: "success",
        message: `${item.productName}: ${valor} salvo.${corrigindoNaRevisao ? " Correção registrada." : ""}${pendentes.length ? ` ${pendentes.length} edição(ões) da aba Itens salvas junto.` : ""}`
      });
      await refreshOperational(operationalDetail.id);
      return true;
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Não foi possível salvar a quantidade." });
      return false;
    }
  }

  async function markOperationalFilteredZero() {
    if (!operationalDetail) return;
    const ids = filteredOperationalItems.map((item) => item.id);
    if (ids.length === 0) return;
    await markOperationalInventoryItemsZero(operationalDetail.id, ids);
    setNotice({ tone: "success", message: `${ids.length} item(ns) filtrado(s) marcados como zero.` });
    await refreshOperational(operationalDetail.id);
  }

  // Saldo negativo depois do ajuste significa que sairam mais itens do que o
  // contado entre a contagem e a aprovacao. Nao e travado, mas precisa aparecer.
  function avisoSaldoNegativo(negativos: Array<{ produto: string; saldo: number }>) {
    if (!negativos.length) return "";
    const nomes = negativos.slice(0, 3).map((n) => n.produto).join(", ");
    const resto = negativos.length > 3 ? ` e mais ${negativos.length - 3}` : "";
    return `Atencao: ${negativos.length} produto(s) ficaram com saldo negativo (${nomes}${resto}) — houve saida nao registrada entre a contagem e a aprovacao.`;
  }

  /**
   * Revela o formulario de criar inventario e rola ate ele. O formulario ficava
   * sempre aberto no desktop, competindo com o que a tela tem a dizer — e quem
   * chegava para fechar o mes via um formulario que nao precisava preencher.
   */
  function abrirFormularioDeInventario() {
    setMobileInvFormOpen(true);
    // Conteudo revelado fora da viewport tem que se apresentar sozinho.
    window.setTimeout(() => {
      formularioInventarioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  /**
   * Executa o proximo passo do fechamento direto do card, sem obrigar a abrir o
   * inventario. Aprovar pede confirmacao: cria a base do CMV e, dali em diante,
   * reabrir custa caro.
   */
  async function executarPassoDoFechamento(inventoryId: string, acao: "submit" | "approve") {
    if (acaoFechamentoEmCurso) return;
    if (acao === "approve" && !window.confirm(
      "Aprovar cria a base de estoque do CMV Real a partir deste inventario.\n\n"
      + "Depois disso, reabrir exige cancelar ou revisar o inventario. Confirma?"
    )) return;

    setAcaoFechamentoEmCurso(true);
    try {
      if (acao === "submit") {
        await submitOperationalInventory(inventoryId);
        setNotice({ tone: "success", message: "Inventario enviado para revisao. Agora da para aprovar e criar a base do CMV." });
      } else {
        const resultado = await approveOperationalInventory(inventoryId);
        const ajustados = resultado.reconciliacao?.adjustedItems ?? 0;
        setNotice({
          tone: "success",
          message: `Inventario aprovado — base de estoque do CMV Real criada${ajustados > 0 ? ` (${ajustados} item(ns) reconciliado(s))` : ""}.`,
        });
      }
      await refreshOperational();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel avancar o fechamento." });
    } finally {
      setAcaoFechamentoEmCurso(false);
    }
  }

  async function operationalAction(action: "submit" | "approve" | "reject" | "close" | "cancel" | "reopen") {
    if (!operationalDetail) return;
    try {
      if (action === "submit") await submitOperationalInventory(operationalDetail.id);
      let ajustados = 0;
      let negativos: Array<{ produto: string; saldo: number }> = [];
      if (action === "approve") {
        const resultado = await approveOperationalInventory(operationalDetail.id);
        ajustados = resultado.reconciliacao?.adjustedItems ?? 0;
        negativos = resultado.reconciliacao?.negativeBalances ?? [];
      }
      if (action === "close") await closeOperationalInventory(operationalDetail.id);
      if (action === "reject") {
        const reason = window.prompt("Motivo da rejeicao");
        if (!reason) return;
        await rejectOperationalInventory(operationalDetail.id, reason);
      }
      if (action === "cancel") {
        const reason = window.prompt("Motivo do cancelamento");
        if (!reason) return;
        await cancelOperationalInventory(operationalDetail.id, reason);
      }
      if (action === "reopen") {
        const reason = window.prompt("Motivo da reabertura");
        if (!reason) return;
        await reopenOperationalInventory(operationalDetail.id, reason);
      }
      setNotice({
        tone: negativos.length > 0 ? "warning" : "success",
        message: [
          "Status do inventario atualizado.",
          ajustados > 0 ? `${ajustados} produto(s) tiveram o saldo ajustado para a quantidade contada.` : "",
          avisoSaldoNegativo(negativos)
        ].filter(Boolean).join(" ")
      });
      await refreshOperational(operationalDetail.id);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel atualizar o inventario." });
    }
  }

  async function handleApproveFinalCmv() {
    if (!operationalDetail) return;
    setShowCmvApproveModal(false);
    setApprovingFinalCmv(true);
    try {
      const resultado = await approveOperationalInventory(operationalDetail.id);
      const ajustados = resultado.reconciliacao?.adjustedItems ?? 0;
      const negativos = resultado.reconciliacao?.negativeBalances ?? [];
      setNotice({
        tone: negativos.length > 0 ? "warning" : "success",
        message: [
          "Inventario aprovado. Base de estoque criada para o CMV Real.",
          ajustados > 0 ? `${ajustados} produto(s) tiveram o saldo ajustado para a quantidade contada.` : "",
          avisoSaldoNegativo(negativos)
        ].filter(Boolean).join(" ")
      });
      await refreshOperational(operationalDetail.id);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao aprovar inventario." });
    } finally {
      setApprovingFinalCmv(false);
    }
  }

  async function chooseAgenda(item: InventoryAgendaItem) {
    setSelectedAgendaId(item.id);
    await loadProducts(item);
  }

  async function startAgenda() {
    if (!selectedAgenda) return;
    await startInventoryAgendaItem(selectedAgenda.id);
    setNotice({ tone: "success", message: "Contagem iniciada." });
    await load();
  }

  async function openCount(item: InventoryAgendaItem) {
    setSelectedAgendaId(item.id);
    setCountScreenOpen(true);
    await startInventoryAgendaItem(item.id);
    await loadProducts(item);
    await getInventoryAgendaDetail(item.id).catch(() => null);
    setNotice({ tone: "success", message: "Contagem aberta." });
  }

  function closeCountScreen() {
    setCountScreenOpen(false);
  }

  async function submitAgenda() {
    if (!selectedAgenda) return;
    await submitInventoryAgendaItem(selectedAgenda.id);
    setNotice({ tone: "success", message: "Contagem enviada para revisao." });
    await load();
  }

  async function confirmAgenda(item: InventoryAgendaItem) {
    await confirmInventoryAgendaItem(item.id);
    setNotice({ tone: "success", message: "Contagem confirmada." });
    await load();
  }

  async function submitMovement() {
    // Antes saia calado: o botao nao fazia nada e ninguem sabia por que.
    if (!movementForm.productId) {
      setNotice({ tone: "warning", message: "Escolha o produto antes de salvar a movimentacao." });
      return;
    }
    if (!movementForm.quantity) {
      setNotice({ tone: "warning", message: "Informe a quantidade da movimentacao." });
      return;
    }
    if (sensitiveMovementTypes.includes(movementForm.type) && !movementForm.notes.trim()) {
      setNotice({ tone: "error", message: "Observacao obrigatoria para este tipo de movimentacao." });
      return;
    }
    const quantity = quantityToApi(movementForm.quantity);
    if (quantity === undefined || quantity === "") {
      setNotice({ tone: "error", message: "Quantidade invalida. Use apenas numeros (ex.: 16,5)." });
      return;
    }
    try {
      await createInventoryMovement({ ...movementForm, quantity: Number(quantity) });
      setNotice({ tone: "success", message: "Movimentacao criada com sucesso." });
      setMovementForm({ ...movementForm, quantity: "", notes: "" });
      await load();
    } catch {
      setNotice({ tone: "error", message: "Erro ao salvar movimentacao." });
    }
  }

  function selectMovementProduct(productId: string) {
    const product = products.find((item) => item.id === productId);
    setMovementForm({ ...movementForm, productId, unit: product?.unit ?? product?.stockUnit ?? movementForm.unit });
  }

  function findMovementProduct() {
    const query = movementSearch.trim().toLowerCase();
    const product = products.find((item) =>
      item.externalCode?.toLowerCase() === query ||
      item.name.toLowerCase().includes(query)
    );
    if (!product) {
      setNotice({ tone: "warning", message: "Produto nao encontrado para movimentacao." });
      return;
    }
    selectMovementProduct(product.id);
    setMovementSearch(product.externalCode ? `${product.externalCode} - ${product.name}` : product.name);
  }

  async function saveCountLine(product: Product, status: "DRAFT" | "SUBMITTED") {
    const line = countLines[product.id];
    if (!line?.countedQuantity) return;
    const quantity = quantityToApi(line.countedQuantity);
    if (quantity === undefined || quantity === "") {
      setNotice({ tone: "error", message: `Quantidade invalida em ${product.name}.` });
      return;
    }
    const result = await createStockCount({
      productId: product.id,
      countedQuantity: Number(quantity),
      unit: product.stockUnit ?? product.unit ?? "",
      notes: line.notes,
      generateAdjustment: false,
      status,
      inventoryAgendaItemId: selectedAgenda?.id ?? null
    });
    setNotice({
      tone: result.divergenceQuantity === 0 ? "success" : "warning",
      message: status === "SUBMITTED" ? "Linha enviada para revisao." : "Rascunho salvo."
    });
  }

  async function submitCountScreen(status: "DRAFT" | "SUBMITTED") {
    const rows = productsForCount.filter((product) => countLines[product.id]?.countedQuantity);
    for (const product of rows) {
      await saveCountLine(product, status);
    }
    if (status === "SUBMITTED" && selectedAgenda) await submitInventoryAgendaItem(selectedAgenda.id);
    setNotice({ tone: "success", message: status === "SUBMITTED" ? "Contagem enviada para revisao." : "Rascunho da contagem salvo." });
    await load();
  }

  async function submitCount(status: "DRAFT" | "SUBMITTED") {
    if (!countForm.productId || !countForm.countedQuantity) return;
    const quantity = quantityToApi(countForm.countedQuantity);
    if (quantity === undefined || quantity === "") {
      setNotice({ tone: "error", message: "Quantidade invalida. Use apenas numeros (ex.: 16,5)." });
      return;
    }
    try {
      const result = await createStockCount({
        ...countForm,
        status,
        inventoryAgendaItemId: selectedAgenda?.id ?? null,
        countedQuantity: Number(quantity)
      });
      setNotice({
        tone: result.divergenceQuantity === 0 ? "success" : "warning",
        message: status === "SUBMITTED" ? "Contagem salva e enviada para revisao." : "Rascunho de contagem salvo."
      });
      setCountForm({ ...countForm, countedQuantity: "", notes: "" });
      await load();
    } catch {
      setNotice({ tone: "error", message: "Erro ao salvar contagem." });
    }
  }

  async function saveRule() {
    const sector = sectors.find((item) => item.id === ruleForm.sectorId);
    if (!sector && !ruleForm.categoryName.trim()) return;
    await saveInventoryAgendaRule({
      id: ruleForm.id || undefined,
      sectorId: sector?.id,
      sectorName: sector?.name ?? ruleForm.sectorName,
      categoryName: ruleForm.categoryName,
      dayOfWeek: ruleForm.dayOfWeek ? Number(ruleForm.dayOfWeek) : null,
      frequency: ruleForm.frequency,
      notes: ruleForm.notes,
      isActive: true
    });
    setNotice({ tone: "success", message: "Agenda de inventario atualizada." });
    setRuleForm({ id: "", dayOfWeek: "1", sectorId: "", sectorName: "", categoryName: "", frequency: "WEEKLY", notes: "" });
    await load();
  }

  async function editRule(rule: InventoryAgenda["rules"][number]) {
    setRuleForm({
      id: rule.id,
      dayOfWeek: rule.dayOfWeek == null ? "" : String(rule.dayOfWeek),
      sectorId: rule.sectorId ?? "",
      sectorName: rule.sectorName ?? "",
      categoryName: rule.categoryName,
      frequency: rule.frequency,
      notes: rule.notes ?? ""
    });
  }

  async function removeRule(ruleId: string) {
    const confirmed = window.confirm("Excluir esta agenda recorrente?");
    if (!confirmed) return;
    await deleteInventoryAgendaRule(ruleId);
    setNotice({ tone: "success", message: "Agenda excluida." });
    await load();
  }

  function focusNextCountInput(event: KeyboardEvent<HTMLInputElement>, productId: string) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const currentIndex = filteredCountProducts.findIndex((product) => product.id === productId);
    const nextProduct = filteredCountProducts[currentIndex + 1];
    if (!nextProduct) return;
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>(`[data-count-quantity="${nextProduct.id}"]`)?.focus();
    });
  }

  useEffect(() => {
    load();
  }, [month, showCanceledStockData]);

  useEffect(() => {
    window.localStorage.setItem("stockCountLaunchColumns", JSON.stringify(countSessionVisibleColumns));
  }, [countSessionVisibleColumns]);

  // Respeita a aba pedida pela rota (o item clicado no menu). So desvia quando o usuario
  // nao tem permissao naquela aba — e ai cai na primeira permitida, nunca num destino fixo.
  useEffect(() => {
    const allowedIds = viewItems.map((item) => item.id);
    if (allowedIds.length === 0) return;
    setActiveView(allowedIds.includes(initialView) ? initialView : allowedIds[0]);
    // viewItems e derivado das permissoes do usuario, estaveis dentro da sessao.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialView, viewItems.map((item) => item.id).join(",")]);

  useEffect(() => {
    const drafts = operationalInventories.filter(
      (inv) => inv.type === "FINAL_CMV" && ["RASCUNHO", "EM_REVISAO"].includes(inv.status)
    );
    if (drafts.length === 0) { setFinalCmvCoverageMap({}); return; }
    setIsLoadingCoverageMap(true);
    void Promise.all(drafts.map((inv) => getFinalCmvCoverage(inv.id).catch(() => null)))
      .then((results) => {
        const map: Record<string, StockCoverageAudit & { inventoryId: string; inventoryCode: string }> = {};
        results.forEach((cov) => { if (cov) map[cov.inventoryId] = cov; });
        setFinalCmvCoverageMap(map);
      })
      .finally(() => setIsLoadingCoverageMap(false));
  }, [operationalInventories]);

  useEffect(() => {
    if (activeView !== "counting") return;
    if (!countSessionId) {
      setCountSessionDetail(null);
      // De volta a lista: outra pessoa pode ter concluido um dia da rotina.
      void loadRoutineWeek();
      return;
    }
    let active = true;
    openCountSession(countSessionId, false, false).catch((error) => {
      if (!active) return;
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Nao foi possivel abrir a contagem." });
      onCloseCountSessionRoute?.();
    });
    return () => {
      active = false;
    };
  }, [activeView, countSessionId]);

  if (countSessionDetail && activeView === "counting") {
    const locked = !editableCountSessionStatuses.has(countSessionDetail.status) || !canEditCountSession;
    const mobileFilterSummary = [
      countSessionSectorFilter ? `Setor: ${countSessionSectorFilter}` : "",
      countSessionCategoryFilter ? `Categoria: ${countSessionCategoryFilter}` : "",
      countSessionSubcategoryFilter ? `Subcategoria: ${countSessionSubcategoryFilter}` : "",
      countSessionUnitFilter ? `Unidade: ${countSessionUnitFilter}` : "",
      countSessionStatusFilter !== "TODOS" ? (countSessionStatusFilter === "PENDENTE" ? "Pendentes" : "Contados") : ""
    ].filter(Boolean).join(" - ");
    const shouldRepeatSector = !countSessionDetail.sectorName && !countSessionSectorFilter && countSessionDetail.type !== "SETORIAL";
    const filteredSectorCounts = filteredCountSessionItems.reduce<Record<string, number>>((totals, item) => {
      const sector = item.sectorLabel ?? displayLabel(item.sectorSnapshot, "Sem setor");
      totals[sector] = (totals[sector] ?? 0) + 1;
      return totals;
    }, {});
    const editingMobileNoteItem = editingCountSessionNoteId
      ? filteredCountSessionItems.find((item) => item.id === editingCountSessionNoteId) ?? countSessionDetail.items.find((item) => item.id === editingCountSessionNoteId)
      : null;
    const editingMobileNoteLine = editingMobileNoteItem ? countSessionLines[editingMobileNoteItem.id] ?? { countedQuantity: "", notes: "" } : null;
    const clearCountSessionFilters = () => {
      setCountSessionSearch("");
      setCountSessionSectorFilter("");
      setCountSessionCategoryFilter("");
      setCountSessionSubcategoryFilter("");
      setCountSessionUnitFilter("");
      setCountSessionStatusFilter("TODOS");
      setMobileQuickCountMode(false);
      setMobileCountFiltersOpen(false);
    };
    const toggleMobileQuickCountMode = () => {
      const next = !mobileQuickCountMode;
      setMobileQuickCountMode(next);
      setMobileCountFiltersOpen(false);
      if (next) {
        setCountSessionStatusFilter("PENDENTE");
        window.setTimeout(focusFirstVisibleCountSessionInput, 140);
      }
    };
    const toggleCountSessionColumn = (column: CountSessionColumn) => {
      if (column === "product" || column === "quantity" || column === "status") return;
      setCountSessionVisibleColumns((current) => ({ ...current, [column]: !current[column] }));
    };
    // A regra de digitacao mora na barra FIXA, nao no cabecalho. Estava no
    // cabecalho, que rola embora — e some justamente enquanto se digita, que e
    // quando ela serve. Aqui acompanha a rolagem dos 99 itens.
    const regraDeDigitacao = (
      <div className="count-rule-hints">
        <span><strong>kg &middot; L</strong> 11,700 ou 11.700 &mdash; dá 11,7</span>
        <span><strong>demais</strong> inteiro &mdash; 1510</span>
      </div>
    );
    // Quanto vale o que ja foi contado nesta contagem, pelo custo de cada item.
    const valorDaContagem = (
      <div className="count-valor-total" title="Soma de quantidade contada × custo de cada item">
        <em>Valor contado</em>
        <strong><Money value={countSessionValor.valor} /></strong>
        {countSessionValor.contadosSemCusto > 0 && <small>{countSessionValor.contadosSemCusto} sem custo</small>}
      </div>
    );
    return (
      <div className={`stack stockkeeper-mode count-session-launch ${mobileQuickCountMode ? "quick-count-mode" : ""}`}>
        <Notice notice={notice} />
        <section className="panel count-session-panel">
          <div className="section-heading">
            <div>
              <p>
                {countSessionDetail.code} - {formatDate(countSessionDetail.referenceDate)} - {countSessionTypeLabels[countSessionDetail.type]}
                {countSessionDetail.sectorName ? ` - ${countSessionDetail.sectorName}` : ""}
              </p>
              <h2>
                Lançamento de contagem
                <StatusBadge tone={countSessionDetail.status === "CONCLUIDA" ? "success" : "warning"}>
                  {countSessionStatusLabels[countSessionDetail.status] ?? countSessionDetail.status}
                </StatusBadge>
              </h2>
              <span className="muted">Digite as quantidades físicas. Sem estoque, informe 0. Campo vazio fica pendente.</span>
            </div>
            {/* Salvar e Concluir moram na faixa fixa abaixo: aqui eles rolavam
                para fora da tela logo no primeiro item. */}
            <div className="actions-cell">
              <button className="secondary-button" type="button" onClick={() => { setCountSessionDetail(null); onCloseCountSessionRoute?.(); }}><X size={16} />Voltar</button>
              <button className="secondary-button" type="button" onClick={() => void printCountSession(countSessionDetail)}><Printer size={16} />Imprimir</button>
              <button className="secondary-button" type="button" onClick={() => downloadCountSessionPdf(countSessionDetail)}><Download size={16} />Baixar PDF</button>
              {canReshapeCountSession && !countSessionDetail.generatedInventoryId && ["ABERTA", "EM_ANDAMENTO", "CONCLUIDA"].includes(countSessionDetail.status) && ["GERAL", "SETORIAL"].includes(countSessionDetail.type) && (
                <button className="secondary-button" type="button" onClick={reshapeCountSessionToCurrentFilters}>
                  <FilterX size={16} />Recortar para filtros
                </button>
              )}
              {canPlanPurchase && countSessionDetail.status === "CONCLUIDA" && (
                <button className="secondary-button" type="button" onClick={() => navigate(`/estoque/planejamento-compra?sourceType=STOCK_COUNT_SESSION&sourceId=${countSessionDetail.id}`)}><ShoppingCart size={16} />Planejar compra</button>
              )}
              {canGenerateInventoryFromCount(countSessionDetail) && (
                <button className="primary-button large-action" type="button" onClick={generateInventoryFromCountSession}>Gerar inventario</button>
              )}
              {canGenerateInventoryFromCount(countSessionDetail) && (
                <button className="secondary-button" type="button" onClick={reopenCountSessionAction}>Reabrir</button>
              )}
              {canCancelCountSession(countSessionDetail) && (
                <button className="danger-button" type="button" onClick={() => cancelCountSessionAction(countSessionDetail)}><Trash2 size={16} />Cancelar</button>
              )}
            </div>
          </div>

          {/* Filtros de recorte rolam junto com o cabecalho: sao usados uma vez
              por contagem. Fixo fica so o que se usa a cada item. */}
          <div className="filters-row desktop-count-filters">
            <label>Setor<select value={countSessionSectorFilter} onChange={(event) => setCountSessionSectorFilter(event.target.value)}>
              <option value="">Todos</option>
              {countSessionSectors.map((sector) => <option key={sector} value={sector}>{sector}</option>)}
            </select></label>
            <label>Categoria<select value={countSessionCategoryFilter} onChange={(event) => setCountSessionCategoryFilter(event.target.value)}>
              <option value="">Todas</option>
              {countSessionCategories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select></label>
            <label>Subcategoria<select value={countSessionSubcategoryFilter} onChange={(event) => setCountSessionSubcategoryFilter(event.target.value)}>
              <option value="">Todas</option>
              {countSessionSubcategories.map((subcategory) => <option key={subcategory} value={subcategory}>{subcategory}</option>)}
            </select></label>
            <label>Unidade<select value={countSessionUnitFilter} onChange={(event) => setCountSessionUnitFilter(event.target.value)}>
              <option value="">Todas</option>
              {countSessionUnits.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
            </select></label>
            <label>Status<select value={countSessionStatusFilter} onChange={(event) => setCountSessionStatusFilter(event.target.value as "TODOS" | "PENDENTE" | "CONTADO")}>
              <option value="TODOS">Todos</option>
              <option value="PENDENTE">Pendentes</option>
              <option value="CONTADO">Contados</option>
            </select></label>
            <div className="desktop-count-filters-tools">
              <button className="secondary-button" type="button" disabled={locked} onClick={markFilteredCountSessionItemsAsZero}>Marcar filtrados como zero</button>
              <details className="column-picker">
                <summary>Colunas</summary>
                <div className="column-picker-menu">
                  {countSessionColumnOptions.map((column) => (
                    <label key={column.key} className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={countSessionVisibleColumns[column.key]}
                        disabled={column.required}
                        onChange={() => toggleCountSessionColumn(column.key)}
                      />
                      {column.label}
                    </label>
                  ))}
                </div>
              </details>
            </div>
          </div>

          {/* Uma faixa fixa so, com fundo solido. Eram duas (cabecalho e
              progresso/filtros) grudando em alturas diferentes, e a de baixo,
              transparente, deixava os itens passarem por dentro dela. */}
          <div className="count-session-sticky-shell">
            <div className="count-progress-block count-toolbar">
              <div className="count-toolbar-progress">
                <div className="progress-header">
                  <span><strong>{countSessionProgress.counted}</strong> de {countSessionProgress.total} contados <em>{countSessionProgress.pending} pendentes</em></span>
                  {canViewCosts && valorDaContagem}
                  <strong>{countSessionProgress.percent}%</strong>
                </div>
                <div className="progress-track"><div className="progress-fill" style={{ width: `${countSessionProgress.percent}%` }} /></div>
              </div>
              <label className="count-toolbar-search" aria-label="Busca por codigo ou produto">
                <Search size={16} />
                <input autoFocus value={countSessionSearch} onChange={(event) => setCountSessionSearch(event.target.value)} placeholder="Codigo ou produto" />
              </label>
              <button className={countSessionStatusFilter === "PENDENTE" ? "secondary-button active-filter pending-filter-button" : "secondary-button pending-filter-button"} type="button" aria-pressed={countSessionStatusFilter === "PENDENTE"} onClick={() => setCountSessionStatusFilter(countSessionStatusFilter === "PENDENTE" ? "TODOS" : "PENDENTE")}>Somente pendentes</button>
              <div className="count-toolbar-actions">
                <button className="secondary-button" type="button" disabled={locked} onClick={saveCountSessionDraft}><Save size={16} />Salvar</button>
                <button className="primary-button" type="button" disabled={locked} onClick={concludeCountSession}><CheckCircle2 size={16} />Concluir</button>
              </div>
              {regraDeDigitacao}
            </div>

            <div className="mobile-count-sticky-bar">
              <div className="mobile-count-progress-line">
                <strong>{countSessionProgress.counted}/{countSessionProgress.total}</strong>
                <span>{countSessionProgress.pending} pendentes</span>
                <button className={mobileQuickCountMode ? "primary-button" : "secondary-button"} type="button" aria-pressed={mobileQuickCountMode} onClick={toggleMobileQuickCountMode}>
                  {mobileQuickCountMode ? "Sair do rapido" : "Modo rapido"}
                </button>
              </div>
              {canViewCosts && valorDaContagem}
              <div className="progress-track"><div className="progress-fill" style={{ width: `${countSessionProgress.percent}%` }} /></div>
              {regraDeDigitacao}
              <div className="mobile-count-search-row">
                <label aria-label="Busca por codigo ou produto">
                  <Search size={16} />
                  <input value={countSessionSearch} onChange={(event) => setCountSessionSearch(event.target.value)} placeholder="Codigo ou produto" />
                </label>
                <button className={countSessionStatusFilter === "PENDENTE" ? "secondary-button active-filter" : "secondary-button"} type="button" onClick={() => setCountSessionStatusFilter(countSessionStatusFilter === "PENDENTE" ? "TODOS" : "PENDENTE")}>Pendentes</button>
                <button className="secondary-button count-filter-button" type="button" aria-expanded={mobileCountFiltersOpen} onClick={() => setMobileCountFiltersOpen((current) => !current)}><SlidersHorizontal size={17} />Filtros</button>
              </div>
              {(mobileFilterSummary || countSessionSearch) && (
                <div className="mobile-count-filter-summary">
                  <span>{[countSessionSearch ? `Busca: ${countSessionSearch}` : "", mobileFilterSummary].filter(Boolean).join(" - ")}</span>
                  <button type="button" onClick={clearCountSessionFilters}>Limpar</button>
                </div>
              )}
              {mobileCountFiltersOpen && (
                <div className="mobile-count-filter-panel">
                  <label>Setor<select value={countSessionSectorFilter} onChange={(event) => { setCountSessionSectorFilter(event.target.value); setMobileCountFiltersOpen(false); }}>
                    <option value="">Todos</option>
                    {countSessionSectors.map((sector) => <option key={sector} value={sector}>{sector}</option>)}
                  </select></label>
                  <label>Categoria<select value={countSessionCategoryFilter} onChange={(event) => { setCountSessionCategoryFilter(event.target.value); setMobileCountFiltersOpen(false); }}>
                    <option value="">Todas</option>
                    {countSessionCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select></label>
                  <label>Subcategoria<select value={countSessionSubcategoryFilter} onChange={(event) => { setCountSessionSubcategoryFilter(event.target.value); setMobileCountFiltersOpen(false); }}>
                    <option value="">Todas</option>
                    {countSessionSubcategories.map((subcategory) => <option key={subcategory} value={subcategory}>{subcategory}</option>)}
                  </select></label>
                  <label>Unidade<select value={countSessionUnitFilter} onChange={(event) => { setCountSessionUnitFilter(event.target.value); setMobileCountFiltersOpen(false); }}>
                    <option value="">Todas</option>
                    {countSessionUnits.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                  </select></label>
                  <label>Status<select value={countSessionStatusFilter} onChange={(event) => { setCountSessionStatusFilter(event.target.value as "TODOS" | "PENDENTE" | "CONTADO"); setMobileCountFiltersOpen(false); }}>
                    <option value="TODOS">Todos</option>
                    <option value="PENDENTE">Pendentes</option>
                    <option value="CONTADO">Contados</option>
                  </select></label>
                  <button className="secondary-button" type="button" onClick={clearCountSessionFilters}>Limpar filtros</button>
                </div>
              )}
            </div>

          </div>

          <div className="mobile-count-card-list">
            {filteredCountSessionItems.map((item, index) => {
              const line = countSessionLines[item.id] ?? { countedQuantity: "", notes: "" };
              const typed = line.countedQuantity !== "";
              const status = typed ? "CONTADO" : "PENDENTE";
              const sector = item.sectorLabel ?? displayLabel(item.sectorSnapshot, "Sem setor");
              const previousSector = index > 0 ? (filteredCountSessionItems[index - 1].sectorLabel ?? displayLabel(filteredCountSessionItems[index - 1].sectorSnapshot, "Sem setor")) : null;
              const hasNotes = line.notes.trim().length > 0;
              const isActiveInput = activeCountSessionInputId === item.id;
              return (
                <div key={item.id} className="mobile-count-card-block">
                  {sector !== previousSector && (
                    <div className="mobile-sector-divider">
                      <strong>{sector}</strong>
                      <span>{filteredSectorCounts[sector]} itens</span>
                    </div>
                  )}
                  <article className={`mobile-count-card ${typed ? "is-counted" : "is-pending"} ${isActiveInput ? "is-active-input" : ""}`}>
                    <div className="mobile-count-card-title">
                      <strong title={displayLabel(item.productNameSnapshot, "Produto sem nome")}>{displayLabel(item.productNameSnapshot, "Produto sem nome")}</strong>
                      {/* Sem selo aqui. Ele ocupava 70 dos 142px da coluna e o nome do
                          produto ficava com 64px, ilegivel. O estado aparece em tres outros
                          canais: a borda esquerda (ambar pendente / verde contado), o campo
                          vazio ou preenchido, e o contador de pendentes no topo. */}
                    </div>
                    {/* Uma faixa so. Eram duas empilhadas; a unidade saiu daqui porque
                        agora aparece junto do campo, e o setor repetia o divisor acima. */}
                    <div className="mobile-count-card-meta">
                      <span>{item.productCodeSnapshot ?? "sem codigo"}</span>
                      <span>{item.unitLabel ?? displayLabel(item.unitSnapshot, "sem unidade")}</span>
                      <span>{item.categoryLabel ?? displayLabel(item.categorySnapshot, "Sem categoria")}</span>
                    </div>
                    <div className="mobile-count-card-entry">
                      <label className="mobile-quantity-inline">
                        <input
                          className="count-input mobile-touch-count-input"
                          data-session-count-input="true"
                          data-session-count-item-id={item.id}
                          enterKeyHint={index >= filteredCountSessionItems.length - 1 ? "done" : "next"}
                          inputMode="decimal"
                          placeholder="0"
                          aria-label={`Quantidade contada de ${displayLabel(item.productNameSnapshot, "produto")} em ${item.unitLabel ?? displayLabel(item.unitSnapshot, "unidade")}`}
                          disabled={locked}
                          value={line.countedQuantity}
                          onKeyDown={handleCountFieldKeyDown}
                          onFocus={() => setActiveCountSessionInputId(item.id)}
                          onBlur={() => handleCountInputBlur(item.id)}
                          onChange={(event) => updateCountSessionLine(item.id, { countedQuantity: sanitizeQuantityInput(event.target.value) })}
                        />
                      </label>
                      <button
                        className={`note-flag mobile-note-button ${hasNotes ? "has-note" : ""}`}
                        type="button"
                        title={hasNotes ? line.notes : "Adicionar observacao"}
                        aria-label={hasNotes ? "Editar observacao do produto" : "Adicionar observacao ao produto"}
                        onClick={() => setEditingCountSessionNoteId(item.id)}
                      >
                        <MessageSquare size={16} />
                      </button>
                      {isActiveInput && !locked && (
                        <button className="secondary-button mobile-next-button" type="button" aria-label="Ir para proximo produto" onMouseDown={(event) => event.preventDefault()} onClick={() => advanceCountSessionItem(item.id)}>
                          <ArrowDown size={15} />
                        </button>
                      )}
                    </div>
                    <CountQuantityGuard
                      itemId={item.id}
                      productName={item.productNameSnapshot}
                      unit={item.unitLabel ?? item.unitSnapshot}
                      value={line.countedQuantity}
                      plausibility={countSessionPlausibility[item.id]}
                      isActive={isActiveInput}
                    />
                    <ReferenciaDaContagem
                      referencia={countSessionReferencia[item.id]}
                      unidade={item.unitLabel ?? item.unitSnapshot}
                      valorDigitado={line.countedQuantity}
                      isActive={isActiveInput}
                      mostrarValor={canViewCosts}
                    />
                  </article>
                </div>
              );
            })}
            {filteredCountSessionItems.length === 0 && mobileQuickCountMode && (
              <div className="mobile-quick-finished">
                <strong>Todos os itens deste filtro foram contados.</strong>
                <span>{countSessionProgress.pending === 0 ? "A contagem inteira esta pronta para conclusao." : "Salve o rascunho ou veja os itens ja contados neste filtro."}</span>
                <div>
                  <button className="secondary-button" type="button" disabled={locked} onClick={saveCountSessionDraft}>Salvar rascunho</button>
                  <button className="secondary-button" type="button" onClick={() => { setMobileQuickCountMode(false); setCountSessionStatusFilter("CONTADO"); }}>Ver contados</button>
                  {countSessionProgress.pending === 0 && <button className="primary-button" type="button" disabled={locked} onClick={concludeCountSession}>Concluir contagem</button>}
                </div>
              </div>
            )}
            {filteredCountSessionItems.length === 0 && !mobileQuickCountMode && (
              <EmptyState title="Nenhum produto encontrado" description="Ajuste a busca ou os filtros da contagem." />
            )}
          </div>

          <div className="count-session-desktop-list subsection count-session-table-wrap">
            <div className="count-session-desktop-head">
              <span>Produto</span>
              <span>Quantidade</span>
              {countSessionVisibleColumns.status && <span>Status</span>}
            </div>
            <div className="count-session-desktop-body">
              {filteredCountSessionItems.map((item, index) => {
                const line = countSessionLines[item.id] ?? { countedQuantity: "", notes: "" };
                const typed = line.countedQuantity !== "";
                const status = typed ? "CONTADO" : "PENDENTE";
                const sector = item.sectorLabel ?? displayLabel(item.sectorSnapshot, "Sem setor");
                const category = item.categoryLabel ?? displayLabel(item.categorySnapshot, "Sem categoria");
                const subcategory = item.subcategoryLabel ?? displayLabel(item.subcategorySnapshot, "Sem subcategoria");
                const unit = item.unitLabel ?? displayLabel(item.unitSnapshot, "Sem unidade");
                const productName = displayLabel(item.productNameSnapshot, "Produto sem nome");
                const hasNotes = line.notes.trim().length > 0;
                const editingNotes = editingCountSessionNoteId === item.id;
                const isActiveInput = activeCountSessionInputId === item.id;
                return (
                  <article key={item.id} className={`count-session-desktop-row ${typed ? "is-counted" : "is-pending"} ${isActiveInput ? "is-active-input" : ""}`}>
                    <div className="count-session-desktop-row-main">
                      <div className="count-session-product-stack">
                        <div className="count-session-product-line">
                          <strong className="count-session-product-name" title={productName}>{productName}</strong>
                          {countSessionVisibleColumns.notes && (
                            <button
                              className={`note-flag count-session-note-button ${hasNotes ? "has-note" : ""}`}
                              type="button"
                              tabIndex={-1}
                              title={hasNotes ? line.notes : "Adicionar observacao"}
                              aria-label={hasNotes ? "Editar observacao do produto" : "Adicionar observacao ao produto"}
                              onClick={() => setEditingCountSessionNoteId(editingNotes ? null : item.id)}
                            >
                              <MessageSquare size={14} />
                            </button>
                          )}
                        </div>
                        <div className="count-session-product-meta">
                          {countSessionVisibleColumns.code && <span title={item.productCodeSnapshot ?? "Sem codigo"}>{item.productCodeSnapshot ?? "Sem codigo"}</span>}
                          {item.locationSnapshot && <span title={item.locationSnapshot}>{item.locationSnapshot}</span>}
                        </div>
                        <div className="count-session-product-tags">
                          {countSessionVisibleColumns.unit && <span className="count-session-tag" title={unit}>{unit}</span>}
                          {countSessionVisibleColumns.category && <span className="count-session-tag" title={category}>{category}</span>}
                          {countSessionVisibleColumns.subcategory && <span className="count-session-tag" title={subcategory}>{subcategory}</span>}
                          {countSessionVisibleColumns.sector && shouldRepeatSector && (
                            <span className={`count-session-tag ${sector === "Sem setor" ? "is-problem" : ""}`} title={sector}>{sector}</span>
                          )}
                        </div>
                        {editingNotes && (
                          <div className="inline-note-editor count-session-inline-note">
                            <input
                              autoFocus
                              disabled={locked}
                              value={line.notes}
                              placeholder="Observacao do produto"
                              onChange={(event) => updateCountSessionLine(item.id, { notes: event.target.value })}
                            />
                            <button className="secondary-button" type="button" onClick={() => setEditingCountSessionNoteId(null)}>OK</button>
                          </div>
                        )}
                      </div>
                      <div className="count-session-quantity-block">
                        <label className="count-session-quantity-label" htmlFor={`count-session-input-${item.id}`}>
                          <span className="count-session-quantity-caption">
                            <strong>{unit}</strong>
                            <em>{quantityHint(item.unitSnapshot ?? unit)}</em>
                          </span>
                          <input
                            id={`count-session-input-${item.id}`}
                            className="count-input touch-count-input desktop-count-input"
                            data-session-count-input="true"
                            data-session-count-item-id={item.id}
                            enterKeyHint={index >= filteredCountSessionItems.length - 1 ? "done" : "next"}
                            inputMode="decimal"
                            placeholder="0"
                            disabled={locked}
                            value={line.countedQuantity}
                            onKeyDown={handleCountFieldKeyDown}
                            onFocus={() => setActiveCountSessionInputId(item.id)}
                            onBlur={() => handleCountInputBlur(item.id)}
                            onChange={(event) => updateCountSessionLine(item.id, { countedQuantity: sanitizeQuantityInput(event.target.value) })}
                          />
                        </label>
                      </div>
                      {countSessionVisibleColumns.status && (
                        <div className="count-session-status-block">
                          <StatusBadge tone={status === "PENDENTE" ? "warning" : "success"}>{status === "PENDENTE" ? "pendente" : "contado"}</StatusBadge>
                          <small>{typed ? "valor confirmado" : "aguardando lancamento"}</small>
                        </div>
                      )}
                    </div>
                    <CountQuantityGuard
                      itemId={item.id}
                      productName={item.productNameSnapshot}
                      unit={item.unitLabel ?? item.unitSnapshot}
                      value={line.countedQuantity}
                      plausibility={countSessionPlausibility[item.id]}
                      isActive={isActiveInput}
                    />
                    <ReferenciaDaContagem
                      referencia={countSessionReferencia[item.id]}
                      unidade={item.unitLabel ?? item.unitSnapshot}
                      valorDigitado={line.countedQuantity}
                      isActive={isActiveInput}
                      mostrarValor={canViewCosts}
                    />
                  </article>
                );
              })}
              {filteredCountSessionItems.length === 0 && (
                <div className="count-session-empty-state">
                  <EmptyState title="Nenhum produto encontrado" description="Ajuste a busca ou os filtros da contagem." />
                </div>
              )}
            </div>
          </div>
          <div className="mobile-count-bottom-actions">
            <button className="secondary-button" type="button" onClick={() => { setCountSessionDetail(null); onCloseCountSessionRoute?.(); }}><X size={16} />Voltar</button>
            <button className="secondary-button" type="button" disabled={locked} onClick={saveCountSessionDraft}><Save size={17} />Salvar</button>
            <button className="primary-button" type="button" disabled={locked} onClick={concludeCountSession}><CheckCircle2 size={17} />Concluir</button>
            <button className="secondary-button" type="button" aria-expanded={mobileCountMoreActionsOpen} onClick={() => setMobileCountMoreActionsOpen((current) => !current)}>Mais</button>
            {mobileCountMoreActionsOpen && (
              <div className="mobile-more-actions-panel">
                <button className="secondary-button" type="button" onClick={() => { setMobileCountMoreActionsOpen(false); void printCountSession(countSessionDetail); }}><span><Printer size={15} />Imprimir</span><small>Por setor e categoria, com anterior, compras e esperado; o contado sai em branco para a caneta</small></button>
                <button className="secondary-button" type="button" onClick={() => { setMobileCountMoreActionsOpen(false); downloadCountSessionPdf(countSessionDetail); }}><span><Download size={15} />Baixar PDF</span></button>
                <button className="secondary-button" type="button" disabled={locked} onClick={() => {
                  markFilteredCountSessionItemsAsZero();
                  setMobileCountMoreActionsOpen(false);
                }}><span>Zerar os itens filtrados</span><small>Preenche 0 em tudo que o filtro atual mostra</small></button>
                {canReshapeCountSession && !countSessionDetail.generatedInventoryId && ["ABERTA", "EM_ANDAMENTO", "CONCLUIDA"].includes(countSessionDetail.status) && ["GERAL", "SETORIAL"].includes(countSessionDetail.type) && (
                  <button className="secondary-button" type="button" onClick={() => { setMobileCountMoreActionsOpen(false); reshapeCountSessionToCurrentFilters(); }}>
                    <span>Reduzir a contagem ao filtro</span>
                    <small>A contagem passa a cobrir so os itens filtrados</small>
                  </button>
                )}
                {canGenerateInventoryFromCount(countSessionDetail) && (
                  <button className="primary-button" type="button" onClick={() => { setMobileCountMoreActionsOpen(false); generateInventoryFromCountSession(); }}>Gerar inventario</button>
                )}
                {canGenerateInventoryFromCount(countSessionDetail) && (
                  <button className="secondary-button" type="button" onClick={() => { setMobileCountMoreActionsOpen(false); reopenCountSessionAction(); }}>Reabrir contagem</button>
                )}
                {canCancelCountSession(countSessionDetail) && (
                  <button className="danger-button" type="button" onClick={() => { setMobileCountMoreActionsOpen(false); cancelCountSessionAction(countSessionDetail); }}>Cancelar contagem</button>
                )}
                {locked && !(canGenerateInventoryFromCount(countSessionDetail)) && !canCancelCountSession(countSessionDetail) && (
                  <span>Nenhuma acao adicional disponivel para este status.</span>
                )}
              </div>
            )}
          </div>
        </section>
        {editingMobileNoteItem && editingMobileNoteLine && (
          <div className="mobile-note-sheet" role="dialog" aria-modal="true" aria-label="Observacao do produto">
            <button className="mobile-note-backdrop" type="button" aria-label="Fechar observacao" onClick={() => setEditingCountSessionNoteId(null)} />
            <div className="mobile-note-panel">
              <div>
                <span>Observacao</span>
                <strong>{editingMobileNoteItem.productNameSnapshot}</strong>
              </div>
              <textarea
                autoFocus
                disabled={locked}
                value={editingMobileNoteLine.notes}
                placeholder="Anote uma divergencia, embalagem aberta ou detalhe importante."
                onChange={(event) => updateCountSessionLine(editingMobileNoteItem.id, { notes: event.target.value })}
              />
              <div className="actions-cell">
                <button className="secondary-button" type="button" onClick={() => setEditingCountSessionNoteId(null)}>Cancelar</button>
                <button className="primary-button" type="button" onClick={() => setEditingCountSessionNoteId(null)}>Salvar obs.</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (countScreenOpen && selectedAgenda) {
    return (
      <div className="stack stockkeeper-mode">
        <Notice notice={notice} />
        <section className="panel">
          <div className="section-heading">
            <div>
              <p>{formatDate(selectedAgenda.scheduledDate)} - {selectedAgenda.responsibleName ?? user.name}</p>
              <h2>{selectedAgenda.sectorName || selectedAgenda.categoryName}</h2>
            </div>
            <div className="actions-cell">
              <button className="secondary-button" type="button" onClick={closeCountScreen}><X size={16} />Voltar</button>
              <button className="secondary-button large-action" type="button" onClick={() => submitCountScreen("DRAFT")}><Save size={17} />Salvar rascunho</button>
              <button className="primary-button large-action" type="button" onClick={() => submitCountScreen("SUBMITTED")}><Send size={17} />Enviar para revisao</button>
            </div>
          </div>

          <div className="summary-grid">
            <article><span>Total de produtos</span><strong>{countProgress.total}</strong></article>
            <article><span>Contados</span><strong>{countProgress.counted}</strong></article>
            <article><span>Pendentes</span><strong>{countProgress.pending}</strong></article>
            <article><span>Divergentes</span><strong>{countProgress.divergent}</strong></article>
          </div>
          <div className="count-progress-block">
            <div className="progress-header">
              <span>{countProgress.counted} de {countProgress.total} produtos contados</span>
              <strong>{countProgress.total ? Math.round((countProgress.counted / countProgress.total) * 100) : 0}%</strong>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${countProgress.total ? Math.round((countProgress.counted / countProgress.total) * 100) : 0}%` }} />
            </div>
          </div>

          <div className="filters-row">
            <label>Busca por codigo ou nome<input autoFocus value={countSearch} onChange={(event) => setCountSearch(event.target.value)} /></label>
            <button className="secondary-button" type="button" onClick={() => {
              const updates = { ...countLines };
              filteredCountProducts.forEach((product) => { updates[product.id] = { countedQuantity: "0", notes: updates[product.id]?.notes ?? "" }; });
              setCountLines(updates);
            }}>Marcar filtrados como zero</button>
          </div>

          <div className="chart-grid">
            <SimpleBarChart title="Contado x pendente" items={[
              { label: "Contados", value: countProgress.counted },
              { label: "Pendentes", value: countProgress.pending },
              { label: "Divergentes", value: countProgress.divergent }
            ]} />
          </div>

          <div className="table-wrap subsection">
            <table>
              <thead><tr><th>Codigo</th><th>Produto</th><th>Localizacao</th><th>Unidade</th><th>Quantidade contada</th><th>Observacao</th><th>Status</th></tr></thead>
              <tbody>{filteredCountProducts.map((product) => {
                const line = countLines[product.id] ?? { countedQuantity: "", notes: "" };
                const stock = stocks.find((item) => item.productName === product.name || item.productCode === product.externalCode);
                const hasValue = line.countedQuantity !== "";
                const divergent = hasValue && Number(line.countedQuantity) !== Number(stock?.currentQuantity ?? 0);
                return (
                  <tr key={product.id}>
                    <td>{product.externalCode ?? "-"}</td>
                    <td>{product.name}<small>{product.category?.name ?? "-"}</small></td>
                    <td>{[product.storageLocation, product.storageShelf, product.storagePosition].filter(Boolean).join(" - ") || "-"}</td>
                    <td>{product.stockUnit ?? product.unit ?? "-"}</td>
                    <td><input data-count-quantity={product.id} inputMode="decimal" value={line.countedQuantity} onKeyDown={(event) => focusNextCountInput(event, product.id)} onChange={(event) => setCountLines({ ...countLines, [product.id]: { ...line, countedQuantity: sanitizeQuantityInput(event.target.value) } })} /></td>
                    <td><input value={line.notes} onChange={(event) => setCountLines({ ...countLines, [product.id]: { ...line, notes: event.target.value } })} /></td>
                    <td><StatusBadge tone={divergent ? "danger" : hasValue ? "success" : "warning"}>{divergent ? "divergente" : hasValue ? "contado" : "pendente"}</StatusBadge></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={`stack ${stockkeeperMode ? "stockkeeper-mode" : ""}`}>
      <Notice notice={notice} />

      <div className="module-tabs stock-module-tabs">
        {viewItems.map((item) => (
          <button className={activeView === item.id ? "active" : ""} key={item.id} type="button" onClick={() => irParaVisao(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      <OverviewSection
        className={panelClass(["overview"])}
        loading={loading}
        onRefresh={load}
        productSummary={productSummary}
        lowStockItems={lowStockItems}
        latestCountSession={latestCountSession}
        latestClosedInventory={latestClosedInventory}
        activeCountProgress={activeCountProgress}
        openCountsCount={openCounts.length}
        movementsByType={movementsByType}
        countsByStatus={countsByStatus}
        onStartCounting={() => { irParaVisao("counting"); setMobileCountFormOpen(true); }}
        onOpenInventory={() => irParaVisao("inventory")}
      />

      {activeView === "counting" && (
        <RoutineWeekSection
          items={routineWeek}
          loading={routineWeekLoading}
          canStartCount={canStartCountSession}
          startingItemId={startingRoutineItemId}
          onStart={(item) => void startRoutineCount(item)}
          onOpenSession={(sessionId) => void openCountSession(sessionId)}
        />
      )}

      <section className={panelClass(["counting", "inventory"])}>
        {/* O titulo da pagina ja diz "Inventário" logo acima; repetir "Estoque /
          * Inventario operacional" aqui era o terceiro rotulo em sequencia
          * dizendo a mesma coisa. Ficam os controles. */}
        <div className="section-heading inv-op-header inv-op-header--enxuto">
          <div>
            {activeView === "counting" && <h2>Contagens de estoque</h2>}
          </div>
          <div className="actions-cell">
            {/* No desktop nao havia como abrir uma contagem nesta tela: o botao
                do formulario so existia no mobile e a barra de acoes do topo
                nao e renderizada na aba de contagens. */}
            {activeView === "counting" && (
              <button className="primary-button count-new-button" type="button" aria-expanded={mobileCountFormOpen} onClick={() => setMobileCountFormOpen((v) => !v)}>
                {mobileCountFormOpen ? <X size={16} /> : <Play size={16} />}{mobileCountFormOpen ? "Fechar" : "Nova contagem"}
              </button>
            )}
            <label className="checkbox-label compact-check inventory-toggle-label">
              <input type="checkbox" checked={showCanceledStockData} onChange={(event) => setShowCanceledStockData(event.target.checked)} />
              Exibir cancelados/testes
            </label>
            <button className="icon-button" type="button" onClick={load} aria-label="Atualizar inventarios">
              {loading ? <Loader2 size={18} /> : <RefreshCw size={18} />}
            </button>
          </div>
        </div>

        {activeView !== "counting" && !operationalDetail && (
          <>
            {/* O fechamento do mes vem ANTES da navegacao e das acoes: quando ha
              * um em andamento, ele e o assunto da tela. Ficava depois de duas
              * barras e de uma fileira de botoes, competindo com tudo. */}
            {operationalSummary.activeFinalCmv && inventoryDeskTab === "official" && (() => {
              const inv = operationalSummary.activeFinalCmv!;
              const cov = finalCmvCoverageMap[inv.id];
              const isComplete = cov?.isComplete === true;
              const passo = proximoPassoDoFechamento(inv.status, isComplete);
              const pct = cov && cov.expectedTotal > 0
                ? Math.min(100, Math.round((cov.coveredTotal / cov.expectedTotal) * 100))
                : null;
              return (
                <section className={`fechamento-hero${passo.concluido ? " fechamento-hero--pronto" : ""}`}>
                  <header className="fechamento-hero__topo">
                    <div>
                      <PanelEyebrow>Fechamento do mês</PanelEyebrow>
                      <h3 className="fechamento-hero__titulo">{passo.titulo}</h3>
                      <p className="fechamento-hero__meta">{inv.code} · contado em {formatDate(inv.date)}</p>
                    </div>
                    <StatusBadge tone={operationalTone(inv.status)}>{operationalStatusLabels[inv.status] ?? inv.status}</StatusBadge>
                  </header>

                  {cov && pct !== null && (
                    <div className="fechamento-hero__cobertura">
                      <div className="fechamento-hero__barra" role="img" aria-label={`${pct}% dos produtos controlados cobertos`}>
                        <span style={{ width: `${pct}%` }} className={isComplete ? "completa" : ""} />
                      </div>
                      <p className="fechamento-hero__cobertura-texto">
                        <strong>{cov.coveredTotal} de {cov.expectedTotal}</strong> produtos controlados cobertos
                        {isComplete ? " — completo" : ` — faltam ${cov.missingTotal}`}
                      </p>
                    </div>
                  )}

                  <p className="fechamento-hero__descricao">{passo.descricao}</p>

                  <div className="fechamento-hero__acoes">
                    {passo.acao && (
                      <button
                        className="primary-button"
                        type="button"
                        disabled={acaoFechamentoEmCurso}
                        onClick={() => void executarPassoDoFechamento(inv.id, passo.acao!)}
                      >
                        {acaoFechamentoEmCurso ? "Processando…" : passo.rotuloAcao}
                      </button>
                    )}
                    <button className="secondary-button" type="button" onClick={() => irParaInventario(inv.id)}>Ver inventário</button>
                  </div>
                </section>
              );
            })()}

            {/* Sub-navegacao e acao principal na mesma faixa. Eram duas linhas
              * empilhadas, e o olho tinha de descer duas vezes para achar o que
              * fazer. */}
            {/* Duas abas. Eram quatro: "Sugestao de compras" gerou 2 pedidos na
              * vida (o Planejamento de compra gerou 64), "Estoque atual" listava o
              * saldo que nunca baixa e "Relatorios" repetia a aba do modulo. */}
            <div className="inventory-nav-bar">
              <Tabs
                value={inventoryDeskTab}
                onChange={(v) => setInventoryDeskTab(v as InventoryDeskTab)}
                tabs={[
                  { value: "official", label: "Inventários" },
                  { value: "posicao", label: "Posição do estoque" }
                ]}
              />

              {inventoryDeskTab === "official" && canCreateOperational && (
                <div className="inventory-action-strip">
                  <div className="inv-more-actions-wrap">
                    <Button variant="secondary" aria-expanded={mobileInvMoreActionsOpen} onClick={() => setMobileInvMoreActionsOpen((v) => !v)}>Mais ações ▾</Button>
                    <div className={`inv-more-actions-menu${mobileInvMoreActionsOpen ? " open" : ""}`}>
                      <button
                        type="button"
                        onClick={() => {
                          setMobileInvMoreActionsOpen(false);
                          if (mobileInvFormOpen) { setMobileInvFormOpen(false); return; }
                          abrirFormularioDeInventario();
                        }}
                      >
                        <ClipboardCheck size={14} />{mobileInvFormOpen ? "Fechar inventário manual" : "Criar inventário manual"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {activeView === "counting" && (
          <>
            {/* Linha de numeros, como na aba Inventario. Eram quatro cartoes de
                ~130px: no celular empurravam a primeira contagem para 860px. */}
            <ul className="inv-estatisticas">
              <li><span>{activeCountSessions.filter((item) => item.status === "ABERTA").length}</span> abertas</li>
              <li><span>{activeCountSessions.filter((item) => item.status === "EM_ANDAMENTO").length}</span> em andamento</li>
              <li><span>{completedCountSessions.length}</span> concluídas</li>
              {activeCountSessions.length > 0 && <li><span>{activeCountProgress}%</span> progresso médio das abertas</li>}
            </ul>

            {operationalSummary.activeFinalCmv && (() => {
              const inv = operationalSummary.activeFinalCmv!;
              const cov = finalCmvCoverageMap[inv.id];
              const isEmRevisao = inv.status === "EM_REVISAO";
              const isComplete = cov?.isComplete === true;
              return (
                <div className="form-section" style={{ borderLeft: `4px solid ${isEmRevisao ? "var(--warning, #b45309)" : "var(--success, #2e7d32)"}`, background: "var(--surface)" }}>
                  <div className="section-heading compact-heading" style={{ margin: 0 }}>
                    <div>
                      <p>Fechamento do mes</p>
                      <h3 style={{ margin: "2px 0 4px" }}>
                        {isEmRevisao ? "Inventario Final CMV em revisao" : "Inventario Final CMV em andamento"}
                      </h3>
                      <span className="muted">{inv.code} • {formatDate(inv.date)}</span>
                      {cov && (
                        <p style={{ margin: "4px 0 0", fontSize: 13, fontWeight: 600, color: isComplete ? "var(--success, #2e7d32)" : "var(--warning, #b45309)" }}>
                          {cov.coveredTotal}/{cov.expectedTotal} produtos controlados cobertos{isComplete ? " — completo" : ` — ${cov.missingTotal} pendente(s)`}
                        </p>
                      )}
                      {isEmRevisao && <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted, #666)" }}>Aguardando revisao e aprovacao para fechamento do CMV Real.</p>}
                    </div>
                    <div className="actions-cell">
                      <StatusBadge tone={operationalTone(inv.status)}>{operationalStatusLabels[inv.status] ?? inv.status}</StatusBadge>
                      <button className="secondary-button" type="button" onClick={() => irParaInventario(inv.id)}>Ver inventario</button>
                    </div>
                  </div>
                </div>
              );
            })()}

            <button className="inv-mobile-form-toggle" type="button" onClick={() => setMobileCountFormOpen(v => !v)}>
              <Play size={15} />{mobileCountFormOpen ? "Cancelar" : "Nova contagem"}
            </button>
            <div className={`inv-collapsible-form${mobileCountFormOpen ? " open" : ""}`}>
              <div className="form-section">
                <div className="section-heading compact-heading">
                  <div>
                    <p>Nova contagem</p>
                    <h3>Iniciar Contagem</h3>
                    <span className="muted">Esta etapa abre uma ficha de lancamento. Inventario oficial sera gerado depois, apenas com contagem concluida.</span>
                  </div>
                </div>
                <div className="filters-row">
                  <label>Data<input type="date" value={countSessionForm.referenceDate} onChange={(event) => {
                    const referenceDate = event.target.value;
                    // Trocar a data re-sugere o ciclo — a menos que a pessoa ja
                    // tenha escolhido um, caso em que a escolha dela manda.
                    const ciclo = countSessionForm.cicloEditadoAMao
                      ? { mes: countSessionForm.periodMonth, ano: countSessionForm.periodYear }
                      : cicloSugerido(referenceDate);
                    setCountSessionForm({ ...countSessionForm, referenceDate, periodMonth: ciclo.mes, periodYear: ciclo.ano });
                  }} /></label>
                  <label>Ciclo
                    <select
                      value={`${countSessionForm.periodYear}-${countSessionForm.periodMonth}`}
                      onChange={(event) => {
                        const [ano, mes] = event.target.value.split("-").map(Number);
                        setCountSessionForm({ ...countSessionForm, periodMonth: mes, periodYear: ano, cicloEditadoAMao: true });
                      }}
                    >
                      {opcoesDeCiclo(countSessionForm.referenceDate).map((ciclo) => (
                        <option key={`${ciclo.ano}-${ciclo.mes}`} value={`${ciclo.ano}-${ciclo.mes}`}>{rotuloDoCiclo(ciclo)}</option>
                      ))}
                    </select>
                  </label>
                  <label>Tipo<select value={countSessionForm.type} onChange={(event) => setCountSessionForm({ ...countSessionForm, type: event.target.value as StockCountSessionType, sectorId: "", categoryId: "", subcategoryId: "" })}>
                    <option value="GERAL">Geral</option>
                    <option value="SETORIAL">Por setor</option>
                    <option value="CATEGORIA">Por categoria</option>
                    <option value="SUBCATEGORIA">Por subcategoria</option>
                    <option value="FINAL_MES">Final do mes</option>
                    <option value="ALEATORIA">Aleatoria</option>
                  </select></label>
                  {countSessionForm.type === "SETORIAL" && (
                    <label>Setor<select value={countSessionForm.sectorId} onChange={(event) => setCountSessionForm({ ...countSessionForm, sectorId: event.target.value, categoryId: "" })}>
                      <option value="">{sectors.length ? "Selecione" : "Nenhum setor disponível para contagem"}</option>
                      {sectors.map((sector) => <option key={sector.id} value={sector.id}>{sector.name}</option>)}
                    </select></label>
                  )}
                  {countSessionForm.type === "SETORIAL" && countSessionForm.sectorId && (
                    <label>Categoria (opcional)<select value={countSessionForm.categoryId} onChange={(event) => setCountSessionForm({ ...countSessionForm, categoryId: event.target.value })}>
                      <option value="">{categoriesForSector.length ? "Todas do setor" : "Nenhuma categoria com produtos neste setor"}</option>
                      {categoriesForSector.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select></label>
                  )}
                  {countSessionForm.type === "CATEGORIA" && (
                    <label>Categoria<select value={countSessionForm.categoryId} onChange={(event) => setCountSessionForm({ ...countSessionForm, categoryId: event.target.value })}>
                      <option value="">Selecione</option>
                      {productCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select></label>
                  )}
                  {countSessionForm.type === "SUBCATEGORIA" && (
                    <label>Subcategoria<select value={countSessionForm.subcategoryId} onChange={(event) => setCountSessionForm({ ...countSessionForm, subcategoryId: event.target.value })}>
                      <option value="">Selecione</option>
                      {productSubcategories.map((subcategory) => <option key={subcategory.id} value={subcategory.id}>{subcategory.name}</option>)}
                    </select></label>
                  )}
                  <label className="checkbox-label"><input type="checkbox" checked={countSessionForm.isMonthEnd || countSessionForm.type === "FINAL_MES"} onChange={(event) => setCountSessionForm({ ...countSessionForm, isMonthEnd: event.target.checked })} />Contagem final do mes</label>
                  {cicloDivergeDaData(countSessionForm.referenceDate, { mes: countSessionForm.periodMonth, ano: countSessionForm.periodYear }) && (
                    <small className="muted-text">
                      Contando em {countSessionForm.referenceDate.split("-").reverse().join("/")}, mas fecha o ciclo de {rotuloDoCiclo({ mes: countSessionForm.periodMonth, ano: countSessionForm.periodYear })}.
                    </small>
                  )}
                  <label>Observacoes<input value={countSessionForm.notes} onChange={(event) => setCountSessionForm({ ...countSessionForm, notes: event.target.value })} /></label>
                  <button className="primary-button" type="button" onClick={createCountSession}><Play size={16} />Iniciar Contagem</button>
                </div>
              </div>
            </div>
          </>
        )}

        {activeView === "counting" && (() => {
          const consolidatable = countSessions.filter((s) => s.type === "SETORIAL" && s.status === "CONCLUIDA" && (!s.generatedInventoryId || s.generatedInventoryStatus === "CANCELADO"));
          return consolidatable.length > 0 && canCreateOperational ? (
            // Recolhido por padrao: e acao de fim de mes, e aberto ocupava a tela
            // inteira do celular antes da primeira contagem.
            <details className="form-section count-consolidation" style={{ borderColor: "var(--gold)", background: "var(--surface)" }}>
              <summary>
                <span className="count-consolidation__title"><Layers size={16} />Fechamento do mês: consolidar setoriais em inventário Final CMV</span>
                <span className="count-consolidation__meta">{consolidatable.length} pronta{consolidatable.length !== 1 ? "s" : ""}</span>
              </summary>
              <p className="muted count-consolidation__help">Selecione as contagens setoriais concluídas que deseja unificar. Os produtos duplicados entre setores terão a contagem mais recente prevalecida.</p>
              <div className="filters-row" style={{ flexWrap: "wrap", gap: 8 }}>
                {consolidatable.map((s) => (
                  <label key={s.id} className="checkbox-label" style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "6px 10px", background: consolidationSelected.has(s.id) ? "var(--gold-soft)" : "#fff", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={consolidationSelected.has(s.id)}
                      onChange={(e) => {
                        const next = new Set(consolidationSelected);
                        if (e.target.checked) next.add(s.id); else next.delete(s.id);
                        setConsolidationSelected(next);
                        checkConsolidationCoverage([...next]);
                      }}
                    />
                    <span><strong>{s.code}</strong>{s.sectorName ? ` — ${s.sectorName}` : ""}<small style={{ display: "block", color: "var(--muted)", fontSize: 11 }}>{s.totalItems} produtos contados</small></span>
                  </label>
                ))}
              </div>
              {/* Painel de cobertura */}
              {isFetchingCoverage && (
                <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>Verificando cobertura...</p>
              )}
              {!isFetchingCoverage && consolidationCoverage && (
                <div style={{
                  marginTop: 10,
                  padding: "10px 14px",
                  borderRadius: 6,
                  background: consolidationCoverage.isComplete ? "var(--success-soft, #e6f4ea)" : "var(--error-soft, #fdecea)",
                  border: `1px solid ${consolidationCoverage.isComplete ? "var(--success, #2e7d32)" : "var(--error, #c62828)"}`,
                  fontSize: 13
                }}>
                  {consolidationCoverage.isComplete ? (
                    <strong style={{ color: "var(--success, #2e7d32)" }}>
                      Cobertura completa: {consolidationCoverage.coveredTotal}/{consolidationCoverage.expectedTotal} produtos controlados cobertos.
                    </strong>
                  ) : (
                    <>
                      <strong style={{ color: "var(--error, #c62828)" }}>
                        Inventario incompleto: {consolidationCoverage.coveredTotal}/{consolidationCoverage.expectedTotal} produtos controlados cobertos.
                      </strong>
                      <p style={{ margin: "6px 0 4px" }}>
                        {consolidationCoverage.missingTotal} produto(s) sem informacao de contagem — a consolidacao esta bloqueada:
                      </p>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {consolidationCoverage.missingProducts.slice(0, 20).map((p) => (
                          <li key={p.id}>
                            <strong>{p.code ? `[${p.code}]` : ""} {p.name}</strong>
                            {p.sector ? ` — ${p.sector}` : ""}
                            {p.category ? ` — ${p.category}` : ""}
                            {p.unit ? ` — ${p.unit}` : ""}
                          </li>
                        ))}
                        {consolidationCoverage.missingProducts.length > 20 && (
                          <li>...e mais {consolidationCoverage.missingProducts.length - 20} produto(s).</li>
                        )}
                      </ul>
                      {consolidationCoverage.missingSectors.length > 0 && (
                        <p style={{ margin: "6px 0 0" }}>
                          Setores sem contagem: <strong>{consolidationCoverage.missingSectors.join(", ")}</strong>
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                <button
                  className="primary-button"
                  type="button"
                  disabled={consolidationSelected.size === 0 || isConsolidating || isFetchingCoverage || (consolidationCoverage != null && !consolidationCoverage.isComplete)}
                  onClick={() => consolidateMonthEnd(false)}
                >
                  <Layers size={15} />{isConsolidating ? "Gerando inventario..." : `Gerar inventario final unificado (${consolidationSelected.size} setor${consolidationSelected.size !== 1 ? "es" : ""})`}
                </button>
                {consolidationCoverage != null && !consolidationCoverage.isComplete && consolidationSelected.size > 0 && (
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={isConsolidating || isFetchingCoverage}
                    style={{ borderColor: "var(--error, #c62828)", color: "var(--error, #c62828)" }}
                    onClick={() => consolidateMonthEnd(true)}
                    title="Cria o inventario em RASCUNHO com os produtos pendentes; feche o gap via contagem complementar antes de aprovar."
                  >
                    <Layers size={15} />Consolidar mesmo assim ({consolidationCoverage.missingTotal} pendente{consolidationCoverage.missingTotal !== 1 ? "s" : ""})
                  </button>
                )}
                {consolidationSelected.size > 0 && (
                  <button className="secondary-button" type="button" onClick={() => { setConsolidationSelected(new Set()); setConsolidationCoverage(null); }}>Limpar selecao</button>
                )}
              </div>
            </details>
          ) : null;
        })()}

        {activeView === "counting" && canCreateOperational && (() => {
          const finalCmvDrafts = operationalInventories.filter(
            (inv) => inv.type === "FINAL_CMV" && ["RASCUNHO", "EM_REVISAO"].includes(inv.status)
          );
          if (finalCmvDrafts.length === 0) return null;
          return finalCmvDrafts.map((inv) => {
            const cov = finalCmvCoverageMap[inv.id];
            const complementSessions = countSessions.filter((s) =>
              s.type === "COMPLEMENTAR_CMV" && s.notes?.includes(`[COMPLEMENTO:${inv.id}]`)
            );
            const readyToAppend = complementSessions.filter((s) => s.status === "CONCLUIDA" && !s.generatedInventoryId);
            const inProgress = complementSessions.filter((s) => s.status === "ABERTA" || s.status === "EM_ANDAMENTO");
            const isComplete = cov?.isComplete === true;
            const isIncomplete = cov != null && !isComplete;
            const borderColor = isComplete ? "var(--success, #2e7d32)" : isIncomplete ? "var(--error, #c62828)" : "var(--gold)";
            return (
              <div key={inv.id} className="form-section" style={{ borderColor, background: "var(--surface)" }}>
                <div className="section-heading compact-heading">
                  <div>
                    <p>Fechamento do mes</p>
                    <h3>Cobertura do inventario final CMV</h3>
                    <span className="muted">{inv.code} • {formatDate(inv.date)}</span>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => irParaInventario(inv.id)}
                  >
                    Ver inventario
                  </button>
                </div>
                {isLoadingCoverageMap && !cov && (
                  <p style={{ color: "var(--text-muted, #666)", fontSize: 13, margin: "4px 0" }}>Verificando cobertura de estoque...</p>
                )}
                {cov && (
                  <div style={{
                    padding: "10px 14px", borderRadius: 6, fontSize: 13, marginBottom: 8,
                    background: isComplete ? "var(--success-soft, #e6f4ea)" : "var(--error-soft, #fdecea)",
                    border: `1px solid ${isComplete ? "var(--success, #2e7d32)" : "var(--error, #c62828)"}`
                  }}>
                    <p style={{ margin: 0, fontWeight: 600, color: isComplete ? "var(--success, #2e7d32)" : "var(--error, #c62828)" }}>
                      {isComplete
                        ? `Inventario completo: ${cov.coveredTotal}/${cov.expectedTotal} produtos controlados cobertos.`
                        : `Inventario incompleto: ${cov.coveredTotal}/${cov.expectedTotal} — ${cov.missingTotal} produto(s) sem contagem:`}
                    </p>
                    {isIncomplete && (
                      <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                        {cov.missingProducts.slice(0, 20).map((p) => (
                          <li key={p.id}><strong>[{p.code ?? "?"}]</strong> {p.name} — {p.sector ?? "sem setor"}{p.unit ? ` (${p.unit})` : ""}</li>
                        ))}
                        {cov.missingProducts.length > 20 && <li>...e mais {cov.missingProducts.length - 20} produto(s).</li>}
                      </ul>
                    )}
                  </div>
                )}
                {inProgress.length > 0 && (
                  <p style={{ color: "var(--warning, #b45309)", fontSize: 13, margin: "0 0 8px" }}>
                    Contagem complementar em andamento: {inProgress.map((s) => s.code).join(", ")} — conclua-a para habilitar o anexo.
                  </p>
                )}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {readyToAppend.map((s) => (
                    <button key={s.id} className="primary-button" type="button" disabled={isAppendingComplement || isComplete} onClick={() => handleAppendMissingCountForInv(inv.id, s.id)}>
                      {isAppendingComplement ? "Incluindo..." : `Incluir complemento ${s.code} no inventario`}
                    </button>
                  ))}
                  {isIncomplete && readyToAppend.length === 0 && inProgress.length === 0 && (
                    <button className="secondary-button" type="button" disabled={isCreatingComplement} onClick={() => handleCreateMissingCountForInv(inv.id)}>
                      {isCreatingComplement ? "Criando..." : `Criar contagem complementar com ${cov.missingTotal} produto(s) pendente(s)`}
                    </button>
                  )}
                </div>
              </div>
            );
          });
        })()}

        {activeView === "counting" && (
          <div className="subsection inv-cards-section">
            <h3>Contagens de estoque</h3>
            <p className="muted">Atividade operacional do estoquista. Concluir contagem nao fecha inventario.</p>

            {/* Desktop. Eram 11 colunas e Acoes caia fora da tela, atras de uma
                rolagem lateral. Total/Contados/Pendentes viraram uma coluna de
                progresso, e Tipo deixou de repetir o setor da coluna ao lado. */}
            <div className="inv-desktop-table-wrap">
              <Table>
                <Table.Head>
                  <Table.Row>
                    <Table.Th>Código</Table.Th>
                    <Table.Th>Data</Table.Th>
                    <Table.Th>Tipo / setor</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th minWidth={120}>Progresso</Table.Th>
                    <Table.Th>Responsável</Table.Th>
                    <Table.Th actions>Ações</Table.Th>
                  </Table.Row>
                </Table.Head>
                <Table.Body>
                  {countSessions.map((session) => {
                    const escopo = [session.sectorName, session.categoryName, session.subcategoryName].filter(Boolean).join(" - ");
                    const pct = session.totalItems > 0 ? Math.round((Number(session.countedItems) / Number(session.totalItems)) * 100) : 0;
                    return (
                      <Table.Row key={session.id}>
                        <Table.Td className="count-list-code" title={session.notes ?? session.code}>
                          <strong>{session.code}</strong>
                          {session.source === "IMPORTACAO_PLANILHA" && <StatusBadge tone="info">Importada</StatusBadge>}
                          <small>{session.generatedInventoryCode ? `Inventário: ${session.generatedInventoryCode}` : session.isMonthEnd ? "Final do mês" : session.source === "IMPORTACAO_PLANILHA" ? "Importada via planilha" : session.type === "RECONTAGEM" ? "Pedida na conferência do inventário" : "Contagem operacional"}</small>
                        </Table.Td>
                        <Table.Td style={{ whiteSpace: "nowrap" }}>{formatDate(session.referenceDate)}</Table.Td>
                        <Table.Td truncate style={{ maxWidth: 200 }} title={escopo || undefined}>
                          {countSessionTypeLabels[session.type] ?? session.type}
                          {escopo && <small>{escopo}</small>}
                        </Table.Td>
                        <Table.Td><StatusBadge tone={countSessionTone(session.status)}>{countSessionStatusLabels[session.status] ?? session.status}</StatusBadge></Table.Td>
                        <Table.Td>
                          <div className="count-list-progress">
                            <span><strong>{formatNumber(session.countedItems)}</strong>/{formatNumber(session.totalItems)}{Number(session.pendingItems) > 0 && <em>{formatNumber(session.pendingItems)} pend.</em>}</span>
                            <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
                          </div>
                        </Table.Td>
                        <Table.Td truncate style={{ maxWidth: 120 }} title={session.responsibleName ?? "-"}>{session.responsibleName ?? "-"}</Table.Td>
                        <Table.Td actions>
                          <Button variant={editableCountSessionStatuses.has(session.status) ? "primary" : "secondary"} size="sm" onClick={() => openCountSession(session.id)}>{editableCountSessionStatuses.has(session.status) ? "Continuar" : "Visualizar"}</Button>
                          <RowMenu label={`Mais ações — ${session.code}`} items={countSessionMenuItems(session)} />
                        </Table.Td>
                      </Table.Row>
                    );
                  })}
                  {countSessions.length === 0 && (
                    <Table.Row>
                      <Table.Td colSpan={7}>
                        <EmptyState title="Nenhuma contagem encontrada" description="Clique em Nova contagem para abrir uma ficha de lançamento com produtos controlados." />
                      </Table.Td>
                    </Table.Row>
                  )}
                </Table.Body>
              </Table>
            </div>

            {/* Celular: um botao principal e o resto no menu. */}
            <div className="inv-mobile-cards">
              {countSessions.length === 0 && (
                <EmptyState title="Nenhuma contagem encontrada" description="Toque em Nova contagem para abrir uma ficha de lancamento." />
              )}
              {countSessions.map((session) => {
                const escopo = [session.sectorName, session.categoryName, session.subcategoryName].filter(Boolean).join(" - ");
                const pct = session.totalItems > 0 ? Math.round((Number(session.countedItems) / Number(session.totalItems)) * 100) : 0;
                const editavel = editableCountSessionStatuses.has(session.status);
                return (
                  <div key={session.id} className={`inv-mobile-card count-list-card${editavel ? " is-open" : ""}`}>
                    <div className="inv-mc-header">
                      <div className="inv-mc-header-left">
                        <strong>{session.code}</strong>
                        <small>
                          {[session.generatedInventoryCode ? `Inv: ${session.generatedInventoryCode}` : session.isMonthEnd ? "Final do mes" : countSessionTypeLabels[session.type] ?? session.type, escopo].filter(Boolean).join(" · ")}
                        </small>
                      </div>
                      <StatusBadge tone={countSessionTone(session.status)}>{countSessionStatusLabels[session.status] ?? session.status}</StatusBadge>
                    </div>
                    <div className="count-list-progress">
                      <span>
                        <strong>{formatNumber(session.countedItems)}</strong>/{formatNumber(session.totalItems)} contados
                        {Number(session.pendingItems) > 0 && <em>{formatNumber(session.pendingItems)} pend.</em>}
                      </span>
                      <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
                    </div>
                    <div className="count-list-card-footer">
                      <small>{formatDate(session.referenceDate)}{session.responsibleName ? ` · ${session.responsibleName}` : ""}</small>
                      <div className="count-list-card-actions">
                        <button className={editavel ? "primary-button" : "secondary-button"} type="button" onClick={() => openCountSession(session.id)}>
                          {editavel ? "Continuar" : "Visualizar"}
                        </button>
                        <RowMenu label={`Mais ações — ${session.code}`} items={countSessionMenuItems(session)} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeView !== "counting" && inventoryDeskTab === "official" && !operationalDetail && <>
          <div className={`inv-collapsible-form${mobileInvFormOpen ? " open" : ""}`} ref={formularioInventarioRef}>
            <div className="form-section inventory-create-panel">
              <div className="section-heading compact-heading">
                <div>
                  <p>Exceção</p>
                  <h3>Criar inventário manual</h3>
                </div>
                <span className="muted">O caminho normal é contar em Contagem de Estoque e gerar o inventário de lá. Use o manual só para lançar quantidades direto, sem contagem.</span>
              </div>
              <div className="filters-row">
                <label>Data<input type="date" value={operationalForm.date} onChange={(event) => setOperationalForm({ ...operationalForm, date: event.target.value })} /></label>
                <label>Data efetiva<input type="date" value={operationalForm.effectiveCountDate} onChange={(event) => setOperationalForm({ ...operationalForm, effectiveCountDate: event.target.value })} /></label>
                <label>Tipo<select value={operationalForm.type} onChange={(event) => setOperationalForm({ ...operationalForm, type: event.target.value as OperationalInventoryType })}>
                  <option value="GERAL">Geral</option>
                  <option value="SETORIAL">Setorial</option>
                  <option value="FINAL_CMV">Final CMV</option>
                  <option value="CONFERENCIA">Conferencia</option>
                </select></label>
                <label>Início real<input type="datetime-local" value={operationalForm.startedAt} onChange={(event) => setOperationalForm({ ...operationalForm, startedAt: event.target.value })} /></label>
                <label>Fim real<input type="datetime-local" value={operationalForm.finishedAt} onChange={(event) => setOperationalForm({ ...operationalForm, finishedAt: event.target.value })} /></label>
                {operationalForm.type === "SETORIAL" && (
                  <label>Setor<select value={operationalForm.sectorId} onChange={(event) => setOperationalForm({ ...operationalForm, sectorId: event.target.value })}>
                    <option value="">Selecione</option>
                    {sectors.map((sector) => <option key={sector.id} value={sector.id}>{sector.name}</option>)}
                  </select></label>
                )}
                <label className="span-2">Observações<input value={operationalForm.notes} onChange={(event) => setOperationalForm({ ...operationalForm, notes: event.target.value })} /></label>
                <button className="primary-button" type="button" onClick={createOperational}><ClipboardCheck size={16} />Criar inventário</button>
              </div>
            </div>
          </div>

          <ListaDeInventarios
            inventarios={operationalInventories}
            coberturas={finalCmvCoverageMap}
            abrindoId={openingInventoryId}
            podeCancelar={canCancelOperational}
            onAbrir={(id) => irParaInventario(id, "lista")}
            onPdf={(inventario) => void downloadInventoryPdf(inventario)}
            onCancelarRascunhos={cancelarRascunhosVazios}
          />
        </>}

        {activeView !== "counting" && inventoryDeskTab === "posicao" && !operationalDetail && <PosicaoEstoque />}

        {activeView !== "counting" && inventoryDeskTab === "official" && operationalDetail && (
          <div ref={operationalDetailRef} className="subsection operational-count-panel scroll-target">
            {/* O detalhe e uma pagina: a lista some e o endereco ganha
              * ?inventario=, entao o "voltar" do navegador funciona. As acoes de
              * status sobem para o cabecalho; editar fica junto da tabela. */}
            <nav className="op-detail-trilha" aria-label="Navegação">
              <button type="button" className="op-detail-voltar" onClick={fecharDetalheDoInventario}>
                <ArrowLeft size={15} aria-hidden="true" /> Inventários
              </button>
            </nav>
            <header className="op-detail-cabecalho">
              <div className="op-detail-cabecalho__titulo">
                <p className="op-detail-eyebrow">
                  {operationalDetail.code} · {operationalTypeLabels[operationalDetail.type]}{operationalDetail.sectorName ? ` · ${operationalDetail.sectorName}` : ""} · contado em {formatDate(operationalDetail.effectiveCountDate ?? operationalDetail.date)}
                </p>
                <h3 tabIndex={-1} data-autofocus title={operationalDetail.name}>{tituloCurto(operationalDetail)}</h3>
              </div>
              <div className="op-detail-head-actions">
                <StatusBadge tone={operationalTone(operationalDetail.status)}>{operationalStatusLabels[operationalDetail.status] ?? operationalDetail.status}</StatusBadge>
                {canPlanPurchase && operationalDetail.status !== "CANCELADO" && operationalDetail.pendingItems === 0 && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => navigate(`/estoque/planejamento-compra?sourceType=OPERATIONAL_INVENTORY&sourceId=${operationalDetail.id}`)}
                  >
                    <ShoppingCart size={15} /> Planejar compra
                  </button>
                )}
                {/* Final CMV tem o assistente de fechamento logo abaixo com o
                    passo principal; aqui so os inventarios comuns. */}
                {operationalDetail.type !== "FINAL_CMV" && editableOperationalInventoryStatuses.has(operationalDetail.status) && (
                  <button className="primary-button" type="button" onClick={() => operationalAction("submit")}><Send size={16} />Enviar para revisão</button>
                )}
                {canApproveOperational && operationalDetail.type !== "FINAL_CMV" && operationalDetail.status === "EM_REVISAO" && (
                  <button className="primary-button" type="button" disabled={aprovacaoTravada} title={tituloAprovacaoTravada} onClick={() => operationalAction("approve")}>
                    {faltamConferir > 0 ? `Aprovar (faltam ${formatNumber(faltamConferir)})` : "Aprovar"}
                  </button>
                )}
                {canApproveOperational && operationalDetail.type !== "FINAL_CMV" && operationalDetail.status === "APROVADO" && (
                  <button className="primary-button" type="button" onClick={() => operationalAction("close")}>Fechar</button>
                )}
                <RowMenu
                  label={`Mais ações — ${operationalDetail.code}`}
                  items={[
                    { label: "Gerar PDF", icon: <Download size={15} />, onClick: () => void downloadInventoryPdf(operationalDetail) },
                    ...(canApproveOperational && operationalDetail.status === "EM_REVISAO"
                      ? [{ label: "Rejeitar e devolver para correção", icon: <X size={15} />, onClick: () => void operationalAction("reject") }]
                      : []),
                    ...(canCancelOperational && !["FECHADO", "CANCELADO"].includes(operationalDetail.status)
                      ? [{ separator: true as const }, { label: "Cancelar inventário", icon: <Trash2 size={15} />, tone: "danger" as const, onClick: () => void operationalAction("cancel") }]
                      : [])
                  ]}
                />
              </div>
            </header>

            <EtapasDoInventario
              inventario={operationalDetail}
              faltamNaCobertura={operationalDetail.type === "FINAL_CMV" && finalCmvCoverage && !finalCmvCoverage.isComplete ? finalCmvCoverage.missingTotal : 0}
            />

            {operationalDetail.type === "FINAL_CMV" && operationalDetail.status === "RASCUNHO" && (() => {
              const complementSessions = countSessions.filter((s) =>
                s.type === "COMPLEMENTAR_CMV" &&
                s.notes?.includes(`[COMPLEMENTO:${operationalDetail.id}]`)
              );
              const readyToAppend = complementSessions.filter((s) => s.status === "CONCLUIDA" && !s.generatedInventoryId);
              const inProgress = complementSessions.filter((s) => s.status === "ABERTA" || s.status === "EM_ANDAMENTO");
              const isIncomplete = finalCmvCoverage != null && !finalCmvCoverage.isComplete;
              const isComplete = finalCmvCoverage != null && finalCmvCoverage.isComplete;
              // Cobertura: o Final CMV precisa ter todo produto controlado. Era um
              // bloco com cores fixas no codigo; virou o mesmo aviso do resto da tela.
              const tom = isComplete ? "ok" : isIncomplete ? "alerta" : "neutro";
              return (
                <section className={`cobertura cobertura--${tom}`} aria-label="Cobertura do inventário final">
                  {isFetchingFinalCmvCoverage && <p className="cobertura__titulo">Verificando cobertura de estoque…</p>}
                  {!isFetchingFinalCmvCoverage && finalCmvCoverage && (
                    <>
                      <p className="cobertura__titulo">
                        {isComplete
                          ? <>Cobertura completa: <strong>{finalCmvCoverage.coveredTotal} de {finalCmvCoverage.expectedTotal}</strong> produtos controlados contados.</>
                          : <>Faltam <strong>{finalCmvCoverage.missingTotal} {finalCmvCoverage.missingTotal === 1 ? "produto" : "produtos"}</strong> sem contagem ({finalCmvCoverage.coveredTotal} de {finalCmvCoverage.expectedTotal} cobertos). Eles entrariam no CMV como zero.</>}
                      </p>
                      {isIncomplete && (
                        <ul className="cobertura__lista">
                          {finalCmvCoverage.missingProducts.slice(0, 20).map((p) => (
                            <li key={p.id}>
                              <span>{p.name}</span>
                              <small>{[p.code, p.sector ?? "sem setor", p.unit].filter(Boolean).join(" · ")}</small>
                            </li>
                          ))}
                          {finalCmvCoverage.missingProducts.length > 20 && <li className="cobertura__mais">e mais {finalCmvCoverage.missingProducts.length - 20} produto(s)</li>}
                        </ul>
                      )}
                    </>
                  )}
                  {inProgress.length > 0 && (
                    <p className="cobertura__nota">
                      Contagem complementar em andamento: {inProgress.map((s) => s.code).join(", ")}. Conclua-a para incluir os produtos aqui.
                    </p>
                  )}
                  {readyToAppend.length > 0 && !isComplete && (
                    <div className="cobertura__acoes">
                      {readyToAppend.map((s) => (
                        <button key={s.id} className="primary-button" type="button" disabled={isAppendingComplement} onClick={() => handleAppendMissingCount(s.id)}>
                          {isAppendingComplement ? "Incluindo…" : `Incluir complemento ${s.code} no inventário`}
                        </button>
                      ))}
                    </div>
                  )}
                  {isIncomplete && readyToAppend.length === 0 && inProgress.length === 0 && (
                    <div className="cobertura__acoes">
                      <button className="secondary-button" type="button" disabled={isCreatingComplement} onClick={handleCreateMissingCount}>
                        {isCreatingComplement ? "Criando…" : `Criar contagem complementar com ${finalCmvCoverage?.missingTotal ?? "?"} produto(s)`}
                      </button>
                    </div>
                  )}
                </section>
              );
            })()}

            {/* Antes este painel so existia para EM_REVISAO. Quem acabava de
              * consolidar ficava em RASCUNHO sem nenhuma indicacao do que fazer,
              * e o "Enviar para revisao" morava numa barra generica no rodape. */}
            {operationalDetail.type === "FINAL_CMV" && ["RASCUNHO", "REJEITADO"].includes(operationalDetail.status) && (() => {
              const passo = proximoPassoDoFechamento(operationalDetail.status, finalCmvCoverage?.isComplete === true);
              return (
                <div className="cmv-closing-assistant">
                  <div className="cmv-closing-assistant__header">
                    <Send size={20} className="cmv-closing-assistant__icon" />
                    <div>
                      <h4 className="cmv-closing-assistant__title">{passo.titulo}</h4>
                      <p className="cmv-closing-assistant__info" style={{ margin: "2px 0 0" }}>{passo.descricao}</p>
                    </div>
                  </div>
                  <div className="cmv-closing-assistant__actions">
                    <button
                      className="primary-button cmv-closing-assistant__cta"
                      type="button"
                      disabled={acaoFechamentoEmCurso}
                      onClick={() => void executarPassoDoFechamento(operationalDetail.id, "submit")}
                    >
                      {acaoFechamentoEmCurso ? "Enviando…" : passo.rotuloAcao}
                    </button>
                  </div>
                </div>
              );
            })()}

            {operationalDetail.type === "FINAL_CMV" && operationalDetail.status === "EM_REVISAO" && (
              <div className="cmv-closing-assistant">
                <div className="cmv-closing-assistant__header">
                  <CheckCircle2 size={20} className="cmv-closing-assistant__icon" />
                  <div>
                    <h4 className="cmv-closing-assistant__title">Inventário Final CMV pronto para aprovação</h4>
                    <p className="cmv-closing-assistant__subtitle">{operationalDetail.code} — {operationalDetail.totalItems} itens cobertos</p>
                  </div>
                </div>
                <div className="cmv-closing-stats">
                  <div><span>Zerados</span><strong>{formatNumber(operationalDetail.zeroItems)}</strong></div>
                  <div><span>Contados</span><strong>{formatNumber(operationalDetail.countedItems)}</strong></div>
                  <div><span>Em alerta</span><strong>{conferenciaAtual ? formatNumber(itensEmAlerta) : "—"}</strong></div>
                  <div><span>Pendentes</span><strong>{formatNumber(operationalDetail.pendingItems)}</strong></div>
                </div>
                {faltamConferir > 0 ? (
                  <p className="cmv-closing-assistant__warn">
                    <AlertTriangle size={14} />Faltam conferir {formatNumber(faltamConferir)} item(ns) na aba Conferência. A aprovação libera quando todos estiverem marcados: depois dela as quantidades viram a base do CMV.
                  </p>
                ) : itensEmAlerta > 0 && (
                  <p className="cmv-closing-assistant__info">
                    Todos os alertas que pesam foram conferidos.
                  </p>
                )}
                <p className="cmv-closing-assistant__info">
                  Ao aprovar, será criada automaticamente a base de estoque para o CMV Real com {operationalDetail.totalItems} produtos.
                </p>
                <div className="cmv-closing-assistant__actions">
                  <button className="primary-button cmv-closing-assistant__cta" type="button" disabled={approvingFinalCmv || aprovacaoTravada} title={tituloAprovacaoTravada} onClick={() => setShowCmvApproveModal(true)}>
                    {approvingFinalCmv ? "Aprovando..." : "Aprovar e disponibilizar para CMV"}
                  </button>
                </div>
              </div>
            )}

            {operationalDetail.type === "FINAL_CMV" && ["APROVADO", "FECHADO"].includes(operationalDetail.status) && operationalDetail.inventorySnapshotId && (
              <div className="cmv-snapshot-panel cmv-snapshot-panel--compact">
                <div className="cmv-snapshot-panel__header">
                  <CheckCircle2 size={16} className="cmv-snapshot-panel__icon" />
                  <div>
                    <h4 className="cmv-snapshot-panel__title">Base de estoque criada para o CMV Real</h4>
                    <p className="cmv-snapshot-panel__subtitle">Inventário aprovado e disponível para apuração do CMV</p>
                  </div>
                </div>
                <div className="cmv-snapshot-panel__details">
                  <div><span>Tipo</span><strong>Inventário Final CMV</strong></div>
                  <div><span>Origem</span><strong>Sistema</strong></div>
                  <div><span>Itens</span><strong>{formatNumber(operationalDetail.totalItems)}</strong></div>
                  <div><span>Data efetiva</span><strong>{formatDate(operationalDetail.effectiveCountDate ?? operationalDetail.date)}</strong></div>
                </div>
                <div className="cmv-snapshot-panel__actions">
                  {operationalDetail.status === "APROVADO" && (
                    <button className="secondary-button" type="button" onClick={() => operationalAction("close")}>
                      Fechar inventário final
                    </button>
                  )}
                  <button className="primary-button" type="button" onClick={() => navigate(`/cmv/real?estoqueFinalSnapshotId=${operationalDetail.inventorySnapshotId}&inventoryCode=${encodeURIComponent(operationalDetail.code)}&totalItems=${operationalDetail.totalItems}`)}>
                    Usar no CMV Real
                  </button>
                </div>
              </div>
            )}

            <div className="op-detail-abas" role="tablist" aria-label="Conteúdo do inventário">
              {operationalDetail.status !== "CANCELADO" && (
                <button type="button" role="tab" id="aba-conferencia" aria-controls="painel-conferencia" aria-selected={abaDoDetalhe === "conferencia"} className="op-detail-aba" onClick={() => setAbaDoDetalhe("conferencia")}>
                  Conferência
                  {conferenciaAtual && (
                    <span
                      className={`op-detail-aba__contador${faltamConferir > 0 ? " op-detail-aba__contador--alerta" : ""}`}
                      title={faltamConferir > 0 ? `${faltamConferir} alerta(s) faltam conferir` : "Nada falta conferir"}
                    >
                      {faltamConferir > 0 ? formatNumber(faltamConferir) : "✓"}
                    </span>
                  )}
                </button>
              )}
              <button type="button" role="tab" id="aba-itens" aria-controls="painel-itens" aria-selected={abaDoDetalhe === "itens" || operationalDetail.status === "CANCELADO"} className="op-detail-aba" onClick={() => setAbaDoDetalhe("itens")}>
                Itens
                <span className="op-detail-aba__contador">{formatNumber(operationalDetail.countedItems)}/{formatNumber(operationalDetail.totalItems)}</span>
              </button>
            </div>

            {operationalDetail.status !== "CANCELADO" && (
              <div role="tabpanel" id="painel-conferencia" aria-labelledby="aba-conferencia" hidden={abaDoDetalhe !== "conferencia"}>
                <ConferenciaInventario
                  key={operationalDetail.id}
                  inventoryId={operationalDetail.id}
                  versao={versaoConferencia}
                  onLocalizar={localizarItemDaConferencia}
                  onCarregar={setConferencia}
                  jaAprovado={["APROVADO", "FECHADO"].includes(operationalDetail.status)}
                  podeCorrigir={podeEditarItens}
                  podeConferir={corrigindoNaRevisao}
                  onCorrigir={corrigirPelaConferencia}
                  onRecontagemAplicada={() => {
                    setNotice({ tone: "success", message: "Recontagem aplicada: as quantidades voltaram para a conferência." });
                    void refreshOperational(operationalDetail.id);
                  }}
                />
              </div>
            )}

            <div role="tabpanel" id="painel-itens" aria-labelledby="aba-itens" hidden={abaDoDetalhe !== "itens" && operationalDetail.status !== "CANCELADO"}>
            <div className="op-filters-bar">
              <div className="op-filters-bar__filters">
                <label>Setor<select value={operationalSectorFilter} onChange={(event) => setOperationalSectorFilter(event.target.value)}>
                  <option value="">Todos</option>
                  {operationalSectors.map((sector) => <option key={sector} value={sector}>{sector}</option>)}
                </select></label>
                <label>Busca<input value={operationalSearch} onChange={(event) => setOperationalSearch(event.target.value)} placeholder="Código ou produto" /></label>
                {(operationalSearch || operationalSectorFilter) && (
                  <p className="op-filtro-ativo" role="status">
                    Mostrando {formatNumber(filteredOperationalItems.length)} de {formatNumber(operationalDetail.items.length)}
                    <button type="button" onClick={() => { setOperationalSearch(""); setOperationalSectorFilter(""); }}>Limpar filtro</button>
                  </p>
                )}
              </div>
              {/* Junto da tabela, so o que edita quantidades. Status subiu
                  para o cabecalho; cancelar foi para o menu. */}
              {podeEditarItens && (
                <div className="op-filters-bar__actions">
                  {emRascunho && <button className="secondary-button" type="button" onClick={markOperationalFilteredZero}>Marcar filtrados como zero</button>}
                  <button className="primary-button" type="button" onClick={saveOperationalDraft}>
                    <Save size={16} />{corrigindoNaRevisao ? "Salvar correções" : "Salvar rascunho"}
                  </button>
                </div>
              )}
            </div>

            {corrigindoNaRevisao && (
              <p className="op-revisao-aviso" role="note">
                <strong>Em revisão:</strong> corrija as quantidades que a conferência apontou e salve. Cada correção fica registrada com o valor anterior. Depois de aprovar, as quantidades viram a base do CMV.
              </p>
            )}

            <div className="table-wrap operational-count-table">
              <table>
                <thead><tr><th>Cód.</th><th>Produto</th><th>Setor</th><th>Qtd.</th><th title="Resultado da conferência quando o inventário foi salvo pela última vez">Conferência</th><th className="op-note-col-header" title="Observação do item"><MessageSquare size={14} /></th></tr></thead>
                <tbody>
                  {filteredOperationalItems.map((item) => {
                    const line = operationalLines[item.id] ?? { countedQuantity: "", notes: "" };
                    const locked = !podeEditarItens;
                    const hasNote = line.notes.trim().length > 0;
                    const noteOpen = editingOperationalNoteId === item.id;
                    return (
                      <Fragment key={item.id}>
                        <tr>
                          <td>{item.productCode ?? "-"}</td>
                          <td title={item.productName}><span className="op-product-name">{item.productName}</span><small>{[item.categoryName, item.subcategoryName].filter(Boolean).join(" • ") || "-"}</small></td>
                          <td title={item.sectorName ?? "-"}>{item.sectorName ?? "-"}</td>
                          <td className="op-qty-cell"><input className="count-input" data-op-item-id={item.id} aria-label={`Quantidade de ${item.productName}`} inputMode="decimal" disabled={locked} value={line.countedQuantity} onChange={(event) => { setOperationalLines({ ...operationalLines, [item.id]: { ...line, countedQuantity: sanitizeQuantityInput(event.target.value) } }); setOperationalDirty((prev) => (prev[item.id] ? prev : { ...prev, [item.id]: true })); }} />{item.unit && <small className="op-unit-tag">{item.unit}</small>}</td>
                          <td><SeloDaConferencia item={conferenciaPorItem.get(item.id)} /></td>
                          <td className="op-note-col">
                            <button
                              type="button"
                              className={`op-note-btn${hasNote ? " has-note" : ""}`}
                              title={hasNote ? line.notes : "Adicionar observação"}
                              aria-label={hasNote ? "Editar observação do item" : "Adicionar observação"}
                              onClick={() => setEditingOperationalNoteId(noteOpen ? null : item.id)}
                            >
                              <MessageSquare size={13} />
                              {hasNote && <span className="op-note-dot" aria-hidden="true" />}
                            </button>
                          </td>
                        </tr>
                        {noteOpen && (
                          <tr className="op-note-expansion-row">
                            <td colSpan={6}>
                              <div className="op-note-expansion">
                                <label className="op-note-label">Observação do item</label>
                                <textarea
                                  autoFocus
                                  disabled={locked}
                                  className="op-note-textarea"
                                  placeholder="Sem observação"
                                  value={line.notes}
                                  rows={2}
                                  onChange={(event) => {
                                    // Observacao tambem e edicao: sem marcar, "Salvar" nao a enviava
                                    // e a correcao pela conferencia a apagava na recarga.
                                    setOperationalLines({ ...operationalLines, [item.id]: { ...line, notes: event.target.value } });
                                    setOperationalDirty((prev) => (prev[item.id] ? prev : { ...prev, [item.id]: true }));
                                  }}
                                />
                                <button type="button" className="secondary-button op-note-close" onClick={() => setEditingOperationalNoteId(null)}>Fechar</button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {filteredOperationalItems.length === 0 && (
                    <tr><td colSpan={6}><EmptyState title="Nenhum produto nesta contagem" description="Revise o setor selecionado ou crie uma contagem geral/final CMV para carregar todos os produtos controlados." /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
            </div>
          </div>
        )}

      </section>

      {/* So com a aba dele: nas outras abas o conteudo nao renderiza e sobrava
          um painel "Estoque atual" vazio no fim da pagina. */}
      <section className={activeView === "reports" ? "panel" : "panel inventory-section-hidden"}>
        <div className="section-heading">
          <div>
            <PanelEyebrow>Relatórios</PanelEyebrow>
            <h2>Leitura gerencial</h2>
          </div>
        </div>
        {showManagementReport && (
          <>
            <div className="summary-grid inventory-compact-summary">
              <SummaryCard label="Movimentações" value={movements.length} tone="info" />
              <SummaryCard label="Contagens" value={counts.length} tone="info" />
              <SummaryCard label="Inventários oficiais" value={officialInventories.length} tone="success" />
              <SummaryCard label="Divergências" value={counts.filter((count) => Number(count.divergenceQuantity) !== 0).length} tone="warning" />
            </div>
            <div className="chart-grid">
              <SimpleBarChart title="Divergências por setor/tipo" items={divergencesBySector} />
              <SimpleBarChart title="Status dos inventários" items={countsByStatus} />
              <SimpleBarChart title="Estoque contado x pendente" items={[
                { label: "Contados", value: operationalInventories.reduce((sum, item) => sum + Number(item.countedItems ?? 0), 0) },
                { label: "Pendentes", value: operationalInventories.reduce((sum, item) => sum + Number(item.pendingItems ?? 0), 0) }
              ]} />
            </div>
          </>
        )}
      </section>

      {/* A agenda e a rotina do estoquista: mora em Contagens, recolhida, para
          quem configura. O dia a dia fica na faixa "Contagens da semana". */}
      <section className={canConfigureAgenda || canViewInventoryReports ? panelClass(["counting"]) : "panel inventory-section-hidden"}>
        <details className="routine-config">
          <summary>
            <span>
              <PanelEyebrow>Rotina do estoquista</PanelEyebrow>
              <strong>Agenda de contagens</strong>
            </span>
            <small>Regras por setor e o mês inteiro</small>
          </summary>

        <div className="filters-row">
          <label>
            Mes
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </label>
          <button className="secondary-button" type="button" onClick={() => setMonth(monthValue())}>
            Mes atual
          </button>
          <button className="icon-button" type="button" onClick={load} aria-label="Atualizar agenda">
            {loading ? <Loader2 size={18} /> : <RefreshCw size={18} />}
          </button>
        </div>

        {(agenda?.items.length ?? 0) > 0 && (
          <div className="table-wrap subsection">
            <table>
              <thead><tr><th>Dia</th><th>Setor</th><th>Situação</th><th>Contagem</th><th>Responsavel</th><th>Acoes</th></tr></thead>
              <tbody>{agenda?.items.map((item) => {
                const rotina = rotuloDoStatusDaRotina[item.routineStatus ?? "PREVISTA"];
                return (
                  <tr key={item.id}>
                    <td>{formatDate(item.scheduledDate)}</td>
                    <td>{item.activeSectorName ?? item.sectorName ?? item.categoryName}</td>
                    <td><StatusBadge tone={item.activeSectorId ? rotina.tone : "neutral"}>{item.activeSectorId ? rotina.label : "Lembrete"}</StatusBadge></td>
                    <td>{item.sessionId ? <button type="button" className="link-button" onClick={() => void openCountSession(item.sessionId!)}>{item.sessionCode}</button> : "-"}</td>
                    <td>{item.responsibleName ?? "-"}</td>
                    <td>
                      <div className="actions-cell">
                        {item.status === "SUBMITTED" && canConfigureAgenda && <Button variant="secondary" size="sm" leadingIcon={<CheckCircle2 size={14} />} onClick={() => confirmAgenda(item)}>Confirmar</Button>}
                        <button type="button" onClick={() => openCount(item)}><CalendarDays size={14} />Contagem avulsa</button>
                      </div>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}

        {canConfigureAgenda && (
          <div className="subsection">
            <h3>Configurar agenda</h3>
            <div className="form-grid">
              <label>Dia<select value={ruleForm.dayOfWeek} onChange={(event) => setRuleForm({ ...ruleForm, dayOfWeek: event.target.value })}>{weekdays.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}</select></label>
              <label>Frequencia<select value={ruleForm.frequency} onChange={(event) => setRuleForm({ ...ruleForm, frequency: event.target.value })}><option value="DAILY">Diaria</option><option value="WEEKLY">Semanal</option><option value="BIWEEKLY">Quinzenal</option><option value="MONTHLY">Mensal</option><option value="LAST_DAY">Ultimo dia do mes</option></select></label>
              <label>Setor<select value={ruleForm.sectorId} onChange={(event) => {
                const sector = sectors.find((item) => item.id === event.target.value);
                setRuleForm({ ...ruleForm, sectorId: event.target.value, sectorName: sector?.name ?? "" });
              }}><option value="">Selecione</option>{sectors.map((sector) => <option key={sector.id} value={sector.id}>{sector.name}</option>)}</select></label>
              <label>Categoria/grupo<input value={ruleForm.categoryName} onChange={(event) => setRuleForm({ ...ruleForm, categoryName: event.target.value })} /></label>
              <label>Observacoes<input value={ruleForm.notes} onChange={(event) => setRuleForm({ ...ruleForm, notes: event.target.value })} /></label>
              <button className="primary-button" type="button" onClick={saveRule}>{ruleForm.id ? "Atualizar agenda" : "Salvar agenda"}</button>
            </div>
            <div className="table-wrap subsection">
              <table>
                <thead><tr><th>Setor</th><th>Frequencia</th><th>Dia</th><th>Obs.</th><th>Acoes</th></tr></thead>
                <tbody>{agenda?.rules.map((rule) => (
                  <tr key={rule.id}>
                    <td>{rule.sectorName || rule.categoryName}</td>
                    <td>{rule.frequency}</td>
                    <td>{rule.dayOfWeek == null ? "-" : weekdays.find((day) => day.value === String(rule.dayOfWeek))?.label ?? rule.dayOfWeek}</td>
                    <td>{rule.notes ?? "-"}</td>
                    <td><div className="actions-cell"><button type="button" onClick={() => editRule(rule)}>Editar</button><button type="button" onClick={() => removeRule(rule.id)}><Trash2 size={15} />Excluir</button></div></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
        </details>
      </section>

      {/* Contagem avulsa, produto a produto (grava StockCount; nao ajusta
          estoque nem entra no CMV). Recolhida: o caminho normal e a sessao. */}
      <section className={panelClass(["counting"])}>
        <details className="routine-config">
          <summary>
            <span>
              <PanelEyebrow>{selectedAgenda ? selectedAgenda.sectorName || selectedAgenda.categoryName : "Contagem rapida"}</PanelEyebrow>
              <strong>Contagem avulsa de um produto</strong>
            </span>
            <small>Não ajusta o estoque nem entra no CMV</small>
          </summary>
        <div className="section-heading">
          <div />

          <div className="actions-cell">
            <button className="secondary-button large-action" type="button" onClick={startAgenda} disabled={!selectedAgenda || selectedAgenda.status === "CONFIRMED"}>
              <Play size={17} />
              Iniciar
            </button>
            <button className="primary-button large-action" type="button" onClick={submitAgenda} disabled={!selectedAgenda || selectedAgenda.status === "CONFIRMED"}>
              <Send size={17} />
              Enviar revisao
            </button>
          </div>
        </div>

        <div className="form-grid quick-count-grid">
          <label>Produto<select value={countForm.productId} onChange={(event) => {
            const product = products.find((item) => item.id === event.target.value);
            setCountForm({ ...countForm, productId: event.target.value, unit: product?.unit ?? countForm.unit });
          }}>{productsForCount.map((product) => <option key={product.id} value={product.id}>{product.externalCode ? `${product.externalCode} - ` : ""}{product.name}</option>)}</select></label>
          <label>Quantidade<input inputMode="decimal" value={countForm.countedQuantity} onChange={(event) => setCountForm({ ...countForm, countedQuantity: sanitizeQuantityInput(event.target.value) })} /></label>
          <label>Unidade<input value={countForm.unit} onChange={(event) => setCountForm({ ...countForm, unit: event.target.value })} /></label>
          <label>Observacao<input value={countForm.notes} onChange={(event) => setCountForm({ ...countForm, notes: event.target.value })} /></label>
          <button className="secondary-button large-action" type="button" onClick={() => submitCount("DRAFT")}><Save size={17} />Salvar rascunho</button>
          <button className="primary-button large-action" type="button" onClick={() => submitCount("SUBMITTED")}><Send size={17} />Salvar e enviar</button>
        </div>

        <div className="subsection table-wrap">
          <table>
            <thead><tr><th>Produto</th><th>Setor</th><th>Localizacao</th><th>Categoria</th><th>Unidade</th></tr></thead>
            <tbody>{productsForCount.slice(0, 80).map((product) => <tr key={product.id}><td>{product.name}<small>{product.externalCode ?? "Sem codigo"}</small></td><td>{product.inventorySector?.name ?? "-"}</td><td>{[product.storageLocation, product.storageShelf, product.storagePosition].filter(Boolean).join(" - ") || "-"}</td><td>{product.category?.name ?? "-"}</td><td>{product.stockUnit ?? product.unit ?? "-"}</td></tr>)}</tbody>
          </table>
        </div>
        </details>
      </section>

      <section className={panelClass(["movements"])}>
        <div className="section-heading"><div><PanelEyebrow>Movimentação autorizada</PanelEyebrow><h2>Registrar movimentação</h2></div></div>
        <div className="form-grid">
          <label>Buscar produto<input list="movement-products" value={movementSearch} onBlur={findMovementProduct} onChange={(event) => setMovementSearch(event.target.value)} placeholder="Código ou nome" /><datalist id="movement-products">{products.map((product) => <option key={product.id} value={product.externalCode ? `${product.externalCode} - ${product.name}` : product.name} />)}</datalist></label>
          <Button variant="secondary" leadingIcon={<Search size={16} />} onClick={findMovementProduct}>Buscar</Button>
          <label>Produto<select value={movementForm.productId} onChange={(event) => selectMovementProduct(event.target.value)}><option value="">Selecione o produto</option>{products.map((product) => <option key={product.id} value={product.id}>{product.externalCode ? `${product.externalCode} - ` : ""}{product.name}</option>)}</select></label>
          <label>Tipo<select value={movementForm.type} onChange={(event) => setMovementForm({ ...movementForm, type: event.target.value })}>{movementTypes.filter((type) => canViewCosts || type.value !== "PURCHASE_IN").map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
          <label>Quantidade<input inputMode="decimal" value={movementForm.quantity} onChange={(event) => setMovementForm({ ...movementForm, quantity: sanitizeQuantityInput(event.target.value) })} /></label>
          <label>Unidade<input value={movementForm.unit} onChange={(event) => setMovementForm({ ...movementForm, unit: event.target.value })} /></label>
          <label className={sensitiveMovementTypes.includes(movementForm.type) && !movementForm.notes.trim() ? "field-error" : ""}>Motivo/observação<input value={movementForm.notes} onChange={(event) => setMovementForm({ ...movementForm, notes: event.target.value })} /></label>
          <Button className="large-action" onClick={submitMovement}>Salvar movimentação</Button>
        </div>
        {movementForm.productId && (
          <Alert tone="success">
            {(() => {
              const product = products.find((item) => item.id === movementForm.productId);
              return product ? `Selecionado: ${product.externalCode ?? "-"} - ${product.name} | Setor ${product.inventorySector?.name ?? "-"} | ${[product.storageLocation, product.storageShelf, product.storagePosition].filter(Boolean).join(" - ") || "sem localização"}` : "";
            })()}
          </Alert>
        )}
      </section>

      <ConfirmDialog
        open={showCmvApproveModal}
        title="Confirmar inventário final para CMV"
        description={
          operationalDetail?.type === "FINAL_CMV" ? (
            <div>
              <p><strong>Inventário:</strong> {operationalDetail.code}</p>
              <p><strong>Cobertura:</strong> {operationalDetail.totalItems}/{operationalDetail.totalItems} produtos controlados</p>
              <p><strong>Produtos pendentes:</strong> {operationalDetail.pendingItems}</p>
              <p><strong>Itens zerados:</strong> {formatNumber(operationalDetail.zeroItems)}</p>
              <p><strong>Itens contados:</strong> {formatNumber(operationalDetail.countedItems)}</p>
              <p><strong>Em alerta na conferência:</strong> {conferenciaAtual ? `${formatNumber(itensEmAlerta)} (impossíveis, zerados suspeitos ou fora do histórico)` : "não carregada"}</p>
              <p style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                Esta ação aprovará o inventário final e criará uma base de estoque para uso no CMV Real. Depois disso, o inventário poderá ser fechado e utilizado na apuração do CMV.
              </p>
            </div>
          ) : ""
        }
        confirmLabel="Confirmar aprovação"
        onConfirm={handleApproveFinalCmv}
        onCancel={() => setShowCmvApproveModal(false)}
      />

      <section className={panelClass(["movements"])}>
        <div className="section-heading"><div><PanelEyebrow>Histórico</PanelEyebrow><h2>{stockkeeperMode ? "Contagens e movimentações" : "Movimentações recentes"}</h2></div></div>
        <div className="filters-row">
          <PeriodFilter value={movementPeriod} onChange={setMovementPeriod} />
          <Button onClick={load}>Filtrar</Button>
        </div>
        {/* Sem movimentacao no periodo, eram tres cartoes "Sem dados
            suficientes" — no celular, uma tela inteira de nada. */}
        {movements.length > 0 && (
          <div className="chart-grid">
            <SimpleBarChart title="Entradas x saídas por tipo" items={movementsByType} />
            <SimpleBarChart title="Produtos mais movimentados" items={movementsByProduct} />
            <SimpleBarChart title="Linha temporal de movimentações" items={movementsTimeline} />
          </div>
        )}
        {movements.length === 0 && <EmptyState title="Nenhuma movimentação no período" description="Troque o período acima para ver outros meses." />}
        {movements.length > 0 && (<>
          <div className="inv-desktop-table-wrap">
            <Table>
              <Table.Head>
                <Table.Row>
                  <Table.Th>Data</Table.Th>
                  <Table.Th minWidth={180}>Produto</Table.Th>
                  <Table.Th>Tipo</Table.Th>
                  <Table.Th align="right">Quantidade</Table.Th>
                  {canViewCosts && <Table.Th align="right">Custo total</Table.Th>}
                  <Table.Th>Obs.</Table.Th>
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {movements.map((movement) => {
                  const assinada = movementSignedQuantity(movement.type, Number(movement.quantity));
                  return (
                    <Table.Row key={movement.id}>
                      <Table.Td style={{ whiteSpace: "nowrap" }}>{formatDate(movement.createdAt)}</Table.Td>
                      <Table.Td truncate title={movement.productName}>{movement.productName}</Table.Td>
                      <Table.Td>{movementTypeLabel(movement.type)}</Table.Td>
                      {/* Com sinal: uma perda de 3 e uma entrada de 3 apareciam iguais. */}
                      <Table.Td align="right" className={assinada < 0 ? "movement-out" : "movement-in"} style={{ whiteSpace: "nowrap" }}>
                        {assinada > 0 ? "+" : ""}{formatNumber(assinada)} {movement.unit ?? ""}
                      </Table.Td>
                      {canViewCosts && <Table.Td align="right">{movement.totalCost ? <Money value={Number(movement.totalCost)} /> : "-"}</Table.Td>}
                      <Table.Td truncate style={{ maxWidth: 200 }} title={movement.notes ?? undefined}>{movement.notes ?? "-"}</Table.Td>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table>
          </div>

          {/* Celular: a tabela de 7 colunas rolava 394px de lado. */}
          <div className="inv-mobile-cards movement-mobile-list">
            {movements.map((movement) => {
              const assinada = movementSignedQuantity(movement.type, Number(movement.quantity));
              return (
                <div key={movement.id} className="movement-mobile-item">
                  <div>
                    <strong>{movement.productName}</strong>
                    <small>{formatDate(movement.createdAt)} · {movementTypeLabel(movement.type)}{movement.notes ? ` · ${movement.notes}` : ""}</small>
                  </div>
                  <span className={assinada < 0 ? "movement-out" : "movement-in"}>
                    {assinada > 0 ? "+" : ""}{formatNumber(assinada)} {movement.unit ?? ""}
                    {canViewCosts && movement.totalCost ? <small><Money value={Number(movement.totalCost)} /></small> : null}
                  </span>
                </div>
              );
            })}
          </div>
        </>)}
      </section>
    </div>
  );
}
