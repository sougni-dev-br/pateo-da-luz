import { Banknote, Bus, Check, ChevronLeft, ChevronRight, Clock, Coins, Palmtree, Pencil, Printer, RefreshCw, Settings, Trash2, Wallet, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Employee, PayrollComputedItem, PayrollItemType, PayrollKind, PayrollList, PayrollListItem, PayrollOverride, PayrollPreview, PayrollSettings,
  deletePayrollItem, editPayrollItem, generatePayroll, getEmployees, getPayroll, getPayrollSettings,
  previewPayroll, releaseVacation, savePayrollSettings
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { useSession } from "../context/SessionContext";
import {
  Alert, Button, EmptyState, FormField, FormGrid, IconButton, Money, PanelEyebrow, RowMenu, Select, StatusBadge, SummaryCard, Table, Textarea, TextField
} from "../design-system";
import { hasPermission } from "../lib/permissions";
import { maskMoney, moneyToMasked } from "../utils/format";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const TYPE_LABELS: Record<PayrollItemType, string> = { ADIANTAMENTO: "Adiantamento", SALARIO: "Salário", VALE_TRANSPORTE: "Vale-transporte", RESCISAO: "Rescisão", FERIAS: "Férias" };
const TYPE_TONE: Record<PayrollItemType, "info" | "warning" | "neutral" | "danger"> = { VALE_TRANSPORTE: "info", ADIANTAMENTO: "warning", SALARIO: "neutral", RESCISAO: "danger", FERIAS: "info" };

function money(v: string | number | null) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  return isNaN(n) ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "UTC" });
}
function toNumStr(s: string) {
  const t = s.trim();
  return t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
}

// Apelido ("Como quero ser chamado") — pílula sutil ao lado do nome completo.
function NickTag({ nick }: { nick: string | null | undefined }) {
  if (!nick) return null;
  return (
    <span
      title="Como quero ser chamado — nome que aparece na escala"
      style={{ marginLeft: 6, fontSize: "0.72em", fontWeight: 600, color: "var(--muted)", border: "1px solid var(--border)", padding: "0 6px", borderRadius: 999, verticalAlign: "middle", whiteSpace: "nowrap" }}
    >
      {nick}
    </span>
  );
}

const emptySettingsForm = {
  busFare: "", metroFare: "", integratedFare: "", monthlyPassBus: "", monthlyPassIntegrated: "",
  advancePercent: "", advanceDueDay: "", salaryDueDay: "", bufferDays: ""
};

export function Folha() {
  const { user } = useSession();
  const canEdit = hasPermission(user, "payroll", "edit");
  const { notice, setNotice } = useNotice();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [list, setList] = useState<PayrollList | null>(null);
  const [preview, setPreview] = useState<PayrollPreview | null>(null);
  // Escopo da prévia (VT ou folha) e valores ajustados à mão antes de gerar.
  const [previewScope, setPreviewScope] = useState<"VT" | "FOLHA">("VT");
  const [ajustes, setAjustes] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<PayrollSettings | null>(null);
  const [settingsForm, setSettingsForm] = useState(emptySettingsForm);
  const [showSettings, setShowSettings] = useState(false);
  // Conferência do VT antes de mandar pagar: lista por quinzena, com total.
  const [showVtConf, setShowVtConf] = useState(false);
  const [vtQuinzena, setVtQuinzena] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showVacation, setShowVacation] = useState(false);
  const [vacBusy, setVacBusy] = useState(false);
  const [vacError, setVacError] = useState<string | null>(null);
  const emptyVacForm = { employeeId: "", startDate: "", endDate: "", amount: "", dueDate: "", notes: "" };
  const [vacForm, setVacForm] = useState(emptyVacForm);
  const [editItem, setEditItem] = useState<PayrollListItem | null>(null);
  const [editForm, setEditForm] = useState({ amount: "", dueDate: "", startDate: "", endDate: "" });
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deletingItem, setDeletingItem] = useState<PayrollListItem | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const l = await getPayroll(year, month);
      setList(l);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar folha.");
    } finally {
      setLoading(false);
    }
  }

  function applySettings(s: PayrollSettings) {
    setSettings(s);
    setSettingsForm({
      busFare: s.busFare, metroFare: s.metroFare, integratedFare: s.integratedFare,
      monthlyPassBus: s.monthlyPassBus, monthlyPassIntegrated: s.monthlyPassIntegrated,
      advancePercent: s.advancePercent, advanceDueDay: String(s.advanceDueDay),
      salaryDueDay: String(s.salaryDueDay), bufferDays: String(s.bufferDays)
    });
  }

  useEffect(() => { void load(); setPreview(null); }, [year, month]);
  useEffect(() => { getPayrollSettings().then(applySettings).catch(() => undefined); }, []);
  useEffect(() => { getEmployees({}).then(setEmployees).catch(() => undefined); }, []);

  function openVacation() {
    setVacForm(emptyVacForm);
    setVacError(null);
    setShowVacation(true);
  }

  async function handleReleaseVacation() {
    const amount = Number(toNumStr(vacForm.amount));
    if (!vacForm.employeeId || !vacForm.startDate || !vacForm.endDate) {
      setVacError("Funcionário, início e fim das férias são obrigatórios.");
      return;
    }
    if (vacForm.endDate < vacForm.startDate) {
      setVacError("O fim das férias não pode ser antes do início.");
      return;
    }
    if (!(amount > 0)) {
      setVacError("Informe o valor das férias (da contabilidade).");
      return;
    }
    setVacError(null);
    setVacBusy(true);
    try {
      await releaseVacation({
        employeeId: vacForm.employeeId,
        startDate: vacForm.startDate,
        endDate: vacForm.endDate,
        amount,
        dueDate: vacForm.dueDate || undefined,
        notes: vacForm.notes || undefined,
      });
      setNotice({ tone: "success", message: "Férias lançadas — em Contas a Pagar e marcadas na escala." });
      setShowVacation(false);
      await load();
    } catch (err) {
      setVacError(err instanceof Error ? err.message : "Erro ao lançar férias.");
    } finally {
      setVacBusy(false);
    }
  }

  function goMonth(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setMonth(m);
    setYear(y);
  }

  // A prévia é sempre calculada inteira (é read-only e barata), mas mostrada
  // por escopo: VT é VT, folha é folha — não misturar as duas coisas na tela.
  async function handlePreview(scope: "VT" | "FOLHA") {
    setBusy(true);
    setError(null);
    setAjustes({});
    setPreviewScope(scope);
    try {
      setPreview(await previewPayroll(year, month));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao calcular a prévia.");
    } finally {
      setBusy(false);
    }
  }

  const chaveAjuste = (i: PayrollComputedItem) => `${i.employeeId}|${i.type}|${i.periodLabel}`;
  function setAjuste(i: PayrollComputedItem, valor: string) {
    setAjustes((prev) => ({ ...prev, [chaveAjuste(i)]: valor }));
  }
  // Ajustes válidos e realmente diferentes do calculado.
  function ajustesParaEnviar(itens: PayrollComputedItem[]): PayrollOverride[] {
    return itens.flatMap((i) => {
      const bruto = ajustes[chaveAjuste(i)];
      if (bruto == null || bruto.trim() === "") return [];
      const valor = Number(toNumStr(bruto));
      if (!Number.isFinite(valor) || valor <= 0 || valor === i.amount) return [];
      return [{ employeeId: i.employeeId, type: i.type, periodLabel: i.periodLabel, amount: valor }];
    });
  }

  // Folha de conferência do VT para levar ao pagamento — autocontida, via iframe.
  function handlePrintVt() {
    const linhas = vtDaQuinzena.map((i) => `<tr>
      <td class="l">${i.employeeDisplayName?.trim() || i.employeeName}</td>
      <td class="l">${i.sector ?? "—"}</td>
      <td>${i.workedDays ?? "—"}</td>
      <td>${i.freeDays ?? "—"}</td>
      <td>${i.creditApplied ? money(i.creditApplied) : "—"}</td>
      <td class="v">${money(i.amount)}</td>
      <td>${i.status === "PAID" ? "Pago" : "Em aberto"}</td>
    </tr>`).join("");
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="color-scheme" content="light">
<title>VT ${vtQuinzena}a quinzena ${MONTHS[month - 1]} ${year}</title><style>
:root{color-scheme:light}*{font-family:Arial,Helvetica,sans-serif;box-sizing:border-box}
body{background:#fff;color:#000;margin:16px}@page{margin:10mm}
h1{font-size:19px;margin:0 0 2px}.sub{font-size:12px;color:#555;margin:0 0 12px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #777;font-size:12px;padding:5px 6px;text-align:center}
th{background:#eee}td.l,th.l{text-align:left}td.v{text-align:right;font-weight:bold}
tfoot td{font-weight:bold;background:#f4f4f4;font-size:13px}
.ass{margin-top:34px;font-size:12px;color:#333}
</style></head><body>
<h1>Vale-transporte — ${vtQuinzena}ª quinzena · ${MONTHS[month - 1]} ${year}</h1>
<div class="sub">Pateo da Luz · ${vtDaQuinzena.length} funcionário(s)</div>
<table>
<thead><tr><th class="l">Funcionário</th><th class="l">Setor</th><th>Dias</th><th>Grátis</th><th>Crédito</th><th>Valor</th><th>Situação</th></tr></thead>
<tbody>${linhas}</tbody>
<tfoot><tr><td class="l" colspan="5">Total da quinzena</td><td class="v">${money(vtTotal)}</td><td></td></tr></tfoot>
</table>
<div class="ass">Conferido por: ____________________________&nbsp;&nbsp;&nbsp;&nbsp;Data: ____/____/______</div>
</body></html>`;
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;left:-10000px;top:0;width:210mm;height:290mm;border:0";
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) { document.body.removeChild(iframe); return; }
    doc.open(); doc.write(html); doc.close();
    iframe.contentWindow?.focus();
    setTimeout(() => {
      iframe.contentWindow?.print();
      setTimeout(() => { if (iframe.parentNode) document.body.removeChild(iframe); }, 1500);
    }, 300);
  }

  async function handleGenerate(kind: PayrollKind = "ALL") {
    setBusy(true);
    setError(null);
    try {
      const res = await generatePayroll(year, month, kind, ajustesParaEnviar(itensDoEscopo));
      const oque = kind === "VT_Q1" ? "VT da 1ª quinzena gerado"
        : kind === "VT_Q2" ? "VT da 2ª quinzena gerado"
        : kind === "VT" ? "Vale-transporte gerado"
        : kind === "FOLHA" ? "Folha gerada" : "VT + folha gerados";
      const comAjuste = res.ajustados > 0 ? ` · ${res.ajustados} com valor ajustado` : "";
      setNotice({ tone: "success", message: `${oque} — ${res.created} lançamento(s) criado(s), ${res.skipped} já existiam${comAjuste}.` });
      setPreview(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao gerar folha.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSettings() {
    setBusy(true);
    try {
      const saved = await savePayrollSettings({
        busFare: toNumStr(settingsForm.busFare) as unknown as string,
        metroFare: toNumStr(settingsForm.metroFare) as unknown as string,
        integratedFare: toNumStr(settingsForm.integratedFare) as unknown as string,
        monthlyPassBus: toNumStr(settingsForm.monthlyPassBus) as unknown as string,
        monthlyPassIntegrated: toNumStr(settingsForm.monthlyPassIntegrated) as unknown as string,
        advancePercent: toNumStr(settingsForm.advancePercent) as unknown as string,
        advanceDueDay: Number(settingsForm.advanceDueDay) as unknown as number,
        salaryDueDay: Number(settingsForm.salaryDueDay) as unknown as number,
        bufferDays: Number(settingsForm.bufferDays) as unknown as number
      });
      applySettings(saved);
      setNotice({ tone: "success", message: "Configurações salvas." });
      setShowSettings(false);
    } catch (err) {
      setNotice({ tone: "error", message: err instanceof Error ? err.message : "Erro ao salvar configurações." });
    } finally {
      setBusy(false);
    }
  }

  function openEdit(item: PayrollListItem) {
    setEditItem(item);
    setEditForm({
      amount: moneyToMasked(item.amount),
      dueDate: item.dueDate ? String(item.dueDate).slice(0, 10) : "",
      startDate: item.periodStart ? String(item.periodStart).slice(0, 10) : "",
      endDate: item.periodEnd ? String(item.periodEnd).slice(0, 10) : "",
    });
    setEditError(null);
  }

  async function handleEdit() {
    if (!editItem) return;
    const amount = Number(toNumStr(editForm.amount));
    if (!(amount > 0)) { setEditError("Informe um valor maior que zero."); return; }
    if (!editForm.dueDate) { setEditError("Informe o vencimento."); return; }
    const isFerias = editItem.type === "FERIAS";
    if (isFerias && editForm.startDate && editForm.endDate && editForm.endDate < editForm.startDate) {
      setEditError("O fim das férias não pode ser antes do início."); return;
    }
    setEditError(null);
    setEditBusy(true);
    try {
      await editPayrollItem(editItem.id, {
        amount,
        dueDate: editForm.dueDate,
        ...(isFerias ? { startDate: editForm.startDate || undefined, endDate: editForm.endDate || undefined } : {}),
      });
      setNotice({ tone: "success", message: "Lançamento atualizado." });
      setEditItem(null);
      await load();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Erro ao editar lançamento.");
    } finally {
      setEditBusy(false);
    }
  }
  function openDelete(item: PayrollListItem) {
    setDeletingItem(item);
    setDeleteReason("");
    setDeleteError(null);
  }

  async function confirmDelete() {
    if (!deletingItem) return;
    if (deleteReason.trim().length < 3) { setDeleteError("Informe a justificativa da exclusão (mín. 3 caracteres)."); return; }
    setDeleteError(null);
    setDeleteBusy(true);
    try {
      await deletePayrollItem(deletingItem.id, deleteReason.trim());
      setNotice({ tone: "success", message: "Lançamento excluído." });
      setDeletingItem(null);
      await load();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Erro ao excluir.");
    } finally {
      setDeleteBusy(false);
    }
  }

  const s = list?.summary;
  // Só os itens do escopo escolhido aparecem e são gerados.
  const itensDoEscopo: PayrollComputedItem[] = preview
    ? preview.items.filter((i) => (previewScope === "VT" ? i.type === "VALE_TRANSPORTE" : i.type === "ADIANTAMENTO" || i.type === "SALARIO"))
    : [];
  const previewNew = itensDoEscopo.filter((i) => !i.exists).length;
  // Total do escopo já refletindo os ajustes manuais — é o que vai ser gerado.
  const previewTotal = itensDoEscopo.filter((i) => !i.exists).reduce((a, i) => {
    const bruto = ajustes[`${i.employeeId}|${i.type}|${i.periodLabel}`];
    const v = bruto == null || bruto.trim() === "" ? NaN : Number(toNumStr(bruto));
    return a + (Number.isFinite(v) && v > 0 ? v : i.amount);
  }, 0);
  // VT e folha são fechamentos independentes, e o VT ainda fecha por quinzena
  // (a 2ª só depois que a escala da segunda metade do mês está pronta).
  const novosVtDe = (q: 1 | 2) =>
    itensDoEscopo.filter((i) => !i.exists && i.type === "VALE_TRANSPORTE" && (new Date(i.dueDate).getUTCDate() <= 15 ? 1 : 2) === q).length;
  const novosVtQ1 = novosVtDe(1);
  const novosVtQ2 = novosVtDe(2);
  const novosFolha = itensDoEscopo.filter((i) => !i.exists && (i.type === "ADIANTAMENTO" || i.type === "SALARIO")).length;

  // Conferência: VT já lançado da quinzena escolhida, ordenado por funcionário.
  const quinzenaDe = (iso: string) => (new Date(iso).getUTCDate() <= 15 ? 1 : 2);
  const vtDaQuinzena = (list?.items ?? [])
    .filter((i) => i.type === "VALE_TRANSPORTE" && quinzenaDe(i.dueDate) === vtQuinzena)
    .sort((a, b) => (a.employeeName || "").localeCompare(b.employeeName || "", "pt-BR"));
  const vtTotal = vtDaQuinzena.reduce((s, i) => s + Number(i.amount), 0);
  const vtPago = vtDaQuinzena.filter((i) => i.status === "PAID").reduce((s, i) => s + Number(i.paidAmount ?? i.amount), 0);
  const vtAberto = vtTotal - vtDaQuinzena.filter((i) => i.status === "PAID").reduce((s, i) => s + Number(i.amount), 0);

  function periodCell(item: { periodLabel: string; workedDays: number | null; freeDays: number | null }) {
    return (
      <>
        <div>{item.periodLabel}</div>
        {item.workedDays != null && (
          <div style={{ fontSize: "0.8em", color: "var(--muted)" }}>
            {item.workedDays} dia(s){item.freeDays ? ` · ${item.freeDays} c/ ônibus grátis` : ""}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="stack">
      <Notice notice={notice} />

      <section className="panel">
        <div className="section-heading">
          <div>
            <PanelEyebrow>Pessoal</PanelEyebrow>
            <h2>Folha de pagamento</h2>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Button variant="secondary" onClick={() => goMonth(-1)} aria-label="Mês anterior"><ChevronLeft size={16} /></Button>
            <strong style={{ minWidth: 130, textAlign: "center" }}>{MONTHS[month - 1]} {year}</strong>
            <Button variant="secondary" onClick={() => goMonth(1)} aria-label="Próximo mês"><ChevronRight size={16} /></Button>
            <Button variant="secondary" onClick={load} aria-label="Recarregar"><RefreshCw size={15} /></Button>
            <Button variant="secondary" leadingIcon={<Settings size={14} />} onClick={() => setShowSettings((v) => !v)}>Configurações</Button>
            <Button variant="secondary" leadingIcon={<Bus size={14} />} onClick={() => setShowVtConf(true)}>Conferir VT</Button>
            {canEdit && <Button variant="secondary" leadingIcon={<Palmtree size={14} />} onClick={openVacation}>Lançar férias</Button>}
            {canEdit && <Button variant="secondary" leadingIcon={<Bus size={14} />} onClick={() => handlePreview("VT")} disabled={busy}>Prever VT</Button>}
            {canEdit && <Button leadingIcon={<Wand2 size={14} />} onClick={() => handlePreview("FOLHA")} disabled={busy}>Prever folha</Button>}
          </div>
        </div>

        {/* Configurações */}
        {showSettings && settings && (
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14, margin: "0 0 14px" }}>
            <PanelEyebrow>Tarifas e regras (configuráveis)</PanelEyebrow>
            <FormGrid cols={4}>
              <FormField label="Ônibus (R$)"><TextField value={settingsForm.busFare} onChange={(e) => setSettingsForm({ ...settingsForm, busFare: e.target.value })} inputMode="decimal" /></FormField>
              <FormField label="Metrô (R$)"><TextField value={settingsForm.metroFare} onChange={(e) => setSettingsForm({ ...settingsForm, metroFare: e.target.value })} inputMode="decimal" /></FormField>
              <FormField label="Integração (R$)"><TextField value={settingsForm.integratedFare} onChange={(e) => setSettingsForm({ ...settingsForm, integratedFare: e.target.value })} inputMode="decimal" /></FormField>
              <FormField label="Bilhete Único Mensal — ônibus (R$)"><TextField value={settingsForm.monthlyPassBus} onChange={(e) => setSettingsForm({ ...settingsForm, monthlyPassBus: e.target.value })} inputMode="decimal" /></FormField>
              <FormField label="Bilhete Único Mensal — integrado (R$)"><TextField value={settingsForm.monthlyPassIntegrated} onChange={(e) => setSettingsForm({ ...settingsForm, monthlyPassIntegrated: e.target.value })} inputMode="decimal" /></FormField>
              <FormField label="Dias de sobra (VT)"><TextField value={settingsForm.bufferDays} onChange={(e) => setSettingsForm({ ...settingsForm, bufferDays: e.target.value.replace(/\D/g, "") })} inputMode="numeric" /></FormField>
              <FormField label="Adiantamento (%)"><TextField value={settingsForm.advancePercent} onChange={(e) => setSettingsForm({ ...settingsForm, advancePercent: e.target.value })} inputMode="decimal" /></FormField>
              <FormField label="Vencimento adiantamento (dia)"><TextField value={settingsForm.advanceDueDay} onChange={(e) => setSettingsForm({ ...settingsForm, advanceDueDay: e.target.value.replace(/\D/g, "") })} inputMode="numeric" /></FormField>
              <FormField label="Vencimento salário (dia mês seguinte)"><TextField value={settingsForm.salaryDueDay} onChange={(e) => setSettingsForm({ ...settingsForm, salaryDueDay: e.target.value.replace(/\D/g, "") })} inputMode="numeric" /></FormField>
            </FormGrid>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setShowSettings(false)}>Fechar</Button>
              {canEdit && <Button onClick={handleSaveSettings} disabled={busy}>Salvar configurações</Button>}
            </div>
          </div>
        )}

        {error && <Alert tone="error">{error}</Alert>}

        {/* Resumo */}
        {s && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(168px, 1fr))", gap: 10, margin: "0 0 16px" }}>
            <SummaryCard compact label="Total do mês" moneyValue={s.total} icon={<Wallet size={16} />} />
            <SummaryCard compact label="Vale-transporte" moneyValue={s.vt} tone="info" icon={<Bus size={16} />} />
            <SummaryCard compact label="Adiantamento" moneyValue={s.advance} tone="warning" icon={<Coins size={16} />} />
            <SummaryCard compact label="Salário" moneyValue={s.salary} icon={<Banknote size={16} />} />
            <SummaryCard compact label="Férias" moneyValue={s.ferias} tone="info" icon={<Palmtree size={16} />} />
            <SummaryCard compact label="Pago" moneyValue={s.paid} tone="success" icon={<Check size={16} />} />
            <SummaryCard compact label="Pendente" moneyValue={s.pending} tone={s.overdue > 0 ? "danger" : "warning"} detail={s.overdue > 0 ? `${money(s.overdue)} vencido` : undefined} icon={<Clock size={16} />} />
          </div>
        )}

        {/* Preview */}
        {preview && (
          <div style={{ border: "2px solid var(--border-accent, var(--border-strong, var(--border)))", borderRadius: 10, padding: 14, margin: "0 0 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
              <div>
                <PanelEyebrow>
                  Prévia · {previewScope === "VT" ? "Vale-transporte" : "Folha (adiantamento + salário)"} — {MONTHS[month - 1]} {year}
                </PanelEyebrow>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>
                  {previewNew} lançamento(s) novo(s) · total {money(previewTotal)}
                  <span style={{ marginLeft: 6 }}>(o que já existe não é recriado)</span>
                  {previewScope === "VT" && (
                    <div style={{ marginTop: 2 }}>1ª quinzena: <strong>{novosVtQ1}</strong> · 2ª quinzena: <strong>{novosVtQ2}</strong></div>
                  )}
                  <div style={{ marginTop: 2, color: "var(--ink, inherit)" }}>
                    O valor é editável — se o cálculo não bater, ajuste antes de gerar.
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button variant="secondary" onClick={() => setPreview(null)}>Cancelar</Button>
                {canEdit && previewScope === "VT" && (
                  <>
                    <Button variant="secondary" leadingIcon={<Bus size={14} />} onClick={() => handleGenerate("VT_Q1")} disabled={busy || novosVtQ1 === 0} title="Fecha só o VT da 1ª quinzena (dias 1 a 15)">
                      Gerar 1ª quinz. ({novosVtQ1})
                    </Button>
                    <Button variant="secondary" leadingIcon={<Bus size={14} />} onClick={() => handleGenerate("VT_Q2")} disabled={busy || novosVtQ2 === 0} title="Fecha só o VT da 2ª quinzena (dia 16 em diante) — use quando a escala da segunda metade já estiver pronta">
                      Gerar 2ª quinz. ({novosVtQ2})
                    </Button>
                    <Button leadingIcon={<Check size={14} />} onClick={() => handleGenerate("VT")} disabled={busy || previewNew === 0}>
                      Gerar VT ({previewNew})
                    </Button>
                  </>
                )}
                {canEdit && previewScope === "FOLHA" && (
                  <Button leadingIcon={<Banknote size={14} />} onClick={() => handleGenerate("FOLHA")} disabled={busy || novosFolha === 0} title="Fecha adiantamento + salário">
                    Gerar folha ({novosFolha})
                  </Button>
                )}
              </div>
            </div>
            {preview.warnings && preview.warnings.length > 0 && (
              <Alert tone="warning">
                {preview.warnings.map((w, i) => <div key={i}>{w}</div>)}
              </Alert>
            )}
            <div style={{ overflowX: "auto" }}>
              <Table>
                <Table.Head>
                  <Table.Row>
                    <Table.Th minWidth={160}>Funcionário</Table.Th>
                    <Table.Th>Tipo</Table.Th>
                    <Table.Th>Período</Table.Th>
                    <Table.Th>Vencimento</Table.Th>
                    <Table.Th>Valor</Table.Th>
                  </Table.Row>
                </Table.Head>
                <Table.Body>
                  {itensDoEscopo.map((i: PayrollComputedItem, idx) => {
                    const bruto = ajustes[chaveAjuste(i)] ?? "";
                    const valorAjustado = bruto.trim() === "" ? null : Number(toNumStr(bruto));
                    const mudou = valorAjustado != null && Number.isFinite(valorAjustado) && valorAjustado > 0 && valorAjustado !== i.amount;
                    const invalido = bruto.trim() !== "" && (!Number.isFinite(valorAjustado) || (valorAjustado ?? 0) <= 0);
                    return (
                      <Table.Row key={idx} style={i.exists ? { opacity: 0.5 } : undefined}>
                        <Table.Td><strong>{i.employeeName}</strong><NickTag nick={i.employeeDisplayName} />{i.sector ? <div style={{ fontSize: "0.8em", color: "var(--muted)" }}>{i.sector}</div> : null}</Table.Td>
                        <Table.Td><StatusBadge tone={TYPE_TONE[i.type]}>{TYPE_LABELS[i.type]}</StatusBadge></Table.Td>
                        <Table.Td>{periodCell(i)}{i.creditApplied ? <div style={{ fontSize: "0.78em", color: "var(--muted)" }}>+{money(i.bufferAmount)} sobra − {money(i.creditApplied)} crédito</div> : null}</Table.Td>
                        <Table.Td style={{ whiteSpace: "nowrap" }}>{fmtDate(i.dueDate)}</Table.Td>
                        <Table.Td style={{ whiteSpace: "nowrap", fontWeight: 500 }}>
                          {i.exists ? (
                            <><Money value={i.amount} /><span style={{ fontSize: "0.78em", color: "var(--muted)", fontWeight: 400 }}> (já existe)</span></>
                          ) : canEdit ? (
                            <>
                              <TextField
                                value={bruto === "" ? moneyToMasked(String(i.amount)) : bruto}
                                onChange={(e) => setAjuste(i, maskMoney(e.target.value))}
                                aria-label={`Valor de ${i.employeeName} — ${TYPE_LABELS[i.type]}`}
                                style={{ width: 120, textAlign: "right", ...(invalido ? { borderColor: "var(--danger)" } : {}) }}
                              />
                              {mudou && (
                                <div style={{ fontSize: "0.75em", color: "var(--gold-dark, #9a6410)", fontWeight: 600 }}>
                                  ajustado · calculado {money(i.amount)}
                                </div>
                              )}
                              {invalido && <div style={{ fontSize: "0.75em", color: "var(--danger)" }}>valor inválido</div>}
                            </>
                          ) : (
                            <Money value={i.amount} />
                          )}
                        </Table.Td>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table>
            </div>
          </div>
        )}

        {loading && <EmptyState title="Carregando folha..." />}
        {!loading && list && list.items.length === 0 && !preview && (
          <EmptyState
            title={`Nenhum lançamento em ${MONTHS[month - 1]} ${year}.`}
            action={canEdit ? <Button leadingIcon={<Bus size={14} />} onClick={() => handlePreview("VT")}>Prever VT</Button> : undefined}
          />
        )}

        {!loading && list && list.items.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <Table>
              <Table.Head>
                <Table.Row>
                  <Table.Th minWidth={160}>Funcionário</Table.Th>
                  <Table.Th>Tipo</Table.Th>
                  <Table.Th>Período</Table.Th>
                  <Table.Th>Vencimento</Table.Th>
                  <Table.Th>Valor</Table.Th>
                  <Table.Th>Status</Table.Th>
                  {canEdit && <Table.Th actions>Ações</Table.Th>}
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {list.items.map((i) => (
                  <Table.Row key={i.id}>
                    <Table.Td><strong>{i.employeeName}</strong><NickTag nick={i.employeeDisplayName} />{i.sector ? <div style={{ fontSize: "0.8em", color: "var(--muted)" }}>{i.sector}</div> : null}</Table.Td>
                    <Table.Td><StatusBadge tone={TYPE_TONE[i.type]}>{TYPE_LABELS[i.type]}</StatusBadge></Table.Td>
                    <Table.Td>{periodCell(i)}</Table.Td>
                    <Table.Td style={{ whiteSpace: "nowrap" }}>{fmtDate(i.dueDate)}</Table.Td>
                    <Table.Td style={{ whiteSpace: "nowrap", fontWeight: 500 }}><Money value={i.amount} /></Table.Td>
                    <Table.Td>
                      <StatusBadge tone={i.status === "PAID" ? "success" : i.status === "OVERDUE" ? "danger" : "neutral"}>
                        {i.status === "PAID" ? "Pago" : i.status === "OVERDUE" ? "Vencido" : "Pendente"}
                      </StatusBadge>
                    </Table.Td>
                    {canEdit && (
                      <Table.Td actions>
                        <RowMenu
                          label={`Mais ações — ${i.employeeName}`}
                          items={[
                            ...(i.status !== "PAID" ? [{ label: "Editar", icon: <Pencil size={15} />, onClick: () => openEdit(i) }] : []),
                            { label: "Excluir", icon: <Trash2 size={15} />, tone: "danger" as const, onClick: () => openDelete(i) }
                          ]}
                        />
                      </Table.Td>
                    )}
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        )}
      </section>

      {showVtConf && (
        <div className="modal-backdrop">
          <section className="panel modal-panel">
            <div className="section-heading">
              <div>
                <PanelEyebrow>Conferência antes do pagamento</PanelEyebrow>
                <h2>Vale-transporte · {MONTHS[month - 1]} {year}</h2>
              </div>
              <Button variant="secondary" onClick={() => setShowVtConf(false)}>Fechar</Button>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "0 0 12px" }}>
              <Button variant={vtQuinzena === 1 ? undefined : "secondary"} onClick={() => setVtQuinzena(1)}>1ª quinzena</Button>
              <Button variant={vtQuinzena === 2 ? undefined : "secondary"} onClick={() => setVtQuinzena(2)}>2ª quinzena</Button>
              <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <Button variant="secondary" leadingIcon={<Printer size={14} />} onClick={handlePrintVt} disabled={vtDaQuinzena.length === 0}>Imprimir</Button>
              </span>
            </div>

            {vtDaQuinzena.length === 0 ? (
              <EmptyState
                title={`Nenhum VT lançado na ${vtQuinzena}ª quinzena`}
                description="Use 'Prever folha' e depois o botão da quinzena para gerar o vale-transporte deste período."
              />
            ) : (
              <>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", margin: "0 0 10px", fontSize: 13 }}>
                  <span><strong>{vtDaQuinzena.length}</strong> funcionário(s)</span>
                  <span>Total: <strong>{money(vtTotal)}</strong></span>
                  <span style={{ color: "var(--muted)" }}>Pago: {money(vtPago)} · Em aberto: {money(vtAberto)}</span>
                </div>
                <Table>
                  <Table.Head>
                    <Table.Row>
                      <Table.Th>Funcionário</Table.Th>
                      <Table.Th>Setor</Table.Th>
                      <Table.Th>Dias</Table.Th>
                      <Table.Th>Grátis</Table.Th>
                      <Table.Th>Crédito</Table.Th>
                      <Table.Th>Valor</Table.Th>
                      <Table.Th>Situação</Table.Th>
                    </Table.Row>
                  </Table.Head>
                  <Table.Body>
                    {vtDaQuinzena.map((i) => (
                      <Table.Row key={i.id}>
                        <Table.Td><strong>{i.employeeDisplayName?.trim() || i.employeeName}</strong></Table.Td>
                        <Table.Td>{i.sector ?? "—"}</Table.Td>
                        <Table.Td>{i.workedDays ?? "—"}</Table.Td>
                        <Table.Td>{i.freeDays ?? "—"}</Table.Td>
                        <Table.Td>{i.creditApplied ? money(i.creditApplied) : "—"}</Table.Td>
                        <Table.Td style={{ whiteSpace: "nowrap", fontWeight: 600 }}><Money value={i.amount} /></Table.Td>
                        <Table.Td>
                          <StatusBadge tone={i.status === "PAID" ? "success" : i.status === "OVERDUE" ? "danger" : "warning"}>
                            {i.status === "PAID" ? "Pago" : i.status === "OVERDUE" ? "Vencido" : "Em aberto"}
                          </StatusBadge>
                        </Table.Td>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
                <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
                  A baixa do pagamento é feita em <strong>Contas a pagar</strong> — lá dá para selecionar vários e baixar de uma vez.
                </p>
              </>
            )}
          </section>
        </div>
      )}

      {/* Modal de férias — contabilidade envia o valor */}
      {showVacation && (
        <div className="modal-backdrop">
          <section className="panel modal-panel">
            <div className="section-heading">
              <div>
                <PanelEyebrow>Férias · contabilidade envia o valor</PanelEyebrow>
                <h2>Lançar férias</h2>
              </div>
              <Button variant="secondary" onClick={() => setShowVacation(false)}>Fechar</Button>
            </div>

            <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }}>
              O período marca as férias na escala (dias sombreados, sem VT) e gera um pagamento em Contas a Pagar + DRE (categoria Férias).
            </p>

            {vacError && <div style={{ marginBottom: 12 }}><Alert tone="error">{vacError}</Alert></div>}

            <FormGrid cols={2}>
              <div className="ds-form-grid-span-all">
                <FormField label="Funcionário" required>
                  <Select
                    value={vacForm.employeeId}
                    onChange={(e) => setVacForm({ ...vacForm, employeeId: e.target.value })}
                    placeholder="Selecione o funcionário"
                    options={employees.map((emp) => ({ value: emp.id, label: `${emp.firstName} ${emp.lastName}${emp.sector ? ` — ${emp.sector}` : ""}` }))}
                  />
                </FormField>
              </div>
              <FormField label="Início das férias" required>
                <TextField type="date" value={vacForm.startDate} onChange={(e) => setVacForm({ ...vacForm, startDate: e.target.value })} />
              </FormField>
              <FormField label="Fim das férias" required>
                <TextField type="date" value={vacForm.endDate} onChange={(e) => setVacForm({ ...vacForm, endDate: e.target.value })} />
              </FormField>
              <FormField label="Valor das férias (contabilidade)" required>
                <TextField value={vacForm.amount} onChange={(e) => setVacForm({ ...vacForm, amount: maskMoney(e.target.value) })} placeholder="0,00" inputMode="numeric" />
              </FormField>
              <FormField label="Vencimento" hint="em branco = 2 dias antes do início">
                <TextField type="date" value={vacForm.dueDate} onChange={(e) => setVacForm({ ...vacForm, dueDate: e.target.value })} />
              </FormField>
              <div className="ds-form-grid-span-all">
                <FormField label="Observações">
                  <Textarea rows={2} value={vacForm.notes} onChange={(e) => setVacForm({ ...vacForm, notes: e.target.value })} />
                </FormField>
              </div>
            </FormGrid>

            <div className="form-actions">
              <Button variant="secondary" onClick={() => setShowVacation(false)}>Cancelar</Button>
              <Button onClick={handleReleaseVacation} disabled={vacBusy}>{vacBusy ? "Lançando..." : "Lançar férias"}</Button>
            </div>
          </section>
        </div>
      )}

      {/* Modal de edição de lançamento */}
      {editItem && (
        <div className="modal-backdrop">
          <section className="panel modal-panel">
            <div className="section-heading">
              <div>
                <PanelEyebrow>Editar · {TYPE_LABELS[editItem.type]}</PanelEyebrow>
                <h2>{editItem.employeeName}</h2>
              </div>
              <Button variant="secondary" onClick={() => setEditItem(null)}>Fechar</Button>
            </div>

            <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }}>
              Ajuste o valor e o vencimento. O pagamento/baixa é feito no Contas a Pagar.
            </p>

            {editError && <div style={{ marginBottom: 12 }}><Alert tone="error">{editError}</Alert></div>}

            <FormGrid cols={2}>
              <FormField label="Valor" required>
                <TextField value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: maskMoney(e.target.value) })} placeholder="0,00" inputMode="numeric" />
              </FormField>
              <FormField label="Vencimento" required>
                <TextField type="date" value={editForm.dueDate} onChange={(e) => setEditForm({ ...editForm, dueDate: e.target.value })} />
              </FormField>
              {editItem.type === "FERIAS" && (
                <>
                  <FormField label="Início das férias">
                    <TextField type="date" value={editForm.startDate} onChange={(e) => setEditForm({ ...editForm, startDate: e.target.value })} />
                  </FormField>
                  <FormField label="Fim das férias">
                    <TextField type="date" value={editForm.endDate} onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })} />
                  </FormField>
                </>
              )}
            </FormGrid>

            <div className="form-actions">
              <Button variant="secondary" onClick={() => setEditItem(null)}>Cancelar</Button>
              <Button onClick={handleEdit} disabled={editBusy}>{editBusy ? "Salvando..." : "Salvar alterações"}</Button>
            </div>
          </section>
        </div>
      )}

      {/* Modal de exclusão — exige justificativa (auditoria) */}
      {deletingItem && (
        <div className="modal-backdrop">
          <section className="panel modal-panel">
            <div className="section-heading">
              <div>
                <PanelEyebrow>Excluir · {TYPE_LABELS[deletingItem.type]}</PanelEyebrow>
                <h2>{deletingItem.employeeName}</h2>
              </div>
              <Button variant="secondary" onClick={() => setDeletingItem(null)}>Fechar</Button>
            </div>

            <Alert tone="warning">A exclusão fica registrada na auditoria (quem, quando e por quê). Não é possível excluir sem justificativa.</Alert>

            {deleteError && <div style={{ margin: "12px 0 0" }}><Alert tone="error">{deleteError}</Alert></div>}

            <div style={{ marginTop: 12 }}>
              <FormField label="Justificativa da exclusão" required>
                <Textarea rows={2} value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} placeholder="Ex.: valor lançado errado, duplicado…" />
              </FormField>
            </div>

            <div className="form-actions">
              <Button variant="secondary" onClick={() => setDeletingItem(null)}>Cancelar</Button>
              <Button onClick={confirmDelete} disabled={deleteBusy}>{deleteBusy ? "Excluindo..." : "Excluir lançamento"}</Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
