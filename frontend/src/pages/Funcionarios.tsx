import { Cake, FileText, Pencil, Plus, PowerOff, RefreshCw, UserCheck, UserMinus, Users, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Employee, EmployeeBirthday, EmployeeBankAccountType, EmployeeModality, TerminationInfo,
  VtCommute, VtPeriodicity, VtType, WorkScheduleRegime,
  deleteEmployee, getEmployeeBirthdays, getEmployeeOptions, getEmployees, getTerminationInfo,
  releaseTermination, saveEmployee, setEmployeeStatus, terminateEmployee
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { useSession } from "../context/SessionContext";
import {
  Alert, Button, EmptyState, FormField, FormGrid, FormSection,
  IconButton, Money, PanelEyebrow, RowMenu, Select, StatusBadge, SummaryCard, Switch, Table, Textarea, TextField
} from "../design-system";
import { hasPermission } from "../lib/permissions";
import { maskMoney, moneyToMasked } from "../utils/format";

const MODALITY_LABELS: Record<EmployeeModality, string> = { CLT: "CLT", NAO_CLT: "Não-CLT" };
const REGIME_LABELS: Record<WorkScheduleRegime, string> = { SEIS_POR_UM: "6×1", CINCO_POR_DOIS: "5×2" };
const VT_TYPE_LABELS: Record<VtType, string> = {
  NENHUM: "Não recebe (mora perto)",
  TRANSPORTE_PUBLICO: "Transporte público",
  AUXILIO_COMBUSTIVEL: "Ajuda de custo"
};
const VT_PERIODICITY_LABELS: Record<VtPeriodicity, string> = { QUINZENAL: "Quinzenal", MENSAL: "Mensal" };
const VT_COMMUTE_LABELS: Record<VtCommute, string> = {
  ONIBUS: "Só ônibus (por tarifa/dia)",
  METRO: "Só metrô (por tarifa/dia)",
  INTEGRADO: "Ônibus + metrô integrado (por tarifa/dia)",
  ONIBUS_METRO_SEPARADO: "Ônibus + metrô sem integração (por tarifa/dia)",
  BILHETE_MENSAL_ONIBUS: "Bilhete Único Mensal — só ônibus",
  BILHETE_MENSAL_INTEGRADO: "Bilhete Único Mensal — integrado (metrô/CPTM)"
};
const ACCOUNT_TYPE_LABELS: Record<EmployeeBankAccountType, string> = {
  CONTA_CORRENTE: "Conta Corrente", POUPANCA: "Poupança", CAIXA: "Caixa",
  CARTEIRA: "Carteira", CARTAO: "Cartão", OUTROS: "Outros"
};
const PIX_TYPE_LABELS: Record<string, string> = {
  "": "—", CPF: "CPF", EMAIL: "E-mail", TELEFONE: "Telefone", ALEATORIA: "Aleatória"
};
// Parcelamento da rescisão/acordo (1 = à vista, até 12×).
const INSTALLMENT_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1),
  label: i === 0 ? "À vista (1×)" : `${i + 1}×`
}));
// Tipos de desligamento (rótulo canônico salvo em terminationReason + observação opcional).
const TERMINATION_TYPES = [
  "Pedido de demissão",
  "Dispensa sem justa causa",
  "Dispensa com justa causa",
  "Fim de contrato (experiência/prazo)",
  "Acordo (art. 484-A)"
];
// Sugestões iniciais dos comboboxes. O usuário pode escolher uma ou digitar
// qualquer valor novo — os valores já usados vêm do backend e se somam aqui.
const DEFAULT_SECTORS = ["Cozinha", "Salão/Bar", "Pizzaria", "Buffet/Pia/Deliv", "Administrativo"];
const DEFAULT_POSITIONS = [
  "Gerente", "Sub. Gerente", "Gerente de salão", "Líder de salão", "Garçom", "Cozinheiro",
  "Auxiliar de cozinha", "Pizzaiolo", "Chapeiro", "Caixa", "Copeiro", "Auxiliar de limpeza"
];
function mergeSuggestions(defaults: string[], used: string[]) {
  return Array.from(new Set([...defaults, ...used]));
}

function toOptions<T extends string>(labels: Record<T, string>) {
  return (Object.entries(labels) as [T, string][]).map(([value, label]) => ({ value, label }));
}

function applyCpfMask(v: string) {
  return v.replace(/\D/g, "").slice(0, 11)
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}
function applyPhoneMask(v: string) {
  const c = v.replace(/\D/g, "").slice(0, 11);
  if (c.length <= 10) return c.replace(/^(\d{2})(\d{4})(\d)/, "($1) $2-$3").replace(/^(\d{2})(\d)/, "($1) $2");
  return c.replace(/^(\d{2})(\d{5})(\d)/, "($1) $2-$3");
}
function applyZipMask(v: string) {
  return v.replace(/\D/g, "").slice(0, 8).replace(/^(\d{5})(\d)/, "$1-$2");
}
function toDateInput(iso: string | null) {
  return iso ? iso.slice(0, 10) : "";
}
function calcAge(birth: string | null): number | null {
  if (!birth) return null;
  const b = new Date(birth);
  if (isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
  return age;
}
function moneyToNumberString(s: string) {
  const t = s.trim();
  if (!t) return "";
  return t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
}
function fullName(e: { firstName: string; lastName: string }) {
  return `${e.firstName} ${e.lastName}`.trim();
}
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const emptyEmployee = {
  id: "", firstName: "", lastName: "", cpf: "", rg: "", pis: "", birthDate: "", phone: "", email: "",
  zipCode: "", address: "", addressNumber: "", addressComplement: "", neighborhood: "", city: "", state: "",
  bankName: "", bankAgency: "", bankAccount: "", bankAccountDigit: "", bankAccountType: "CONTA_CORRENTE" as EmployeeBankAccountType,
  pixKeyType: "", pixKey: "", sector: "", position: "", baseSalary: "", shiftStart: "", shiftEnd: "",
  modality: "CLT" as EmployeeModality, scheduleRegime: "SEIS_POR_UM" as WorkScheduleRegime, includeInSchedule: true, admissionDate: "",
  vtType: "TRANSPORTE_PUBLICO" as VtType, vtPeriodicity: "QUINZENAL" as VtPeriodicity,
  vtCommute: "" as VtCommute | "", vtTripsPerDay: "2", vtFixedAmount: "", notes: ""
};

export function Funcionarios() {
  const { user } = useSession();
  const canEdit = hasPermission(user, "employees", "edit");
  const { notice, setNotice } = useNotice();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyEmployee);
  const [saving, setSaving] = useState(false);

  const [birthdays, setBirthdays] = useState<EmployeeBirthday[]>([]);
  const [showBirthdays, setShowBirthdays] = useState(false);
  const [options, setOptions] = useState<{ sectors: string[]; positions: string[] }>({ sectors: [], positions: [] });

  const [terminating, setTerminating] = useState<Employee | null>(null);
  const [terminationForm, setTerminationForm] = useState({ terminationDate: "", terminationType: "", terminationNote: "" });
  const [terminationError, setTerminationError] = useState<string | null>(null);
  const [terminatingBusy, setTerminatingBusy] = useState(false);

  const [rescinding, setRescinding] = useState<Employee | null>(null);
  const [rescInfo, setRescInfo] = useState<TerminationInfo | null>(null);
  const [rescForm, setRescForm] = useState({ grossAmount: "", vtDiscount: "", otherDiscount: "", otherDiscountLabel: "", dueDate: "", installments: "1", notes: "" });
  const [rescBusy, setRescBusy] = useState(false);

  const [deletingEmp, setDeletingEmp] = useState<Employee | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const currentMonth = new Date().getMonth() + 1;

  async function loadEmployees() {
    setLoading(true);
    setError(null);
    try {
      setEmployees(await getEmployees({ search: search || undefined, includeInactive }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar funcionários.");
    } finally {
      setLoading(false);
    }
  }

  function loadOptions() {
    getEmployeeOptions().then(setOptions).catch(() => undefined);
  }

  useEffect(() => { void loadEmployees(); }, [search, includeInactive]);
  useEffect(() => { getEmployeeBirthdays(currentMonth).then(setBirthdays).catch(() => setBirthdays([])); }, [currentMonth]);
  useEffect(() => { loadOptions(); }, []);

  const sectorSuggestions = mergeSuggestions(DEFAULT_SECTORS, options.sectors);
  const positionSuggestions = mergeSuggestions(DEFAULT_POSITIONS, options.positions);

  function openNew() {
    setForm(emptyEmployee);
    setShowForm(true);
    setError(null);
  }

  function openEdit(e: Employee) {
    setForm({
      id: e.id, firstName: e.firstName, lastName: e.lastName, cpf: applyCpfMask(e.cpf),
      rg: e.rg ?? "", pis: e.pis ?? "", birthDate: toDateInput(e.birthDate),
      phone: e.phone ?? "", email: e.email ?? "",
      zipCode: e.zipCode ?? "", address: e.address ?? "", addressNumber: e.addressNumber ?? "",
      addressComplement: e.addressComplement ?? "", neighborhood: e.neighborhood ?? "",
      city: e.city ?? "", state: e.state ?? "",
      bankName: e.bankName ?? "", bankAgency: e.bankAgency ?? "", bankAccount: e.bankAccount ?? "",
      bankAccountDigit: e.bankAccountDigit ?? "", bankAccountType: e.bankAccountType,
      pixKeyType: e.pixKeyType ?? "", pixKey: e.pixKey ?? "",
      sector: e.sector ?? "", position: e.position ?? "", baseSalary: moneyToMasked(e.baseSalary),
      shiftStart: e.shiftStart ?? "", shiftEnd: e.shiftEnd ?? "",
      modality: e.modality, scheduleRegime: e.scheduleRegime, includeInSchedule: e.includeInSchedule ?? true, admissionDate: toDateInput(e.admissionDate),
      vtType: e.vtType, vtPeriodicity: e.vtPeriodicity, vtCommute: e.vtCommute ?? "",
      vtTripsPerDay: e.vtTripsPerDay != null ? String(e.vtTripsPerDay) : "2",
      vtFixedAmount: moneyToMasked(e.vtFixedAmount), notes: e.notes ?? ""
    });
    setShowForm(true);
    setError(null);
  }

  async function handleSave() {
    if (!form.firstName.trim()) return void setError("Nome é obrigatório.");
    if (!form.lastName.trim()) return void setError("Sobrenome é obrigatório.");
    if (!form.cpf.trim()) return void setError("CPF é obrigatório.");
    setSaving(true);
    setError(null);
    try {
      await saveEmployee({
        id: form.id || undefined,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        cpf: form.cpf,
        rg: form.rg || undefined,
        pis: form.pis || undefined,
        birthDate: form.birthDate || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        zipCode: form.zipCode || undefined,
        address: form.address || undefined,
        addressNumber: form.addressNumber || undefined,
        addressComplement: form.addressComplement || undefined,
        neighborhood: form.neighborhood || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        bankName: form.bankName || undefined,
        bankAgency: form.bankAgency || undefined,
        bankAccount: form.bankAccount || undefined,
        bankAccountDigit: form.bankAccountDigit || undefined,
        bankAccountType: form.bankAccountType,
        pixKeyType: form.pixKeyType || undefined,
        pixKey: form.pixKey || undefined,
        sector: form.sector || undefined,
        position: form.position || undefined,
        baseSalary: form.baseSalary ? moneyToNumberString(form.baseSalary) : undefined,
        shiftStart: form.shiftStart || undefined,
        shiftEnd: form.shiftEnd || undefined,
        modality: form.modality,
        scheduleRegime: form.scheduleRegime,
        includeInSchedule: form.includeInSchedule,
        admissionDate: form.admissionDate || undefined,
        vtType: form.vtType,
        vtPeriodicity: form.vtPeriodicity,
        vtCommute: form.vtCommute || undefined,
        vtTripsPerDay: form.vtTripsPerDay || undefined,
        vtFixedAmount: form.vtFixedAmount ? moneyToNumberString(form.vtFixedAmount) : undefined,
        notes: form.notes || undefined
      });
      setNotice({ tone: "success", message: form.id ? "Funcionário atualizado." : "Funcionário cadastrado." });
      setShowForm(false);
      await loadEmployees();
      loadOptions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar funcionário.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(e: Employee) {
    try {
      await setEmployeeStatus(e.id, !e.isActive);
      setNotice({ tone: "success", message: e.isActive ? "Funcionário inativado." : "Funcionário reativado." });
      await loadEmployees();
    } catch (err) {
      setNotice({ tone: "error", message: err instanceof Error ? err.message : "Erro ao alterar status." });
    }
  }

  function openTerminate(e: Employee) {
    setTerminating(e);
    setTerminationForm({ terminationDate: new Date().toISOString().slice(0, 10), terminationType: "", terminationNote: "" });
    setTerminationError(null);
  }

  async function handleTerminate() {
    if (!terminating) return;
    if (!terminationForm.terminationDate) { setTerminationError("Informe a data do desligamento."); return; }
    if (!terminationForm.terminationType) { setTerminationError("Selecione o tipo de desligamento."); return; }
    const note = terminationForm.terminationNote.trim();
    const reason = note ? `${terminationForm.terminationType} — ${note}` : terminationForm.terminationType;
    setTerminationError(null);
    setTerminatingBusy(true);
    try {
      await terminateEmployee(terminating.id, terminationForm.terminationDate, reason);
      setNotice({ tone: "success", message: "Desligamento registrado." });
      setTerminating(null);
      await loadEmployees();
    } catch (err) {
      setNotice({ tone: "error", message: err instanceof Error ? err.message : "Erro ao registrar desligamento." });
    } finally {
      setTerminatingBusy(false);
    }
  }

  async function openRescisao(e: Employee) {
    setRescinding(e);
    setRescInfo(null);
    setRescForm({ grossAmount: "", vtDiscount: "", otherDiscount: "", otherDiscountLabel: "", dueDate: new Date().toISOString().slice(0, 10), installments: "1", notes: "" });
    try {
      const info = await getTerminationInfo(e.id);
      setRescInfo(info);
      if (info.vtCreditBalance > 0) setRescForm((f) => ({ ...f, vtDiscount: moneyToMasked(info.vtCreditBalance) }));
    } catch (err) {
      setNotice({ tone: "error", message: err instanceof Error ? err.message : "Erro ao carregar dados da rescisão." });
    }
  }

  async function handleReleaseRescisao() {
    if (!rescinding) return;
    const gross = Number(moneyToNumberString(rescForm.grossAmount));
    if (!gross || gross <= 0) return void setNotice({ tone: "error", message: "Informe o valor da rescisão (bruto) que a contabilidade enviou." });
    setRescBusy(true);
    try {
      const res = await releaseTermination(rescinding.id, {
        grossAmount: gross,
        vtDiscount: Number(moneyToNumberString(rescForm.vtDiscount)) || 0,
        otherDiscount: Number(moneyToNumberString(rescForm.otherDiscount)) || 0,
        otherDiscountLabel: rescForm.otherDiscountLabel || undefined,
        dueDate: rescForm.dueDate || undefined,
        installments: Math.max(1, Math.min(Number(rescForm.installments) || 1, 12)),
        notes: rescForm.notes || undefined
      });
      setNotice({
        tone: "success",
        message: res.installments > 1
          ? `Rescisão liberada em ${res.installments}× para a Contas a Pagar.`
          : "Rescisão liberada para a Contas a Pagar."
      });
      setRescinding(null);
      await loadEmployees();
    } catch (err) {
      setNotice({ tone: "error", message: err instanceof Error ? err.message : "Erro ao liberar rescisão." });
    } finally {
      setRescBusy(false);
    }
  }

  const rescNet = Number(moneyToNumberString(rescForm.grossAmount) || "0")
    - (Number(moneyToNumberString(rescForm.vtDiscount)) || 0)
    - (Number(moneyToNumberString(rescForm.otherDiscount)) || 0);

  // Prévia do parcelamento — mesma lógica de centavos do backend (1ª parcela absorve o resto),
  // vencimentos mensais a partir do 1º. Vazio quando é à vista ou não há líquido positivo.
  const rescInstallments = Math.max(1, Math.min(Number(rescForm.installments) || 1, 12));
  const rescParcelas = (() => {
    if (rescNet <= 0 || rescInstallments <= 1) return [] as Array<{ number: number; amount: number; due: Date }>;
    const totalCents = Math.round(rescNet * 100);
    const base = Math.floor(totalCents / rescInstallments);
    const remainder = totalCents - base * rescInstallments;
    const parts = (rescForm.dueDate || new Date().toISOString().slice(0, 10)).split("-").map(Number);
    const fy = parts[0];
    const fm = (parts[1] ?? 1) - 1;
    const fd = parts[2] ?? 1;
    return Array.from({ length: rescInstallments }, (_, i) => {
      const cents = base + (i === 0 ? remainder : 0);
      const due = new Date(fy, fm + i, 1);
      const lastDay = new Date(due.getFullYear(), due.getMonth() + 1, 0).getDate();
      due.setDate(Math.min(fd, lastDay));
      return { number: i + 1, amount: cents / 100, due };
    });
  })();

  function openDelete(e: Employee) {
    setDeletingEmp(e);
    setDeleteReason("");
    setDeleteError(null);
  }

  async function confirmDelete() {
    if (!deletingEmp) return;
    if (deleteReason.trim().length < 3) { setDeleteError("Informe a justificativa da exclusão (mín. 3 caracteres)."); return; }
    setDeleteError(null);
    setDeleteBusy(true);
    try {
      await deleteEmployee(deletingEmp.id, deleteReason.trim());
      setNotice({ tone: "success", message: "Funcionário excluído." });
      setDeletingEmp(null);
      await loadEmployees();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Erro ao excluir.");
    } finally {
      setDeleteBusy(false);
    }
  }

  const isPublicVt = form.vtType === "TRANSPORTE_PUBLICO";
  const isFuelVt = form.vtType === "AUXILIO_COMBUSTIVEL";
  const isMonthlyPass = form.vtCommute === "BILHETE_MENSAL_ONIBUS" || form.vtCommute === "BILHETE_MENSAL_INTEGRADO";

  return (
    <div className="stack">
      <Notice notice={notice} />

      {!loading && employees.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(158px, 1fr))", gap: 12 }}>
          <SummaryCard label="Funcionários" value={employees.length} icon={<Users size={18} />} />
          <SummaryCard label="Ativos" value={employees.filter((e) => e.isActive).length} tone="success" icon={<UserCheck size={18} />} />
          <SummaryCard label={`Aniversariantes de ${MONTHS[currentMonth - 1]}`} value={birthdays.length} tone="info" icon={<Cake size={18} />} />
        </div>
      )}

      {/* Aniversariantes do mês */}
      <section className="panel">
        <div className="section-heading">
          <div>
            <PanelEyebrow>Pessoal</PanelEyebrow>
            <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Cake size={18} /> Aniversariantes de {MONTHS[currentMonth - 1]}
              {birthdays.length > 0 && <StatusBadge tone="info">{birthdays.length}</StatusBadge>}
            </h2>
          </div>
          <Button variant="secondary" onClick={() => setShowBirthdays((v) => !v)}>
            {showBirthdays ? "Ocultar" : "Ver"}
          </Button>
        </div>
        {showBirthdays && (
          birthdays.length === 0
            ? <div style={{ color: "var(--muted)", padding: "4px 0" }}>Nenhum aniversariante neste mês.</div>
            : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {birthdays.map((b) => (
                  <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 10 }}>
                    <strong>dia {toDateInput(b.birthDate).slice(8, 10)}</strong>
                    <span>{fullName(b)}</span>
                    {b.sector && <span style={{ color: "var(--muted)", fontSize: "0.85em" }}>· {b.sector}</span>}
                  </div>
                ))}
              </div>
            )
        )}
      </section>

      {/* Formulário */}
      {showForm && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <PanelEyebrow>Cadastro de funcionário</PanelEyebrow>
              <h2>{form.id ? `Editar — ${form.firstName} ${form.lastName}` : "Novo funcionário"}</h2>
            </div>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Fechar</Button>
          </div>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="stack">
            <datalist id="employee-sectors">{sectorSuggestions.map((s) => <option key={s} value={s} />)}</datalist>
            <datalist id="employee-positions">{positionSuggestions.map((p) => <option key={p} value={p} />)}</datalist>
            <FormSection title="Dados pessoais">
              <FormGrid cols={4}>
                <FormField label="Nome" required>
                  <TextField value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
                </FormField>
                <FormField label="Sobrenome" required>
                  <TextField value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
                </FormField>
                <FormField label="CPF" required>
                  <TextField value={form.cpf} onChange={(e) => setForm({ ...form, cpf: applyCpfMask(e.target.value) })} placeholder="000.000.000-00" maxLength={14} />
                </FormField>
                <FormField label="RG">
                  <TextField value={form.rg} onChange={(e) => setForm({ ...form, rg: e.target.value })} />
                </FormField>
                <FormField label="PIS / NIS">
                  <TextField value={form.pis} onChange={(e) => setForm({ ...form, pis: e.target.value })} />
                </FormField>
                <FormField label="Nascimento" hint={calcAge(form.birthDate) != null ? `${calcAge(form.birthDate)} anos` : undefined}>
                  <TextField type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} />
                </FormField>
                <FormField label="Telefone">
                  <TextField value={form.phone} onChange={(e) => setForm({ ...form, phone: applyPhoneMask(e.target.value) })} placeholder="(00) 00000-0000" maxLength={15} />
                </FormField>
                <FormField label="E-mail">
                  <TextField type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </FormField>
              </FormGrid>
            </FormSection>

            <FormSection title="Endereço">
              <FormGrid cols={4}>
                <FormField label="CEP">
                  <TextField value={form.zipCode} onChange={(e) => setForm({ ...form, zipCode: applyZipMask(e.target.value) })} placeholder="00000-000" maxLength={9} />
                </FormField>
                <div className="ds-form-grid-span-all">
                  <FormField label="Logradouro">
                    <TextField value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                  </FormField>
                </div>
                <FormField label="Número">
                  <TextField value={form.addressNumber} onChange={(e) => setForm({ ...form, addressNumber: e.target.value })} />
                </FormField>
                <FormField label="Complemento">
                  <TextField value={form.addressComplement} onChange={(e) => setForm({ ...form, addressComplement: e.target.value })} />
                </FormField>
                <FormField label="Bairro">
                  <TextField value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} />
                </FormField>
                <FormField label="Cidade">
                  <TextField value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                </FormField>
                <FormField label="UF">
                  <TextField value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase().slice(0, 2) })} maxLength={2} placeholder="SP" />
                </FormField>
              </FormGrid>
            </FormSection>

            <FormSection title="Dados bancários">
              <FormGrid cols={4}>
                <FormField label="Banco">
                  <TextField value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
                </FormField>
                <FormField label="Agência">
                  <TextField value={form.bankAgency} onChange={(e) => setForm({ ...form, bankAgency: e.target.value })} />
                </FormField>
                <FormField label="Conta">
                  <TextField value={form.bankAccount} onChange={(e) => setForm({ ...form, bankAccount: e.target.value })} />
                </FormField>
                <FormField label="Dígito">
                  <TextField value={form.bankAccountDigit} onChange={(e) => setForm({ ...form, bankAccountDigit: e.target.value.slice(0, 2) })} maxLength={2} />
                </FormField>
                <FormField label="Tipo de conta">
                  <Select value={form.bankAccountType} onChange={(e) => setForm({ ...form, bankAccountType: e.target.value as EmployeeBankAccountType })} options={toOptions(ACCOUNT_TYPE_LABELS)} />
                </FormField>
                <FormField label="Tipo da chave PIX">
                  <Select value={form.pixKeyType} onChange={(e) => setForm({ ...form, pixKeyType: e.target.value })} options={toOptions(PIX_TYPE_LABELS)} />
                </FormField>
                <div className="ds-form-grid-span-all">
                  <FormField label="Chave PIX">
                    <TextField value={form.pixKey} onChange={(e) => setForm({ ...form, pixKey: e.target.value })} placeholder="CPF, e-mail, telefone ou chave aleatória" />
                  </FormField>
                </div>
              </FormGrid>
            </FormSection>

            <FormSection title="Trabalho">
              <FormGrid cols={4}>
                <FormField label="Setor" hint="Escolha ou digite um novo">
                  <TextField value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })} list="employee-sectors" placeholder="Ex.: Salão/Bar" />
                </FormField>
                <FormField label="Cargo" hint="Escolha ou digite um novo">
                  <TextField value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} list="employee-positions" placeholder="Ex.: Líder de salão" />
                </FormField>
                <FormField label="Salário base">
                  <TextField value={form.baseSalary} onChange={(e) => setForm({ ...form, baseSalary: maskMoney(e.target.value) })} placeholder="0,00" inputMode="numeric" />
                </FormField>
                <FormField label="Modalidade">
                  <Select value={form.modality} onChange={(e) => setForm({ ...form, modality: e.target.value as EmployeeModality })} options={toOptions(MODALITY_LABELS)} />
                </FormField>
                <FormField label="Regime de escala">
                  <Select value={form.scheduleRegime} onChange={(e) => setForm({ ...form, scheduleRegime: e.target.value as WorkScheduleRegime })} options={toOptions(REGIME_LABELS)} />
                </FormField>
                <FormField label="Entra na escala" hint="desligue p/ quem não tem escala (ex.: gerência/administrativo)">
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 38 }}>
                    <Switch checked={form.includeInSchedule} onChange={(v) => setForm({ ...form, includeInSchedule: v })} label="Entra na escala" />
                    <span style={{ fontSize: 13, color: "var(--muted)" }}>{form.includeInSchedule ? "Sim" : "Não"}</span>
                  </div>
                </FormField>
                <FormField label="Turno — início">
                  <TextField type="time" value={form.shiftStart} onChange={(e) => setForm({ ...form, shiftStart: e.target.value })} />
                </FormField>
                <FormField label="Turno — fim">
                  <TextField type="time" value={form.shiftEnd} onChange={(e) => setForm({ ...form, shiftEnd: e.target.value })} />
                </FormField>
                <FormField label="Admissão">
                  <TextField type="date" value={form.admissionDate} onChange={(e) => setForm({ ...form, admissionDate: e.target.value })} />
                </FormField>
              </FormGrid>
            </FormSection>

            <FormSection title="Vale-transporte">
              <FormGrid cols={4}>
                <FormField label="Tipo de VT">
                  <Select value={form.vtType} onChange={(e) => setForm({ ...form, vtType: e.target.value as VtType })} options={toOptions(VT_TYPE_LABELS)} />
                </FormField>
                <FormField label="Periodicidade">
                  <Select value={form.vtPeriodicity} onChange={(e) => setForm({ ...form, vtPeriodicity: e.target.value as VtPeriodicity })} options={toOptions(VT_PERIODICITY_LABELS)} />
                </FormField>
                {isPublicVt && (
                  <>
                    <FormField label="Trajeto">
                      <Select value={form.vtCommute} onChange={(e) => setForm({ ...form, vtCommute: e.target.value as VtCommute | "" })} options={[{ value: "", label: "—" }, ...toOptions(VT_COMMUTE_LABELS)]} />
                    </FormField>
                    {!isMonthlyPass && (
                      <FormField label="Viagens por dia" hint="ida e volta = 2">
                        <TextField value={form.vtTripsPerDay} onChange={(e) => setForm({ ...form, vtTripsPerDay: e.target.value.replace(/\D/g, "").slice(0, 2) })} inputMode="numeric" />
                      </FormField>
                    )}
                    {isMonthlyPass && (
                      <FormField label="Passe mensal" hint="valor fixo ilimitado — configurável na Folha">
                        <TextField value="Valor fixo mensal" disabled />
                      </FormField>
                    )}
                  </>
                )}
                {isFuelVt && (
                  <FormField label="Valor combinado (por período)" hint="quinzenal ou mensal">
                    <TextField value={form.vtFixedAmount} onChange={(e) => setForm({ ...form, vtFixedAmount: maskMoney(e.target.value) })} placeholder="0,00" inputMode="numeric" />
                  </FormField>
                )}
              </FormGrid>
            </FormSection>

            <FormSection title="Observações">
              <FormGrid cols={1}>
                <FormField label="Notas">
                  <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </FormField>
              </FormGrid>
            </FormSection>

            <div className="form-actions">
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
            </div>
          </div>
        </section>
      )}

      {/* Modal de desligamento */}
      {terminating && (
        <div className="modal-backdrop">
          <section className="panel modal-panel">
            <div className="section-heading">
              <div>
                <PanelEyebrow>Desligamento</PanelEyebrow>
                <h2>{fullName(terminating)}</h2>
              </div>
              <Button variant="secondary" onClick={() => setTerminating(null)}>Fechar</Button>
            </div>
            {terminationError && <div style={{ marginBottom: 12 }}><Alert tone="error">{terminationError}</Alert></div>}
            <FormGrid cols={2}>
              <FormField label="Data do desligamento" required>
                <TextField type="date" value={terminationForm.terminationDate} onChange={(e) => setTerminationForm({ ...terminationForm, terminationDate: e.target.value })} />
              </FormField>
              <FormField label="Tipo de desligamento" required>
                <Select
                  value={terminationForm.terminationType}
                  onChange={(e) => setTerminationForm({ ...terminationForm, terminationType: e.target.value })}
                  placeholder="Selecione o tipo"
                  options={TERMINATION_TYPES.map((t) => ({ value: t, label: t }))}
                />
              </FormField>
              <div className="ds-form-grid-span-all">
                <FormField label="Observação (opcional)">
                  <Textarea rows={2} value={terminationForm.terminationNote} onChange={(e) => setTerminationForm({ ...terminationForm, terminationNote: e.target.value })} placeholder="Detalhes adicionais, se houver…" />
                </FormField>
              </div>
            </FormGrid>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setTerminating(null)}>Cancelar</Button>
              <Button onClick={handleTerminate} disabled={terminatingBusy}>{terminatingBusy ? "Registrando..." : "Registrar desligamento"}</Button>
            </div>
          </section>
        </div>
      )}

      {/* Modal de rescisão */}
      {rescinding && (
        <div className="modal-backdrop">
          <section className="panel modal-panel">
            <div className="section-heading">
              <div>
                <PanelEyebrow>Rescisão · contabilidade envia o valor</PanelEyebrow>
                <h2>{fullName(rescinding)}</h2>
              </div>
              <Button variant="secondary" onClick={() => setRescinding(null)}>Fechar</Button>
            </div>

            {rescInfo?.alreadyReleased && <Alert tone="warning">Já existe uma rescisão lançada para este funcionário.</Alert>}

            <div style={{ background: "var(--paper-soft, var(--surface-2))", borderRadius: 10, padding: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Já identificado pelo sistema para descontar</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span>Crédito de VT — dias pagos e não usados</span>
                <strong><Money value={rescInfo?.vtCreditBalance ?? 0} /></strong>
              </div>
              {rescInfo && rescInfo.vtItems.length > 0 && (
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
                  VT no mês do desligamento (confira se cabe estorno): {rescInfo.vtItems.map((v) => v.periodLabel).join(" · ")}
                </div>
              )}
            </div>

            <FormGrid cols={2}>
              <FormField label="Valor da rescisão — bruto (contabilidade)" required>
                <TextField value={rescForm.grossAmount} onChange={(e) => setRescForm({ ...rescForm, grossAmount: maskMoney(e.target.value) })} placeholder="0,00" inputMode="numeric" />
              </FormField>
              <FormField label="VT a descontar" hint="pré-preenchido pelo crédito do sistema">
                <TextField value={rescForm.vtDiscount} onChange={(e) => setRescForm({ ...rescForm, vtDiscount: maskMoney(e.target.value) })} placeholder="0,00" inputMode="numeric" />
              </FormField>
              <FormField label="Outro desconto (opcional)">
                <TextField value={rescForm.otherDiscount} onChange={(e) => setRescForm({ ...rescForm, otherDiscount: maskMoney(e.target.value) })} placeholder="0,00" inputMode="numeric" />
              </FormField>
              <FormField label="Descrição do outro desconto">
                <TextField value={rescForm.otherDiscountLabel} onChange={(e) => setRescForm({ ...rescForm, otherDiscountLabel: e.target.value })} placeholder="Ex.: adiantamento em aberto" />
              </FormField>
              <FormField label={rescInstallments > 1 ? "Vencimento da 1ª parcela" : "Vencimento"}>
                <TextField type="date" value={rescForm.dueDate} onChange={(e) => setRescForm({ ...rescForm, dueDate: e.target.value })} />
              </FormField>
              <FormField label="Parcelas" hint="acordo (art. 484-A) pode ser dividido; mensais">
                <Select value={rescForm.installments} onChange={(e) => setRescForm({ ...rescForm, installments: e.target.value })} options={INSTALLMENT_OPTIONS} />
              </FormField>
              <div className="ds-form-grid-span-all">
                <FormField label="Observações">
                  <Textarea rows={2} value={rescForm.notes} onChange={(e) => setRescForm({ ...rescForm, notes: e.target.value })} />
                </FormField>
              </div>
            </FormGrid>

            {rescParcelas.length > 0 && (
              <div style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", padding: "8px 12px", background: "var(--surface-2)" }}>
                  {rescParcelas.length} parcelas mensais · vira {rescParcelas.length} títulos em Contas a Pagar
                </div>
                {rescParcelas.map((p) => (
                  <div key={p.number} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", fontSize: 14, borderTop: "1px solid var(--border)" }}>
                    <span>Parcela {p.number}/{rescParcelas.length} · vence {p.due.toLocaleDateString("pt-BR")}</span>
                    <strong><Money value={p.amount} /></strong>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, padding: "12px 14px", border: "1px solid var(--border-strong, var(--border))", borderRadius: 10 }}>
              <span style={{ fontWeight: 500 }}>Líquido a pagar</span>
              <strong style={{ fontSize: 19 }}><Money value={rescNet} /></strong>
            </div>

            <div className="form-actions">
              <Button variant="secondary" onClick={() => setRescinding(null)}>Cancelar</Button>
              <Button onClick={handleReleaseRescisao} disabled={rescBusy || Boolean(rescInfo?.alreadyReleased)}>{rescBusy ? "Liberando..." : "Liberar para Contas a Pagar"}</Button>
            </div>
          </section>
        </div>
      )}

      {/* Modal de exclusão de funcionário — exige justificativa (auditoria) */}
      {deletingEmp && (
        <div className="modal-backdrop">
          <section className="panel modal-panel">
            <div className="section-heading">
              <div>
                <PanelEyebrow>Excluir funcionário</PanelEyebrow>
                <h2>{fullName(deletingEmp)}</h2>
              </div>
              <Button variant="secondary" onClick={() => setDeletingEmp(null)}>Fechar</Button>
            </div>

            <Alert tone="warning">Isso remove o cadastro da lista e fica registrado na auditoria (quem, quando e por quê). Não é possível excluir sem justificativa. Se o objetivo é só tirar da operação, use "Inativar".</Alert>

            {deleteError && <div style={{ margin: "12px 0 0" }}><Alert tone="error">{deleteError}</Alert></div>}

            <div style={{ marginTop: 12 }}>
              <FormField label="Justificativa da exclusão" required>
                <Textarea rows={2} value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} placeholder="Ex.: cadastro duplicado, criado por engano…" />
              </FormField>
            </div>

            <div className="form-actions">
              <Button variant="secondary" onClick={() => setDeletingEmp(null)}>Cancelar</Button>
              <Button onClick={confirmDelete} disabled={deleteBusy}>{deleteBusy ? "Excluindo..." : "Excluir funcionário"}</Button>
            </div>
          </section>
        </div>
      )}

      {/* Lista */}
      <section className="panel">
        <div className="section-heading">
          <div>
            <PanelEyebrow>Cadastro de funcionários</PanelEyebrow>
            <h2>Funcionários</h2>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <IconButton icon={<RefreshCw size={16} />} label="Atualizar" onClick={loadEmployees} />
            {canEdit && <Button leadingIcon={<Plus size={14} />} onClick={openNew}>Novo funcionário</Button>}
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
          <FormField label="Busca">
            <TextField placeholder="Nome, CPF ou cargo" value={search} onChange={(e) => setSearch(e.target.value)} />
          </FormField>
          <FormField label="Incluir inativos" inline>
            <Switch checked={includeInactive} onChange={setIncludeInactive} />
          </FormField>
        </div>

        {error && <Alert tone="error">{error}</Alert>}
        {loading && <EmptyState title="Carregando funcionários..." />}

        {!loading && employees.length === 0 && (
          <EmptyState
            title="Nenhum funcionário cadastrado."
            action={canEdit ? <Button leadingIcon={<Plus size={14} />} onClick={openNew}>Novo funcionário</Button> : undefined}
          />
        )}

        {!loading && employees.length > 0 && (
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.Th minWidth={180}>Nome</Table.Th>
                <Table.Th>Cargo</Table.Th>
                <Table.Th>Setor</Table.Th>
                <Table.Th>Modalidade</Table.Th>
                <Table.Th>Salário base</Table.Th>
                <Table.Th>VT</Table.Th>
                <Table.Th>Status</Table.Th>
                {canEdit && <Table.Th actions>Ações</Table.Th>}
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {employees.map((e) => {
                const age = calcAge(e.birthDate);
                return (
                  <Table.Row key={e.id} style={!e.isActive ? { opacity: 0.55 } : undefined}>
                    <Table.Td>
                      <strong>{fullName(e)}</strong>
                      <div style={{ fontSize: "0.82em", color: "var(--muted)" }}>
                        {e.cpf}{age != null ? ` · ${age} anos` : ""}
                      </div>
                    </Table.Td>
                    <Table.Td>{e.position ?? "—"}</Table.Td>
                    <Table.Td>{e.sector ?? "—"}</Table.Td>
                    <Table.Td><StatusBadge tone={e.modality === "CLT" ? "info" : "neutral"}>{MODALITY_LABELS[e.modality]}</StatusBadge></Table.Td>
                    <Table.Td style={{ whiteSpace: "nowrap", fontWeight: 500 }}><Money value={e.baseSalary} /></Table.Td>
                    <Table.Td>{VT_TYPE_LABELS[e.vtType]}</Table.Td>
                    <Table.Td>
                      <StatusBadge tone={e.isActive ? "success" : "danger"}>
                        {e.isActive ? "Ativo" : (e.terminationDate ? "Desligado" : "Inativo")}
                      </StatusBadge>
                    </Table.Td>
                    {canEdit && (
                      <Table.Td actions>
                        <IconButton icon={<Pencil size={16} />} label="Editar" onClick={() => openEdit(e)} />
                        <RowMenu
                          label={`Mais ações — ${fullName(e)}`}
                          items={[
                            ...(e.isActive ? [{ label: "Registrar desligamento", icon: <UserMinus size={15} />, onClick: () => openTerminate(e) }] : []),
                            ...(!e.isActive && e.terminationDate ? [{ label: "Lançar rescisão", icon: <FileText size={15} />, onClick: () => openRescisao(e) }] : []),
                            { label: e.isActive ? "Inativar" : "Reativar", icon: <PowerOff size={15} />, tone: e.isActive ? "danger" as const : "default" as const, onClick: () => handleToggleStatus(e) },
                            { label: "Excluir", icon: <Trash2 size={15} />, tone: "danger" as const, onClick: () => openDelete(e) }
                          ]}
                        />
                      </Table.Td>
                    )}
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table>
        )}
      </section>
    </div>
  );
}
