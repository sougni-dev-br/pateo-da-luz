import { ChevronDown, ChevronRight, Pencil, Plus, PowerOff, RefreshCw } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import {
  Company, CompanyBankAccount,
  getCompanies, getCompanyBankAccounts,
  saveCompany, saveCompanyBankAccount, setCompanyBankAccountStatus, setCompanyStatus
} from "../api/client";
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
  PanelEyebrow,
  RowMenu,
  Select,
  StatusBadge,
  Switch,
  Table,
  Textarea,
  TextField
} from "../design-system";
import { hasPermission } from "../lib/permissions";

const BANK_ACCOUNT_TYPE_LABELS: Record<CompanyBankAccount["accountType"], string> = {
  CONTA_CORRENTE: "Conta Corrente",
  POUPANCA: "Poupança",
  CAIXA: "Caixa",
  CARTEIRA: "Carteira",
  CARTAO: "Cartão",
  OUTROS: "Outros"
};

const emptyCompany = {
  id: "", code: "", tradeName: "", legalName: "", cnpj: "",
  stateRegistration: "", municipalRegistration: "", financialEmail: "",
  phone: "", zipCode: "", address: "", addressNumber: "", addressComplement: "",
  neighborhood: "", city: "", state: "", notes: ""
};

const emptyAccount = {
  id: "", bankName: "", agency: "", account: "", accountDigit: "",
  accountType: "CONTA_CORRENTE" as CompanyBankAccount["accountType"],
  pixKey: "", name: "", notes: ""
};

function applyCnpjMask(value: string) {
  const clean = value.replace(/\D/g, "").slice(0, 14);
  return clean
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function applyPhoneMask(value: string) {
  const clean = value.replace(/\D/g, "").slice(0, 11);
  if (clean.length <= 10) {
    return clean.replace(/^(\d{2})(\d{4})(\d)/, "($1) $2-$3").replace(/^(\d{2})(\d)/, "($1) $2");
  }
  return clean.replace(/^(\d{2})(\d{5})(\d)/, "($1) $2-$3");
}

function applyZipMask(value: string) {
  const clean = value.replace(/\D/g, "").slice(0, 8);
  return clean.replace(/^(\d{5})(\d)/, "$1-$2");
}

export function Companies() {
  const { user } = useSession();
  const canEdit = hasPermission(user, "companies", "edit");
  const { notice, setNotice } = useNotice();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyCompany);

  const [expandedCompanyId, setExpandedCompanyId] = useState<string | null>(null);
  const [bankAccounts, setBankAccounts] = useState<CompanyBankAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [accountForm, setAccountForm] = useState(emptyAccount);
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [includeInactiveAccounts, setIncludeInactiveAccounts] = useState(false);

  async function loadCompanies() {
    setLoading(true);
    setError(null);
    try {
      const data = await getCompanies({ search: search || undefined, includeInactive });
      setCompanies(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar empresas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadCompanies(); }, [search, includeInactive]);

  async function loadBankAccounts(companyId: string, withInactive = includeInactiveAccounts) {
    setLoadingAccounts(true);
    try {
      const data = await getCompanyBankAccounts(companyId, withInactive);
      setBankAccounts(data);
    } catch {
      setBankAccounts([]);
    } finally {
      setLoadingAccounts(false);
    }
  }

  function openNewCompany() {
    setForm(emptyCompany);
    setShowForm(true);
    setError(null);
  }

  function openEditCompany(company: Company) {
    setForm({
      id: company.id,
      code: company.code,
      tradeName: company.tradeName,
      legalName: company.legalName,
      cnpj: company.cnpj,
      stateRegistration: company.stateRegistration ?? "",
      municipalRegistration: company.municipalRegistration ?? "",
      financialEmail: company.financialEmail ?? "",
      phone: company.phone ?? "",
      zipCode: company.zipCode ?? "",
      address: company.address ?? "",
      addressNumber: company.addressNumber ?? "",
      addressComplement: company.addressComplement ?? "",
      neighborhood: company.neighborhood ?? "",
      city: company.city ?? "",
      state: company.state ?? "",
      notes: company.notes ?? ""
    });
    setShowForm(true);
    setError(null);
  }

  async function handleSaveCompany() {
    if (!form.tradeName.trim()) return void setError("Nome fantasia é obrigatório.");
    if (!form.legalName.trim()) return void setError("Razão social é obrigatória.");
    if (!form.cnpj.trim()) return void setError("CNPJ é obrigatório.");
    setSaving(true);
    setError(null);
    try {
      await saveCompany({
        id: form.id || undefined,
        code: form.code || undefined,
        tradeName: form.tradeName,
        legalName: form.legalName,
        cnpj: form.cnpj,
        stateRegistration: form.stateRegistration || undefined,
        municipalRegistration: form.municipalRegistration || undefined,
        financialEmail: form.financialEmail || undefined,
        phone: form.phone || undefined,
        zipCode: form.zipCode || undefined,
        address: form.address || undefined,
        addressNumber: form.addressNumber || undefined,
        addressComplement: form.addressComplement || undefined,
        neighborhood: form.neighborhood || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        notes: form.notes || undefined
      });
      setNotice({ tone: "success", message: form.id ? "Empresa atualizada." : "Empresa cadastrada." });
      setShowForm(false);
      await loadCompanies();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar empresa.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(company: Company) {
    try {
      await setCompanyStatus(company.id, !company.isActive);
      setNotice({ tone: "success", message: company.isActive ? "Empresa inativada." : "Empresa reativada." });
      await loadCompanies();
    } catch (err) {
      setNotice({ tone: "error", message: err instanceof Error ? err.message : "Erro ao alterar status." });
    }
  }

  async function toggleExpand(company: Company) {
    if (expandedCompanyId === company.id) {
      setExpandedCompanyId(null);
      setBankAccounts([]);
    } else {
      setExpandedCompanyId(company.id);
      await loadBankAccounts(company.id);
    }
  }

  function openNewAccount() {
    setAccountForm(emptyAccount);
    setShowAccountForm(true);
    setAccountError(null);
  }

  function openEditAccount(account: CompanyBankAccount) {
    setAccountForm({
      id: account.id,
      bankName: account.bankName ?? "",
      agency: account.agency ?? "",
      account: account.account ?? "",
      accountDigit: account.accountDigit ?? "",
      accountType: account.accountType,
      pixKey: account.pixKey ?? "",
      name: account.name,
      notes: account.notes ?? ""
    });
    setShowAccountForm(true);
    setAccountError(null);
  }

  async function handleSaveAccount() {
    if (!accountForm.name.trim()) return void setAccountError("Nome da conta é obrigatório.");
    if (!expandedCompanyId) return;
    setSavingAccount(true);
    setAccountError(null);
    try {
      await saveCompanyBankAccount(expandedCompanyId, {
        id: accountForm.id || undefined,
        bankName: accountForm.bankName || undefined,
        agency: accountForm.agency || undefined,
        account: accountForm.account || undefined,
        accountDigit: accountForm.accountDigit || undefined,
        accountType: accountForm.accountType,
        pixKey: accountForm.pixKey || undefined,
        name: accountForm.name,
        notes: accountForm.notes || undefined
      });
      setNotice({ tone: "success", message: accountForm.id ? "Conta atualizada." : "Conta cadastrada." });
      setShowAccountForm(false);
      await loadBankAccounts(expandedCompanyId);
      await loadCompanies();
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : "Erro ao salvar conta.");
    } finally {
      setSavingAccount(false);
    }
  }

  async function handleToggleAccountStatus(account: CompanyBankAccount) {
    if (!expandedCompanyId) return;
    try {
      await setCompanyBankAccountStatus(expandedCompanyId, account.id, !account.isActive);
      setNotice({ tone: "success", message: account.isActive ? "Conta inativada." : "Conta reativada." });
      await loadBankAccounts(expandedCompanyId);
      await loadCompanies();
    } catch (err) {
      setNotice({ tone: "error", message: err instanceof Error ? err.message : "Erro ao alterar status." });
    }
  }

  const columnCount = canEdit ? 8 : 7;

  return (
    <div className="stack">
      <Notice notice={notice} />

      {/* Formulário de empresa */}
      {showForm && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <PanelEyebrow>Cadastro operacional</PanelEyebrow>
              <h2>{form.id ? "Editar empresa" : "Nova empresa"}</h2>
            </div>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Fechar</Button>
          </div>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="stack">
            <FormSection title="Identificação">
              <FormGrid cols={4}>
                <FormField label="Nome fantasia" required>
                  <TextField value={form.tradeName} onChange={(e) => setForm({ ...form, tradeName: e.target.value })} placeholder="Ex.: Pateo da Luz" />
                </FormField>
                <FormField label="Razão social" required>
                  <TextField value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} placeholder="Ex.: Pateo da Luz Ltda" />
                </FormField>
                <FormField label="CNPJ" required>
                  <TextField value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: applyCnpjMask(e.target.value) })} placeholder="00.000.000/0000-00" maxLength={18} />
                </FormField>
                <FormField label="Código" hint="Gerado automaticamente">
                  <TextField value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
                </FormField>
                <FormField label="Inscrição estadual">
                  <TextField value={form.stateRegistration} onChange={(e) => setForm({ ...form, stateRegistration: e.target.value })} />
                </FormField>
                <FormField label="Inscrição municipal">
                  <TextField value={form.municipalRegistration} onChange={(e) => setForm({ ...form, municipalRegistration: e.target.value })} />
                </FormField>
                <FormField label="E-mail financeiro">
                  <TextField type="email" value={form.financialEmail} onChange={(e) => setForm({ ...form, financialEmail: e.target.value })} />
                </FormField>
                <FormField label="Telefone">
                  <TextField value={form.phone} onChange={(e) => setForm({ ...form, phone: applyPhoneMask(e.target.value) })} placeholder="(00) 00000-0000" maxLength={15} />
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
                <div className="ds-form-grid-span-all">
                  <FormField label="Observações">
                    <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                  </FormField>
                </div>
              </FormGrid>
            </FormSection>

            <div className="form-actions">
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button onClick={handleSaveCompany} disabled={saving}>
                {saving ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* Formulário de conta bancária */}
      {showAccountForm && (
        <div className="modal-backdrop">
          <section className="panel modal-panel">
            <div className="section-heading">
              <div>
                <PanelEyebrow>Conta bancária</PanelEyebrow>
                <h2>{accountForm.id ? "Editar conta" : "Nova conta"}</h2>
              </div>
              <Button variant="secondary" onClick={() => setShowAccountForm(false)}>Fechar</Button>
            </div>
            {accountError && <Alert tone="error">{accountError}</Alert>}
            <FormGrid cols={3}>
              <div className="ds-form-grid-span-all">
                <FormField label="Nome / Descrição" required>
                  <TextField value={accountForm.name} onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })} placeholder="Ex.: Conta principal Bradesco" />
                </FormField>
              </div>
              <FormField label="Tipo">
                <Select
                  value={accountForm.accountType}
                  onChange={(e) => setAccountForm({ ...accountForm, accountType: e.target.value as CompanyBankAccount["accountType"] })}
                  options={(Object.entries(BANK_ACCOUNT_TYPE_LABELS) as [CompanyBankAccount["accountType"], string][]).map(([value, label]) => ({ value, label }))}
                />
              </FormField>
              <FormField label="Banco">
                <TextField value={accountForm.bankName} onChange={(e) => setAccountForm({ ...accountForm, bankName: e.target.value })} placeholder="Ex.: Bradesco" />
              </FormField>
              <FormField label="Agência">
                <TextField value={accountForm.agency} onChange={(e) => setAccountForm({ ...accountForm, agency: e.target.value })} placeholder="0000" />
              </FormField>
              <FormField label="Conta">
                <TextField value={accountForm.account} onChange={(e) => setAccountForm({ ...accountForm, account: e.target.value })} placeholder="00000" />
              </FormField>
              <FormField label="Dígito">
                <TextField value={accountForm.accountDigit} onChange={(e) => setAccountForm({ ...accountForm, accountDigit: e.target.value.slice(0, 2) })} maxLength={2} placeholder="0" />
              </FormField>
              <div className="ds-form-grid-span-all">
                <FormField label="Chave PIX">
                  <TextField value={accountForm.pixKey} onChange={(e) => setAccountForm({ ...accountForm, pixKey: e.target.value })} placeholder="CNPJ, e-mail, telefone ou chave aleatória" />
                </FormField>
              </div>
              <div className="ds-form-grid-span-all">
                <FormField label="Observações">
                  <TextField value={accountForm.notes} onChange={(e) => setAccountForm({ ...accountForm, notes: e.target.value })} />
                </FormField>
              </div>
            </FormGrid>
            <div className="form-actions">
              <Button variant="secondary" onClick={() => setShowAccountForm(false)}>Cancelar</Button>
              <Button onClick={handleSaveAccount} disabled={savingAccount}>
                {savingAccount ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </section>
        </div>
      )}

      {/* Lista principal */}
      <section className="panel">
        <div className="section-heading">
          <div>
            <PanelEyebrow>Cadastro operacional</PanelEyebrow>
            <h2>Empresas / Filiais</h2>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <IconButton icon={<RefreshCw size={16} />} label="Atualizar" onClick={loadCompanies} />
            {canEdit && (
              <Button leadingIcon={<Plus size={14} />} onClick={openNewCompany}>Nova empresa</Button>
            )}
          </div>
        </div>

        <div className="companies-filters">
          <FormField label="Busca" className="companies-filters-search">
            <TextField placeholder="Nome, CNPJ ou código" value={search} onChange={(e) => setSearch(e.target.value)} />
          </FormField>
          <FormField label="Incluir inativas" inline>
            <Switch checked={includeInactive} onChange={setIncludeInactive} />
          </FormField>
          <Button variant="secondary" onClick={loadCompanies}>Filtrar</Button>
        </div>

        {error && <Alert tone="error">{error}</Alert>}
        {loading && <EmptyState title="Carregando empresas..." />}

        {!loading && companies.length === 0 && (
          <EmptyState
            title="Nenhuma empresa cadastrada."
            action={canEdit ? <Button leadingIcon={<Plus size={14} />} onClick={openNewCompany}>Nova empresa</Button> : undefined}
          />
        )}

        {!loading && companies.length > 0 && (
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.Th style={{ width: 110 }} />
                <Table.Th>Código</Table.Th>
                <Table.Th minWidth={180}>Nome fantasia</Table.Th>
                <Table.Th>CNPJ</Table.Th>
                <Table.Th>Cidade</Table.Th>
                <Table.Th>Contas ativas</Table.Th>
                <Table.Th>Status</Table.Th>
                {canEdit && <Table.Th actions>Ações</Table.Th>}
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {companies.map((company) => (
                <Fragment key={company.id}>
                  <Table.Row style={!company.isActive ? { opacity: 0.55 } : undefined}>
                    <Table.Td>
                      <button
                        type="button"
                        className="companies-expand-toggle"
                        onClick={() => toggleExpand(company)}
                      >
                        {expandedCompanyId === company.id
                          ? <><ChevronDown size={12} /> Ocultar</>
                          : <><ChevronRight size={12} /> Ver contas</>}
                      </button>
                    </Table.Td>
                    <Table.Td style={{ whiteSpace: "nowrap" }}>{company.code}</Table.Td>
                    <Table.Td truncate title={company.legalName !== company.tradeName ? `${company.tradeName} — ${company.legalName}` : company.tradeName}>
                      <strong>{company.tradeName}</strong>
                      {company.legalName !== company.tradeName && (
                        <div style={{ fontSize: "0.85em", color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis" }}>{company.legalName}</div>
                      )}
                    </Table.Td>
                    <Table.Td style={{ whiteSpace: "nowrap" }}>{company.cnpj}</Table.Td>
                    <Table.Td>{company.city ? `${company.city}${company.state ? ` / ${company.state}` : ""}` : "—"}</Table.Td>
                    <Table.Td>{(() => { const n = Number(company.activeBankAccountCount ?? 0); return n === 0 ? <span style={{ color: "var(--muted)" }}>—</span> : n === 1 ? "1 conta" : `${n} contas`; })()}</Table.Td>
                    <Table.Td>
                      <StatusBadge tone={company.isActive ? "success" : "danger"}>
                        {company.isActive ? "Ativa" : "Inativa"}
                      </StatusBadge>
                    </Table.Td>
                    {canEdit && (
                      <Table.Td actions>
                        <IconButton icon={<Pencil size={16} />} label="Editar" onClick={() => openEditCompany(company)} />
                        <RowMenu
                          label={`Mais ações — ${company.tradeName}`}
                          items={[
                            {
                              label: company.isActive ? "Inativar" : "Reativar",
                              icon: <PowerOff size={15} />,
                              tone: company.isActive ? "danger" : "default",
                              onClick: () => handleToggleStatus(company)
                            }
                          ]}
                        />
                      </Table.Td>
                    )}
                  </Table.Row>

                  {/* Linha expandida: contas bancárias */}
                  {expandedCompanyId === company.id && (
                    <Table.Row>
                      <Table.Td colSpan={columnCount} style={{ padding: 0, background: "var(--paper-soft)" }}>
                        <div style={{ padding: "12px 16px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
                            <strong>Contas bancárias — {company.tradeName}</strong>
                            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                              <FormField label="Incluir inativas" inline>
                                <Switch
                                  checked={includeInactiveAccounts}
                                  onChange={(checked) => {
                                    setIncludeInactiveAccounts(checked);
                                    void loadBankAccounts(company.id, checked);
                                  }}
                                />
                              </FormField>
                              {canEdit && (
                                <Button size="sm" leadingIcon={<Plus size={13} />} onClick={openNewAccount}>Conta</Button>
                              )}
                            </div>
                          </div>

                          {loadingAccounts ? (
                            <div style={{ padding: 12, color: "var(--muted)" }}>Carregando...</div>
                          ) : bankAccounts.length === 0 ? (
                            <div style={{ padding: 12, color: "var(--muted)" }}>Nenhuma conta bancária cadastrada.</div>
                          ) : (
                            <Table>
                              <Table.Head>
                                <Table.Row>
                                  <Table.Th>Nome</Table.Th>
                                  <Table.Th>Tipo</Table.Th>
                                  <Table.Th>Banco</Table.Th>
                                  <Table.Th>Agência / Conta</Table.Th>
                                  <Table.Th>PIX</Table.Th>
                                  <Table.Th>Status</Table.Th>
                                  {canEdit && <Table.Th actions>Ações</Table.Th>}
                                </Table.Row>
                              </Table.Head>
                              <Table.Body>
                                {bankAccounts.map((account) => (
                                  <Table.Row key={account.id} style={!account.isActive ? { opacity: 0.55 } : undefined}>
                                    <Table.Td><strong>{account.name}</strong></Table.Td>
                                    <Table.Td>{BANK_ACCOUNT_TYPE_LABELS[account.accountType]}</Table.Td>
                                    <Table.Td>{account.bankName ?? "—"}</Table.Td>
                                    <Table.Td style={{ whiteSpace: "nowrap" }}>
                                      {account.agency && account.account
                                        ? `${account.agency} / ${account.account}${account.accountDigit ? `-${account.accountDigit}` : ""}`
                                        : "—"
                                      }
                                    </Table.Td>
                                    <Table.Td truncate style={{ maxWidth: 180 }} title={account.pixKey ?? undefined}>{account.pixKey ?? "—"}</Table.Td>
                                    <Table.Td>
                                      <StatusBadge tone={account.isActive ? "success" : "danger"}>
                                        {account.isActive ? "Ativa" : "Inativa"}
                                      </StatusBadge>
                                    </Table.Td>
                                    {canEdit && (
                                      <Table.Td actions>
                                        <IconButton icon={<Pencil size={16} />} label="Editar" size="sm" onClick={() => openEditAccount(account)} />
                                        <IconButton
                                          icon={<PowerOff size={16} />}
                                          label={account.isActive ? "Inativar" : "Reativar"}
                                          size="sm"
                                          variant={account.isActive ? "danger" : "default"}
                                          onClick={() => handleToggleAccountStatus(account)}
                                        />
                                      </Table.Td>
                                    )}
                                  </Table.Row>
                                ))}
                              </Table.Body>
                            </Table>
                          )}
                        </div>
                      </Table.Td>
                    </Table.Row>
                  )}
                </Fragment>
              ))}
            </Table.Body>
          </Table>
        )}
      </section>
    </div>
  );
}
