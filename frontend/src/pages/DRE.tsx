import { ChevronDown, ChevronRight, Download, Plus, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  assignDRECategory,
  downloadDrePdf,
  getDRECategories,
  getDREDrill,
  getDRESummary,
  saveDRECategory as saveDRECategoryApi,
  type DRECategory,
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

type Mode = "dre" | "categories";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const MONTHS = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function pct(v: number | null, decimals = 1) {
  return v == null ? "—" : `${v.toFixed(decimals)}%`;
}

function colorClass(v: number) {
  return v > 0 ? "text-success" : v < 0 ? "text-danger" : "";
}

function statusLabel(s: string) {
  const map: Record<string, string> = { OPEN: "Aberto", PAID: "Pago", PAID_LATE: "Pago c/ atraso", OVERDUE: "Vencido", CANCELLED: "Cancelado" };
  return map[s] ?? s;
}

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────

export function DRE() {
  const { user } = useSession();
  const canEdit = user?.role === "ADMIN" || user?.role === "GESTAO_COMPLETA";
  const [mode, setMode] = useState<Mode>("dre");
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<{ current: DRESummary; prevMonth: DRESummary | null; prevYear: DRESummary | null } | null>(null);
  const [categories, setCategories] = useState<DRECategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedExpense, setExpandedExpense] = useState<string | null>(null);
  const [drillRows, setDrillRows] = useState<DrillRow[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const { notice, setNotice } = useNotice();

  async function load() {
    setLoading(true);
    try {
      const [summary, cats] = await Promise.all([getDRESummary(year, month), getDRECategories(true)]);
      setData(summary);
      setCategories(cats);
    } catch (e) {
      setNotice({ tone: "error", message: e instanceof Error ? e.message : "Erro ao carregar DRE." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [year, month]);

  async function toggleDrill(dreCategoryId: string | null) {
    const key = dreCategoryId ?? "__uncategorized__";
    if (expandedExpense === key) { setExpandedExpense(null); return; }
    setExpandedExpense(key);
    setDrillLoading(true);
    try {
      const rows = await getDREDrill({ year, month, dreCategoryId: dreCategoryId ?? undefined });
      setDrillRows(rows);
    } catch {
      setNotice({ tone: "error", message: "Erro ao carregar detalhes." });
    } finally {
      setDrillLoading(false);
    }
  }

  async function handleExportPdf() {
    try {
      await downloadDrePdf(year, month);
    } catch {
      setNotice({ tone: "error", message: "Erro ao gerar PDF." });
    }
  }

  const cur = data?.current;
  const pm  = data?.prevMonth;
  const py  = data?.prevYear;

  return (
    <div className="stack">
      <Notice notice={notice} />

      <div className="tabs-row">
        <button className={mode === "dre" ? "active" : ""} type="button" onClick={() => setMode("dre")}>DRE Gerencial</button>
        <button className={mode === "categories" ? "active" : ""} type="button" onClick={() => setMode("categories")}>Categorias DRE</button>
      </div>

      {mode === "categories" && (
        <CategoriesPanel categories={categories} canEdit={canEdit} onSaved={load} notify={(t, m) => setNotice({ tone: t, message: m })} />
      )}

      {mode === "dre" && (
        <>
          {/* Period selector */}
          <div className="filter-row">
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {Array.from({ length: 5 }, (_, i) => now.getFullYear() - i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <button type="button" className="btn-icon" onClick={load} title="Atualizar"><RefreshCw size={15} /></button>
            <button type="button" className="btn-secondary" onClick={handleExportPdf}>
              <Download size={14} /> Exportar PDF
            </button>
          </div>

          {loading ? (
            <p className="text-muted">Carregando DRE...</p>
          ) : cur ? (
            <div className="dre-table-wrap">
              <table className="dre-table">
                <thead>
                  <tr>
                    <th style={{ width: "50%" }}>Linha</th>
                    <th className="text-right">{MONTHS[month - 1]}/{year}</th>
                    <th className="text-right text-muted">Mês anterior</th>
                    <th className="text-right text-muted">Mesmo mês {year - 1}</th>
                  </tr>
                </thead>
                <tbody>
                  {/* ── RECEITAS ── */}
                  <DREGroup label="RECEITAS" />

                  {Object.entries(cur.revenue.byChannel).sort((a, b) => b[1] - a[1]).map(([ch, val]) => (
                    <DRERow
                      key={ch}
                      label={`  Receita bruta — ${ch}`}
                      cur={val}
                      pm={pm?.revenue.byChannel[ch]}
                      py={py?.revenue.byChannel[ch]}
                    />
                  ))}

                  <DRERow label="(−) Descontos e taxas de plataforma" cur={-cur.revenue.deductions}
                    pm={pm ? -pm.revenue.deductions : undefined} py={py ? -py.revenue.deductions : undefined} negative />

                  <DRETotal label="(=) RECEITA LÍQUIDA"
                    cur={cur.revenue.netAmount} pm={pm?.revenue.netAmount} py={py?.revenue.netAmount}
                    pctCur={100} pctLabel="100%" />

                  {/* ── CMV ── */}
                  <DREGroup label="CUSTO DA MERCADORIA VENDIDA (CMV REAL)" />

                  <DRERow label="  Estoque inicial"  cur={cur.cmv.estoqueInicial} pm={pm?.cmv.estoqueInicial} py={py?.cmv.estoqueInicial} />
                  <DRERow label="(+) Compras no período" cur={cur.cmv.compras} pm={pm?.cmv.compras} py={py?.cmv.compras} />
                  <DRERow label="(−) Estoque final"  cur={-cur.cmv.estoqueFinal} pm={pm ? -pm.cmv.estoqueFinal : undefined} py={py ? -py.cmv.estoqueFinal : undefined} negative />

                  <DRETotal label="(=) CMV REAL" warning
                    cur={cur.cmv.cmvReal} pm={pm?.cmv.cmvReal} py={py?.cmv.cmvReal}
                    pctCur={cur.cmv.cmvPercent} pctPm={pm?.cmv.cmvPercent} pctPy={py?.cmv.cmvPercent} />

                  {/* ── LUCRO BRUTO ── */}
                  <DRETotal label="(=) LUCRO BRUTO" highlight
                    cur={cur.lucroBruto} pm={pm?.lucroBruto} py={py?.lucroBruto}
                    pctCur={cur.margemBruta} pctPm={pm?.margemBruta} pctPy={py?.margemBruta} />

                  {/* ── DESPESAS ── */}
                  <DREGroup label="DESPESAS OPERACIONAIS" />

                  {[...cur.expenses].sort((a, b) => a.sortOrder - b.sortOrder || a.dreCategoryName.localeCompare(b.dreCategoryName)).map((exp) => {
                    const key = exp.dreCategoryId ?? "__uncategorized__";
                    const isOpen = expandedExpense === key;
                    const pmExp = pm?.expenses.find((e) => e.dreCategoryId === exp.dreCategoryId);
                    const pyExp = py?.expenses.find((e) => e.dreCategoryId === exp.dreCategoryId);
                    const pctCur = cur.revenue.grossAmount > 0 ? (exp.total / cur.revenue.grossAmount) * 100 : null;

                    return (
                      <>
                        <tr key={key} className={`dre-expense-row ${isOpen ? "dre-expanded" : ""}`}
                          onClick={() => toggleDrill(exp.dreCategoryId)} style={{ cursor: "pointer" }}>
                          <td>
                            <span className="dre-chevron">{isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
                            {`  ${exp.dreCategoryName}`}
                          </td>
                          <td className="text-right">{formatCurrency(exp.total)}</td>
                          <td className="text-right text-muted">{pmExp ? formatCurrency(pmExp.total) : "—"}</td>
                          <td className="text-right text-muted">{pyExp ? formatCurrency(pyExp.total) : "—"}</td>
                        </tr>
                        {isOpen && (
                          <tr key={`${key}-drill`} className="dre-drill-row">
                            <td colSpan={4}>
                              <DrillPanel
                                rows={drillRows}
                                loading={drillLoading}
                                categories={categories}
                                canEdit={canEdit}
                                onCategoryChanged={() => { load(); toggleDrill(null); }}
                                notify={(t, m) => setNotice({ tone: t, message: m })}
                              />
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}

                  <DRETotal label="(=) TOTAL DE DESPESAS" warning
                    cur={cur.totalExpenses} pm={pm?.totalExpenses} py={py?.totalExpenses} />

                  {/* ── EBITDA ── */}
                  <DRETotal label="(=) EBITDA GERENCIAL" highlight strong
                    cur={cur.ebitda} pm={pm?.ebitda} py={py?.ebitda}
                    pctCur={cur.ebitdaPercent} pctPm={pm?.ebitdaPercent} pctPy={py?.ebitdaPercent} />
                </tbody>
              </table>
            </div>
          ) : null}
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
      <td colSpan={4}>{label}</td>
    </tr>
  );
}

function DRERow({ label, cur, pm, py, negative }: {
  label: string; cur: number; pm?: number; py?: number; negative?: boolean;
}) {
  return (
    <tr className="dre-row">
      <td>{label}</td>
      <td className={`text-right ${negative && cur < 0 ? "text-danger" : ""}`}>{formatCurrency(Math.abs(cur))}{negative && cur !== 0 ? "" : ""}</td>
      <td className="text-right text-muted">{pm != null ? formatCurrency(Math.abs(pm)) : "—"}</td>
      <td className="text-right text-muted">{py != null ? formatCurrency(Math.abs(py)) : "—"}</td>
    </tr>
  );
}

function DRETotal({ label, cur, pm, py, pctCur, pctPm, pctPy, pctLabel, highlight, warning, strong }: {
  label: string; cur: number; pm?: number; py?: number;
  pctCur?: number | null; pctPm?: number | null; pctPy?: number | null;
  pctLabel?: string; highlight?: boolean; warning?: boolean; strong?: boolean;
}) {
  const cls = highlight ? "dre-total-highlight" : warning ? "dre-total-warning" : "dre-total";
  return (
    <tr className={cls}>
      <td><strong>{label}</strong>{pctCur != null ? <span className="dre-pct"> [{pct(pctCur)}]</span> : pctLabel ? <span className="dre-pct"> [{pctLabel}]</span> : null}</td>
      <td className={`text-right ${strong ? "" : ""} ${colorClass(cur)}`}><strong>{formatCurrency(cur)}</strong></td>
      <td className="text-right text-muted">{pm != null ? <>{formatCurrency(pm)}{pctPm != null ? <span className="dre-pct"> [{pct(pctPm)}]</span> : null}</> : "—"}</td>
      <td className="text-right text-muted">{py != null ? <>{formatCurrency(py)}{pctPy != null ? <span className="dre-pct"> [{pct(pctPy)}]</span> : null}</> : "—"}</td>
    </tr>
  );
}

// ─────────────────────────────────────────────
// Drill panel
// ─────────────────────────────────────────────

function DrillPanel({ rows, loading, categories, canEdit, onCategoryChanged, notify }: {
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
            <td><div>{r.supplierName}</div>{r.purchaseNumber && <div className="text-muted" style={{ fontSize: "0.8em" }}>Pedido: {r.purchaseNumber}</div>}</td>
            <td>{r.invoiceNumber ?? "—"}{r.installment != null ? <span className="text-muted"> ({r.installment}ª parcela)</span> : null}</td>
            <td className="text-center">{r.dueDate ? formatDate(r.dueDate) : "—"}</td>
            <td className="text-center">{r.paidDate ? formatDate(r.paidDate) : "—"}</td>
            <td className="text-right">{formatCurrency(r.effectiveAmount)}</td>
            <td><span className={`badge ${r.status === "PAID" || r.status === "PAID_LATE" ? "badge-success" : r.status === "OVERDUE" ? "badge-error" : "badge-neutral"}`}>{statusLabel(r.status)}</span></td>
            {canEdit && (
              <td>
                <select
                  value={r.dreCategoryId ?? ""}
                  disabled={assigning === r.installmentId}
                  onChange={(e) => handleAssign(r.installmentId, e.target.value || null)}
                  style={{ fontSize: "0.85em", minWidth: 140 }}
                >
                  <option value="">Não categorizada</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
// Categories panel
// ─────────────────────────────────────────────

const DRE_GROUPS = [
  { value: "DESPESAS_OPERACIONAIS", label: "Despesas Operacionais" },
  { value: "DEDUCOES", label: "Deduções de Receita" },
];

const emptyCategory = { id: "", name: "", dreGroup: "DESPESAS_OPERACIONAIS", sortOrder: 0, notes: "" };

function CategoriesPanel({ categories, canEdit, onSaved, notify }: {
  categories: DRECategory[];
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
      await saveDRECategoryApi(form);
      setForm(emptyCategory);
      onSaved();
      notify("success", form.id ? "Categoria atualizada." : "Categoria criada.");
    } catch (e) {
      notify("error", e instanceof Error ? e.message : "Erro ao salvar.");
    }
  }

  return (
    <div className="stack">
      {canEdit && (
        <div className="form-grid">
          <div className="form-group">
            <label>Nome *</label>
            <input value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="Ex: Folha de Pessoal" />
          </div>
          <div className="form-group">
            <label>Grupo</label>
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
            {form.id && <button type="button" className="btn-secondary" style={{ marginLeft: 8 }} onClick={() => setForm(emptyCategory)}><X size={14} /></button>}
          </div>
        </div>
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th>Ordem</th>
            <th>Nome</th>
            <th>Grupo</th>
            <th>Status</th>
            {canEdit && <th></th>}
          </tr>
        </thead>
        <tbody>
          {categories.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)).map((cat) => (
            <tr key={cat.id}>
              <td>{cat.sortOrder}</td>
              <td><strong>{cat.name}</strong></td>
              <td className="text-muted">{DRE_GROUPS.find((g) => g.value === cat.dreGroup)?.label ?? cat.dreGroup}</td>
              <td>{cat.isActive ? <span className="badge badge-success">Ativo</span> : <span className="badge badge-error">Inativo</span>}</td>
              {canEdit && (
                <td><button type="button" className="btn-link" onClick={() => setForm({ id: cat.id, name: cat.name, dreGroup: cat.dreGroup, sortOrder: cat.sortOrder, notes: cat.notes ?? "" })}>Editar</button></td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
