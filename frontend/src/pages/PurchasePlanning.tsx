import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, FileText, PackageSearch, Search, ShoppingCart, Tag } from "lucide-react";
import { StatusBadge, EmptyState } from "../components/ui";
import { getBuyerSupportReport, getSuppliers, type BuyerSupportItem, type BuyerSupportReport, type Supplier } from "../api/client";
import { formatCurrency, formatDate, formatNumber } from "../utils/format";

// Modelos de compra oferecidos ao comprador. Sem conversao automatica nesta etapa.
const PURCHASE_MODELS = ["unidade", "caixa", "saco", "kg", "bandeja", "pacote", "fardo", "outro"] as const;

type PlanningStatus = "PEDIR" | "REVISAR" | "SEM_FORNECEDOR" | "NAO_PEDIR";

type LineEdit = {
  qty: string;
  model: string;
  supplierId: string | null;
  note: string;
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
        // Estado local inicial: qtd = sugestao, modelo = unidade do produto, fornecedor = sugerido.
        const seed: Record<string, LineEdit> = {};
        for (const item of data.items) {
          seed[item.productId] = {
            qty: item.suggestedQuantity != null ? String(item.suggestedQuantity) : "",
            model: defaultModel(item),
            supplierId: item.supplierId ?? item.preferredSupplierId ?? item.bestPriceSupplierId ?? null,
            note: ""
          };
        }
        setEdits(seed);
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
      if (term && !`${item.productName} ${item.productCode ?? ""}`.toLowerCase().includes(term)) return false;
      if (sectorFilter && item.sectorName !== sectorFilter) return false;
      if (supplierFilter && item.supplierName !== supplierFilter) return false;
      if (onlySuggested && !(item.suggestedQuantity && item.suggestedQuantity > 0)) return false;
      if (onlyWithoutSupplier && item.supplierId) return false;
      if (onlyCheaper && !item.hasCheaperAlternative) return false;
      if (onlyBelowMin && !item.alerts.includes("ABAIXO DO MINIMO")) return false;
      return true;
    });
  }, [report, search, sectorFilter, supplierFilter, onlySuggested, onlyWithoutSupplier, onlyCheaper, onlyBelowMin]);

  // Rascunho local pronto para a Etapa 4 (nao envia nada agora). Um item entra no pedido
  // quando tem quantidade > 0 e fornecedor escolhido. Itens sem fornecedor ficam de fora.
  const draft = useMemo(() => {
    const draftItems = (report?.items ?? []).flatMap((item) => {
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
  }, [report, edits, sourceType, sourceId]);

  // KPIs a partir do payload (nao inventar numeros).
  const kpis = useMemo(() => {
    const items = report?.items ?? [];
    let estimated = 0;
    let hasEstimate = false;
    for (const item of items) {
      const edit = edits[item.productId];
      const qty = Number(edit?.qty ?? item.suggestedQuantity ?? 0);
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
  }, [report, edits]);

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
      const qty = Number(edit?.qty ?? item.suggestedQuantity ?? 0);
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
            <button type="button" className="primary-button" disabled title={futureNote}>
              <ShoppingCart size={16} /> Gerar pedidos por fornecedor
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

          {filteredItems.length === 0 ? (
            <EmptyState title="Nenhum produto com os filtros atuais" description="Ajuste a busca ou os filtros para ver itens para planejar." />
          ) : view === "product" ? (
            <section className="pplan-decision-list">
              {filteredItems.map((item) => (
                <DecisionCard key={item.productId} item={item} edit={edits[item.productId]} onChange={(patch) => updateEdit(item.productId, patch)} suppliers={activeSuppliers} />
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
                      const qty = Number(edit?.qty ?? item.suggestedQuantity ?? 0);
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
                ? `${formatNumber(draft.items.length)} itens prontos para pedido em ${formatNumber(draft.supplierCount)} fornecedor(es) — rascunho local, nada é salvo ainda.`
                : "Rascunho apenas nesta tela — nada é salvo no sistema ainda."}
            </p>
            <div className="pplan-actions-buttons">
              <button type="button" className="secondary-button" disabled title={futureNote}>
                <FileText size={16} /> Gerar PDF por fornecedor
              </button>
            </div>
          </section>
        </>
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

// Fornecedor: ranking recomendado (chips) + escolha livre (select da base ativa).
// A recomendacao e apoio; o comprador decide qualquer fornecedor ativo.
function SupplierBlock({ item, edit, onChange, suppliers }: SupplierBlockProps) {
  const chosen = chosenSupplierOf(item, edit);
  const recommended = recommendedSuppliers(item);
  const recIds = new Set(recommended.map((opt) => opt.supplierId));
  const chosenInBase = chosen ? suppliers.some((s) => s.id === chosen) : false;
  const chosenName = chosen
    ? item.supplierPriceOptions.find((opt) => opt.supplierId === chosen)?.supplierName ?? item.supplierName
    : "";

  const rankLabel = (i: number) => (i === 0 ? "#1 Recomendado" : `#${i + 1} Alternativa`);
  const chipHint = (opt: BuyerSupportItem["supplierPriceOptions"][number], i: number) => {
    if (i === 0) return `${formatCurrency(opt.bestUnitPrice)} · menor preço`;
    if (opt.lastUnitPrice != null) return `último ${formatCurrency(opt.lastUnitPrice)}`;
    return "histórico recente";
  };

  return (
    <div className="pplan-supplier-block">
      {recommended.length > 0 ? (
        <div className="pplan-rec-chips">
          {recommended.map((opt, i) => {
            // Marca fornecedor recomendado que nao esta mais na base ativa (so quando a base ja carregou).
            const inactive = suppliers.length > 0 && !suppliers.some((s) => s.id === opt.supplierId);
            return (
              <button
                key={opt.supplierId}
                type="button"
                className={`pplan-rec-chip${chosen === opt.supplierId ? " is-selected" : ""}${i === 0 ? " is-top" : ""}`}
                onClick={() => onChange({ supplierId: opt.supplierId })}
                title={`${opt.supplierName} · ${formatNumber(opt.purchaseCount)} compra(s)`}
              >
                <span className="pplan-rec-rank">
                  {rankLabel(i)}{item.preferredSupplierId === opt.supplierId ? " · Preferencial" : ""}{inactive ? " · inativo" : ""}
                </span>
                <span className="pplan-rec-name">{opt.supplierName}</span>
                <span className="pplan-rec-price">{chipHint(opt, i)}</span>
                {opt.conversionMissing && (
                  <span className="pplan-rec-warn"><AlertTriangle size={10} /> preço sem conversão · revisar unidade</span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <span className="pplan-no-supplier"><PackageSearch size={13} /> Sem histórico de fornecedor para este produto</span>
      )}
      <select
        className="pplan-supplier-select"
        aria-label="Escolher fornecedor"
        value={chosen ?? ""}
        onChange={(event) => onChange({ supplierId: event.target.value || null })}
      >
        <option key="__placeholder" value="">Escolher outro fornecedor</option>
        {chosen && !chosenInBase && <option key="__chosen" value={chosen}>{chosenName}</option>}
        {suppliers.map((s) => (
          <option key={s.id} value={s.id}>{s.name}{recIds.has(s.id) ? " (recomendado)" : ""}</option>
        ))}
      </select>
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

// Bloco de decisao por produto: produto em destaque + controles de compra ao lado.
function DecisionCard({ item, edit, onChange, suppliers }: LineProps & { suppliers: Supplier[] }) {
  const supplierId = chosenSupplierOf(item, edit);
  const qty = Number(edit?.qty ?? item.suggestedQuantity ?? 0);
  const status = lineStatus(qty, supplierId, item);
  const meta = [item.sectorName, item.categoryName, item.productCode ? `cód. ${item.productCode}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="pplan-decision-card">
      <div className="pplan-product-main">
        <h3 className="pplan-product-title" title={item.productName}>{item.productName}</h3>
        <span className="pplan-product-meta">{meta || "—"}</span>
        {item.hasCheaperAlternative && item.bestPriceSupplierName && (
          <span className="pplan-badge pplan-badge--cheaper" title={item.priceComparisonNote ?? undefined}>
            <Tag size={11} /> Menor preço: {item.bestPriceSupplierName} · {formatCurrency(item.bestUnitPrice)}
          </span>
        )}
      </div>

      <div className="pplan-buy-controls">
        <div className="pplan-control pplan-control--have">
          <span>Tem</span>
          <span className="pplan-stock-pill">
            {item.lastQuantity != null ? formatNumber(item.lastQuantity) : "—"}
            {item.unit ? <small>{item.unit}</small> : null}
          </span>
        </div>
        <div className="pplan-control pplan-control--ask">
          <span>Pedir</span>
          <QtyInput item={item} edit={edit} onChange={onChange} />
        </div>
        <div className="pplan-control">
          <span>Modelo</span>
          <ModelSelect item={item} edit={edit} onChange={onChange} />
        </div>
        <div className="pplan-control pplan-control--supplier">
          <span>Fornecedor</span>
          <SupplierBlock item={item} edit={edit} onChange={onChange} suppliers={suppliers} />
        </div>
        <div className="pplan-control pplan-control--price">
          <span>Preço ref.</span>
          <PriceRef item={item} />
        </div>
        <div className="pplan-control pplan-control--status">
          <span>Status</span>
          <StatusBadge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusBadge>
        </div>
        <label className="pplan-control pplan-control--note">
          <span>Obs. do comprador</span>
          <textarea rows={1} placeholder="Anotação (opcional)" value={edit?.note ?? ""} onChange={(event) => onChange({ note: event.target.value })} />
        </label>
      </div>
    </article>
  );
}
