import { Check, ChevronLeft, ChevronRight, Coins, FileText, Lock, Plus, RefreshCw, Save, Trash2, UserPlus } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import {
  Employee, TipComputation, TipParticipantInput, TipParticipantKind, TipValeType,
  addTipVale, closeTipPeriodApi, getEmployees, getTipCommission, openTipPeriod,
  removeTipParticipant, removeTipVale, saveTipParticipants, syncTipParticipants, updateTipPeriod,
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { useSession } from "../context/SessionContext";
import { Alert, Button, FormField, FormGrid, Money, SummaryCard, Table } from "../design-system";
import { hasPermission } from "../lib/permissions";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const VALE_LABELS: Record<TipValeType, string> = {
  REFEICAO: "Refeição", VALE_CONSUMO: "Vale consumo", RETIRADA_CAIXA: "Retirada de caixa", ADIANTAMENTO: "Adiantamento", OUTRO: "Outro",
};
const VALE_TYPES = Object.keys(VALE_LABELS) as TipValeType[];

const inputStyle: CSSProperties = {
  width: "100%", padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 8,
  background: "var(--surface, #fff)", color: "inherit", font: "inherit",
};
const panelStyle: CSSProperties = { border: "1px solid var(--border)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 };

function money(v: number | string | null | undefined) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  return isNaN(n) ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}

type LocalRow = {
  employeeId: string; employeeName: string; companyName: string | null;
  kind: TipParticipantKind; points: string; fixedAmount: string;
  horaExtra: string; adicionalNoturno: string; faltas: string; justificada: boolean;
};

// Ordena por pontos (maior → menor) e, em seguida, por empresa.
function sortParticipants<T extends { points: number | null; companyName: string | null }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const pa = a.points ?? -1;
    const pb = b.points ?? -1;
    if (pb !== pa) return pb - pa;
    return (a.companyName ?? "").localeCompare(b.companyName ?? "", "pt-BR");
  });
}

function toRows(comp: TipComputation): LocalRow[] {
  return sortParticipants(comp.participants).map((p) => ({
    employeeId: p.employeeId,
    employeeName: p.employeeName,
    companyName: p.companyName,
    kind: p.kind,
    points: p.points != null ? String(p.points) : "",
    fixedAmount: p.fixedAmount != null ? String(p.fixedAmount) : "",
    horaExtra: p.horaExtra ?? "",
    adicionalNoturno: p.adicionalNoturno ?? "",
    faltas: p.faltas != null ? String(p.faltas) : "",
    justificada: p.justificada ?? false,
  }));
}

export function FolhaGorjeta() {
  const { user } = useSession();
  const canEdit = hasPermission(user, "payroll-tips", "edit");
  const canApprove = hasPermission(user, "payroll-tips", "approve");
  const { notice, setNotice } = useNotice();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [comp, setComp] = useState<TipComputation | null>(null);
  const [rows, setRows] = useState<LocalRow[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [busy, setBusy] = useState(false);
  const [poolInput, setPoolInput] = useState("");
  const [deductionInput, setDeductionInput] = useState("");
  const [pointsTotalInput, setPointsTotalInput] = useState("");
  const [startInput, setStartInput] = useState("");
  const [endInput, setEndInput] = useState("");
  const [addEmpId, setAddEmpId] = useState("");
  const [valesFor, setValesFor] = useState<string | null>(null);
  const [newVale, setNewVale] = useState<{ type: TipValeType; amount: string; date: string }>({ type: "REFEICAO", amount: "", date: "" });
  const [editTick, setEditTick] = useState(0); // incrementa a cada edição do usuário (dispara o autosave)
  const [autoSaving, setAutoSaving] = useState(false);

  // Marca que o usuário editou os participantes (pontos/tipo/cota) → agenda recálculo automático.
  function markEdited() { setEditTick((t) => t + 1); }

  const closed = comp?.status === "CLOSED";
  const readonly = closed || !canEdit;

  // Controle de pontos (feedback imediato).
  const budgetLocal = Math.max(0, Math.round(Number(pointsTotalInput || "0")));
  const sumRowPoints = rows.reduce((acc, r) => acc + (r.kind === "PONTOS" ? Number(r.points || "0") : 0), 0);
  const overAllocatedLocal = budgetLocal > 0 && sumRowPoints > budgetLocal;
  const remainingLocal = budgetLocal - sumRowPoints;

  const compByEmp = useMemo(
    () => new Map((comp?.participants ?? []).map((p) => [p.employeeId, p])),
    [comp],
  );

  async function load() {
    setBusy(true);
    try {
      const [c, emps] = await Promise.all([getTipCommission(year, month), getEmployees({ includeInactive: true })]);
      setComp(c);
      setEmployees(emps);
      setRows(toRows(c));
      setPoolInput(String(c.grossPool));
      setDeductionInput(String(c.deductionPercent));
      setPointsTotalInput(String(c.pointsBudget));
      setStartInput((c.periodStart ?? "").slice(0, 10));
      setEndInput((c.periodEnd ?? "").slice(0, 10));
    } catch (e) {
      setNotice({ tone: "error", message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [year, month]);

  function changeMonth(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setYear(y);
    setMonth(m);
  }

  async function ensurePeriod(): Promise<string | null> {
    if (comp?.periodId) return comp.periodId;
    const p = await openTipPeriod(year, month);
    await load();
    return p.id;
  }

  async function savePool() {
    setBusy(true);
    try {
      const id = await ensurePeriod();
      if (!id) return;
      const datesChanged = startInput !== (comp?.periodStart ?? "").slice(0, 10) || endInput !== (comp?.periodEnd ?? "").slice(0, 10);
      const poolChanged = poolInput !== String(comp?.grossPool ?? "");
      const payload: { grossPool?: number; deductionPercent?: number; pointsTotal?: number; periodStart?: string; periodEnd?: string } = {
        deductionPercent: Number(deductionInput),
        pointsTotal: Math.max(1, Math.round(Number(pointsTotalInput) || 100)),
      };
      if (datesChanged) { payload.periodStart = startInput; payload.periodEnd = endInput; }
      // Se o usuário mexeu no total, respeita o manual; se só mudou as datas, deixa o backend repuxar do Faturamento.
      if (poolChanged || !datesChanged) payload.grossPool = Number(poolInput);
      await updateTipPeriod(id, payload);
      await load();
      setNotice({ tone: "success", message: datesChanged ? "Período e valores atualizados." : "Valores do período atualizados." });
    } catch (e) {
      setNotice({ tone: "error", message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function setRow(employeeId: string, patch: Partial<LocalRow>) {
    setRows((prev) => prev.map((r) => (r.employeeId === employeeId ? { ...r, ...patch } : r)));
    markEdited();
  }

  function addEmployee() {
    const emp = employees.find((e) => e.id === addEmpId);
    if (!emp) return;
    if (rows.some((r) => r.employeeId === emp.id)) { setNotice({ tone: "warning", message: "Funcionário já está na folha." }); return; }
    const name = (emp.displayName || `${emp.firstName} ${emp.lastName}`).trim();
    setRows((prev) => [...prev, { employeeId: emp.id, employeeName: name, companyName: null, kind: "PONTOS", points: "", fixedAmount: "", horaExtra: "", adicionalNoturno: "", faltas: "", justificada: false }]);
    setAddEmpId("");
    markEdited();
  }

  async function persistParticipants(opts: { silent?: boolean } = {}) {
    const silent = opts.silent ?? false;
    if (silent) setAutoSaving(true); else setBusy(true);
    try {
      const id = await ensurePeriod();
      if (!id) return;
      const payload: TipParticipantInput[] = rows.map((r) => ({
        employeeId: r.employeeId,
        kind: r.kind,
        points: r.kind === "PONTOS" ? Number(r.points || "0") : null,
        fixedAmount: r.kind === "FIXO" ? Number(r.fixedAmount || "0") : null,
        horaExtra: r.horaExtra || null,
        adicionalNoturno: r.adicionalNoturno || null,
        faltas: r.faltas === "" ? null : Number(r.faltas),
        justificada: r.justificada,
      }));
      const c = await saveTipParticipants(id, payload);
      setComp(c);
      // No autosave, preserva a ordem/edição em andamento; só reordena no salvamento manual.
      if (!silent) {
        setRows(toRows(c));
        setNotice({ tone: "success", message: "Participantes salvos e comissão recalculada." });
      }
    } catch (e) {
      setNotice({ tone: "error", message: (e as Error).message });
    } finally {
      if (silent) setAutoSaving(false); else setBusy(false);
    }
  }

  async function saveParticipants() { await persistParticipants(); }

  // Recálculo automático: ao alterar pontos/tipo/cota, salva e recalcula sozinho (com debounce).
  useEffect(() => {
    if (editTick === 0) return;
    if (readonly || !comp?.periodId) return;
    if (overAllocatedLocal) return; // não persiste enquanto a soma exceder o total
    const handle = setTimeout(() => { void persistParticipants({ silent: true }); }, 700);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editTick]);

  async function delParticipant(participantId: string | null, employeeId: string) {
    if (participantId) {
      setBusy(true);
      try { await removeTipParticipant(participantId); await load(); }
      catch (e) { setNotice({ tone: "error", message: (e as Error).message }); }
      finally { setBusy(false); }
    } else {
      setRows((prev) => prev.filter((r) => r.employeeId !== employeeId));
    }
  }

  async function submitVale(participantId: string) {
    if (!newVale.amount || Number(newVale.amount) <= 0) { setNotice({ tone: "warning", message: "Informe o valor do vale." }); return; }
    setBusy(true);
    try {
      await addTipVale(participantId, { type: newVale.type, amount: Number(newVale.amount), date: newVale.date || undefined });
      setNewVale({ type: "REFEICAO", amount: "", date: "" });
      await load();
    } catch (e) {
      setNotice({ tone: "error", message: (e as Error).message });
    } finally { setBusy(false); }
  }

  async function delVale(id: string) {
    setBusy(true);
    try { await removeTipVale(id); await load(); }
    catch (e) { setNotice({ tone: "error", message: (e as Error).message }); }
    finally { setBusy(false); }
  }

  async function closePeriod() {
    setBusy(true);
    try {
      const c = await closeTipPeriodApi(year, month);
      setComp(c);
      setRows(toRows(c));
      setNotice({ tone: "success", message: "Período fechado. Comissão líquida disponível para a folha." });
    } catch (e) {
      setNotice({ tone: "error", message: (e as Error).message });
    } finally { setBusy(false); }
  }

  // Carrega/recarrega do cadastro quem participa da gorjeta (inclusive desligados).
  async function syncFromCadastro() {
    setBusy(true);
    try {
      const id = await ensurePeriod();
      if (!id) return;
      const { added, computation } = await syncTipParticipants(id);
      setComp(computation);
      setRows(toRows(computation));
      setNotice({
        tone: "success",
        message: added > 0 ? `${added} funcionário(s) carregado(s) do cadastro.` : "Todos que participam da gorjeta já estão no período.",
      });
    } catch (e) {
      setNotice({ tone: "error", message: (e as Error).message });
    } finally { setBusy(false); }
  }

  // Exporta o PDF de envio ao RH: por empresa, colunas Nome/HE/Adicional/Comissão/Faltas/Justificada.
  async function exportRhPdf() {
    if (!comp) return;
    try {
    const { jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;
    const doc = new jsPDF();
    const marginX = 14;
    let y = 16;
    doc.setFontSize(14);
    doc.text("Fechamento de Gorjetas — Envio RH", marginX, y);
    y += 7;
    doc.setFontSize(10);
    doc.setTextColor(90);
    doc.text(`Competência: ${MONTHS[month - 1]} / ${year}   ·   Período: ${comp.label}`, marginX, y);
    doc.setTextColor(0);
    y += 4;

    // Agrupa por empresa (nome); "Sem empresa" quando não definida.
    const groups = new Map<string, typeof comp.participants>();
    for (const p of sortParticipants(comp.participants)) {
      const key = p.companyName || "Sem empresa";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }

    for (const [company, list] of groups) {
      const totalComissao = list.reduce((acc, p) => acc + p.netCommission, 0);
      autoTable(doc, {
        startY: y + 4,
        head: [[company, "Hora Extra", "Adicional Noturno", "Comissão", "Faltas", "Justificada"]],
        body: list.map((p) => [
          p.employeeName,
          p.horaExtra ?? "",
          p.adicionalNoturno ?? "",
          money(p.netCommission),
          p.faltas != null ? String(p.faltas) : "",
          p.justificada ? "Sim" : "Não",
        ]),
        foot: [["Total", "", "", money(totalComissao), "", ""]],
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [107, 79, 42], textColor: 255 },
        footStyles: { fillColor: [240, 236, 229], textColor: 0, fontStyle: "bold" },
        columnStyles: { 3: { halign: "right" }, 1: { halign: "center" }, 2: { halign: "center" }, 4: { halign: "center" }, 5: { halign: "center" } },
        theme: "grid",
        margin: { left: marginX, right: marginX },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
    }

    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text("Comissão = rateio da gorjeta (líquido de vales). Hora Extra, Adicional Noturno, Faltas e Justificada são preenchidos pela contabilidade.", marginX, y);
    doc.save(`Fechamento_Gorjetas_${MONTHS[month - 1]}_${year}.pdf`);
    } catch (err) {
      console.error("[PDF] erro ao gerar", err);
      setNotice({ tone: "error", message: "Erro ao gerar PDF: " + (err as Error).message });
    }
  }

  const availableEmployees = employees.filter((e) => !rows.some((r) => r.employeeId === e.id));
  const check = comp?.check;
  const valesParticipant = comp?.participants.find((p) => p.participantId === valesFor) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Notice notice={notice} />

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Button variant="secondary" onClick={() => changeMonth(-1)} aria-label="Mês anterior" leadingIcon={<ChevronLeft size={14} />}>Anterior</Button>
        <strong style={{ minWidth: 160, textAlign: "center" }}>{MONTHS[month - 1]} / {year}</strong>
        <Button variant="secondary" onClick={() => changeMonth(1)} aria-label="Próximo mês" leadingIcon={<ChevronRight size={14} />}>Próximo</Button>
        <Button variant="secondary" onClick={() => void load()} aria-label="Recarregar" leadingIcon={<RefreshCw size={14} />}>Recarregar</Button>
        <span style={{ color: "var(--muted)", fontSize: 13 }}>{comp?.label}{closed ? " — FECHADA" : ""}</span>
      </div>

      {comp?.periodId == null && (
        <div style={{ ...panelStyle, gap: 4 }}>
          <span>Nenhum período aberto para esta competência.</span>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>
            Ajuste os valores e clique em <strong>Salvar totais</strong>, ou adicione um participante — o período é aberto automaticamente puxando o serviço do Faturamento Salão (26 → 25).
          </span>
        </div>
      )}

      <FormGrid cols={4}>
        <SummaryCard compact label="Total arrecadado (serviço)" moneyValue={comp?.grossPool ?? 0} icon={<Coins size={16} />} />
        <SummaryCard compact label={`Total líquido (−${comp?.deductionPercent ?? 20}%)`} moneyValue={comp?.netPool ?? 0} tone="info" />
        <SummaryCard compact label="Valor do ponto" moneyValue={comp?.pointValue ?? 0} tone="warning" />
        <SummaryCard compact label="Comissão líquida total" moneyValue={comp?.totals.netCommission ?? 0} tone="success" />
      </FormGrid>

      <div style={panelStyle}>
        <strong>Total arrecadado do período</strong>
        <FormGrid cols={4}>
          <FormField label="Início do período">
            <input style={inputStyle} type="date" value={startInput} disabled={readonly} onChange={(e) => setStartInput(e.target.value)} />
          </FormField>
          <FormField label="Fim do período">
            <input style={inputStyle} type="date" value={endInput} disabled={readonly} onChange={(e) => setEndInput(e.target.value)} />
          </FormField>
          <div style={{ gridColumn: "span 2", display: "flex", alignItems: "center", color: "var(--muted)", fontSize: 12 }}>
            Datas editáveis. O sistema impede sobreposição com outro período (não paga em duplicidade). Mudar as datas repuxa o total do Faturamento no intervalo.
          </div>
        </FormGrid>
        <FormGrid cols={4}>
          <FormField label="Total arrecadado (serviço) R$">
            <input style={inputStyle} type="number" step="0.01" value={poolInput} disabled={readonly} onChange={(e) => setPoolInput(e.target.value)} />
          </FormField>
          <FormField label="Dedução (%)">
            <input style={inputStyle} type="number" step="0.01" value={deductionInput} disabled={readonly} onChange={(e) => setDeductionInput(e.target.value)} />
          </FormField>
          <FormField label="Total de pontos do rateio">
            <input style={inputStyle} type="number" step="1" min="1" value={pointsTotalInput} disabled={readonly} onChange={(e) => setPointsTotalInput(e.target.value)} />
          </FormField>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <Button onClick={() => void savePool()} disabled={readonly || busy} leadingIcon={<Save size={14} />}>Salvar totais</Button>
          </div>
        </FormGrid>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>
          Origem: {comp?.periodId ? "valor salvo no período (edite e salve para ajustar)" : "puxado do Faturamento Salão"}. As cotas fixas saem do total líquido antes do rateio. O valor do ponto = total líquido ÷ total de pontos.
        </span>
      </div>

      {!readonly && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <FormField label="Adicionar funcionário">
            <select style={{ ...inputStyle, minWidth: 260 }} value={addEmpId} onChange={(e) => setAddEmpId(e.target.value)}>
              <option value="">Selecione…</option>
              {availableEmployees.map((e) => (
                <option key={e.id} value={e.id}>{(e.displayName || `${e.firstName} ${e.lastName}`).trim()}</option>
              ))}
            </select>
          </FormField>
          <Button variant="secondary" onClick={addEmployee} disabled={!addEmpId} leadingIcon={<Plus size={14} />}>Adicionar</Button>
          <Button variant="secondary" onClick={() => void syncFromCadastro()} disabled={busy} title="Traz do cadastro quem participa da gorjeta (inclusive desligados)" leadingIcon={<UserPlus size={14} />}>Carregar do cadastro</Button>
          <Button
            onClick={() => void saveParticipants()}
            disabled={busy || overAllocatedLocal}
            title={overAllocatedLocal ? "A soma dos pontos ultrapassa o total definido." : undefined}
            leadingIcon={<Save size={14} />}
          >
            Salvar participantes
          </Button>
        </div>
      )}

      {comp?.periodId != null && (
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", fontSize: 14 }}>
          <span>Pontos distribuídos: <strong>{sumRowPoints}</strong> / total definido: <strong>{budgetLocal}</strong></span>
          {overAllocatedLocal ? (
            <span style={{ color: "var(--danger, #b91c1c)", fontWeight: 600 }}>
              excede em {sumRowPoints - budgetLocal} ponto(s) — ajuste para salvar
            </span>
          ) : remainingLocal > 0 ? (
            <span style={{ color: "var(--warning, #b45309)", fontWeight: 600 }}>
              faltam {remainingLocal} ponto(s){comp && comp.undistributedAmount > 0 ? ` (${money(comp.undistributedAmount)} não distribuído)` : ""}
            </span>
          ) : (
            <span style={{ color: "var(--success, #15803d)", fontWeight: 600 }}>distribuição completa ✓</span>
          )}
          {autoSaving && <span style={{ color: "var(--muted)" }}>· recalculando…</span>}
        </div>
      )}
      {overAllocatedLocal && <Alert tone="error">A soma dos pontos ({sumRowPoints}) ultrapassa o total definido ({budgetLocal}). A soma não pode passar do total — reduza os pontos ou aumente o total do rateio.</Alert>}

      <Table>
        <Table.Head>
          <Table.Row>
            <Table.Th minWidth={180}>Funcionário</Table.Th>
            <Table.Th>Tipo</Table.Th>
            <Table.Th>Pontos</Table.Th>
            <Table.Th>Cota fixa</Table.Th>
            <Table.Th>Rateio</Table.Th>
            <Table.Th>Vales</Table.Th>
            <Table.Th>Comissão líquida</Table.Th>
            <Table.Th> </Table.Th>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {rows.map((r) => {
            const c = compByEmp.get(r.employeeId);
            return (
              <Table.Row key={r.employeeId}>
                <Table.Td style={{ fontWeight: 500 }}>{r.employeeName}</Table.Td>
                <Table.Td>
                  <select style={inputStyle} value={r.kind} disabled={readonly} onChange={(e) => setRow(r.employeeId, { kind: e.target.value as TipParticipantKind })}>
                    <option value="PONTOS">Pontos</option>
                    <option value="FIXO">Fixo</option>
                  </select>
                </Table.Td>
                <Table.Td>
                  {r.kind === "PONTOS"
                    ? <input style={{ ...inputStyle, width: 90 }} type="number" step="1" value={r.points} disabled={readonly} onChange={(e) => setRow(r.employeeId, { points: e.target.value })} />
                    : <span style={{ color: "var(--muted)" }}>—</span>}
                </Table.Td>
                <Table.Td>
                  {r.kind === "FIXO"
                    ? <input style={{ ...inputStyle, width: 110 }} type="number" step="0.01" value={r.fixedAmount} disabled={readonly} onChange={(e) => setRow(r.employeeId, { fixedAmount: e.target.value })} />
                    : <span style={{ color: "var(--muted)" }}>—</span>}
                </Table.Td>
                <Table.Td><Money value={c?.rateioAmount ?? 0} /></Table.Td>
                <Table.Td>
                  <button
                    type="button"
                    onClick={() => setValesFor(valesFor === c?.participantId ? null : (c?.participantId ?? null))}
                    disabled={!c?.participantId}
                    style={{ border: "1px solid var(--border)", borderRadius: 8, background: "transparent", color: "inherit", padding: "4px 8px", cursor: c?.participantId ? "pointer" : "default" }}
                    title={c?.participantId ? "Ver / lançar vales" : "Salve o participante para lançar vales"}
                  >
                    {money(c?.valesTotal ?? 0)} ▾
                  </button>
                </Table.Td>
                <Table.Td style={{ fontWeight: 600 }}><Money value={c?.netCommission ?? 0} /></Table.Td>
                <Table.Td>
                  {!readonly && (
                    <button type="button" onClick={() => void delParticipant(c?.participantId ?? null, r.employeeId)} aria-label="Remover" style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)" }}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </Table.Td>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table>

      {comp?.periodId != null && rows.length > 0 && (
        <div style={panelStyle}>
          <strong>Dados para o RH <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 13 }}>(informados por você; vão no PDF de envio junto com a comissão)</span></strong>
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.Th minWidth={180}>Funcionário</Table.Th>
                <Table.Th>Hora Extra</Table.Th>
                <Table.Th>Adicional Noturno</Table.Th>
                <Table.Th>Faltas</Table.Th>
                <Table.Th>Justificada</Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {rows.map((r) => (
                <Table.Row key={r.employeeId}>
                  <Table.Td style={{ fontWeight: 500 }}>{r.employeeName}</Table.Td>
                  <Table.Td><input style={{ ...inputStyle, width: 110 }} value={r.horaExtra} disabled={readonly} placeholder="ex.: 1,05" onChange={(e) => setRow(r.employeeId, { horaExtra: e.target.value })} /></Table.Td>
                  <Table.Td><input style={{ ...inputStyle, width: 110 }} value={r.adicionalNoturno} disabled={readonly} placeholder="ex.: 2,10" onChange={(e) => setRow(r.employeeId, { adicionalNoturno: e.target.value })} /></Table.Td>
                  <Table.Td><input style={{ ...inputStyle, width: 80 }} type="number" step="1" min="0" value={r.faltas} disabled={readonly} onChange={(e) => setRow(r.employeeId, { faltas: e.target.value })} /></Table.Td>
                  <Table.Td>
                    <select style={{ ...inputStyle, width: 90 }} value={r.justificada ? "S" : "N"} disabled={readonly} onChange={(e) => setRow(r.employeeId, { justificada: e.target.value === "S" })}>
                      <option value="N">Não</option>
                      <option value="S">Sim</option>
                    </select>
                  </Table.Td>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      )}

      {valesParticipant && (
        <div style={panelStyle}>
          <strong>Vales de {valesParticipant.employeeName} <span style={{ color: "var(--muted)", fontWeight: 400 }}>(descontados por dentro da comissão — não aparecem no holerite)</span></strong>
          {valesParticipant.vales.length === 0 && <span style={{ color: "var(--muted)" }}>Sem vales lançados.</span>}
          {valesParticipant.vales.map((v) => (
            <div key={v.id} style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{ minWidth: 140 }}>{VALE_LABELS[v.type]}</span>
              <span style={{ minWidth: 100 }}>{money(v.amount)}</span>
              <span style={{ color: "var(--muted)", minWidth: 60 }}>{fmtDate(v.date)}</span>
              {!readonly && <button type="button" onClick={() => void delVale(v.id)} aria-label="Remover vale" style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)" }}><Trash2 size={14} /></button>}
            </div>
          ))}
          {!readonly && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 4 }}>
              <FormField label="Tipo">
                <select style={{ ...inputStyle, width: 170 }} value={newVale.type} onChange={(e) => setNewVale({ ...newVale, type: e.target.value as TipValeType })}>
                  {VALE_TYPES.map((t) => <option key={t} value={t}>{VALE_LABELS[t]}</option>)}
                </select>
              </FormField>
              <FormField label="Valor R$">
                <input style={{ ...inputStyle, width: 120 }} type="number" step="0.01" value={newVale.amount} onChange={(e) => setNewVale({ ...newVale, amount: e.target.value })} />
              </FormField>
              <FormField label="Data">
                <input style={{ ...inputStyle, width: 160 }} type="date" value={newVale.date} onChange={(e) => setNewVale({ ...newVale, date: e.target.value })} />
              </FormField>
              <Button variant="secondary" onClick={() => valesParticipant.participantId && void submitVale(valesParticipant.participantId)} leadingIcon={<Plus size={14} />}>Lançar vale</Button>
            </div>
          )}
        </div>
      )}

      {check && (
        <div style={panelStyle}>
          <strong>Conferência</strong>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <span>Σ rateios: <strong>{money(check.sumRateios)}</strong></span>
            <span>Total líquido: <strong>{money(check.expectedNetPool)}</strong></span>
            <span style={{ color: check.ok ? "var(--success, #15803d)" : "var(--danger, #b91c1c)", fontWeight: 600 }}>
              {check.ok ? "bate ✓" : `diferença ${money(check.diff)}`}
            </span>
          </div>
          {(comp?.warnings ?? []).map((w, i) => <Alert key={i} tone="warning">{w}</Alert>)}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        {closed
          ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--muted)" }}><Lock size={14} /> Período fechado.</span>
          : <Button onClick={() => void closePeriod()} disabled={!canApprove || busy || !check?.ok || !comp?.periodId} leadingIcon={<Check size={14} />}>Fechar período</Button>}
        {comp?.periodId && <Button variant="secondary" onClick={() => void exportRhPdf()} leadingIcon={<FileText size={14} />}>Exportar PDF (RH)</Button>}
      </div>
    </div>
  );
}
