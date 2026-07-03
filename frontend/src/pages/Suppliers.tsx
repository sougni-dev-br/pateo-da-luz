import { ChevronDown, ChevronUp, History, Pencil, PowerOff, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getPaymentMethods, getSupplierHistory, getSuppliers, PaymentMethod, saveSupplier, setSupplierStatus, Supplier, SupplierHistory } from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { useSession } from "../context/SessionContext";
import {
  Alert,
  Button,
  EmptyState,
  FormField,
  FormGrid,
  FormSection,
  IconButton,
  RowMenu,
  Select,
  StatusBadge,
  Switch,
  Table,
  Tabs,
  TextField
} from "../design-system";
import { hasPermission } from "../lib/permissions";
import { formatCurrency, formatDate } from "../utils/format";

const emptySupplier = {
  id: "",
  externalCode: "",
  document: "",
  name: "",
  phone: "",
  email: "",
  contactName: "",
  mainCategory: "",
  defaultPaymentTermDays: "",
  defaultPaymentMethodId: "",
  defaultInstallmentCount: "",
  defaultInstallmentDays: "",
  defaultFinancialNotes: "",
  registrationDate: "",
  notes: "",
  isActive: true,
  billingMode: "DIRECT",
  cycleFrequency: "",
  cycleFirstDueDays: "",
  cycleSecondDueDays: ""
};

function toInputDate(value: string | null | undefined) {
  if (!value) return "";
  return value.slice(0, 10);
}

function parseInstallmentDaysInput(value: string): number[] | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/[,;\s]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  return parts.length > 0 ? parts : null;
}

function paymentLabel(supplier: Supplier): string {
  if (supplier.billingMode === "CYCLE") return "Por ciclo";
  if (supplier.defaultInstallmentDays && Array.isArray(supplier.defaultInstallmentDays) && supplier.defaultInstallmentDays.length > 0) {
    return `${supplier.defaultInstallmentCount ?? supplier.defaultInstallmentDays.length}x / ${(supplier.defaultInstallmentDays as number[]).join(", ")}d`;
  }
  if (supplier.defaultPaymentTermDays) return `${supplier.defaultPaymentTermDays}d`;
  return "-";
}

export function Suppliers({ onOpenPurchases }: { onOpenPurchases?: () => void }) {
  const { user } = useSession();
  const canEdit = hasPermission(user, "suppliers", "edit");
  const canDelete = hasPermission(user, "suppliers", "delete");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");
  const [form, setForm] = useState(emptySupplier);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [history, setHistory] = useState<SupplierHistory | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const { notice, setNotice } = useNotice();
  const formRef = useRef<HTMLElement | null>(null);

  async function loadSuppliers() {
    setLoading(true);
    setError(null);
    try {
      const [supplierList, methodList] = await Promise.all([getSuppliers({ search: search || undefined }), getPaymentMethods()]);
      setSuppliers(supplierList);
      setPaymentMethods(methodList.filter((m) => m.isActive));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Erro ao carregar fornecedores.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    if (!form.name.trim()) return;
    const isUpdate = Boolean(form.id);
    setError(null);
    try {
      await saveSupplier({
        ...form,
        defaultPaymentTermDays: form.defaultPaymentTermDays === "" ? null : Number(form.defaultPaymentTermDays),
        defaultPaymentMethodId: form.defaultPaymentMethodId || null,
        defaultInstallmentCount: form.defaultInstallmentCount === "" ? null : Number(form.defaultInstallmentCount),
        defaultInstallmentDays: parseInstallmentDaysInput(form.defaultInstallmentDays),
        defaultFinancialNotes: form.defaultFinancialNotes || null,
        billingMode: form.billingMode || "DIRECT",
        cycleFrequency: form.cycleFrequency || null,
        cycleFirstDueDays: form.cycleFirstDueDays === "" ? null : Number(form.cycleFirstDueDays),
        cycleSecondDueDays: form.cycleSecondDueDays === "" ? null : Number(form.cycleSecondDueDays)
      });
      cancelEdit();
      await loadSuppliers();
      setNotice({ tone: "success", message: isUpdate ? "Cadastro atualizado com sucesso." : "Cadastro criado com sucesso." });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Erro ao salvar fornecedor.");
      setNotice({ tone: "error", message: "Erro ao salvar." });
    }
  }

  async function toggleStatus(supplier: Supplier) {
    setError(null);
    try {
      await setSupplierStatus(supplier.id, !supplier.isActive);
      await loadSuppliers();
      setNotice({ tone: "success", message: supplier.isActive ? "Cadastro inativado com sucesso." : "Cadastro reativado com sucesso." });
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Erro ao alterar status.");
      setNotice({ tone: "error", message: "Erro ao salvar." });
    }
  }

  async function loadHistory(supplier: Supplier) {
    setSelectedSupplier(supplier);
    setHistory(await getSupplierHistory(supplier.id));
  }

  function editSupplier(supplier: Supplier) {
    setForm({
      id: supplier.id,
      externalCode: supplier.externalCode ?? "",
      document: supplier.document ?? "",
      name: supplier.name,
      phone: supplier.phone ?? "",
      email: supplier.email ?? "",
      contactName: supplier.contactName ?? "",
      mainCategory: supplier.mainCategory ?? "",
      defaultPaymentTermDays: supplier.defaultPaymentTermDays == null ? "" : String(supplier.defaultPaymentTermDays),
      defaultPaymentMethodId: supplier.defaultPaymentMethodId ?? "",
      defaultInstallmentCount: supplier.defaultInstallmentCount == null ? "" : String(supplier.defaultInstallmentCount),
      defaultInstallmentDays: Array.isArray(supplier.defaultInstallmentDays) ? supplier.defaultInstallmentDays.join(", ") : "",
      defaultFinancialNotes: supplier.defaultFinancialNotes ?? "",
      registrationDate: toInputDate(supplier.registrationDate),
      notes: supplier.notes ?? "",
      isActive: supplier.isActive,
      billingMode: supplier.billingMode ?? "DIRECT",
      cycleFrequency: supplier.cycleFrequency ?? "",
      cycleFirstDueDays: supplier.cycleFirstDueDays == null ? "" : String(supplier.cycleFirstDueDays),
      cycleSecondDueDays: supplier.cycleSecondDueDays == null ? "" : String(supplier.cycleSecondDueDays)
    });
    setEditingId(supplier.id);
    setEditingName(supplier.name);
    setFormOpen(true);
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }

  function cancelEdit() {
    setForm(emptySupplier);
    setEditingId(null);
    setEditingName("");
    setFormOpen(false);
  }

  function openNewForm() {
    setForm(emptySupplier);
    setEditingId(null);
    setEditingName("");
    setFormOpen(true);
    window.setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }

  const filteredSuppliers = suppliers.filter((s) => {
    if (statusFilter === "active") return s.isActive;
    if (statusFilter === "inactive") return !s.isActive;
    return true;
  });

  useEffect(() => {
    loadSuppliers();
  }, []);

  const activeCount = suppliers.filter((s) => s.isActive).length;
  const statusTabs = [
    { value: "all", label: `Todos (${suppliers.length})` },
    { value: "active", label: `Ativos (${activeCount})` },
    { value: "inactive", label: `Inativos (${suppliers.length - activeCount})` }
  ];

  const installmentCount = Number(form.defaultInstallmentCount);
  const installmentDays = parseInstallmentDaysInput(form.defaultInstallmentDays);
  const installmentMismatch =
    installmentCount > 0 && installmentDays && installmentCount !== installmentDays.length;

  return (
    <div className="stack">
      <Notice notice={notice} />

      {/* ── Cabeçalho da página ── */}
      <div className="supp-page-header">
        <p className="supp-page-sub">Cadastro utilizado em compras, pagamentos e relatórios financeiros</p>
        <div className="supp-page-actions">
          <IconButton icon={<RefreshCw size={16} />} label="Atualizar" onClick={loadSuppliers} />
          {canEdit && (
            <Button onClick={openNewForm}>+ Novo fornecedor</Button>
          )}
        </div>
      </div>

      {/* ── Formulário colapsável ── */}
      <section
        ref={formRef}
        className={`panel supp-form-panel${formOpen ? " supp-form-open" : ""}`}
        aria-expanded={formOpen}
      >
        <button
          type="button"
          className="supp-form-toggle"
          onClick={() => { if (formOpen) cancelEdit(); else openNewForm(); }}
          aria-expanded={formOpen}
        >
          <span className="supp-form-toggle-label">
            {formOpen
              ? (editingId ? `Editando: ${editingName}` : "Novo fornecedor")
              : "Cadastrar / Editar fornecedor"}
          </span>
          {formOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {formOpen && (
          <div className="stack">
            {editingId && (
              <div className="supp-editing-banner">
                <span>Editando fornecedor: <strong>{editingName}</strong></span>
                <button type="button" className="supp-editing-cancel" onClick={cancelEdit}>
                  <X size={14} /> Cancelar edição
                </button>
              </div>
            )}

            <FormSection eyebrow="Cadastro operacional" title="Dados do fornecedor">
              <FormGrid cols={4}>
                <FormField label="Código" hint="Gerado automaticamente ao salvar">
                  <TextField readOnly value={form.externalCode || "Gerado automaticamente"} />
                </FormField>
                <FormField label="Nome" required>
                  <TextField value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
                </FormField>
                <FormField label="CNPJ/CPF">
                  <TextField value={form.document} onChange={(event) => setForm({ ...form, document: event.target.value })} />
                </FormField>
                <FormField label="Telefone">
                  <TextField value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
                </FormField>
                <FormField label="Email">
                  <TextField type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
                </FormField>
                <FormField label="Contato">
                  <TextField value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} />
                </FormField>
                <FormField label="Categoria">
                  <TextField value={form.mainCategory} onChange={(event) => setForm({ ...form, mainCategory: event.target.value })} />
                </FormField>
                <FormField label="Data de cadastro">
                  <TextField type="date" value={form.registrationDate} onChange={(event) => setForm({ ...form, registrationDate: event.target.value })} />
                </FormField>
                <div className="ds-form-grid-span-all">
                  <FormField label="Observações">
                    <TextField value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
                  </FormField>
                </div>
                <FormField label="Fornecedor ativo" inline>
                  <Switch checked={form.isActive} onChange={(checked) => setForm({ ...form, isActive: checked })} />
                </FormField>
              </FormGrid>
            </FormSection>

            <FormSection
              eyebrow="Financeiro"
              title="Condição padrão de pagamento"
              description="Essas condições serão usadas automaticamente nas novas compras. Se nada for informado, o sistema usa BOLETO em 2 parcelas: 15 e 30 dias."
            >
              <FormGrid cols={4}>
                <FormField label="Forma de pagamento">
                  <Select
                    value={form.defaultPaymentMethodId}
                    onChange={(event) => setForm({ ...form, defaultPaymentMethodId: event.target.value })}
                    placeholder="Padrão do sistema (BOLETO)"
                    options={paymentMethods.map((method) => ({ value: method.id, label: method.name }))}
                  />
                </FormField>
                <FormField label="Parcelas">
                  <TextField type="number" min="1" step="1" placeholder="Ex: 2" value={form.defaultInstallmentCount} onChange={(event) => setForm({ ...form, defaultInstallmentCount: event.target.value })} />
                </FormField>
                <FormField label="Dias de vencimento" hint="Separados por vírgula">
                  <TextField placeholder="Ex: 15, 30" value={form.defaultInstallmentDays} onChange={(event) => setForm({ ...form, defaultInstallmentDays: event.target.value })} />
                </FormField>
                <FormField label="Prazo em dias">
                  <TextField type="number" min="0" placeholder="Ex: 30" value={form.defaultPaymentTermDays} onChange={(event) => setForm({ ...form, defaultPaymentTermDays: event.target.value })} />
                </FormField>
                <div className="ds-form-grid-span-all">
                  <FormField label="Observação financeira">
                    <TextField placeholder="Ex: Boleto enviado por email até o dia 5" value={form.defaultFinancialNotes} onChange={(event) => setForm({ ...form, defaultFinancialNotes: event.target.value })} />
                  </FormField>
                </div>
                {installmentMismatch && (
                  <div className="ds-form-grid-span-all">
                    <Alert tone="warning">
                      {installmentCount} parcela{installmentCount !== 1 ? "s" : ""} configurada{installmentCount !== 1 ? "s" : ""} mas {installmentDays!.length} dia{installmentDays!.length !== 1 ? "s" : ""} de vencimento informado{installmentDays!.length !== 1 ? "s" : ""} — os dois valores precisam ser iguais.
                    </Alert>
                  </div>
                )}
              </FormGrid>
            </FormSection>

            <FormSection eyebrow="Financeiro" title="Faturamento">
              <FormGrid cols={4}>
                <FormField
                  label="Tipo de faturamento"
                  hint={form.billingMode === "CYCLE"
                    ? "Compras do período são acumuladas para gerar uma fatura depois."
                    : "Cada compra gera suas próprias parcelas no Contas a Pagar."}
                >
                  <Select
                    value={form.billingMode}
                    onChange={(event) => setForm({ ...form, billingMode: event.target.value, cycleFrequency: "", cycleFirstDueDays: "", cycleSecondDueDays: "" })}
                    options={[
                      { value: "DIRECT", label: "Direto por compra" },
                      { value: "CYCLE", label: "Por ciclo / fatura" }
                    ]}
                  />
                </FormField>
                {form.billingMode === "CYCLE" && (
                  <>
                    <FormField label="Frequência do ciclo">
                      <Select
                        value={form.cycleFrequency}
                        onChange={(event) => setForm({ ...form, cycleFrequency: event.target.value })}
                        placeholder="Sem frequência definida"
                        options={[
                          { value: "WEEKLY", label: "Semanal" },
                          { value: "BIWEEKLY", label: "Quinzenal" },
                          { value: "MONTHLY", label: "Mensal" },
                          { value: "CUSTOM", label: "Personalizado" }
                        ]}
                      />
                    </FormField>
                    <FormField label="1º vencimento (dias)">
                      <TextField type="number" min="1" step="1" placeholder="Ex: 15" value={form.cycleFirstDueDays} onChange={(event) => setForm({ ...form, cycleFirstDueDays: event.target.value })} />
                    </FormField>
                    <FormField label="2º vencimento (opcional)">
                      <TextField type="number" min="1" step="1" placeholder="Ex: 30" value={form.cycleSecondDueDays} onChange={(event) => setForm({ ...form, cycleSecondDueDays: event.target.value })} />
                    </FormField>
                  </>
                )}
              </FormGrid>
            </FormSection>

            <div className="form-actions">
              <Button variant="secondary" onClick={cancelEdit}>Cancelar</Button>
              <Button disabled={!canEdit} onClick={handleSubmit}>
                {form.id ? "Salvar alterações" : "Cadastrar"}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* ── Listagem ── */}
      <section className="panel">
        <div className="supp-list-header">
          <div className="supp-search-wrap">
            <TextField
              placeholder="Buscar por nome, código ou documento…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") loadSuppliers(); }}
              containerClassName="supp-search-field"
            />
            <Button variant="secondary" onClick={loadSuppliers}>Buscar</Button>
          </div>
          <Tabs
            tabs={statusTabs}
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as typeof statusFilter)}
          />
        </div>

        {error && <Alert tone="error">{error}</Alert>}
        {loading && <EmptyState title="Carregando fornecedores…" />}

        {!loading && filteredSuppliers.length === 0 && (
          <EmptyState
            title={search ? `Nenhum fornecedor encontrado para "${search}"` : "Nenhum fornecedor cadastrado."}
            action={canEdit && !search
              ? <Button onClick={openNewForm}>+ Novo fornecedor</Button>
              : undefined}
          />
        )}

        {!loading && filteredSuppliers.length > 0 && (
          <>
            {/* Desktop table */}
            <div className="supp-table-wrap">
              <Table>
                <Table.Head>
                  <Table.Row>
                    <Table.Th>Situação</Table.Th>
                    <Table.Th>Código</Table.Th>
                    <Table.Th minWidth={180}>Fornecedor</Table.Th>
                    <Table.Th>Documento</Table.Th>
                    <Table.Th>Contato</Table.Th>
                    <Table.Th>Categoria</Table.Th>
                    <Table.Th>Pagamento</Table.Th>
                    <Table.Th actions>Ações</Table.Th>
                  </Table.Row>
                </Table.Head>
                <Table.Body>
                  {filteredSuppliers.map((supplier) => (
                    <Table.Row
                      key={supplier.id}
                      className={editingId === supplier.id ? "supp-row-editing" : undefined}
                    >
                      <Table.Td>
                        <StatusBadge tone={supplier.isActive ? "success" : "danger"}>
                          {supplier.isActive ? "Ativo" : "Inativo"}
                        </StatusBadge>
                      </Table.Td>
                      <Table.Td style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{supplier.externalCode ?? "-"}</Table.Td>
                      <Table.Td truncate title={supplier.name} style={{ fontWeight: "var(--fw-medium)" as never }}>
                        {supplier.name}
                      </Table.Td>
                      <Table.Td style={{ whiteSpace: "nowrap" }}>{supplier.document ?? "-"}</Table.Td>
                      <Table.Td truncate style={{ maxWidth: 150 }} title={supplier.contactName ?? supplier.phone ?? supplier.email ?? undefined}>
                        {supplier.contactName ?? supplier.phone ?? supplier.email ?? "-"}
                      </Table.Td>
                      <Table.Td truncate style={{ maxWidth: 120 }} title={supplier.mainCategory ?? undefined}>
                        {supplier.mainCategory ?? "-"}
                      </Table.Td>
                      <Table.Td>
                        <StatusBadge
                          tone="neutral"
                          title={supplier.billingMode === "CYCLE"
                            ? `Ciclo${supplier.cycleFrequency ? ` ${supplier.cycleFrequency}` : ""}${supplier.cycleFirstDueDays ? ` — ${supplier.cycleFirstDueDays}d` : ""}`
                            : undefined}
                        >
                          {paymentLabel(supplier)}
                        </StatusBadge>
                      </Table.Td>
                      <Table.Td actions>
                        <IconButton
                          icon={<Pencil size={16} />}
                          label="Editar"
                          disabled={!canEdit}
                          onClick={() => editSupplier(supplier)}
                        />
                        <RowMenu
                          label={`Mais ações — ${supplier.name}`}
                          items={[
                            { label: "Histórico de compras", icon: <History size={15} />, onClick: () => loadHistory(supplier) },
                            { separator: true },
                            {
                              label: supplier.isActive ? "Inativar" : "Reativar",
                              icon: <PowerOff size={15} />,
                              tone: supplier.isActive ? "danger" : "default",
                              disabled: !canDelete,
                              onClick: () => toggleStatus(supplier)
                            }
                          ]}
                        />
                      </Table.Td>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            </div>

            {/* Mobile cards */}
            <div className="supp-mobile-list">
              {filteredSuppliers.map((supplier) => (
                <div key={supplier.id} className={`supp-card${editingId === supplier.id ? " supp-card-editing" : ""}`}>
                  <div className="supp-card-header">
                    <div className="supp-card-title-wrap">
                      {supplier.externalCode && <span className="supp-card-code">{supplier.externalCode}</span>}
                      <span className="supp-card-name">{supplier.name}</span>
                    </div>
                    <StatusBadge tone={supplier.isActive ? "success" : "danger"}>
                      {supplier.isActive ? "Ativo" : "Inativo"}
                    </StatusBadge>
                  </div>
                  <div className="supp-card-meta">
                    {supplier.document && <span>{supplier.document}</span>}
                    {(supplier.contactName || supplier.phone) && <span>{supplier.contactName ?? supplier.phone}</span>}
                    {supplier.mainCategory && <span>{supplier.mainCategory}</span>}
                    {paymentLabel(supplier) !== "-" && <span>{paymentLabel(supplier)}</span>}
                  </div>
                  <div className="supp-card-actions">
                    <button type="button" className="supp-card-btn" disabled={!canEdit} onClick={() => editSupplier(supplier)}>
                      <Pencil size={13} /> Editar
                    </button>
                    <button type="button" className={`supp-card-btn${supplier.isActive ? " danger" : ""}`} disabled={!canDelete} onClick={() => toggleStatus(supplier)}>
                      <PowerOff size={13} /> {supplier.isActive ? "Inativar" : "Reativar"}
                    </button>
                    <button type="button" className="supp-card-btn" onClick={() => loadHistory(supplier)}>
                      <History size={13} /> Histórico
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* ── Modal de histórico ── */}
      {selectedSupplier && history && (
        <div className="modal-backdrop">
          <section className="panel modal-panel">
            <div className="section-heading">
              <div>
                <p>Histórico do fornecedor</p>
                <h2>{selectedSupplier.name}</h2>
              </div>
              <Button variant="secondary" onClick={() => { setSelectedSupplier(null); setHistory(null); }}>Fechar</Button>
            </div>
            <div className="summary-grid">
              <article><span>Total no mês</span><strong>{formatCurrency(history.monthTotal)}</strong></article>
              <article><span>Total no ano</span><strong>{formatCurrency(history.yearTotal)}</strong></article>
              <article><span>Última compra</span><strong>{history.lastPurchase ? formatDate(history.lastPurchase.purchaseDate) : "-"}</strong></article>
              <article><span>Prazo médio</span><strong>{history.averagePaymentTermDays == null ? "-" : `${Math.round(history.averagePaymentTermDays)} dias`}</strong></article>
            </div>
            <div className="summary-columns">
              <div>
                <h3>Últimas NFs</h3>
                {history.recentInvoices.map((invoice) => <p key={invoice.id}>{invoice.purchaseNumber ?? "-"} NF {invoice.invoiceNumber ?? "-"} - {formatCurrency(invoice.totalAmount)}</p>)}
              </div>
              <div>
                <h3>Produtos mais comprados</h3>
                {history.topProducts.map((product) => <p key={product.name}>{product.name} - {formatCurrency(product.total)}</p>)}
              </div>
              <div>
                <h3>Pagamentos usados</h3>
                {history.paymentMethods.map((method) => <p key={method.name}>{method.name}: {method.count}</p>)}
              </div>
            </div>
            <div className="subsection">
              <Table>
                <Table.Head>
                  <Table.Row>
                    <Table.Th>Pedido interno</Table.Th>
                    <Table.Th>Data</Table.Th>
                    <Table.Th>NF</Table.Th>
                    <Table.Th align="right">Total</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th actions>Abrir</Table.Th>
                  </Table.Row>
                </Table.Head>
                <Table.Body>
                  {history.recentInvoices.map((invoice) => (
                    <Table.Row key={invoice.id}>
                      <Table.Td>{invoice.purchaseNumber ?? "-"}</Table.Td>
                      <Table.Td>{formatDate(invoice.purchaseDate)}</Table.Td>
                      <Table.Td>{invoice.invoiceNumber ?? "-"}</Table.Td>
                      <Table.Td align="right">{formatCurrency(invoice.totalAmount)}</Table.Td>
                      <Table.Td>{invoice.status}</Table.Td>
                      <Table.Td actions>
                        <Button variant="secondary" size="sm" onClick={onOpenPurchases}>Abrir compra</Button>
                      </Table.Td>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
