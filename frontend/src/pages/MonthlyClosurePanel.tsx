// Painel de Fechamento Mensal (CMV v2 — 2026-07-15)
// Consome /monthly-closure/YYYY/MM e mostra checklist visual com justificativas.
import { AlertTriangle, CheckCircle2, ExternalLink, Lock, Unlock, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AppUser,
  getMonthlyClosure,
  justifyMonthlyClosureBlock,
  removeMonthlyClosureJustification,
  lockMonthlyClosure,
  unlockMonthlyClosure,
  MonthlyClosureState,
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { Alert, Button, Money, PanelEyebrow } from "../design-system";
import { hasPermission } from "../lib/permissions";
import { formatDate } from "../utils/format";

function currentYearMonth() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function parseYearMonthParam(raw: string | undefined): { year: number; month: number } {
  if (!raw) return currentYearMonth();
  const match = /^(\d{4})-(\d{1,2})$/.exec(raw);
  if (!match) return currentYearMonth();
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12) return currentYearMonth();
  return { year: y, month: m };
}

function monthLabel(year: number, month: number): string {
  const names = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  return `${names[month - 1]} / ${year}`;
}

function toYearMonthParam(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function frequencyLabel(freq: string): string {
  if (freq === "MONTHLY") return "Mensal";
  if (freq === "QUARTERLY") return "Trimestral";
  if (freq === "ANNUAL") return "Anual";
  return freq;
}

function StatusPill({ ok, warning, na, label }: { ok?: boolean; warning?: boolean; na?: boolean; label: string }) {
  const color = ok ? "var(--success, #2e7d32)" : warning ? "var(--warning, #ef6c00)" : na ? "var(--muted)" : "var(--error, #c62828)";
  const bg = ok ? "var(--success-soft, #e6f4ea)" : warning ? "var(--warning-soft, #fff4e5)" : na ? "var(--surface-subtle, #f5f5f5)" : "var(--error-soft, #fdecea)";
  const icon = ok ? "✅" : warning ? "⚠️" : na ? "—" : "⏳";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 10px", borderRadius: 12, background: bg, color, fontSize: 12, fontWeight: 600 }}>
      {icon} {label}
    </span>
  );
}

export function MonthlyClosurePanel({ user }: { user: AppUser }) {
  const canEdit = hasPermission(user, "monthly-closing", "edit");
  // Travar e reabrir o mes sao fechamento contabil: o backend pede "Aprovar".
  const canLockMonth = hasPermission(user, "monthly-closing", "approve");
  const params = useParams<{ yearMonth?: string }>();
  const navigate = useNavigate();
  const { year, month } = useMemo(() => parseYearMonthParam(params.yearMonth), [params.yearMonth]);
  const [state, setState] = useState<MonthlyClosureState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const { notice, setNotice } = useNotice();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getMonthlyClosure(year, month);
      setState(data);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao carregar fechamento." });
    } finally {
      setLoading(false);
    }
  }, [year, month, setNotice]);

  useEffect(() => { load(); }, [load]);

  function goToMonth(y: number, m: number) {
    navigate(`/cmv/fechamento-mensal/${toYearMonthParam(y, m)}`);
  }

  function prevMonth() {
    const d = new Date(Date.UTC(year, month - 2, 1));
    goToMonth(d.getUTCFullYear(), d.getUTCMonth() + 1);
  }
  function nextMonth() {
    const d = new Date(Date.UTC(year, month, 1));
    goToMonth(d.getUTCFullYear(), d.getUTCMonth() + 1);
  }

  async function justifyBlock(blockKey: string, label: string) {
    const reason = window.prompt(`Justificar pendência "${label}":\n\nMotivo (obrigatório):`);
    if (!reason || !reason.trim()) return;
    setBusy(true);
    try {
      const updated = await justifyMonthlyClosureBlock(year, month, blockKey, reason.trim());
      setState(updated);
      setNotice({ tone: "success", message: "Pendência justificada." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao justificar." });
    } finally {
      setBusy(false);
    }
  }

  async function removeJustification(blockKey: string) {
    if (!window.confirm("Remover esta justificativa? A pendência voltará a bloquear a trava do mês.")) return;
    setBusy(true);
    try {
      const updated = await removeMonthlyClosureJustification(year, month, blockKey);
      setState(updated);
      setNotice({ tone: "success", message: "Justificativa removida." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao remover." });
    } finally {
      setBusy(false);
    }
  }

  async function lockMonth() {
    if (!state) return;
    const confirmMsg = state.summary.pendingCount > 0
      ? `Existem ${state.summary.pendingCount} pendência(s) sem justificativa. Trava bloqueada — justifique antes.`
      : `Travar fechamento de ${monthLabel(year, month)}?

Compras, baixas de contas a pagar, faturamento e inventário com data em ${String(month).padStart(2, "0")}/${year} passam a ser recusados até o mês ser reaberto.`;
    if (state.summary.pendingCount > 0) { window.alert(confirmMsg); return; }
    if (!window.confirm(confirmMsg)) return;
    setBusy(true);
    try {
      const updated = await lockMonthlyClosure(year, month);
      setState(updated);
      setNotice({ tone: "success", message: `Fechamento de ${monthLabel(year, month)} travado.` });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao travar." });
    } finally {
      setBusy(false);
    }
  }

  async function unlockMonth() {
    if (!state) return;
    const reason = window.prompt(`Reabrir fechamento de ${monthLabel(year, month)}?\n\nMotivo (obrigatório):`);
    if (!reason || !reason.trim()) return;
    setBusy(true);
    try {
      const updated = await unlockMonthlyClosure(year, month, reason.trim());
      setState(updated);
      setNotice({ tone: "success", message: "Fechamento reaberto." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao reabrir." });
    } finally {
      setBusy(false);
    }
  }

  const justificationByKey = useMemo(() => {
    const map = new Map<string, MonthlyClosureState["justifications"][number]>();
    for (const j of (state?.justifications ?? [])) map.set(j.blockKey, j);
    return map;
  }, [state]);

  const suppliersByGroup = useMemo(() => {
    if (!state) return new Map<string, MonthlyClosureState["requiredSuppliers"]>();
    const map = new Map<string, MonthlyClosureState["requiredSuppliers"]>();
    for (const s of state.requiredSuppliers) {
      const g = s.group || "Outros";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(s);
    }
    return map;
  }, [state]);

  if (loading || !state) {
    return (
      <div className="page">
        <Notice notice={notice} />
        <p>Carregando fechamento...</p>
      </div>
    );
  }

  const isClosed = state.status === "CLOSED";
  const totalRevenueGross = state.revenue.salon.grossAmount + state.revenue.ifood.grossAmount + state.revenue.noventaNove.grossAmount;

  return (
    <div className="page">
      <Notice notice={notice} />

      <section className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <PanelEyebrow>Fechamento mensal</PanelEyebrow>
            <h2 style={{ margin: "4px 0 0" }}>{monthLabel(year, month)}</h2>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
              Período contábil: {formatDate(state.monthStart)} a {formatDate(state.monthEnd)}
              {isClosed && state.closedAt && ` · travado em ${formatDate(state.closedAt)}`}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Button variant="secondary" onClick={prevMonth}>← Mês anterior</Button>
            <Button variant="secondary" onClick={nextMonth}>Próximo mês →</Button>
            <Button variant="secondary" onClick={load}>Recarregar</Button>
            {canLockMonth && !isClosed && (
              <Button
                onClick={lockMonth}
                disabled={busy || !state.summary.canLock}
                title={!state.summary.canLock ? `${state.summary.pendingCount} pendência(s) sem justificativa` : undefined}
              >
                <Lock size={15} /> Travar mês
              </Button>
            )}
            {canLockMonth && isClosed && (
              <Button variant="secondary" onClick={unlockMonth} disabled={busy}>
                <Unlock size={15} /> Reabrir mês
              </Button>
            )}
          </div>
        </div>

        {isClosed && (
          <Alert tone="success" icon={<CheckCircle2 size={18} />} style={{ marginTop: 12 }}>
            <strong>Fechamento travado.</strong> Todos os blocos foram concluídos ou justificados. Para editar lançamentos deste mês, reabra o fechamento.
          </Alert>
        )}
        {!isClosed && state.summary.pendingCount > 0 && (
          <Alert tone="warning" icon={<AlertTriangle size={18} />} style={{ marginTop: 12 }}>
            <strong>{state.summary.pendingCount} pendência{state.summary.pendingCount > 1 ? "s" : ""}</strong> — justifique cada uma abaixo para habilitar a trava do mês.
          </Alert>
        )}
        {!isClosed && state.summary.pendingCount === 0 && (
          <Alert tone="info" icon={<CheckCircle2 size={18} />} style={{ marginTop: 12 }}>
            <strong>Pronto pra travar.</strong> Todos os blocos concluídos ou justificados.
          </Alert>
        )}
      </section>

      {/* FATURAMENTO */}
      <section className="panel">
        <PanelEyebrow>1. Faturamento</PanelEyebrow>
        <div className="summary-grid" style={{ marginTop: 8 }}>
          <div className="metric-card">
            <div className="muted" style={{ fontSize: 12 }}>Salão</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}><Money value={state.revenue.salon.grossAmount} /></div>
            <div className="muted" style={{ fontSize: 12 }}>{state.revenue.salon.daysCount} dias, {state.revenue.salon.entryCount} lançamentos</div>
          </div>
          <div className="metric-card">
            <div className="muted" style={{ fontSize: 12 }}>iFood</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}><Money value={state.revenue.ifood.grossAmount} /></div>
            <div className="muted" style={{ fontSize: 12 }}>{state.revenue.ifood.count} vendas</div>
          </div>
          <div className="metric-card">
            <div className="muted" style={{ fontSize: 12 }}>99 Food</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}><Money value={state.revenue.noventaNove.grossAmount} /></div>
            <div className="muted" style={{ fontSize: 12 }}>{state.revenue.noventaNove.count} vendas</div>
          </div>
          <div className="metric-card">
            <div className="muted" style={{ fontSize: 12 }}>Total bruto</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}><Money value={totalRevenueGross} /></div>
            <div className="muted" style={{ fontSize: 12 }}>Líquido salão: <Money value={state.revenue.salon.netAmount} /></div>
          </div>
        </div>
        {(() => {
          const revJust = justificationByKey.get("block:revenue");
          const revPend = state.summary.pending.find(p => p.key === "block:revenue");
          if (revJust) return <p style={{ marginTop: 8, fontSize: 12 }}>⚠️ Justificada: <em>{revJust.reason}</em> {canEdit && !isClosed && <button onClick={() => removeJustification("block:revenue")} className="link-btn" disabled={busy}><X size={12} /> remover</button>}</p>;
          if (revPend && canEdit && !isClosed) return <p style={{ marginTop: 8, fontSize: 12 }}>⏳ {revPend.label} <button onClick={() => justifyBlock("block:revenue", revPend.label)} className="link-btn" disabled={busy}>Justificar</button></p>;
          return null;
        })()}
      </section>

      {/* COMPRAS */}
      <section className="panel">
        <PanelEyebrow>2. Compras (por competência)</PanelEyebrow>
        <div className="summary-grid" style={{ marginTop: 8 }}>
          <div className="metric-card">
            <div className="muted" style={{ fontSize: 12 }}>Total do mês</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}><Money value={state.purchases.total} /></div>
            <div className="muted" style={{ fontSize: 12 }}>{state.purchases.count} lançamentos</div>
          </div>
        </div>
        {state.purchases.byCategory.length > 0 && (
          <table className="data-table" style={{ marginTop: 8, fontSize: 13 }}>
            <thead>
              <tr><th style={{ textAlign: "left" }}>Categoria DRE</th><th style={{ textAlign: "right" }}>Compras</th><th style={{ textAlign: "right" }}>#</th></tr>
            </thead>
            <tbody>
              {state.purchases.byCategory.map(c => (
                <tr key={c.categoryName}>
                  <td>{c.categoryName}</td>
                  <td style={{ textAlign: "right" }}><Money value={c.total} /></td>
                  <td style={{ textAlign: "right" }}>{c.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* FORNECEDORES OBRIGATÓRIOS */}
      <section className="panel">
        <PanelEyebrow>3. Fornecedores obrigatórios</PanelEyebrow>
        {state.requiredSuppliers.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>Nenhum fornecedor marcado como obrigatório no fechamento. Marque em <a href="/fornecedores">Cadastro de fornecedores → Regra de fechamento</a>.</p>
        ) : (
          Array.from(suppliersByGroup.entries()).map(([group, suppliers]) => (
            <div key={group} style={{ marginTop: 12 }}>
              <h4 style={{ margin: "0 0 6px", fontSize: 13, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>{group}</h4>
              <table className="data-table" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Fornecedor</th>
                    <th style={{ textAlign: "left" }}>Frequência</th>
                    <th style={{ textAlign: "left" }}>Status</th>
                    <th style={{ textAlign: "right" }}>Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map(s => {
                    const blockKey = `supplier:${s.id}`;
                    const just = justificationByKey.get(blockKey);
                    let statusEl;
                    if (!s.appliesThisMonth) statusEl = <StatusPill na label="Não aplica este mês" />;
                    else if (s.present) statusEl = <StatusPill ok label={`Lançado (${s.purchaseCount})`} />;
                    else if (just) statusEl = <StatusPill warning label="Pendência justificada" />;
                    else statusEl = <StatusPill label="Pendente" />;
                    return (
                      <tr key={s.id}>
                        <td>{s.name}</td>
                        <td>{frequencyLabel(s.frequency)}</td>
                        <td>{statusEl}</td>
                        <td style={{ textAlign: "right" }}>{s.present ? <Money value={s.total} /> : "—"}</td>
                        <td style={{ textAlign: "right" }}>
                          {canEdit && !isClosed && s.appliesThisMonth && !s.present && !just && (
                            <button className="link-btn" onClick={() => justifyBlock(blockKey, `Fornecedor ${s.name}`)} disabled={busy}>Justificar</button>
                          )}
                          {canEdit && !isClosed && just && (
                            <span title={just.reason}>
                              <button className="link-btn" onClick={() => removeJustification(blockKey)} disabled={busy}><X size={12} /> Remover just.</button>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {suppliers.some(s => justificationByKey.has(`supplier:${s.id}`)) && (
                <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>
                  {suppliers.filter(s => justificationByKey.has(`supplier:${s.id}`)).map(s => (
                    <div key={s.id}>↳ <strong>{s.name}:</strong> <em>{justificationByKey.get(`supplier:${s.id}`)?.reason}</em></div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </section>

      {/* IMPOSTOS */}
      <section className="panel">
        <PanelEyebrow>4. Impostos e taxas</PanelEyebrow>
        {state.taxes.length === 0 ? (
          <div>
            <p className="muted" style={{ fontSize: 13 }}>Nenhum imposto registrado para {monthLabel(year, month)}.</p>
            {(() => {
              const j = justificationByKey.get("block:taxes");
              if (j) return <p style={{ fontSize: 12 }}>⚠️ Justificada: <em>{j.reason}</em> {canEdit && !isClosed && <button onClick={() => removeJustification("block:taxes")} className="link-btn" disabled={busy}><X size={12} /> remover</button>}</p>;
              if (canEdit && !isClosed) return <button className="link-btn" onClick={() => justifyBlock("block:taxes", "Impostos ausentes")} disabled={busy}>Justificar ausência</button>;
              return null;
            })()}
          </div>
        ) : (
          <table className="data-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Tipo</th>
                <th style={{ textAlign: "left" }}>Descrição</th>
                <th style={{ textAlign: "right" }}>Valor</th>
                <th style={{ textAlign: "left" }}>Vencimento</th>
                <th style={{ textAlign: "left" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {state.taxes.map(t => (
                <tr key={t.id}>
                  <td>{t.documentType}</td>
                  <td>{t.description ?? "—"}</td>
                  <td style={{ textAlign: "right" }}><Money value={t.amount} /></td>
                  <td>{formatDate(t.dueDate)}</td>
                  <td>{t.paymentDate ? <StatusPill ok label={`Pago ${formatDate(t.paymentDate)}`} /> : <StatusPill label={t.status} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* INVENTÁRIO FINAL */}
      <section className="panel">
        <PanelEyebrow>5. Inventário final</PanelEyebrow>
        {state.finalInventory.hasSnapshot ? (
          <div>
            <StatusPill ok label={`Contado em ${formatDate(state.finalInventory.countDate)}`} />
            <p style={{ marginTop: 6, fontSize: 14 }}>
              <Money value={state.finalInventory.totalValue} /> · {state.finalInventory.totalItems} itens
            </p>
          </div>
        ) : (
          <div>
            <p className="muted" style={{ fontSize: 13 }}>Nenhum inventário final ativo para {monthLabel(year, month)}.</p>
            {(() => {
              const j = justificationByKey.get("block:finalInventory");
              if (j) return <p style={{ fontSize: 12 }}>⚠️ Justificada: <em>{j.reason}</em> {canEdit && !isClosed && <button onClick={() => removeJustification("block:finalInventory")} className="link-btn" disabled={busy}><X size={12} /> remover</button>}</p>;
              return (
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                  <a href="/estoque/contagens" className="link-btn"><ExternalLink size={12} /> Ir para Contagem de Estoque</a>
                  {canEdit && !isClosed && <button className="link-btn" onClick={() => justifyBlock("block:finalInventory", "Inventário final ausente")} disabled={busy}>Justificar ausência</button>}
                </div>
              );
            })()}
          </div>
        )}
      </section>

      {/* CMV ATRIBUÍDO */}
      <section className="panel">
        <PanelEyebrow>6. CMV atribuído ao mês (rateio por dias corridos)</PanelEyebrow>
        {state.cmvAttribution.breakdown.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>Nenhum ciclo de CMV Real intercepta este mês. Gere apuração em CMV Real.</p>
        ) : (
          <>
            <div className="metric-card" style={{ marginBottom: 12 }}>
              <div className="muted" style={{ fontSize: 12 }}>CMV rateado</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}><Money value={state.cmvAttribution.total} /></div>
            </div>
            <table className="data-table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Ciclo</th>
                  <th style={{ textAlign: "left" }}>Período</th>
                  <th style={{ textAlign: "right" }}>Dias no mês</th>
                  <th style={{ textAlign: "right" }}>Dias totais</th>
                  <th style={{ textAlign: "right" }}>CMV do ciclo</th>
                  <th style={{ textAlign: "right" }}>Contribuição</th>
                </tr>
              </thead>
              <tbody>
                {state.cmvAttribution.breakdown.map(c => (
                  <tr key={c.cmvPeriodId}>
                    <td>{c.code ?? "—"}</td>
                    <td>{formatDate(c.cycleStart)} → {formatDate(c.cycleEnd)}</td>
                    <td style={{ textAlign: "right" }}>{c.daysInMonth}</td>
                    <td style={{ textAlign: "right" }}>{c.totalDays}</td>
                    <td style={{ textAlign: "right" }}><Money value={c.cmvReal} /></td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}><Money value={c.contribution} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      {/* JUSTIFICATIVAS */}
      {state.justifications.length > 0 && (
        <section className="panel">
          <PanelEyebrow>Justificativas registradas</PanelEyebrow>
          <table className="data-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Bloco</th>
                <th style={{ textAlign: "left" }}>Motivo</th>
                <th style={{ textAlign: "left" }}>Registrada em</th>
              </tr>
            </thead>
            <tbody>
              {state.justifications.map(j => (
                <tr key={j.blockKey}>
                  <td><code style={{ fontSize: 11 }}>{j.blockKey}</code></td>
                  <td>{j.reason}</td>
                  <td>{formatDate(j.justifiedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
