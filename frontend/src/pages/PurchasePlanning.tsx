import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, FileText, PackageSearch, RotateCcw, Search, ShoppingCart, Tag, Trash2, X } from "lucide-react";
import { StatusBadge, EmptyState, Dialog } from "../components/ui";
import {
  createPurchaseOrdersFromPlanning,
  getBuyerSupportReport,
  getSuppliers,
  type BuyerSupportItem,
  type BuyerSupportReport,
  type PurchaseOrderFromPlanningResult,
  type Supplier
} from "../api/client";
import { formatCurrency, formatDate, formatNumber } from "../utils/format";

// Modelos de compra oferecidos ao comprador. Sem conversao automatica nesta etapa.
const PURCHASE_MODELS = ["unidade", "caixa", "saco", "kg", "bandeja", "pacote", "fardo", "outro"] as const;

type PlanningStatus = "PEDIR" | "REVISAR" | "SEM_FORNECEDOR" | "NAO_PEDIR";

type LineEdit = {
  qty: string;
  model: string;
  supplierId: string | null;
  note: string;
  // Marca itens em que o comprador aceitou explicitamente a sugestao automatica.
  // Usada para diferenciar "digitado do zero" (nao mostra chip) de "aceitou e ajustou"
  // (mostra chip discreto de rastreabilidade quando qty != suggestedQuantity).
  acceptedSuggestion?: boolean;
};

type ViewMode = "product" | "supplier";

function sourceTitle(source: BuyerSupportReport["summary"]["source"]): string {
  const byType: Record<string, string> = {
    FINAL_CMV: "Inventário Final CMV",
    GERAL: "Inventário Geral",
    SETORIAL: "Contagem Setorial",
    FINAL_MES: "Contagem de Fim de Mês"
  };
  if (source.sourceType === "LATEST_FINAL_CMV") return "Último Inventário Final CMV";
  return byType[source.type ?? ""] ?? (source.sourceType === "STOCK_COUNT_SESSION" ? "Contagem de estoque" : "Inventário");
}

function defaultModel(item: BuyerSupportItem): string {
  const unit = (item.unit ?? "").trim().toLowerCase();
  const match = PURCHASE_MODELS.find((model) => model === unit);
  return match ?? (unit ? "outro" : "unidade");
}

function chosenSupplierOf(item: BuyerSupportItem, edit: LineEdit | undefined): string | null {
  if (edit && edit.supplierId !== undefined && edit.supplierId !== "") return edit.supplierId;
  return item.supplierId ?? item.preferredSupplierId ?? item.bestPriceSupplierId ?? null;
}

function unitPriceForSupplier(item: BuyerSupportItem, supplierId: string | null): number | null {
  if (supplierId) {
    const option = item.supplierPriceOptions.find((opt) => opt.supplierId === supplierId);
    if (option) return option.bestUnitPrice;
  }
  return item.lastUnitPrice ?? item.bestUnitPrice ?? null;
}

// Ranking recomendado (ate 3). supplierPriceOptions ja vem ordenado por bestUnitPrice
// no backend; aqui reforcamos o criterio: menor preco → mais compras → compra mais recente.
function recommendedSuppliers(item: BuyerSupportItem) {
  return [...item.supplierPriceOptions]
    .sort((a, b) => {
      if (a.bestUnitPrice !== b.bestUnitPrice) return a.bestUnitPrice - b.bestUnitPrice;
      if (a.purchaseCount !== b.purchaseCount) return b.purchaseCount - a.purchaseCount;
      return (b.lastPurchaseDate ?? "").localeCompare(a.lastPurchaseDate ?? "");
    })
    .slice(0, 3);
}

function lineStatus(qty: number, supplierId: string | null, item: BuyerSupportItem): PlanningStatus {
  // !(qty > 0) tambem cobre NaN (input nao numerico) → tratado como "Nao pedir".
  if (!(qty > 0)) return "NAO_PEDIR";
  if (!supplierId) return "SEM_FORNECEDOR";
  if (item.conversionMissing || item.registrationAlerts.length > 0 || item.alerts.includes("DIVERGENTE")) return "REVISAR";
  return "PEDIR";
}

const STATUS_LABEL: Record<PlanningStatus, string> = {
  PEDIR: "Pedir",
  REVISAR: "Revisar",
  SEM_FORNECEDOR: "Sem fornecedor",
  NAO_PEDIR: "Não pedir"
};

const STATUS_TONE: Record<PlanningStatus, "success" | "warning" | "danger" | "neutral"> = {
  PEDIR: "success",
  REVISAR: "warning",
  SEM_FORNECEDOR: "danger",
  NAO_PEDIR: "neutral"
};

export function PurchasePlanning() {
  const [params] = useSearchParams();
  const sourceType = params.get("sourceType") ?? undefined;
  const sourceId = params.get("sourceId") ?? undefined;

  const [report, setReport] = useState<BuyerSupportReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, LineEdit>>({});

  const [search, setSearch] = useState("");
  const [sectorFilter, setSectorFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [onlySuggested, setOnlySuggested] = useState(false);
  const [onlyWithoutSupplier, setOnlyWithoutSupplier] = useState(false);
  const [onlyCheaper, setOnlyCheaper] = useState(false);
  const [onlyBelowMin, setOnlyBelowMin] = useState(false);
  const [view, setView] = useState<ViewMode>("product");
  const [activeSuppliers, setActiveSuppliers] = useState<Supplier[]>([]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generatedResult, setGeneratedResult] = useState<PurchaseOrderFromPlanningResult | null>(null);
  // Mapa productId -> codigo do pedido gerado, para impedir gerar 2x o mesmo item.
  const [generatedByProduct, setGeneratedByProduct] = useState<Record<string, string>>({});
  const redoItem = (productId: string) => {
    setGeneratedByProduct((prev) => {
      if (!prev[productId]) return prev;
      const next = { ...prev };
      delete next[productId];
      return next;
    });
  };
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [undoToast, setUndoToast] = useState<{ productId: string; productName: string } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generatedPanelRef = useRef<HTMLElement | null>(null);

  const clearUndoTimer = () => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  };

  const removeItem = (productId: string, productName: string) => {
    setRemovedIds((prev) => {
      const next = new Set(prev);
      next.add(productId);
      return next;
    });
    setUndoToast({ productId, productName });
    clearUndoTimer();
    undoTimerRef.current = setTimeout(() => setUndoToast(null), 10000);
  };
  const undoRemove = () => {
    if (!undoToast) return;
    setRemovedIds((prev) => {
      const next = new Set(prev);
      next.delete(undoToast.productId);
      return next;
    });
    clearUndoTimer();
    setUndoToast(null);
  };
  const restoreAll = () => {
    setRemovedIds(new Set());
    clearUndoTimer();
    setUndoToast(null);
  };
  useEffect(() => () => clearUndoTimer(), []);

  // Base de fornecedores ativos para escolha livre (GET somente leitura, endpoint existente).
  useEffect(() => {
    let active = true;
    getSuppliers({ activeOnly: true })
      .then((list) => { if (active) setActiveSuppliers(list); })
      .catch(() => { /* sem fornecedores: chips de historico ainda funcionam */ });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getBuyerSupportReport(sourceType ? { sourceType, sourceId } : undefined)
      .then((data) => {
        if (!active) return;
        setReport(data);
        // Estado local inicial: qty sempre vazia (comprador precisa aceitar sugestao
        // explicitamente via chip "Aceitar sugestao" ou botao global). Modelo/fornecedor
        // seedados com defaults para acelerar a decisao quando ele preencher qty.
        const seed: Record<string, LineEdit> = {};
        for (const item of data.items) {
          seed[item.productId] = {
            qty: "",
            model: defaultModel(item),
            supplierId: item.supplierId ?? item.preferredSupplierId ?? item.bestPriceSupplierId ?? null,
            note: "",
            acceptedSuggestion: false
          };
        }
        setEdits(seed);
        setRemovedIds(new Set());
        setGeneratedByProduct({});
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Não foi possível carregar o planejamento.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [sourceType, sourceId]);

  const updateEdit = (productId: string, patch: Partial<LineEdit>) => {
    setEdits((prev) => ({ ...prev, [productId]: { ...prev[productId], ...patch } }));
  };

  // Aceita a sugestao automatica de um item: preenche qty com suggestedQuantity
  // e marca acceptedSuggestion=true para diferenciar de "digitado do zero".
  const acceptSuggestion = (item: BuyerSupportItem) => {
    if (item.suggestedQuantity == null || item.suggestedQuantity <= 0) return;
    updateEdit(item.productId, { qty: String(item.suggestedQuantity), acceptedSuggestion: true });
  };

  // Aceita todas as sugestoes pendentes de uma vez (bulk).
  const acceptAllSuggestions = () => {
    if (!report) return;
    setEdits((prev) => {
      const next = { ...prev };
      for (const item of report.items) {
        if (item.suggestedQuantity == null || item.suggestedQuantity <= 0) continue;
        if (removedIds.has(item.productId)) continue;
        if (generatedByProduct[item.productId]) continue;
        const current = next[item.productId] ?? { qty: "", model: defaultModel(item), supplierId: null, note: "" };
        if (current.qty !== "") continue; // ja tem valor, nao sobrescreve
        next[item.productId] = { ...current, qty: String(item.suggestedQuantity), acceptedSuggestion: true };
      }
      return next;
    });
  };

  // Conta itens com sugestao pendente de aceite (respeita removidos/gerados).
  const pendingSuggestionCount = useMemo(() => {
    if (!report) return 0;
    let n = 0;
    for (const item of report.items) {
      if (item.suggestedQuantity == null || item.suggestedQuantity <= 0) continue;
      if (removedIds.has(item.productId)) continue;
      if (generatedByProduct[item.productId]) continue;
      if ((edits[item.productId]?.qty ?? "") !== "") continue;
      n += 1;
    }
    return n;
  }, [report, edits, removedIds, generatedByProduct]);

  const sectors = useMemo(
    () => Array.from(new Set((report?.items ?? []).map((item) => item.sectorName).filter(Boolean))) as string[],
    [report]
  );
  const suppliers = useMemo(
    () => Array.from(new Set((report?.items ?? []).map((item) => item.supplierName).filter(Boolean))) as string[],
    [report]
  );

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (report?.items ?? []).filter((item) => {
      if (removedIds.has(item.productId)) return false;
      if (term && !`${item.productName} ${item.productCode ?? ""}`.toLowerCase().includes(term)) return false;
      if (sectorFilter && item.sectorName !== sectorFilter) return false;
      if (supplierFilter && item.supplierName !== supplierFilter) return false;
      if (onlySuggested && !(item.suggestedQuantity && item.suggestedQuantity > 0)) return false;
      if (onlyWithoutSupplier && item.supplierId) return false;
      if (onlyCheaper && !item.hasCheaperAlternative) return false;
      if (onlyBelowMin && !item.alerts.includes("ABAIXO DO MINIMO")) return false;
      return true;
    });
  }, [report, search, sectorFilter, supplierFilter, onlySuggested, onlyWithoutSupplier, onlyCheaper, onlyBelowMin, removedIds]);

  // Rascunho local pronto para a Etapa 4 (nao envia nada agora). Um item entra no pedido
  // quando tem quantidade > 0 e fornecedor escolhido. Itens sem fornecedor ficam de fora.
  const draft = useMemo(() => {
    const draftItems = (report?.items ?? []).flatMap((item) => {
      if (removedIds.has(item.productId)) return [];
      if (generatedByProduct[item.productId]) return [];
      const edit = edits[item.productId];
      const supplierId = chosenSupplierOf(item, edit);
      const requestedQuantity = Number(edit?.qty ?? "");
      if (!(requestedQuantity > 0) || !supplierId) return [];
      return [{
        productId: item.productId,
        supplierId,
        requestedQuantity,
        purchaseModel: edit?.model ?? defaultModel(item),
        unitSnapshot: item.unit,
        notes: edit?.note ?? "",
        unitPriceEstimated: unitPriceForSupplier(item, supplierId)
      }];
    });
    return { sourceType, sourceId, items: draftItems, supplierCount: new Set(draftItems.map((i) => i.supplierId)).size };
  }, [report, edits, sourceType, sourceId, removedIds, generatedByProduct]);

  // Itens visiveis mas ignorados do pedido: sem quantidade valida ou sem fornecedor escolhido.
  // Removidos e ja gerados NAO contam como ignorados (nao estao "abertos" para decisao).
  const generatedCount = Object.keys(generatedByProduct).length;
  const activeCount = (report?.items.length ?? 0) - removedIds.size - generatedCount;
  const skippedCount = activeCount - draft.items.length;

  const draftEstimatedTotal = useMemo(
    () => draft.items.reduce((sum, item) => sum + (item.unitPriceEstimated != null ? item.unitPriceEstimated * item.requestedQuantity : 0), 0),
    [draft]
  );

  // Detalhamento por fornecedor (nomes vem de supplierNameById mais abaixo, resolvido via lookup no render).
  const draftBySupplier = useMemo(() => {
    const map = new Map<string, { supplierId: string; totalItems: number; totalEstimated: number }>();
    for (const item of draft.items) {
      const group = map.get(item.supplierId) ?? { supplierId: item.supplierId, totalItems: 0, totalEstimated: 0 };
      group.totalItems += 1;
      if (item.unitPriceEstimated != null) group.totalEstimated += item.unitPriceEstimated * item.requestedQuantity;
      map.set(item.supplierId, group);
    }
    return Array.from(map.values()).sort((a, b) => b.totalEstimated - a.totalEstimated);
  }, [draft]);

  // Contadores separados: quantos itens sem fornecedor vs quantos com quantidade zero (dentre os visiveis).
  const skippedBreakdown = useMemo(() => {
    let noSupplier = 0;
    let zeroQty = 0;
    for (const item of report?.items ?? []) {
      if (removedIds.has(item.productId)) continue;
      if (generatedByProduct[item.productId]) continue;
      const edit = edits[item.productId];
      const supplierId = chosenSupplierOf(item, edit);
      const qty = Number(edit?.qty ?? "");
      if (!(qty > 0)) { zeroQty += 1; continue; }
      if (!supplierId) { noSupplier += 1; continue; }
    }
    return { noSupplier, zeroQty };
  }, [report, edits, removedIds, generatedByProduct]);

  const canGenerate = draft.items.length > 0 && !generating;

  const handleGenerate = async () => {
    if (!canGenerate || generating) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const itemsSent = draft.items;
      const result = await createPurchaseOrdersFromPlanning({
        sourceType,
        sourceId,
        items: itemsSent.map((item) => ({
          productId: item.productId,
          supplierId: item.supplierId,
          requestedQuantity: item.requestedQuantity,
          purchaseModel: item.purchaseModel,
          unitSnapshot: item.unitSnapshot,
          unitPriceEstimated: item.unitPriceEstimated,
          notes: item.notes || null
        }))
      });
      // Marca cada item enviado com o codigo do pedido correspondente (por fornecedor)
      // para bloquear geracao duplicada ate o comprador clicar "Refazer".
      const codeBySupplier = new Map(result.createdOrders.map((o) => [o.supplierId, o.code]));
      setGeneratedByProduct((prev) => {
        const next = { ...prev };
        for (const item of itemsSent) {
          const code = codeBySupplier.get(item.supplierId);
          if (code) next[item.productId] = code;
        }
        return next;
      });
      setGeneratedResult(result);
      setConfirmOpen(false);
      // So rola se o topo do painel estiver fora do viewport atual.
      // Em telas grandes (>=1440px) o painel geralmente ja e visivel — evita "pulo" desnecessario.
      setTimeout(() => {
        const el = generatedPanelRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const alreadyVisible = rect.top >= 0 && rect.top < window.innerHeight;
        if (!alreadyVisible) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    } catch (err: unknown) {
      setGenerateError(err instanceof Error ? err.message : "Não foi possível gerar os pedidos de compra.");
    } finally {
      setGenerating(false);
    }
  };

  // KPIs a partir do payload (nao inventar numeros). Removidos pelo comprador
  // saem dos contadores para manter coerencia com a lista/draft.
  const kpis = useMemo(() => {
    const items = (report?.items ?? []).filter((item) => !removedIds.has(item.productId));
    let estimated = 0;
    let hasEstimate = false;
    for (const item of items) {
      const edit = edits[item.productId];
      const qty = Number(edit?.qty || 0);
      const price = unitPriceForSupplier(item, chosenSupplierOf(item, edit));
      if (qty > 0 && price != null) {
        estimated += qty * price;
        hasEstimate = true;
      }
    }
    return {
      analyzed: items.length,
      withSuggestion: items.filter((item) => item.suggestedQuantity && item.suggestedQuantity > 0).length,
      belowMin: items.filter((item) => item.alerts.includes("ABAIXO DO MINIMO")).length,
      withoutSupplier: items.filter((item) => !item.supplierId).length,
      cheaper: items.filter((item) => item.hasCheaperAlternative).length,
      reviewUnit: items.filter((item) => item.conversionMissing).length,
      estimated: hasEstimate ? estimated : null
    };
  }, [report, edits, removedIds]);

  // Nome do fornecedor por id: base ativa + fallback do historico de precos.
  const supplierNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of activeSuppliers) map.set(s.id, s.name);
    for (const item of report?.items ?? []) {
      for (const opt of item.supplierPriceOptions) if (!map.has(opt.supplierId)) map.set(opt.supplierId, opt.supplierName);
    }
    return map;
  }, [activeSuppliers, report]);

  // Visao por fornecedor: reflete a decisao do comprador (fornecedor escolhido no estado local).
  const supplierGroups = useMemo(() => {
    const map = new Map<string, { name: string; noSupplier: boolean; items: BuyerSupportItem[]; subtotal: number; hasEstimate: boolean }>();
    for (const item of filteredItems) {
      const edit = edits[item.productId];
      const supplierId = chosenSupplierOf(item, edit);
      const key = supplierId ?? "__none__";
      const name = supplierId
        ? supplierNameById.get(supplierId)
          ?? item.supplierPriceOptions.find((opt) => opt.supplierId === supplierId)?.supplierName
          ?? item.supplierName
        : "Sem fornecedor selecionado";
      const group = map.get(key) ?? { name, noSupplier: !supplierId, items: [], subtotal: 0, hasEstimate: false };
      group.items.push(item);
      const qty = Number(edit?.qty || 0);
      const price = unitPriceForSupplier(item, supplierId);
      if (qty > 0 && price != null) {
        group.subtotal += qty * price;
        group.hasEstimate = true;
      }
      map.set(key, group);
    }
    // Fornecedores primeiro, "Sem fornecedor selecionado" por ultimo.
    return Array.from(map.values()).sort((a, b) => {
      if (a.noSupplier !== b.noSupplier) return a.noSupplier ? 1 : -1;
      return b.items.length - a.items.length;
    });
  }, [filteredItems, edits, supplierNameById]);

  const goBack = () => window.history.back();

  const futureNote = "Disponível na próxima etapa. Nenhum pedido será criado agora.";

  return (
    <div className="pplan">
      <header className="pplan-hero">
        <div className="pplan-header">
          <div className="pplan-header-main">
            <p className="pplan-eyebrow">Estoque</p>
            <h1>Planejamento de compra</h1>
            <p className="pplan-origin">
              {report
                ? `Origem: ${report.summary.source.code ?? "—"} · ${sourceTitle(report.summary.source)} · ${formatNumber(report.summary.source.totalItems)} itens`
                : "Carregando origem…"}
            </p>
          </div>
          <div className="pplan-header-actions">
            <button type="button" className="secondary-button" onClick={goBack}>
              <ArrowLeft size={16} /> Voltar
            </button>
            <button
              type="button"
              className="secondary-button pplan-accept-all"
              disabled={pendingSuggestionCount === 0}
              onClick={acceptAllSuggestions}
              title={pendingSuggestionCount > 0
                ? `Preenche a quantidade sugerida em ${pendingSuggestionCount} item(ns) que ainda não foram decididos.`
                : "Nenhuma sugestão pendente."}
            >
              <CheckCircle2 size={16} />{" "}
              Aceitar todas as sugestões{pendingSuggestionCount > 0 ? ` (${formatNumber(pendingSuggestionCount)})` : ""}
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!canGenerate}
              title={
                canGenerate
                  ? undefined
                  : draft.items.length === 0 && generatedCount > 0
                    ? "Nenhum item pronto para gerar. Use \"Refazer este item\" nos cards já enviados para reabrir edição."
                    : "Escolha quantidade e fornecedor de pelo menos um item."
              }
              onClick={() => setConfirmOpen(true)}
            >
              <ShoppingCart size={16} />{" "}
              {draft.items.length === 0 && generatedCount > 0
                ? "Nenhum item pronto"
                : "Gerar pedidos por fornecedor"}
            </button>
          </div>
        </div>
        {report?.summary.source.partial && (
          <div className="pplan-origin-alert">
            <AlertTriangle size={15} />
            Planejamento baseado em contagem parcial/setorial
            {report.summary.source.scopeLabel ? `: ${report.summary.source.scopeLabel}` : ""}.
          </div>
        )}
        {kpis.withoutSupplier > 0 && (
          <div className="pplan-origin-alert pplan-origin-alert--danger">
            <AlertTriangle size={15} />
            {formatNumber(kpis.withoutSupplier)} produto(s) sem fornecedor escolhido — não entrarão no pedido até que um fornecedor seja definido.
          </div>
        )}
      </header>

      {loading && <p className="pplan-muted">Carregando planejamento de compra…</p>}
      {error && (
        <div className="pplan-alert pplan-alert--danger">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {report && !loading && (
        <>
          <section className="pplan-kpi-panel" aria-label="Resumo do planejamento">
            <div className="pplan-kpi-card">
              <span className="pplan-kpi-label">Produtos analisados</span>
              <strong className="pplan-kpi-value">{formatNumber(kpis.analyzed)}</strong>
            </div>
            <div className="pplan-kpi-card">
              <span className="pplan-kpi-label">Com sugestão</span>
              <strong className="pplan-kpi-value">{formatNumber(kpis.withSuggestion)}</strong>
            </div>
            <div className={`pplan-kpi-card${kpis.belowMin ? " is-warning" : ""}`}>
              <span className="pplan-kpi-label">Abaixo do mínimo</span>
              <strong className="pplan-kpi-value">{formatNumber(kpis.belowMin)}</strong>
            </div>
            <div className={`pplan-kpi-card${kpis.withoutSupplier ? " is-danger" : ""}`}>
              <span className="pplan-kpi-label">Sem fornecedor</span>
              <strong className="pplan-kpi-value">{formatNumber(kpis.withoutSupplier)}</strong>
            </div>
            <div className="pplan-kpi-card">
              <span className="pplan-kpi-label">Menor preço alternativo</span>
              <strong className="pplan-kpi-value">{formatNumber(kpis.cheaper)}</strong>
            </div>
            <div className={`pplan-kpi-card${kpis.reviewUnit ? " is-warning" : ""}`}>
              <span className="pplan-kpi-label">Revisar unidade</span>
              <strong className="pplan-kpi-value">{formatNumber(kpis.reviewUnit)}</strong>
              <small className="pplan-kpi-sub">preço sem conversão de unidade</small>
            </div>
            <div className={`pplan-kpi-card${draft.items.length > 0 ? " is-ready" : ""}`}>
              <span className="pplan-kpi-label">Prontos para pedir</span>
              <strong className="pplan-kpi-value">
                {draft.items.length > 0 ? `${formatNumber(draft.items.length)} itens` : "—"}
              </strong>
              <small className="pplan-kpi-sub">
                {draft.items.length > 0
                  ? `${formatNumber(draft.supplierCount)} fornecedor${draft.supplierCount === 1 ? "" : "es"}${draftEstimatedTotal > 0 ? ` · ${formatCurrency(draftEstimatedTotal)}` : ""}`
                  : "aguardando decisões"}
              </small>
            </div>
            <div className="pplan-kpi-card is-strong pplan-kpi-card--wide">
              <span className="pplan-kpi-label">Custo estimado</span>
              <strong className="pplan-kpi-value">{kpis.estimated != null ? formatCurrency(kpis.estimated) : "—"}</strong>
              <small className="pplan-kpi-sub">estimativa baseada nas quantidades sugeridas/preenchidas</small>
            </div>
          </section>

          <section className="pplan-filter-bar">
            <div className="pplan-search">
              <Search size={16} />
              <input
                type="text"
                placeholder="Buscar produto ou código"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <select value={sectorFilter} onChange={(event) => setSectorFilter(event.target.value)} aria-label="Setor">
              <option value="">Todos os setores</option>
              {sectors.map((sector) => (
                <option key={sector} value={sector}>{sector}</option>
              ))}
            </select>
            <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)} aria-label="Fornecedor sugerido">
              <option value="">Todos os fornecedores</option>
              {suppliers.map((supplier) => (
                <option key={supplier} value={supplier}>{supplier}</option>
              ))}
            </select>
            <div className="pplan-view-toggle" role="tablist" aria-label="Alternar visão">
              <button type="button" role="tab" aria-selected={view === "product"} className={view === "product" ? "active" : ""} onClick={() => setView("product")}>Por produto</button>
              <button type="button" role="tab" aria-selected={view === "supplier"} className={view === "supplier" ? "active" : ""} onClick={() => setView("supplier")}>Por fornecedor</button>
            </div>
          </section>

          <section className="pplan-chips">
            <label className={onlySuggested ? "active" : ""}><input type="checkbox" checked={onlySuggested} onChange={(event) => setOnlySuggested(event.target.checked)} /> Com sugestão</label>
            <label className={onlyWithoutSupplier ? "active" : ""}><input type="checkbox" checked={onlyWithoutSupplier} onChange={(event) => setOnlyWithoutSupplier(event.target.checked)} /> Sem fornecedor</label>
            <label className={onlyCheaper ? "active" : ""}><input type="checkbox" checked={onlyCheaper} onChange={(event) => setOnlyCheaper(event.target.checked)} /> Menor preço alternativo</label>
            <label className={onlyBelowMin ? "active" : ""}><input type="checkbox" checked={onlyBelowMin} onChange={(event) => setOnlyBelowMin(event.target.checked)} /> Abaixo do mínimo</label>
          </section>

          {removedIds.size > 0 && (
            <div className="pplan-removed-bar">
              <span><Trash2 size={14} /> {formatNumber(removedIds.size)} item(ns) removido(s) desta compra.</span>
              <button type="button" className="secondary-button" onClick={restoreAll}>
                <RotateCcw size={14} /> Restaurar todos
              </button>
            </div>
          )}

          {filteredItems.length === 0 ? (
            <EmptyState title="Nenhum produto com os filtros atuais" description="Ajuste a busca ou os filtros para ver itens para planejar." />
          ) : view === "product" ? (
            <section className="pplan-decision-list">
              {filteredItems.map((item) => (
                <DecisionCard
                  key={item.productId}
                  item={item}
                  edit={edits[item.productId]}
                  onChange={(patch) => updateEdit(item.productId, patch)}
                  onRemove={() => removeItem(item.productId, item.productName)}
                  generatedOrderCode={generatedByProduct[item.productId] ?? null}
                  onRedo={() => redoItem(item.productId)}
                  onAcceptSuggestion={() => acceptSuggestion(item)}
                  suppliers={activeSuppliers}
                />
              ))}
            </section>
          ) : (
            <section className="pplan-suppliers">
              {supplierGroups.map((group, index) => (
                <details key={group.name + index} className="pplan-supplier-group" open>
                  <summary>
                    <span className="pplan-supplier-name">{group.name}</span>
                    <span className="pplan-supplier-meta">
                      {formatNumber(group.items.length)} itens
                      {group.hasEstimate ? ` · ${formatCurrency(group.subtotal)}` : ""}
                    </span>
                  </summary>
                  <div className="pplan-supplier-items">
                    {group.items.map((item) => {
                      const edit = edits[item.productId];
                      const qty = Number(edit?.qty || 0);
                      const price = unitPriceForSupplier(item, chosenSupplierOf(item, edit));
                      return (
                        <div key={item.productId} className="pplan-supplier-row">
                          <span className="pplan-supplier-row-name" title={item.productName}>{item.productName}</span>
                          <span className="pplan-supplier-row-qty">
                            {qty > 0 ? `${formatNumber(qty)} ${edit?.model ?? item.unit ?? ""}` : "—"}
                            {qty > 0 && price != null ? ` · ${formatCurrency(qty * price)}` : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {!group.noSupplier && (
                    <div className="pplan-supplier-foot">
                      <button type="button" className="secondary-button" disabled title={futureNote}>
                        <FileText size={15} /> Gerar PDF deste fornecedor
                      </button>
                    </div>
                  )}
                </details>
              ))}
            </section>
          )}

          <section className="pplan-actions">
            <p className="pplan-muted">
              {draft.items.length > 0
                ? `${formatNumber(draft.items.length)} itens prontos para pedido em ${formatNumber(draft.supplierCount)} fornecedor(es) — clique em "Gerar pedidos por fornecedor" para criar os rascunhos.`
                : "Nenhum item com quantidade e fornecedor definidos ainda."}
            </p>
            <div className="pplan-actions-buttons">
              <button type="button" className="secondary-button" disabled title={futureNote}>
                <FileText size={16} /> Gerar PDF por fornecedor
              </button>
            </div>
          </section>

          {generatedResult && (
            <GeneratedPanel
              ref={generatedPanelRef}
              result={generatedResult}
            />
          )}
        </>
      )}

      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Confirmar geração de pedidos"
        description="Revise o resumo antes de criar os pedidos de compra."
      >
        <div className="pplan-confirm-body">
          <dl className="pplan-confirm-grid">
            <div><dt>Origem</dt><dd>{report ? sourceTitle(report.summary.source) : "—"}</dd></div>
            <div><dt>Pedidos a criar</dt><dd>{formatNumber(draft.supplierCount)}</dd></div>
            <div><dt>Fornecedores</dt><dd>{formatNumber(draft.supplierCount)}</dd></div>
            <div><dt>Itens válidos</dt><dd>{formatNumber(draft.items.length)}</dd></div>
            <div><dt>Sem fornecedor</dt><dd>{formatNumber(skippedBreakdown.noSupplier)}</dd></div>
            <div><dt>Quantidade zero</dt><dd>{formatNumber(skippedBreakdown.zeroQty)}</dd></div>
            <div><dt>Removidos</dt><dd>{formatNumber(removedIds.size)}</dd></div>
            <div className="pplan-confirm-total"><dt>Total estimado</dt><dd>{formatCurrency(draftEstimatedTotal)}</dd></div>
          </dl>

          {draftBySupplier.length > 0 && (
            <div className="pplan-confirm-suppliers" aria-label="Distribuição por fornecedor">
              <h4>Distribuição por fornecedor</h4>
              <ul>
                {draftBySupplier.map((group) => {
                  const name = supplierNameById.get(group.supplierId) ?? "Fornecedor";
                  return (
                    <li key={group.supplierId}>
                      <span className="pplan-confirm-supplier-name">{name}</span>
                      <span className="pplan-confirm-supplier-meta">
                        {formatNumber(group.totalItems)} item(ns) · {group.totalEstimated > 0 ? formatCurrency(group.totalEstimated) : "—"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="pplan-alert pplan-alert--warning pplan-confirm-warning">
            <AlertTriangle size={15} />
            <ul>
              <li>Os pedidos serão criados como RASCUNHO.</li>
              <li>Itens sem fornecedor não serão gerados.</li>
              <li>Itens com quantidade zero serão ignorados.</li>
              <li>Itens removidos da lista não serão gerados.</li>
              <li>Revise antes de enviar ao fornecedor.</li>
            </ul>
          </div>
          {generateError && (
            <div className="pplan-alert pplan-alert--danger">
              <AlertTriangle size={16} /> {generateError}
            </div>
          )}
          <div className="pplan-confirm-actions">
            <button type="button" className="secondary-button" onClick={() => setConfirmOpen(false)} disabled={generating}>
              Cancelar
            </button>
            <button type="button" className="primary-button" onClick={handleGenerate} disabled={generating}>
              {generating ? "Gerando…" : `Gerar ${formatNumber(draft.supplierCount)} pedido${draft.supplierCount === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </Dialog>

      {draft.items.length > 0 && (
        <div className="pplan-sticky-actions" role="region" aria-label="Ações de geração de pedidos">
          <p className="pplan-sticky-count">
            <strong>{formatNumber(draft.items.length)} itens</strong> prontos em{" "}
            <strong>{formatNumber(draft.supplierCount)} fornecedor{draft.supplierCount === 1 ? "" : "es"}</strong>
            {draftEstimatedTotal > 0 && <> · {formatCurrency(draftEstimatedTotal)}</>}
          </p>
          <button
            type="button"
            className="primary-button"
            disabled={!canGenerate}
            onClick={() => setConfirmOpen(true)}
          >
            <ShoppingCart size={16} /> Gerar {formatNumber(draft.supplierCount)} pedido{draft.supplierCount === 1 ? "" : "s"}
          </button>
        </div>
      )}

      {undoToast && (
        <div className="pplan-undo-toast" role="status" aria-live="polite">
          <span><Trash2 size={14} /> Produto removido da lista: <strong>{undoToast.productName}</strong></span>
          <div className="pplan-undo-toast-actions">
            <button type="button" className="pplan-undo-button" onClick={undoRemove}>
              <RotateCcw size={13} /> Desfazer
            </button>
            <button type="button" className="pplan-undo-close" onClick={() => { clearUndoTimer(); setUndoToast(null); }} aria-label="Fechar aviso">
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type LineProps = {
  item: BuyerSupportItem;
  edit: LineEdit | undefined;
  onChange: (patch: Partial<LineEdit>) => void;
};

function QtyInput({ item, edit, onChange }: LineProps) {
  return (
    <input
      className="pplan-qty-input"
      type="text"
      inputMode="decimal"
      placeholder="0"
      aria-label={`Quantidade a pedir de ${item.productName}`}
      value={edit?.qty ?? ""}
      onChange={(event) => onChange({ qty: event.target.value })}
    />
  );
}

function ModelSelect({ item, edit, onChange }: LineProps) {
  return (
    <select className="pplan-model-select" aria-label="Modelo de compra" value={edit?.model ?? defaultModel(item)} onChange={(event) => onChange({ model: event.target.value })}>
      {PURCHASE_MODELS.map((model) => (
        <option key={model} value={model}>{model}</option>
      ))}
    </select>
  );
}

type SupplierBlockProps = LineProps & { suppliers: Supplier[] };

// Fornecedor: chips leves de ranking + combobox local buscavel (input + lista filtrada)
// substituindo o select nativo que abre tela cheia em mobile.
function SupplierBlock({ item, edit, onChange, suppliers }: SupplierBlockProps) {
  const chosen = chosenSupplierOf(item, edit);
  const recommended = recommendedSuppliers(item);
  const chosenName = chosen
    ? suppliers.find((s) => s.id === chosen)?.name
      ?? item.supplierPriceOptions.find((opt) => opt.supplierId === chosen)?.supplierName
      ?? item.supplierName
    : "";

  const rankLabel = (i: number) => (i === 0 ? "#1 Recomendado" : `#${i + 1} Alternativa`);
  const chipHint = (opt: BuyerSupportItem["supplierPriceOptions"][number], i: number) => {
    if (i === 0) return `${formatCurrency(opt.bestUnitPrice)} · menor preço`;
    if (opt.lastUnitPrice != null) return `último ${formatCurrency(opt.lastUnitPrice)}`;
    return "histórico recente";
  };

  return (
    <div className="pplan-supplier-block">
      {chosen ? (
        <div className="pplan-supplier-current">
          <span className="pplan-supplier-current-label">Escolhido</span>
          <span className="pplan-supplier-current-name" title={chosenName}>{chosenName}</span>
          <button type="button" className="pplan-supplier-clear" onClick={() => onChange({ supplierId: null })} aria-label="Limpar fornecedor">
            <X size={13} />
          </button>
        </div>
      ) : (
        <div className="pplan-supplier-empty">
          <AlertTriangle size={13} /> Sem fornecedor escolhido — o item não entrará no pedido.
        </div>
      )}

      {recommended.length > 0 ? (
        <div className="pplan-rec-chips">
          {recommended.map((opt, i) => {
            const inactive = suppliers.length > 0 && !suppliers.some((s) => s.id === opt.supplierId);
            return (
              <button
                key={opt.supplierId}
                type="button"
                className={`pplan-rec-chip${chosen === opt.supplierId ? " is-selected" : ""}${i === 0 ? " is-top" : ""}`}
                onClick={() => onChange({ supplierId: opt.supplierId })}
                title={`${opt.supplierName} · ${formatNumber(opt.purchaseCount)} compra(s)`}
              >
                <span className="pplan-rec-rank">{rankLabel(i)}{inactive ? " · inativo" : ""}</span>
                <span className="pplan-rec-name">{opt.supplierName}</span>
                <span className="pplan-rec-price">{chipHint(opt, i)}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <span className="pplan-no-supplier"><PackageSearch size={13} /> Sem histórico de fornecedor para este produto</span>
      )}

      <SupplierCombobox
        chosen={chosen}
        suppliers={suppliers}
        onSelect={(id) => onChange({ supplierId: id })}
      />
    </div>
  );
}

// Combobox local: input com busca + lista filtrada dos ativos. Substitui o select
// nativo que abria uma tela gigante em mobile. Sem dependencia nova.
function SupplierCombobox({ chosen, suppliers, onSelect }: { chosen: string | null; suppliers: Supplier[]; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const closeAndFocusToggle = () => {
    setOpen(false);
    setQuery("");
    setTimeout(() => toggleRef.current?.focus(), 0);
  };
  useEffect(() => {
    if (!open) return;
    const clickHandler = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndFocusToggle();
      }
    };
    window.addEventListener("mousedown", clickHandler);
    window.addEventListener("keydown", keyHandler);
    return () => {
      window.removeEventListener("mousedown", clickHandler);
      window.removeEventListener("keydown", keyHandler);
    };
  }, [open]);
  const term = query.trim().toLowerCase();
  // Filtra a lista inteira e so entao limita a 40 para renderizacao.
  const matched = term
    ? suppliers.filter((s) => s.name.toLowerCase().includes(term))
    : suppliers;
  const filtered = matched.slice(0, 40);
  const hasMore = matched.length > filtered.length;
  return (
    <div className={`pplan-supplier-combo${open ? " is-open" : ""}`} ref={containerRef}>
      <button ref={toggleRef} type="button" className="pplan-supplier-combo-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Search size={13} /> {chosen ? "Trocar fornecedor" : "Escolher fornecedor"}
      </button>
      {open && (
        <div className="pplan-supplier-combo-panel" role="listbox">
          <input
            autoFocus
            className="pplan-supplier-combo-search"
            type="text"
            placeholder="Buscar fornecedor"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="pplan-supplier-combo-list">
            {filtered.length === 0 && <div className="pplan-supplier-combo-empty">Nenhum fornecedor encontrado.</div>}
            {filtered.map((s) => (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={chosen === s.id}
                className={`pplan-supplier-combo-option${chosen === s.id ? " is-selected" : ""}`}
                onClick={() => { onSelect(s.id); closeAndFocusToggle(); }}
              >
                {s.name}
              </button>
            ))}
          </div>
          {hasMore && (
            <div className="pplan-supplier-combo-more" aria-live="polite">
              Mostrando {formatNumber(filtered.length)} de {formatNumber(matched.length)} — refine a busca
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Preço auxiliar: menor preço + último preço + aviso de unidade. Nunca compete com o produto.
function PriceRef({ item }: { item: BuyerSupportItem }) {
  const parts: string[] = [];
  if (item.bestUnitPrice != null) parts.push(`Menor ${formatCurrency(item.bestUnitPrice)}`);
  if (item.lastUnitPrice != null) parts.push(`Último ${formatCurrency(item.lastUnitPrice)}${item.lastPurchaseDate ? ` em ${formatDate(item.lastPurchaseDate)}` : ""}`);
  return (
    <div className="pplan-price-ref">
      {parts.length > 0 ? (
        <span className="pplan-price-ref-line" title={item.priceComparisonNote ?? undefined}>{parts.join(" · ")}</span>
      ) : (
        <span className="pplan-price-ref-line pplan-muted">Sem histórico de preço</span>
      )}
      {item.conversionMissing && (
        <span className="pplan-price-ref-warn"><AlertTriangle size={11} /> Revisar unidade</span>
      )}
    </div>
  );
}

// Cartao compacto de 4 linhas: (1) produto + botao Nao comprar,
// (2) Tem/Pedir/Modelo/Status, (3) Fornecedor, (4) Preco + Obs (colapsavel).
// Quando um item ja foi enviado como pedido, o card fica bloqueado com chip verde
// mostrando o codigo do pedido e botao "Refazer" para reabrir edicao.
function DecisionCard({
  item,
  edit,
  onChange,
  onRemove,
  generatedOrderCode,
  onRedo,
  onAcceptSuggestion,
  suppliers
}: LineProps & {
  onRemove: () => void;
  generatedOrderCode: string | null;
  onRedo: () => void;
  onAcceptSuggestion: () => void;
  suppliers: Supplier[];
}) {
  const supplierId = chosenSupplierOf(item, edit);
  // Nao usa suggestedQuantity como fallback — a decisao deve ser explicita do comprador.
  const qty = Number(edit?.qty || 0);
  const status = lineStatus(qty, supplierId, item);
  const meta = [item.sectorName, item.categoryName, item.productCode ? `cód. ${item.productCode}` : null]
    .filter(Boolean)
    .join(" · ");
  const hasNote = !!edit?.note;
  const [showNote, setShowNote] = useState(hasNote);
  const locked = !!generatedOrderCode;

  const suggested = item.suggestedQuantity != null && item.suggestedQuantity > 0 ? Number(item.suggestedQuantity) : null;
  const showSuggestionChip = !locked && suggested != null && (edit?.qty ?? "") === "";
  const showEditedChip = !locked && suggested != null && !!edit?.acceptedSuggestion && edit.qty !== "" && Number(edit.qty) !== suggested;

  return (
    <article className={`pplan-decision-card${!supplierId && !locked ? " is-warning" : ""}${locked ? " is-generated" : ""}`}>
      {locked && (
        <div className="pplan-generated-chip">
          <span className="pplan-generated-chip-mark"><CheckCircle2 size={13} /> Pedido gerado</span>
          <Link className="pplan-generated-chip-code" to={`/compras/pedidos?search=${encodeURIComponent(generatedOrderCode)}`}>
            {generatedOrderCode}
          </Link>
          <button type="button" className="pplan-generated-chip-redo" onClick={onRedo}>
            <RotateCcw size={12} /> Refazer este item
          </button>
        </div>
      )}
      {showSuggestionChip && (
        <div className="pplan-suggestion-chip">
          <span className="pplan-suggestion-chip-label">
            Sugestão: <strong>{formatNumber(suggested!)} {item.unit ?? "un"}</strong>
          </span>
          <button type="button" className="pplan-suggestion-chip-accept" onClick={onAcceptSuggestion}>
            <CheckCircle2 size={12} /> Aceitar sugestão
          </button>
        </div>
      )}
      {showEditedChip && (
        <div className="pplan-suggestion-edited">
          Sugerido {formatNumber(suggested!)} {item.unit ?? "un"} — editado por você
        </div>
      )}
      <fieldset className="pplan-decision-card-fields" disabled={locked}>
      <div className="pplan-card-row pplan-card-row--head">
        <div className="pplan-product-main">
          <h3 className="pplan-product-title" title={item.productName}>{item.productName}</h3>
          <span className="pplan-product-meta">{meta || "—"}</span>
          {item.hasCheaperAlternative && item.bestPriceSupplierName && (
            <span className="pplan-badge pplan-badge--cheaper" title={item.priceComparisonNote ?? undefined}>
              <Tag size={11} /> Menor preço: {item.bestPriceSupplierName} · {formatCurrency(item.bestUnitPrice)}
            </span>
          )}
        </div>
        <button
          type="button"
          className="pplan-remove-button"
          onClick={onRemove}
          title="Não incluir este produto nesta compra (não altera cadastro)"
          aria-label={`Não comprar ${item.productName}`}
        >
          <Trash2 size={14} /> Não comprar
        </button>
      </div>

      <div className="pplan-card-row pplan-card-row--fields">
        <div className="pplan-field pplan-field--have">
          <span>Tem</span>
          <span className="pplan-stock-pill">
            {item.lastQuantity != null ? formatNumber(item.lastQuantity) : "—"}
            {item.unit ? <small>{item.unit}</small> : null}
          </span>
        </div>
        <div className="pplan-field pplan-field--ask">
          <span>Pedir</span>
          <QtyInput item={item} edit={edit} onChange={onChange} />
        </div>
        <div className="pplan-field pplan-field--model">
          <span>Modelo</span>
          <ModelSelect item={item} edit={edit} onChange={onChange} />
        </div>
        <div className="pplan-field pplan-field--status">
          <span>Status</span>
          <StatusBadge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusBadge>
        </div>
      </div>

      <div className="pplan-card-row pplan-card-row--supplier">
        <SupplierBlock item={item} edit={edit} onChange={onChange} suppliers={suppliers} />
      </div>

      <div className="pplan-card-row pplan-card-row--foot">
        <PriceRef item={item} />
        {showNote ? (
          <label className="pplan-note-inline">
            <span>Obs.</span>
            <textarea rows={1} placeholder="Anotação (opcional)" value={edit?.note ?? ""} onChange={(event) => onChange({ note: event.target.value })} />
          </label>
        ) : (
          <button type="button" className="pplan-note-toggle" onClick={() => setShowNote(true)}>
            + Obs.
          </button>
        )}
      </div>
      </fieldset>
    </article>
  );
}

// Painel pos-geracao: cards por pedido + busca simples por codigo/fornecedor.
// Usa Link (SPA) para abrir cada pedido na lista filtrada.
const GeneratedPanel = forwardRef<HTMLElement, { result: PurchaseOrderFromPlanningResult }>(
  function GeneratedPanel({ result }, ref) {
    const [filter, setFilter] = useState("");
    const term = filter.trim().toLowerCase();
    const orders = term
      ? result.createdOrders.filter((o) =>
          `${o.code} ${o.supplierName}`.toLowerCase().includes(term)
        )
      : result.createdOrders;
    return (
      <section ref={ref} className="pplan-generated-panel" aria-label="Pedidos gerados">
        <header className="pplan-generated-header">
          <div>
            <h2 className="pplan-generated-title"><CheckCircle2 size={18} /> Pedidos gerados</h2>
            <p className="pplan-generated-subtitle">
              {formatNumber(result.createdOrders.length)} pedido(s) de compra criado(s) como RASCUNHO.
            </p>
          </div>
          {result.createdOrders.length > 3 && (
            <div className="pplan-generated-filter">
              <Search size={14} />
              <input
                type="text"
                placeholder="Buscar por código ou fornecedor"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                aria-label="Filtrar pedidos gerados"
              />
            </div>
          )}
        </header>
        <div className="pplan-generated-cards">
          {orders.map((order) => (
            <article key={order.id} className="pplan-generated-card">
              <div className="pplan-generated-card-head">
                <span className="pplan-generated-code">{order.code}</span>
                <StatusBadge tone="warning">{order.status}</StatusBadge>
              </div>
              <p className="pplan-generated-supplier">{order.supplierName}</p>
              <dl className="pplan-generated-meta-grid">
                <div><dt>Itens</dt><dd>{formatNumber(order.totalItems)}</dd></div>
                <div><dt>Total estimado</dt><dd>{order.totalEstimated > 0 ? formatCurrency(order.totalEstimated) : "—"}</dd></div>
                <div><dt>Origem</dt><dd>Planejamento de compra</dd></div>
              </dl>
              <div className="pplan-generated-actions">
                <Link className="primary-button" to={`/compras/pedidos?search=${encodeURIComponent(order.code)}`}>
                  <ExternalLink size={14} /> Abrir pedido
                </Link>
                <button type="button" className="secondary-button" disabled title="PDF disponível na próxima etapa.">
                  <FileText size={14} /> PDF em breve
                </button>
              </div>
            </article>
          ))}
        </div>
        {orders.length === 0 && (
          <p className="pplan-muted">Nenhum pedido corresponde ao filtro.</p>
        )}
        {result.skippedItems.length > 0 && (
          <p className="pplan-muted">{formatNumber(result.skippedItems.length)} item(ns) ignorado(s) na geração.</p>
        )}
      </section>
    );
  }
);
