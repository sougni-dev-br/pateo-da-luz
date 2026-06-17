import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  Plus,
  RefreshCw,
  Search,
  Tag,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  assignDRECategory,
  bulkAssignDRECategory,
  downloadDrePdf,
  getDRECategories,
  getDREDrill,
  getDREPending,
  getDRESummary,
  saveDRECategory as saveDRECategoryApi,
  seedDRECategories,
  type DRECategory,
  type DREExpenseGroup,
  type DREPendingRow,
  type DRESummary,
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { useSession } from "../context/SessionContext";
import { formatCurrency, formatDate } from "../utils/format";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type DrillRow = {
  installmentId: string;
  purchaseId: string;
  purchaseDate: string;
  supplierName: string;
  invoiceNumber: string | null;
  purchaseNumber: string | null;
  expenseType: string;
  installment: number | null;
  dueDate: string | null;
  paidDate: string | null;
  amount: number;
  paidAmount: number | null;
  effectiveAmount: number;
  status: string;
  dreCategoryId: string | null;
  dreCategoryName: string;
};

type FilterMode = "month" | "range";
type Mode = "dre" | "categories" | "classify";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const MONTHS = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
];

function pct(v: number | null | undefined, decimals = 1) {
  if (v == null || !isFinite(v)) return "—";
  return `${v.toFixed(decimals)}%`;
}

function safePct(numerator: number, base: number): number | null {
  if (!base || !isFinite(base)) return null;
  return (numerator / base) * 100;
}

function colorClass(v: number) {
  return v > 0 ? "text-success" : v < 0 ? "text-danger" : "";
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    OPEN: "Aberto", PAID: "Pago", PAID_LATE: "Pago c/ atraso",
    OVERDUE: "Vencido", CANCELLED: "Cancelado",
  };
  return map[s] ?? s;
}

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────
// DRE Groups (updated with new groups)
// ─────────────────────────────────────────────

const DRE_GROUPS = [
  { value: "PESSOAL",               label: "Pessoal" },
  { value: "VALE_TRANSPORTE",       label: "Vale-Transporte" },
  { value: "LOCACAO",               label: "Ocupação e Locação" },
  { value: "TARIFAS_BANCARIAS",     label: "Tarifas Bancárias" },
  { value: "TARIFAS_PUBLICAS",      label: "Tarifas Públicas" },
  { value: "IMPOSTOS",              label: "Impostos" },
  { value: "DESPESAS_GERAIS",       label: "Despesas Gerais" },
  { value: "PLANEJAMENTO",          label: "Planejamento" },
  { value: "DESPESAS_OPERACIONAIS", label: "Despesas Diversas" },
  { value: "DEDUCOES",              label: "Deduções de Receita" },
];

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────

export function DRE() {
  const { user } = useSession();
  const canEdit = user?.role === "ADMIN" || user?.role === "GESTAO_COMPLETA";
  const isAdmin = user?.role === "ADMIN";
  const [mode, setMode] = useState<Mode>("dre");
  const now = new Date();

  // Filter state
  const [filterMode, setFilterMode] = useState<FilterMode>("month");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [fromDate, setFromDate] = useState(toDateInput(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [toDate, setToDate] = useState(toDateInput(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
  const [comparatives, setComparatives] = useState(true);

  const [data, setData] = useState<{
    current: DRESummary;
    prevMonth: DRESummary | null;
    prevYear: DRESummary | null;
  } | null>(null);
  const [categories, setCategories] = useState<DRECategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [expandedExpense, setExpandedExpense] = useState<string | null>(null);
  const [drillRows, setDrillRows] = useState<DrillRow[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const { notice, setNotice } = useNotice();

  // AbortError = timeout interno do fetchWithTimeout ou cancelamento do browser.
  // Não exibir como erro vermelho — é uma falha silenciosa de rede/latência.
  function isAbortError(e: unknown): boolean {
    return e instanceof Error && (e.name === "AbortError" || e.message.toLowerCase().includes("aborted"));
  }

  // Carrega apenas as categorias (usado pelo seed e pelo CRUD de categorias).
  // Independente do DRE summary — nunca falha silenciosamente a tabela.
  async function loadCategories() {
    try {
      const cats = await getDRECategories(true);
      setCategories(cats);
    } catch (e) {
      if (!isAbortError(e)) {
        setNotice({ tone: "error", message: "Erro ao carregar categorias DRE." });
      }
    }
  }

  // Carrega DRE summary + categorias usando allSettled:
  // se o summary falhar (lento, timeout, sem dados), as categorias ainda carregam.
  async function load() {
    setLoading(true);
    setLoadError(false);
    try {
      const params =
        filterMode === "month"
          ? { year, month, comparatives }
          : { from: fromDate, to: toDate, comparatives };

      const [summaryResult, catsResult] = await Promise.allSettled([
        getDRESummary(params),
        getDRECategories(true),
      ]);

      if (catsResult.status === "fulfilled") {
        setCategories(catsResult.value);
      } else if (!isAbortError(catsResult.reason)) {
        setNotice({ tone: "error", message: "Erro ao carregar categorias DRE." });
      }

      if (summaryResult.status === "fulfilled") {
        setData(summaryResult.value);
      } else if (!isAbortError(summaryResult.reason)) {
        const msg =
          summaryResult.reason instanceof Error
            ? summaryResult.reason.message
            : "Erro ao carregar resumo do DRE.";
        setNotice({ tone: "error", message: msg });
        setLoadError(true);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [year, month, filterMode, comparatives]);

  function handleFromToLoad() { load(); }

  async function toggleDrill(dreCategoryId: string | null) {
    const key = dreCategoryId ?? "__uncategorized__";
    if (expandedExpense === key) { setExpandedExpense(null); return; }
    setExpandedExpense(key);
    setDrillLoading(true);
    try {
      const params =
        filterMode === "month"
          ? { year, month, dreCategoryId: dreCategoryId ?? undefined }
          : { year: new Date(fromDate).getFullYear(), month: new Date(fromDate).getMonth() + 1, dreCategoryId: dreCategoryId ?? undefined };
      const rows = await getDREDrill(params);
      setDrillRows(rows);
    } catch {
      setNotice({ tone: "error", message: "Erro ao carregar detalhes." });
    } finally {
      setDrillLoading(false);
    }
  }

  async function handleExportPdf() {
    if (!data || loading) return;
    setPdfLoading(true);
    try {
      const pdfParams =
        filterMode === "month"
          ? { year, month }
          : { from: fromDate, to: toDate };
      await downloadDrePdf(pdfParams);
      setNotice({ tone: "success", message: "PDF gerado com sucesso." });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao gerar PDF.";
      setNotice({ tone: "error", message: `Erro ao gerar PDF: ${msg}` });
    } finally {
      setPdfLoading(false);
    }
  }

  async function handleSeed() {
    try {
      const r = await seedDRECategories();
      setNotice({ tone: "success", message: `Seed concluído: ${r.created} criadas, ${r.skipped} já existiam.` });
      await loadCategories();
    } catch (e) {
      setNotice({ tone: "error", message: e instanceof Error ? e.message : "Erro ao criar categorias." });
    }
  }

  const cur = data?.current;
  const pm  = data?.prevMonth;
  const py  = data?.prevYear;

  const periodLabel = filterMode === "month"
    ? `${MONTHS[month - 1]} / ${year}`
    : `${fromDate} → ${toDate}`;

  return (
    <div className="stack">
      <Notice notice={notice} />

      <div className="tabs-row">
        <button className={mode === "dre" ? "active" : ""} type="button" onClick={() => setMode("dre")}>DRE Gerencial</button>
        <button className={mode === "categories" ? "active" : ""} type="button" onClick={() => setMode("categories")}>Categorias DRE</button>
        <button className={mode === "classify" ? "active" : ""} type="button" onClick={() => setMode("classify")}>
          <Tag size={13} style={{ verticalAlign: "middle", marginRight: 4 }} />
          Classificar Despesas
        </button>
      </div>

      {mode === "categories" && (
        <CategoriesPanel
          categories={categories}
          canEdit={canEdit}
          isAdmin={isAdmin}
          onSaved={loadCategories}
          onSeed={handleSeed}
          notify={(t, m) => setNotice({ tone: t, message: m })}
        />
      )}

      {mode === "classify" && (
        <ClassifyPanel
          filterMode={filterMode}
          year={year}
          month={month}
          fromDate={fromDate}
          toDate={toDate}
          categories={categories}
          canEdit={canEdit}
          notify={(t, m) => setNotice({ tone: t, message: m })}
          onClassified={() => { load(); }}
        />
      )}

      {mode === "dre" && (
        <>
          {/* ── Period filter ── */}
          <div className="dre-filter-bar">
            <div className="dre-filter-left">
              <select
                value={filterMode}
                onChange={(e) => setFilterMode(e.target.value as FilterMode)}
                style={{ minWidth: 130 }}
              >
                <option value="month">Mês / Ano</option>
                <option value="range">Período livre</option>
              </select>

              {filterMode === "month" && (
                <>
                  <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                    {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                  </select>
                  <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
                    {Array.from({ length: 5 }, (_, i) => now.getFullYear() - i).map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </>
              )}

              {filterMode === "range" && (
                <>
                  <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                  <span className="text-muted" style={{ alignSelf: "center", whiteSpace: "nowrap" }}>até</span>
                  <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                  <button type="button" className="btn-secondary" onClick={handleFromToLoad}>Atualizar</button>
                </>
              )}

              <label className="dre-comparatives-label">
                <input
                  type="checkbox"
                  checked={comparatives}
                  onChange={(e) => setComparatives(e.target.checked)}
                  style={{ width: "auto", cursor: "pointer" }}
                />
                Comparativos
              </label>
            </div>

            <div className="dre-filter-right">
              <button type="button" className="btn-icon" onClick={load} title="Atualizar DRE">
                <RefreshCw size={15} />
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleExportPdf}
                disabled={loading || !data || pdfLoading}
                title={loading || !data ? "Carregue o DRE antes de exportar" : "Exportar PDF"}
              >
                <Download size={14} /> {pdfLoading ? "Gerando PDF..." : "Exportar PDF"}
              </button>
            </div>
          </div>

          {loading ? (
            <p className="text-muted" style={{ padding: "24px 0", textAlign: "center" }}>
              Carregando DRE... (pode levar alguns segundos)
            </p>
          ) : loadError && !cur ? (
            <div style={{ padding: "32px 0", textAlign: "center" }}>
              <p className="text-muted" style={{ marginBottom: 12 }}>
                Não foi possível carregar o DRE para este período.
              </p>
              <button type="button" className="btn-secondary" onClick={load}>
                <RefreshCw size={14} /> Tentar novamente
              </button>
            </div>
          ) : !cur ? (
            <p className="text-muted" style={{ padding: "24px 0", textAlign: "center" }}>
              Nenhum dado encontrado para este período.
            </p>
          ) : cur ? (
            <>
              {/* ── Aviso receita zero ── */}
              {cur.revenue.grossAmount === 0 && (
                <div className="dre-info-banner">
                  <AlertTriangle size={15} />
                  <span>
                    Não há faturamento lançado neste período. Percentuais e margem não podem ser calculados.
                  </span>
                </div>
              )}

              {/* ── Cards ── */}
              <div className="dre-cards">
                <DRECard
                  label="Receita Bruta"
                  value={cur.revenue.grossAmount}
                  sub={`Líquida: ${formatCurrency(cur.revenue.netAmount)}`}
                />
                <DRECard
                  label="CMV"
                  value={cur.cmv.cmvReal}
                  sub={cur.cmv.cmvPercent != null ? `${pct(cur.cmv.cmvPercent)} da receita` : "sem inventário"}
                  warn={!cur.cmv.hasInventoryData}
                />
                <DRECard
                  label="Lucro Bruto"
                  value={cur.lucroBruto}
                  sub={pct(cur.margemBruta) + " de margem"}
                  signed
                />
                <DRECard
                  label="Total Despesas"
                  value={cur.totalExpenses}
                  sub={pct(safePct(cur.totalExpenses, cur.revenue.grossAmount)) + " da receita"}
                />
                <DRECard
                  label="Lucro Operacional"
                  value={cur.ebitda}
                  sub={pct(cur.ebitdaPercent) + " da receita"}
                  signed
                  highlight
                />
                <DRECard
                  label="Margem Final"
                  value={null}
                  sub={pct(cur.ebitdaPercent)}
                  signed={cur.ebitda >= 0}
                  highlight
                  pctOnly
                />
              </div>

              {/* ── CMV warning ── */}
              {cur.cmv.warning && (
                <div className="dre-cmv-warn">
                  <AlertTriangle size={15} />
                  <span>{cur.cmv.warning}</span>
                </div>
              )}

              {/* ── DRE table ── */}
              <div className="dre-table-wrap">
                <table className="dre-table">
                  <thead>
                    <tr>
                      <th style={{ width: "46%" }}>Linha DRE</th>
                      <th className="text-right">{periodLabel}</th>
                      <th className="text-right dre-pct-col">%</th>
                      {pm && <th className="text-right text-muted">Mês ant.</th>}
                      {py && <th className="text-right text-muted">{filterMode === "month" ? `${MONTHS[month - 1]} ${year - 1}` : "Ano ant."}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {/* ── RECEITAS ── */}
                    <DREGroup label="RECEITAS" />

                    {Object.entries(cur.revenue.byChannel)
                      .sort((a, b) => b[1] - a[1])
                      .map(([ch, val]) => (
                        <DRERow
                          key={ch}
                          label={`  Receita bruta — ${ch}`}
                          cur={val}
                          base={cur.revenue.grossAmount}
                          pm={pm?.revenue.byChannel[ch]}
                          py={py?.revenue.byChannel[ch]}
                          hasPm={!!pm} hasPy={!!py}
                        />
                      ))}

                    <DRERow
                      label="(−) Descontos e taxas de plataforma"
                      cur={-cur.revenue.deductions}
                      base={cur.revenue.grossAmount}
                      pm={pm ? -pm.revenue.deductions : undefined}
                      py={py ? -py.revenue.deductions : undefined}
                      hasPm={!!pm} hasPy={!!py}
                      negative
                    />

                    <DRETotal
                      label="(=) RECEITA LÍQUIDA"
                      cur={cur.revenue.netAmount}
                      base={cur.revenue.grossAmount}
                      pm={pm?.revenue.netAmount}
                      py={py?.revenue.netAmount}
                      hasPm={!!pm} hasPy={!!py}
                    />

                    {/* ── CMV ── */}
                    <DREGroup label={cur.cmv.hasInventoryData ? "CMV REAL (Estoque Inicial + Compras − Estoque Final)" : "CMV POR COMPRAS (sem inventário)"} />

                    <DRERow label="  Estoque inicial"
                      cur={cur.cmv.estoqueInicial} base={cur.revenue.grossAmount}
                      pm={pm?.cmv.estoqueInicial} py={py?.cmv.estoqueInicial}
                      hasPm={!!pm} hasPy={!!py} />
                    <DRERow label="(+) Compras no período"
                      cur={cur.cmv.compras} base={cur.revenue.grossAmount}
                      pm={pm?.cmv.compras} py={py?.cmv.compras}
                      hasPm={!!pm} hasPy={!!py} />
                    <DRERow label="(−) Estoque final"
                      cur={-cur.cmv.estoqueFinal} base={cur.revenue.grossAmount}
                      pm={pm ? -pm.cmv.estoqueFinal : undefined}
                      py={py ? -py.cmv.estoqueFinal : undefined}
                      hasPm={!!pm} hasPy={!!py} negative />

                    <DRETotal
                      label={cur.cmv.hasInventoryData ? "(=) CMV REAL" : "(=) CMV (ESTIMADO — sem inventário)"}
                      cur={cur.cmv.cmvReal}
                      base={cur.revenue.grossAmount}
                      pm={pm?.cmv.cmvReal} py={py?.cmv.cmvReal}
                      hasPm={!!pm} hasPy={!!py}
                      warning
                    />

                    {/* ── LUCRO BRUTO ── */}
                    <DRETotal
                      label="(=) LUCRO BRUTO"
                      cur={cur.lucroBruto}
                      base={cur.revenue.grossAmount}
                      pm={pm?.lucroBruto} py={py?.lucroBruto}
                      hasPm={!!pm} hasPy={!!py}
                      highlight
                    />

                    {/* ── DESPESAS POR GRUPO ── */}
                    <DREGroup label="DESPESAS OPERACIONAIS" />

                    {(cur.expenseGroups ?? []).length === 0 && (
                      <tr className="dre-row">
                        <td colSpan={5} className="text-muted" style={{ fontStyle: "italic", paddingLeft: 24 }}>
                          Nenhuma despesa categorizada no período.
                        </td>
                      </tr>
                    )}

                    {(cur.expenseGroups ?? []).map((grp) => {
                      const isGroupOpen = expandedGroup === grp.key;
                      const pmGrp = pm?.expenseGroups?.find((g) => g.key === grp.key);
                      const pyGrp = py?.expenseGroups?.find((g) => g.key === grp.key);
                      const grpPct = safePct(grp.total, cur.revenue.grossAmount);

                      return (
                        <>
                          {/* Group header row */}
                          <tr
                            key={grp.key}
                            className={`dre-expense-group ${isGroupOpen ? "dre-expanded" : ""}`}
                            onClick={() => {
                              setExpandedGroup(isGroupOpen ? null : grp.key);
                              setExpandedExpense(null);
                            }}
                            style={{ cursor: "pointer" }}
                          >
                            <td>
                              <span className="dre-chevron">
                                {isGroupOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                              </span>
                              <strong>{grp.label}</strong>
                              <span className="dre-group-count"> ({grp.lines.length})</span>
                            </td>
                            <td className="text-right"><strong>{formatCurrency(grp.total)}</strong></td>
                            <td className="text-right dre-pct-col text-muted">{pct(grpPct)}</td>
                            {pm && <td className="text-right text-muted">{pmGrp ? formatCurrency(pmGrp.total) : "—"}</td>}
                            {py && <td className="text-right text-muted">{pyGrp ? formatCurrency(pyGrp.total) : "—"}</td>}
                          </tr>

                          {/* Category lines within group */}
                          {isGroupOpen && grp.lines.map((exp) => {
                            const catKey = exp.dreCategoryId ?? "__uncategorized__";
                            const isExpOpen = expandedExpense === catKey;
                            const expPct = safePct(exp.total, cur.revenue.grossAmount);
                            const pmExp = pm?.expenses.find((e) => e.dreCategoryId === exp.dreCategoryId);
                            const pyExp = py?.expenses.find((e) => e.dreCategoryId === exp.dreCategoryId);

                            return (
                              <>
                                <tr
                                  key={catKey}
                                  className={`dre-expense-row ${isExpOpen ? "dre-expanded" : ""}`}
                                  onClick={() => toggleDrill(exp.dreCategoryId)}
                                  style={{ cursor: "pointer" }}
                                >
                                  <td style={{ paddingLeft: 32 }}>
                                    <span className="dre-chevron">
                                      {isExpOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                                    </span>
                                    {exp.dreCategoryName}
                                  </td>
                                  <td className="text-right">{formatCurrency(exp.total)}</td>
                                  <td className="text-right dre-pct-col text-muted">{pct(expPct)}</td>
                                  {pm && <td className="text-right text-muted">{pmExp ? formatCurrency(pmExp.total) : "—"}</td>}
                                  {py && <td className="text-right text-muted">{pyExp ? formatCurrency(pyExp.total) : "—"}</td>}
                                </tr>

                                {isExpOpen && (
                                  <tr key={`${catKey}-drill`} className="dre-drill-row">
                                    <td colSpan={pm && py ? 5 : pm || py ? 4 : 3}>
                                      <DrillPanel
                                        rows={drillRows}
                                        loading={drillLoading}
                                        categories={categories}
                                        canEdit={canEdit}
                                        onCategoryChanged={() => { load(); setExpandedExpense(null); }}
                                        notify={(t, m) => setNotice({ tone: t, message: m })}
                                      />
                                    </td>
                                  </tr>
                                )}
                              </>
                            );
                          })}
                        </>
                      );
                    })}

                    {/* Uncategorized expenses (not in any group) */}
                    {cur.expenses.filter((e) => e.dreCategoryId === null).length > 0 && (() => {
                      const uncatTotal = cur.expenses
                        .filter((e) => e.dreCategoryId === null)
                        .reduce((s, e) => s + e.total, 0);
                      const uncatKey = "__uncategorized__";
                      const isOpen = expandedExpense === uncatKey;
                      return (
                        <>
                          <tr
                            key={uncatKey}
                            className={`dre-expense-row ${isOpen ? "dre-expanded" : ""}`}
                            onClick={() => toggleDrill(null)}
                            style={{ cursor: "pointer" }}
                          >
                            <td style={{ paddingLeft: 16, fontStyle: "italic" }}>
                              <span className="dre-chevron">{isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</span>
                              Não categorizadas
                            </td>
                            <td className="text-right">{formatCurrency(uncatTotal)}</td>
                            <td className="text-right dre-pct-col text-muted">{pct(safePct(uncatTotal, cur.revenue.grossAmount))}</td>
                            {pm && <td className="text-right text-muted">—</td>}
                            {py && <td className="text-right text-muted">—</td>}
                          </tr>
                          {isOpen && (
                            <tr key="uncat-drill" className="dre-drill-row">
                              <td colSpan={pm && py ? 5 : pm || py ? 4 : 3}>
                                <DrillPanel
                                  rows={drillRows}
                                  loading={drillLoading}
                                  categories={categories}
                                  canEdit={canEdit}
                                  onCategoryChanged={() => { load(); setExpandedExpense(null); }}
                                  notify={(t, m) => setNotice({ tone: t, message: m })}
                                />
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })()}

                    <DRETotal
                      label="(=) TOTAL DE DESPESAS"
                      cur={cur.totalExpenses}
                      base={cur.revenue.grossAmount}
                      pm={pm?.totalExpenses} py={py?.totalExpenses}
                      hasPm={!!pm} hasPy={!!py}
                      warning
                    />

                    {/* ── LUCRO OPERACIONAL ── */}
                    <DRETotal
                      label="(=) LUCRO OPERACIONAL"
                      cur={cur.ebitda}
                      base={cur.revenue.grossAmount}
                      pm={pm?.ebitda} py={py?.ebitda}
                      hasPm={!!pm} hasPy={!!py}
                      highlight strong
                    />
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Card component
// ─────────────────────────────────────────────

function DRECard({
  label, value, sub, signed, highlight, warn, pctOnly,
}: {
  label: string;
  value: number | null;
  sub: string;
  signed?: boolean;
  highlight?: boolean;
  warn?: boolean;
  pctOnly?: boolean;
}) {
  const positive = value == null ? true : value >= 0;
  return (
    <div className={`dre-card${highlight ? " dre-card-highlight" : ""}${warn ? " dre-card-warn" : ""}`}>
      <div className="dre-card-label">{label}</div>
      {pctOnly ? (
        <div className={`dre-card-value${signed ? (positive ? " text-success" : " text-danger") : ""}`}>{sub}</div>
      ) : (
        <>
          <div className={`dre-card-value${signed ? (positive ? " text-success" : " text-danger") : ""}`}>
            {value != null ? formatCurrency(value) : "—"}
          </div>
          <div className="dre-card-sub">{sub}</div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// DRE table sub-components
// ─────────────────────────────────────────────

function DREGroup({ label }: { label: string }) {
  return (
    <tr className="dre-group-row">
      <td colSpan={5}>{label}</td>
    </tr>
  );
}

function DRERow({
  label, cur, base, pm, py, hasPm, hasPy, negative,
}: {
  label: string; cur: number; base: number;
  pm?: number; py?: number;
  hasPm: boolean; hasPy: boolean;
  negative?: boolean;
}) {
  const pctVal = safePct(Math.abs(cur), base);
  return (
    <tr className="dre-row">
      <td>{label}</td>
      <td className={`text-right${negative && cur < 0 ? " text-danger" : ""}`}>{formatCurrency(Math.abs(cur))}</td>
      <td className="text-right dre-pct-col text-muted">{pct(pctVal)}</td>
      {hasPm && <td className="text-right text-muted">{pm != null ? formatCurrency(Math.abs(pm)) : "—"}</td>}
      {hasPy && <td className="text-right text-muted">{py != null ? formatCurrency(Math.abs(py)) : "—"}</td>}
    </tr>
  );
}

function DRETotal({
  label, cur, base, pm, py, hasPm, hasPy, highlight, warning, strong,
}: {
  label: string; cur: number; base: number;
  pm?: number; py?: number;
  hasPm?: boolean; hasPy?: boolean;
  highlight?: boolean; warning?: boolean; strong?: boolean;
}) {
  const cls = highlight ? "dre-total-highlight" : warning ? "dre-total-warning" : "dre-total";
  const pctVal = safePct(Math.abs(cur), base);
  return (
    <tr className={cls}>
      <td><strong>{label}</strong></td>
      <td className={`text-right ${colorClass(cur)}`}><strong>{formatCurrency(cur)}</strong></td>
      <td className="text-right dre-pct-col"><span className={`dre-pct${strong ? " dre-pct-strong" : ""}`}>{pct(pctVal)}</span></td>
      {hasPm && <td className="text-right text-muted">{pm != null ? formatCurrency(pm) : "—"}</td>}
      {hasPy && <td className="text-right text-muted">{py != null ? formatCurrency(py) : "—"}</td>}
    </tr>
  );
}

// ─────────────────────────────────────────────
// Drill panel
// ─────────────────────────────────────────────

function DrillPanel({
  rows, loading, categories, canEdit, onCategoryChanged, notify,
}: {
  rows: DrillRow[]; loading: boolean; categories: DRECategory[];
  canEdit: boolean;
  onCategoryChanged: () => void;
  notify: (tone: "success" | "error", message: string) => void;
}) {
  const [assigning, setAssigning] = useState<string | null>(null);

  async function handleAssign(installmentId: string, catId: string | null) {
    setAssigning(installmentId);
    try {
      await assignDRECategory(installmentId, catId);
      onCategoryChanged();
      notify("success", "Categoria atualizada.");
    } catch {
      notify("error", "Erro ao atualizar categoria.");
    } finally {
      setAssigning(null);
    }
  }

  if (loading) return <p className="text-muted" style={{ padding: "10px 0" }}>Carregando...</p>;
  if (rows.length === 0) return <p className="text-muted" style={{ padding: "10px 0" }}>Nenhum lançamento encontrado.</p>;

  return (
    <table className="data-table" style={{ margin: "4px 0" }}>
      <thead>
        <tr>
          <th>Fornecedor</th>
          <th>NF</th>
          <th className="text-center">Vencimento</th>
          <th className="text-center">Pagamento</th>
          <th className="text-right">Valor</th>
          <th>Status</th>
          {canEdit && <th>Categoria DRE</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.installmentId}>
            <td>
              <div>{r.supplierName}</div>
              {r.purchaseNumber && <div className="text-muted" style={{ fontSize: "0.8em" }}>Pedido: {r.purchaseNumber}</div>}
            </td>
            <td>{r.invoiceNumber ?? "—"}{r.installment != null ? <span className="text-muted"> ({r.installment}ª parc.)</span> : null}</td>
            <td className="text-center">{r.dueDate ? formatDate(r.dueDate) : "—"}</td>
            <td className="text-center">{r.paidDate ? formatDate(r.paidDate) : "—"}</td>
            <td className="text-right">{formatCurrency(r.effectiveAmount)}</td>
            <td>
              <span className={`badge ${r.status === "PAID" || r.status === "PAID_LATE" ? "badge-success" : r.status === "OVERDUE" ? "badge-error" : "badge-neutral"}`}>
                {statusLabel(r.status)}
              </span>
            </td>
            {canEdit && (
              <td>
                <select
                  value={r.dreCategoryId ?? ""}
                  disabled={assigning === r.installmentId}
                  onChange={(e) => handleAssign(r.installmentId, e.target.value || null)}
                  style={{ fontSize: "0.85em", minWidth: 140 }}
                >
                  <option value="">Não categorizada</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </td>
            )}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={canEdit ? 4 : 3}><strong>Total</strong></td>
          <td className="text-right"><strong>{formatCurrency(rows.reduce((s, r) => s + r.effectiveAmount, 0))}</strong></td>
          <td colSpan={canEdit ? 2 : 1}></td>
        </tr>
      </tfoot>
    </table>
  );
}

// ─────────────────────────────────────────────
// Classify panel — classificar despesas não categorizadas
// ─────────────────────────────────────────────

function ClassifyPanel({
  filterMode, year, month, fromDate, toDate,
  categories, canEdit, notify, onClassified,
}: {
  filterMode: FilterMode;
  year: number; month: number;
  fromDate: string; toDate: string;
  categories: DRECategory[];
  canEdit: boolean;
  notify: (tone: "success" | "error", message: string) => void;
  onClassified: () => void;
}) {
  const [rows, setRows] = useState<DREPendingRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"amount_desc" | "amount_asc" | "date_desc" | "date_asc">("amount_desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCatId, setBulkCatId] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Indexar categorias por nome para sugestões
  const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));

  function periodParams() {
    if (filterMode === "month") return { year, month };
    return { from: fromDate, to: toDate };
  }

  async function load(q?: string, s?: string) {
    setLoading(true);
    try {
      const result = await getDREPending({
        ...periodParams(),
        search: q ?? search,
        sort: (s ?? sort) as "amount_desc" | "amount_asc" | "date_desc" | "date_asc",
        perPage: 200,
      });
      setRows(result.rows);
      setTotal(result.total);
      setTotalAmount(result.totalAmount);
      setSelected(new Set());
    } catch {
      notify("error", "Erro ao carregar pendências.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [filterMode, year, month, fromDate, toDate]);

  function handleSearchChange(v: string) {
    setSearch(v);
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => load(v), 400);
  }

  function handleSortChange(v: string) {
    setSort(v as "amount_desc");
    load(search, v);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.installmentId)));
    }
  }

  // Selecionar todos do mesmo fornecedor
  function selectBySupplier(name: string) {
    setSelected(new Set(rows.filter((r) => r.supplierName === name).map((r) => r.installmentId)));
  }

  async function handleBulkAssign() {
    if (!bulkCatId || selected.size === 0) return;
    setBulkSaving(true);
    try {
      const result = await bulkAssignDRECategory(Array.from(selected), bulkCatId);
      notify("success", `${result.updated} lançamento(s) categorizados.`);
      setBulkCatId("");
      setSelected(new Set());
      await load();
      onClassified();
    } catch {
      notify("error", "Erro ao salvar em lote.");
    } finally {
      setBulkSaving(false);
    }
  }

  async function handleSingleAssign(installmentId: string, catId: string | null) {
    setSavingId(installmentId);
    try {
      await assignDRECategory(installmentId, catId);
      await load();
      onClassified();
    } catch {
      notify("error", "Erro ao atualizar categoria.");
    } finally {
      setSavingId(null);
    }
  }

  // Aplicar sugestão automática a todos os selecionados que têm sugestão conhecida
  async function handleApplySuggestions() {
    const toApply = rows.filter(
      (r) => selected.has(r.installmentId) && r.suggestedCategoryName
    );
    if (toApply.length === 0) {
      notify("error", "Nenhum selecionado tem sugestão automática.");
      return;
    }
    setBulkSaving(true);
    let applied = 0;
    try {
      // Agrupar por categoria sugerida para fazer bulk por grupo
      const byCat = new Map<string, string[]>();
      for (const r of toApply) {
        const cat = catByName.get(r.suggestedCategoryName!.toLowerCase());
        if (!cat) continue;
        if (!byCat.has(cat.id)) byCat.set(cat.id, []);
        byCat.get(cat.id)!.push(r.installmentId);
      }
      for (const [catId, ids] of byCat) {
        const result = await bulkAssignDRECategory(ids, catId);
        applied += result.updated;
      }
      notify("success", `${applied} sugestão(ões) aplicada(s).`);
      setSelected(new Set());
      await load();
      onClassified();
    } catch {
      notify("error", "Erro ao aplicar sugestões.");
    } finally {
      setBulkSaving(false);
    }
  }

  const allChecked = rows.length > 0 && selected.size === rows.length;
  const someChecked = selected.size > 0 && !allChecked;

  const selectedHaveSuggestions = rows.filter(
    (r) => selected.has(r.installmentId) && r.suggestedCategoryName && catByName.has(r.suggestedCategoryName.toLowerCase())
  ).length;

  const periodLabel = filterMode === "month"
    ? `${MONTHS[month - 1]} / ${year}`
    : `${fromDate} → ${toDate}`;

  return (
    <div className="stack">
      {/* ── Cabeçalho com totais ── */}
      <div className="dre-filter-bar">
        <div className="dre-filter-left" style={{ flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Período: {periodLabel}</span>
          {!loading && (
            <span className="badge badge-neutral" style={{ fontSize: 13 }}>
              {total} lançamento{total !== 1 ? "s" : ""} não categorizados
              {total > 0 && ` · ${formatCurrency(totalAmount)}`}
            </span>
          )}
        </div>
        <div className="dre-filter-right">
          <button type="button" className="btn-icon" onClick={() => load()} title="Atualizar">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* ── Barra de busca + ordenação ── */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-muted)" }} />
          <input
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Buscar fornecedor..."
            style={{ paddingLeft: 28, width: "100%" }}
          />
        </div>
        <select value={sort} onChange={(e) => handleSortChange(e.target.value)} style={{ minWidth: 160 }}>
          <option value="amount_desc">Maior valor primeiro</option>
          <option value="amount_asc">Menor valor primeiro</option>
          <option value="date_desc">Data mais recente</option>
          <option value="date_asc">Data mais antiga</option>
        </select>
      </div>

      {/* ── Barra de ação em lote ── */}
      {canEdit && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", background: "var(--color-surface-2)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--color-border)" }}>
          <span className="text-muted" style={{ fontSize: 13 }}>
            {selected.size === 0 ? "Selecione lançamentos para classificar em lote" : `${selected.size} selecionado(s)`}
          </span>
          {selected.size > 0 && (
            <>
              <select
                value={bulkCatId}
                onChange={(e) => setBulkCatId(e.target.value)}
                style={{ minWidth: 200, fontSize: "0.85em" }}
              >
                <option value="">Escolha a categoria...</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn-primary"
                onClick={handleBulkAssign}
                disabled={!bulkCatId || bulkSaving}
                style={{ fontSize: "0.85em" }}
              >
                {bulkSaving ? "Salvando..." : "Classificar selecionados"}
              </button>
              {selectedHaveSuggestions > 0 && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleApplySuggestions}
                  disabled={bulkSaving}
                  style={{ fontSize: "0.85em" }}
                  title={`Aplicar sugestão automática a ${selectedHaveSuggestions} lançamento(s)`}
                >
                  <Wand2 size={13} /> Aplicar sugestões ({selectedHaveSuggestions})
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Tabela ── */}
      {loading ? (
        <p className="text-muted" style={{ padding: "24px 0", textAlign: "center" }}>Carregando...</p>
      ) : rows.length === 0 ? (
        <div style={{ padding: "40px 0", textAlign: "center" }}>
          {total === 0 ? (
            <>
              <p style={{ fontWeight: 600, marginBottom: 8 }}>Tudo categorizado!</p>
              <p className="text-muted">Nenhuma despesa pendente de classificação para {periodLabel}.</p>
            </>
          ) : (
            <p className="text-muted">Nenhum resultado para "{search}".</p>
          )}
        </div>
      ) : (
        <div className="dre-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {canEdit && (
                  <th style={{ width: 32 }}>
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={(el) => { if (el) el.indeterminate = someChecked; }}
                      onChange={toggleSelectAll}
                      style={{ width: "auto", cursor: "pointer" }}
                    />
                  </th>
                )}
                <th>Fornecedor</th>
                <th>NF / Pedido</th>
                <th className="text-center">Vencimento</th>
                <th className="text-center">Pagamento</th>
                <th>Forma pagto.</th>
                <th className="text-right">Valor</th>
                <th>Status</th>
                {canEdit && <th style={{ minWidth: 200 }}>Categoria DRE</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isSelected = selected.has(r.installmentId);
                const sugCat = r.suggestedCategoryName
                  ? catByName.get(r.suggestedCategoryName.toLowerCase())
                  : undefined;
                return (
                  <tr key={r.installmentId} className={isSelected ? "dre-row-selected" : ""}>
                    {canEdit && (
                      <td>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(r.installmentId)}
                          style={{ width: "auto", cursor: "pointer" }}
                        />
                      </td>
                    )}
                    <td>
                      <div style={{ fontWeight: 500 }}>{r.supplierName}</div>
                      {canEdit && (
                        <button
                          type="button"
                          className="btn-link"
                          style={{ fontSize: "0.75em", padding: 0 }}
                          onClick={() => selectBySupplier(r.supplierName)}
                        >
                          Selecionar todos deste
                        </button>
                      )}
                    </td>
                    <td className="text-muted" style={{ fontSize: "0.85em" }}>
                      {r.invoiceNumber ?? "—"}
                      {r.purchaseNumber && <div>Ped: {r.purchaseNumber}</div>}
                    </td>
                    <td className="text-center">{r.dueDate ? formatDate(r.dueDate) : "—"}</td>
                    <td className="text-center">{r.paidDate ? formatDate(r.paidDate) : "—"}</td>
                    <td className="text-muted" style={{ fontSize: "0.85em" }}>{r.paymentMethod ?? "—"}</td>
                    <td className="text-right" style={{ fontWeight: 500 }}>{formatCurrency(r.effectiveAmount)}</td>
                    <td>
                      <span className={`badge ${r.status === "PAID" || r.status === "PAID_LATE" ? "badge-success" : r.status === "OVERDUE" ? "badge-error" : "badge-neutral"}`}>
                        {statusLabel(r.status)}
                      </span>
                    </td>
                    {canEdit && (
                      <td>
                        {sugCat && (
                          <div style={{ marginBottom: 4 }}>
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ fontSize: "0.75em", padding: "2px 8px" }}
                              disabled={savingId === r.installmentId}
                              onClick={() => handleSingleAssign(r.installmentId, sugCat.id)}
                              title={`Sugestão automática: ${sugCat.name}`}
                            >
                              <Wand2 size={11} /> {sugCat.name}
                            </button>
                          </div>
                        )}
                        <select
                          value=""
                          disabled={savingId === r.installmentId}
                          onChange={(e) => { if (e.target.value) handleSingleAssign(r.installmentId, e.target.value); }}
                          style={{ fontSize: "0.82em", minWidth: 160 }}
                        >
                          <option value="">— Escolha —</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={canEdit ? 6 : 5}><strong>Total ({total} lançamentos)</strong></td>
                <td className="text-right"><strong>{formatCurrency(totalAmount)}</strong></td>
                <td colSpan={canEdit ? 2 : 1}></td>
              </tr>
            </tfoot>
          </table>
          {total > rows.length && (
            <p className="text-muted" style={{ textAlign: "center", padding: "8px 0", fontSize: 13 }}>
              Mostrando {rows.length} de {total}. Refine a busca para ver mais.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Categories panel
// ─────────────────────────────────────────────

const emptyCategory = { id: "", name: "", dreGroup: "DESPESAS_OPERACIONAIS", sortOrder: 0, notes: "" };

function CategoriesPanel({
  categories, canEdit, isAdmin, onSaved, onSeed, notify,
}: {
  categories: DRECategory[];
  canEdit: boolean;
  isAdmin: boolean;
  onSaved: () => void;
  onSeed: () => void;
  notify: (tone: "success" | "error", message: string) => void;
}) {
  const [form, setForm] = useState(emptyCategory);
  const [seeding, setSeeding] = useState(false);

  function setField(key: keyof typeof form, value: string | number) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    if (!form.name.trim()) return;
    try {
      await saveDRECategoryApi(form);
      setForm(emptyCategory);
      onSaved();
      notify("success", form.id ? "Categoria atualizada." : "Categoria criada.");
    } catch (e) {
      notify("error", e instanceof Error ? e.message : "Erro ao salvar.");
    }
  }

  async function handleSeed() {
    setSeeding(true);
    try { await onSeed(); } finally { setSeeding(false); }
  }

  return (
    <div className="stack">
      {isAdmin && (
        <div className="dre-seed-bar">
          <span className="text-muted" style={{ fontSize: 13 }}>
            Cria automaticamente as categorias gerenciais baseadas na planilha do restaurante.
          </span>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleSeed}
            disabled={seeding}
            title="Criar categorias padrão"
          >
            <Wand2 size={14} /> {seeding ? "Criando..." : "Seed categorias padrão"}
          </button>
        </div>
      )}

      {canEdit && (
        <div className="form-grid">
          <div className="form-group">
            <label>Nome *</label>
            <input value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="Ex: Folha de Pessoal" />
          </div>
          <div className="form-group">
            <label>Grupo DRE</label>
            <select value={form.dreGroup} onChange={(e) => setField("dreGroup", e.target.value)}>
              {DRE_GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Ordem</label>
            <input type="number" value={form.sortOrder} onChange={(e) => setField("sortOrder", Number(e.target.value))} />
          </div>
          <div className="form-group" style={{ alignSelf: "flex-end" }}>
            <button type="button" className="btn-primary" onClick={handleSubmit}>
              {form.id ? "Salvar" : <><Plus size={14} /> Criar</>}
            </button>
            {form.id && (
              <button type="button" className="btn-secondary" style={{ marginLeft: 8 }} onClick={() => setForm(emptyCategory)}>
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th>Ordem</th>
            <th>Nome</th>
            <th>Grupo DRE</th>
            <th>Status</th>
            {canEdit && <th></th>}
          </tr>
        </thead>
        <tbody>
          {categories
            .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
            .map((cat) => (
              <tr key={cat.id}>
                <td>{cat.sortOrder}</td>
                <td><strong>{cat.name}</strong></td>
                <td className="text-muted">{DRE_GROUPS.find((g) => g.value === cat.dreGroup)?.label ?? cat.dreGroup}</td>
                <td>
                  {cat.isActive
                    ? <span className="badge badge-success">Ativo</span>
                    : <span className="badge badge-error">Inativo</span>}
                </td>
                {canEdit && (
                  <td>
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => setForm({ id: cat.id, name: cat.name, dreGroup: cat.dreGroup, sortOrder: cat.sortOrder, notes: cat.notes ?? "" })}
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
