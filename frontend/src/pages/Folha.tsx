import { Banknote, Bus, Check, ChevronLeft, ChevronRight, Clock, Coins, Palmtree, Pencil, Printer, RefreshCw, Settings, Trash2, Wallet, Wand2 } from "lucide-react";
import { type CSSProperties, useEffect, useState } from "react";
import {
  Employee, PayrollComputedItem, PayrollItemType, PayrollKind, PayrollList, PayrollListItem, PayrollOverride, PayrollPreview, PayrollSettings,
  VtFare, VtFareBasis,
  createVtFare, deletePayrollItem, deleteVtFare, editPayrollItem, generatePayroll, getEmployees, getPayroll, getPayrollSettings,
  getVtFares, previewPayroll, releaseVacation, savePayrollSettings, updateVtFare
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { useSession } from "../context/SessionContext";
import {
  Alert, Button, EmptyState, FormField, FormGrid, IconButton, Money, PanelEyebrow, RowMenu, Select, StatusBadge, SummaryCard, Table, Textarea, TextField
} from "../design-system";
import { hasPermission } from "../lib/permissions";
import { maskMoney, moneyToMasked } from "../utils/format";
import { FolhaGorjeta } from "./FolhaGorjeta";
import { ExtratoRh } from "./ExtratoRh";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

// Estilo das abas (Folha de Pagamento / Fechamento de Gorjetas).
function tabButtonStyle(active: boolean): CSSProperties {
  return {
    padding: "8px 16px", border: "none", background: "transparent", cursor: "pointer",
    font: "inherit", fontWeight: active ? 700 : 500,
    color: active ? "var(--text, #111)" : "var(--muted)",
    borderBottom: active ? "2px solid var(--brand, #6b4f2a)" : "2px solid transparent",
    marginBottom: -1,
  };
}
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
// Como a tarifa se comporta nos dias de Domingão Tarifa Zero. Não é um
// "grátis sim/não": a integração ônibus+metrô CAI para a tarifa do metrô em vez
// de zerar, e a coluna precisa mostrar isso ou o número na folha vira mistério.
function gratuidadeLabel(f: { sundayAmount: string | null; amount: string }) {
  if (f.sundayAmount == null) return <span style={{ color: "var(--muted)" }}>Cobra sempre</span>;
  const dom = Number(f.sundayAmount);
  if (dom <= 0) return "Grátis no domingo";
  if (dom < Number(f.amount)) return `Domingo: ${money(f.sundayAmount)}`;
  return <span style={{ color: "var(--muted)" }}>Cobra sempre</span>;
}

// Escapa texto livre antes de entrar no HTML da impressao. Nome, setor e
// subgrupo sao digitados a mao no cadastro e vao para um document.write — sem
// isto, um "<" no nome de alguem quebra a folha, e um <script> executa.
function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function fmtDayMonth(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}
// "15/09 a 30/09" — o período que o vale cobre. É o que se confere no
// pagamento, já que o vencimento fica na véspera e não diz nada sobre os dias.
function periodRange(i: { periodStart: string | null; periodEnd: string | null }) {
  if (!i.periodStart || !i.periodEnd) return "—";
  const d = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  return `${d(i.periodStart)} a ${d(i.periodEnd)}`;
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
  vtSecondPeriodStartDay: "", advancePercent: "", advanceDueDay: "", salaryDueDay: ""
};

const emptyFareForm = {
  id: "", name: "", amount: "", basis: "VIAGEM" as VtFareBasis,
  sundayAmount: "", isActive: true, notes: ""
};

export function Folha() {
  const { user } = useSession();
  const canEdit = hasPermission(user, "payroll", "edit");
  const { notice, setNotice } = useNotice();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [tab, setTab] = useState<"folha" | "gorjeta" | "extrato">("folha");
  const [list, setList] = useState<PayrollList | null>(null);
  const [preview, setPreview] = useState<PayrollPreview | null>(null);
  // Escopo da prévia (VT ou folha) e valores ajustados à mão antes de gerar.
  const [previewScope, setPreviewScope] = useState<"VT" | "FOLHA">("VT");
  const [ajustes, setAjustes] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<PayrollSettings | null>(null);
  const [settingsForm, setSettingsForm] = useState(emptySettingsForm);
  const [showSettings, setShowSettings] = useState(false);
  const [fares, setFares] = useState<VtFare[]>([]);
  // null = formulário fechado. Abrir com uma tarifa edita; com null-interno, cria.
  const [fareForm, setFareForm] = useState<typeof emptyFareForm | null>(null);
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
      vtSecondPeriodStartDay: String(s.vtSecondPeriodStartDay),
      advancePercent: s.advancePercent, advanceDueDay: String(s.advanceDueDay),
      salaryDueDay: String(s.salaryDueDay)
    });
  }

  useEffect(() => { void load(); setPreview(null); }, [year, month]);
  useEffect(() => { getPayrollSettings().then(applySettings).catch(() => undefined); }, []);
  useEffect(() => { void loadFares(); }, []);

  async function loadFares() {
    try {
      // Inativas também: a tela de tarifas é onde se reativa uma (a EMTU nasce
      // inativa, esperando o valor da linha).
      setFares(await getVtFares(true));
    } catch {
      setFares([]);
    }
  }

  function openFare(f: VtFare | null) {
    setFareForm(f
      ? { id: f.id, name: f.name, amount: moneyToMasked(f.amount), basis: f.basis, sundayAmount: f.sundayAmount == null ? "" : moneyToMasked(f.sundayAmount), isActive: f.isActive, notes: f.notes ?? "" }
      : { ...emptyFareForm });
  }

  async function handleSaveFare() {
    if (!fareForm) return;
    if (!fareForm.name.trim()) return void setNotice({ tone: "error", message: "Informe o nome da tarifa." });
    setBusy(true);
    try {
      const payload = {
        name: fareForm.name.trim(),
        amount: toNumStr(fareForm.amount) || "0",
        basis: fareForm.basis,
        sundayAmount: fareForm.sundayAmount.trim() === "" ? null : toNumStr(fareForm.sundayAmount),
        isActive: fareForm.isActive,
      };
      if (fareForm.id) await updateVtFare(fareForm.id, payload);
      else await createVtFare(payload);
      await loadFares();
      setFareForm(null);
      setNotice({ tone: "success", message: "Tarifa salva." });
    } catch (err) {
      setNotice({ tone: "error", message: err instanceof Error ? err.message : "Erro ao salvar tarifa." });
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteFare(f: VtFare) {
    if (!window.confirm(`Excluir a tarifa "${f.name}"?`)) return;
    setBusy(true);
    try {
      await deleteVtFare(f.id);
      await loadFares();
      setNotice({ tone: "success", message: "Tarifa excluída." });
    } catch (err) {
      setNotice({ tone: "error", message: err instanceof Error ? err.message : "Erro ao excluir tarifa." });
    } finally {
      setBusy(false);
    }
  }
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
      <td class="l">${escapeHtml(i.employeeDisplayName?.trim() || i.employeeName)}</td>
      <td class="l">${escapeHtml(i.sector ?? "—")}</td>
      <td>${i.workedDays ?? "—"}</td>
      <td>${i.freeDays ?? "—"}</td>
      <td>${periodRange(i)}</td>
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
<thead><tr><th class="l">Funcionário</th><th class="l">Setor</th><th>Dias</th><th>Grátis</th><th>Período</th><th>Valor</th><th>Situação</th></tr></thead>
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
    // O backend ignora em silêncio um campo inválido (mantém o valor antigo).
    // Sem esta guarda, a tela dizia "Configurações salvas" e o corte da quinzena
    // seguia no valor velho — errando o período de 26 pessoas sem avisar ninguém.
    const corte = Number(settingsForm.vtSecondPeriodStartDay);
    const percent = Number(toNumStr(settingsForm.advancePercent));
    const diaAdiant = Number(settingsForm.advanceDueDay);
    const diaSalario = Number(settingsForm.salaryDueDay);
    const erro =
      !Number.isInteger(corte) || corte < 2 || corte > 28
        ? "O dia de início da 2ª quinzena precisa estar entre 2 e 28."
        : !Number.isFinite(percent) || percent < 0 || percent > 100
          ? "O adiantamento precisa ser uma porcentagem entre 0 e 100."
          : !Number.isInteger(diaAdiant) || diaAdiant < 1 || diaAdiant > 31
            ? "O dia de vencimento do adiantamento precisa estar entre 1 e 31."
            : !Number.isInteger(diaSalario) || diaSalario < 1 || diaSalario > 31
              ? "O dia de vencimento do salário precisa estar entre 1 e 31."
              : null;
    if (erro) return void setNotice({ tone: "error", message: erro });

    setBusy(true);
    try {
      const saved = await savePayrollSettings({
        vtSecondPeriodStartDay: Number(settingsForm.vtSecondPeriodStartDay) as unknown as number,
        advancePercent: toNumStr(settingsForm.advancePercent) as unknown as string,
        advanceDueDay: Number(settingsForm.advanceDueDay) as unknown as number,
        salaryDueDay: Number(settingsForm.salaryDueDay) as unknown as number
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
  // Corte da quinzena. Sem settings carregado ainda, assume o padrão (16) em vez
  // de classificar tudo como 2ª quinzena enquanto a requisição não volta.
  const secondPeriodStartDay = settings?.vtSecondPeriodStartDay ?? 16;
  const daysInSelectedMonth = new Date(year, month, 0).getDate();
  const quinzenaHint = `1ª: 01 a ${String(secondPeriodStartDay - 1).padStart(2, "0")} · 2ª: ${String(secondPeriodStartDay).padStart(2, "0")} a ${daysInSelectedMonth}. O VT vence na véspera do início de cada período.`;

  // VT e folha são fechamentos independentes, e o VT ainda fecha por quinzena
  // (a 2ª só depois que a escala da segunda metade do mês está pronta).
  const novosVtDe = (q: 1 | 2) =>
    itensDoEscopo.filter((i) => !i.exists && i.type === "VALE_TRANSPORTE" && i.quinzena === q).length;
  const novosVtQ1 = novosVtDe(1);
  const novosVtQ2 = novosVtDe(2);
  const novosFolha = itensDoEscopo.filter((i) => !i.exists && (i.type === "ADIANTAMENTO" || i.type === "SALARIO")).length;

  // Conferência: VT já lançado da quinzena escolhida, ordenado por funcionário.
  //
  // A quinzena sai do INÍCIO DO PERÍODO, não do vencimento: o VT vence na
  // véspera, então a 1ª quinzena vence no último dia do mês anterior — a regra
  // antiga ("dia <= 15 é a primeira") classificaria esse dia 31 como segunda.
  // Lançamentos antigos (jul/2026) não têm periodStart; para eles a regra antiga
  // ainda vale, porque naquela época o vencimento era o 1º dia do período.
  const quinzenaDe = (i: { periodStart: string | null; dueDate: string }) => {
    const ref = i.periodStart ?? i.dueDate;
    return new Date(ref).getUTCDate() < secondPeriodStartDay ? 1 : 2;
  };
  const vtDaQuinzena = (list?.items ?? [])
    .filter((i) => i.type === "VALE_TRANSPORTE" && quinzenaDe(i) === vtQuinzena)
    .sort((a, b) => (a.employeeName || "").localeCompare(b.employeeName || "", "pt-BR"));
  const vtTotal = vtDaQuinzena.reduce((s, i) => s + Number(i.amount), 0);
  const vtPago = vtDaQuinzena.filter((i) => i.status === "PAID").reduce((s, i) => s + Number(i.paidAmount ?? i.amount), 0);
  const vtAberto = vtTotal - vtDaQuinzena.filter((i) => i.status === "PAID").reduce((s, i) => s + Number(i.amount), 0);

  function periodCell(item: {
    periodLabel: string;
    workedDays: number | null;
    freeDays: number | null;
    details?: Record<string, unknown> | null;
    faltaDeductions?: Array<{ date: string; amount: number; tipo: "FALTA" | "ATESTADO" }>;
  }) {
    // Faltas com abatimento ZERO existem (faltar num domingo, para quem só usa
    // ônibus, não custa nada). Elas ficam registradas como quitadas, mas não têm
    // o que mostrar aqui — "− R$ 0,00 · 1 falta" só confundiria a conferência.
    const faltas = (item.faltaDeductions ?? []).filter((f) => f.amount > 0);
    const totalFaltas = faltas.reduce((s, f) => s + f.amount, 0);
    // Falta e atestado abatem igual (a pessoa não viajou), mas quem confere o
    // pagamento precisa saber qual é qual sem ter de abrir a escala.
    const detalheFaltas = faltas
      .map((f) => `${fmtDayMonth(f.date)}${f.tipo === "ATESTADO" ? " (atestado)" : ""}`)
      .join(", ");
    // Vale zerado com dias trabalhados = trajeto em branco. O aviso geral fica no
    // topo da prévia, longe da linha; sem esta marca o R$ 0,00 passa batido numa
    // lista de 26 pessoas — foi assim que 5 vales sumiram em julho.
    const semTrajeto = item.details?.trajeto === "sem trajeto cadastrado" && (item.workedDays ?? 0) > 0;
    return (
      <>
        <div>{item.periodLabel}</div>
        {item.workedDays != null && (
          <div style={{ fontSize: "0.8em", color: "var(--muted)" }}>
            {item.workedDays} dia(s){item.freeDays ? ` · ${item.freeDays} c/ tarifa zero` : ""}
          </div>
        )}
        {semTrajeto && (
          <div style={{ fontSize: "0.78em", color: "var(--danger, #b00)", fontWeight: 600 }}>
            Sem trajeto cadastrado — cadastre a ida e a volta na ficha
          </div>
        )}
        {/* O abatimento é de faltas de períodos JÁ PAGOS — precisa dizer quais
            dias, senão o valor menor na tela vira mistério no dia do pagamento. */}
        {faltas.length > 0 && (
          <div style={{ fontSize: "0.78em", color: "var(--danger, #b00)", fontWeight: 600 }}>
            − {money(totalFaltas)} · {faltas.length} ausência(s) já paga(s): {detalheFaltas}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="stack">
      <Notice notice={notice} />

      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)" }}>
        <button type="button" onClick={() => setTab("folha")} style={tabButtonStyle(tab === "folha")}>Folha de Pagamento</button>
        <button type="button" onClick={() => setTab("gorjeta")} style={tabButtonStyle(tab === "gorjeta")}>Fechamento de Gorjetas</button>
        <button type="button" onClick={() => setTab("extrato")} style={tabButtonStyle(tab === "extrato")}>Retorno do RH</button>
      </div>

      {tab === "gorjeta" && <FolhaGorjeta />}
      {tab === "extrato" && <ExtratoRh />}

      {tab === "folha" && (<>
      <section className="panel">
        <div className="section-heading">
          <div>
            <PanelEyebrow>Pessoal</PanelEyebrow>
            <h2>Folha de pagamento</h2>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Button variant="secondary" onClick={() => goMonth(-1)} aria-label="Mês anterior"><ChevronLeft size={16} /></Button>
            <input
              type="month"
              value={`${year}-${String(month).padStart(2, "0")}`}
              onChange={(e) => { const [y, m] = e.target.value.split("-").map(Number); if (y && m) { setYear(y); setMonth(m); } }}
              aria-label="Mês e ano"
              style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 8, font: "inherit", background: "var(--surface, #fff)", color: "inherit" }}
            />
            <Button variant="secondary" onClick={() => goMonth(1)} aria-label="Próximo mês"><ChevronRight size={16} /></Button>
            <Button variant="secondary" onClick={load} aria-label="Recarregar"><RefreshCw size={15} /></Button>
            <Button variant="secondary" leadingIcon={<Settings size={14} />} onClick={() => setShowSettings((v) => !v)}>Configurações</Button>
            {canEdit && <Button variant="secondary" leadingIcon={<Palmtree size={14} />} onClick={openVacation}>Lançar férias</Button>}
            {canEdit && <Button variant="secondary" leadingIcon={<Bus size={14} />} onClick={() => handlePreview("VT")} disabled={busy}>Prever VT</Button>}
            {canEdit && <Button leadingIcon={<Wand2 size={14} />} onClick={() => handlePreview("FOLHA")} disabled={busy}>Prever folha</Button>}
          </div>
        </div>

        {/* Configurações */}
        {showSettings && settings && (
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14, margin: "0 0 14px" }}>
            <PanelEyebrow>Regras (configuráveis)</PanelEyebrow>
            <FormGrid cols={4}>
              <FormField label="2ª quinzena começa no dia" hint={quinzenaHint}>
                <TextField value={settingsForm.vtSecondPeriodStartDay} onChange={(e) => setSettingsForm({ ...settingsForm, vtSecondPeriodStartDay: e.target.value.replace(/\D/g, "").slice(0, 2) })} inputMode="numeric" />
              </FormField>
              <FormField label="Adiantamento (%)"><TextField value={settingsForm.advancePercent} onChange={(e) => setSettingsForm({ ...settingsForm, advancePercent: e.target.value })} inputMode="decimal" /></FormField>
              <FormField label="Vencimento adiantamento (dia)"><TextField value={settingsForm.advanceDueDay} onChange={(e) => setSettingsForm({ ...settingsForm, advanceDueDay: e.target.value.replace(/\D/g, "") })} inputMode="numeric" /></FormField>
              <FormField label="Vencimento salário (dia mês seguinte)"><TextField value={settingsForm.salaryDueDay} onChange={(e) => setSettingsForm({ ...settingsForm, salaryDueDay: e.target.value.replace(/\D/g, "") })} inputMode="numeric" /></FormField>
            </FormGrid>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setShowSettings(false)}>Fechar</Button>
              {canEdit && <Button onClick={handleSaveSettings} disabled={busy}>Salvar configurações</Button>}
            </div>

            <div style={{ borderTop: "1px solid var(--border)", marginTop: 16, paddingTop: 14 }}>
              <PanelEyebrow>Tarifas de transporte</PanelEyebrow>
              <div style={{ fontSize: "0.82em", color: "var(--muted)", margin: "4px 0 10px" }}>
                Cada condução que alguém paga é uma tarifa aqui. O trajeto de cada funcionário (ida e volta)
                é montado com elas na ficha dele. Mudar um valor muda o VT de todo mundo que usa a tarifa.
              </div>
              <Table>
                <Table.Head>
                  <Table.Row>
                    <Table.Th>Tarifa</Table.Th>
                    <Table.Th align="right">Valor</Table.Th>
                    <Table.Th>Gratuidade</Table.Th>
                    <Table.Th>Em uso</Table.Th>
                    <Table.Th>Situação</Table.Th>
                    <Table.Th actions />
                  </Table.Row>
                </Table.Head>
                <Table.Body>
                  {fares.map((f) => {
                    const emUso = f.inUseBy ?? 0;
                    const semValor = Number(f.amount) <= 0;
                    // Tarifa desligada que alguém ainda usa é uma armadilha: o
                    // trajeto continua apontando para ela e o vale sai a menos.
                    const inativaEmUso = !f.isActive && emUso > 0;
                    return (
                      <Table.Row key={f.id} style={f.isActive ? undefined : { opacity: 0.6 }}>
                        <Table.Td>
                          <div style={{ fontWeight: 600 }}>{f.name}</div>
                          {semValor && (
                            <div style={{ fontSize: "0.78em", color: "var(--danger, #b00)" }}>
                              Preencha o valor antes de usar
                            </div>
                          )}
                          {inativaEmUso && (
                            <div style={{ fontSize: "0.78em", color: "var(--danger, #b00)" }}>
                              Inativa, mas ainda no trajeto de {emUso} funcionário(s)
                            </div>
                          )}
                        </Table.Td>
                        <Table.Td align="right" style={{ whiteSpace: "nowrap" }}>
                          {semValor ? <span style={{ color: "var(--danger, #b00)" }}>—</span> : <strong>{money(f.amount)}</strong>}
                          <div style={{ fontSize: "0.78em", color: "var(--muted)" }}>
                            {f.basis === "MENSAL" ? "por mês" : "por viagem"}
                          </div>
                        </Table.Td>
                        <Table.Td style={{ whiteSpace: "nowrap" }}>{gratuidadeLabel(f)}</Table.Td>
                        <Table.Td style={{ whiteSpace: "nowrap" }}>
                          {emUso === 0 ? <span style={{ color: "var(--muted)" }}>ninguém</span> : `${emUso} func.`}
                        </Table.Td>
                        <Table.Td><StatusBadge tone={f.isActive ? "success" : "neutral"}>{f.isActive ? "Ativa" : "Inativa"}</StatusBadge></Table.Td>
                        <Table.Td actions>
                          {canEdit && (
                            <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                              <IconButton size="sm" label={`Editar ${f.name}`} icon={<Pencil size={14} />} onClick={() => openFare(f)} />
                              <IconButton size="sm" variant="danger" label={`Excluir ${f.name}`} icon={<Trash2 size={14} />} onClick={() => void handleDeleteFare(f)} />
                            </div>
                          )}
                        </Table.Td>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table>
              {canEdit && (
                <div style={{ marginTop: 10 }}>
                  <Button variant="secondary" onClick={() => openFare(null)}>Nova tarifa</Button>
                </div>
              )}

              {fareForm && (
                <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginTop: 12 }}>
                  <PanelEyebrow>{fareForm.id ? "Editar tarifa" : "Nova tarifa"}</PanelEyebrow>
                  <FormGrid cols={3}>
                    <FormField label="Nome" required>
                      <TextField value={fareForm.name} onChange={(e) => setFareForm({ ...fareForm, name: e.target.value })} placeholder="Ex.: EMTU Carapicuíba – SP" />
                    </FormField>
                    <FormField label="Valor (R$)" required>
                      <TextField value={fareForm.amount} onChange={(e) => setFareForm({ ...fareForm, amount: maskMoney(e.target.value) })} placeholder="0,00" inputMode="numeric" />
                    </FormField>
                    <FormField label="Cobrança" hint="mensal = valor fechado, não depende de dias">
                      <Select value={fareForm.basis} onChange={(e) => setFareForm({ ...fareForm, basis: e.target.value as VtFareBasis })} options={[{ value: "VIAGEM", label: "Por viagem" }, { value: "MENSAL", label: "Mensal (bilhete)" }]} />
                    </FormField>
                    <FormField
                      label="Valor no domingo (R$)"
                      hint="Vazio = cobra normal. 0,00 = grátis. Vale também em 01/01, 25/01 e 25/12."
                    >
                      <TextField
                        value={fareForm.sundayAmount}
                        onChange={(e) => setFareForm({ ...fareForm, sundayAmount: maskMoney(e.target.value) })}
                        placeholder="cobra normal"
                        inputMode="numeric"
                      />
                    </FormField>
                    <FormField label="Situação">
                      <Select value={fareForm.isActive ? "1" : "0"} onChange={(e) => setFareForm({ ...fareForm, isActive: e.target.value === "1" })} options={[{ value: "1", label: "Ativa" }, { value: "0", label: "Inativa" }]} />
                    </FormField>
                  </FormGrid>
                  <div className="form-actions">
                    <Button variant="secondary" onClick={() => setFareForm(null)}>Cancelar</Button>
                    <Button onClick={() => void handleSaveFare()} disabled={busy}>Salvar tarifa</Button>
                  </div>
                </div>
              )}
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

        {/* Vale-transporte — por quinzena (direto na tela) */}
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14, margin: "0 0 14px" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <PanelEyebrow>Vale-transporte · {MONTHS[month - 1]} {year}</PanelEyebrow>
            <div style={{ display: "flex", gap: 6, marginLeft: 8 }}>
              <Button variant={vtQuinzena === 1 ? undefined : "secondary"} onClick={() => setVtQuinzena(1)}>1ª quinzena</Button>
              <Button variant={vtQuinzena === 2 ? undefined : "secondary"} onClick={() => setVtQuinzena(2)}>2ª quinzena</Button>
            </div>
            <span style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button variant="secondary" leadingIcon={<Printer size={14} />} onClick={handlePrintVt} disabled={vtDaQuinzena.length === 0}>Imprimir</Button>
              {canEdit && <Button variant="secondary" leadingIcon={<Bus size={14} />} onClick={() => handlePreview("VT")} disabled={busy}>Prever / gerar</Button>}
            </span>
          </div>
          {vtDaQuinzena.length === 0 ? (
            <EmptyState
              title={`Nenhum VT lançado na ${vtQuinzena}ª quinzena`}
              description="Use 'Prever / gerar' e o botão da quinzena para gerar o vale-transporte deste período."
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
                    <Table.Th>Período</Table.Th>
                    <Table.Th>Valor</Table.Th>
                    <Table.Th>Situação</Table.Th>
                  </Table.Row>
                </Table.Head>
                <Table.Body>
                  {vtDaQuinzena.map((i) => (
                    <Table.Row key={i.id}>
                      <Table.Td>
                        <strong>{i.employeeDisplayName?.trim() || i.employeeName}</strong>
                        {/* Vale zerado com dias trabalhados e lançado: é a lista que vai
                            para o pagamento, então o motivo tem que estar AQUI. */}
                        {Number(i.amount) === 0 && (i.workedDays ?? 0) > 0 && (
                          <div style={{ fontSize: "0.78em", color: "var(--danger, #b00)", fontWeight: 600 }}>Vale zerado — confira o trajeto na ficha</div>
                        )}
                      </Table.Td>
                      <Table.Td>{i.sector ?? "—"}</Table.Td>
                      <Table.Td>{i.workedDays ?? "—"}</Table.Td>
                      <Table.Td>{i.freeDays ?? "—"}</Table.Td>
                      <Table.Td style={{ whiteSpace: "nowrap" }}>{periodRange(i)}</Table.Td>
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
            </>
          )}
        </div>

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
                        <Table.Td>{periodCell(i)}</Table.Td>
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
                      <Table.Th>Período</Table.Th>
                      <Table.Th>Valor</Table.Th>
                      <Table.Th>Situação</Table.Th>
                    </Table.Row>
                  </Table.Head>
                  <Table.Body>
                    {vtDaQuinzena.map((i) => (
                      <Table.Row key={i.id}>
                        <Table.Td>
                        <strong>{i.employeeDisplayName?.trim() || i.employeeName}</strong>
                        {/* Vale zerado com dias trabalhados e lançado: é a lista que vai
                            para o pagamento, então o motivo tem que estar AQUI. */}
                        {Number(i.amount) === 0 && (i.workedDays ?? 0) > 0 && (
                          <div style={{ fontSize: "0.78em", color: "var(--danger, #b00)", fontWeight: 600 }}>Vale zerado — confira o trajeto na ficha</div>
                        )}
                      </Table.Td>
                        <Table.Td>{i.sector ?? "—"}</Table.Td>
                        <Table.Td>{i.workedDays ?? "—"}</Table.Td>
                        <Table.Td>{i.freeDays ?? "—"}</Table.Td>
                        <Table.Td style={{ whiteSpace: "nowrap" }}>{periodRange(i)}</Table.Td>
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
      </>)}
    </div>
  );
}
