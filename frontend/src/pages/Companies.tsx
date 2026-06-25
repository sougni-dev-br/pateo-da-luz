import { Building2, ChevronDown, ChevronRight, Plus, RefreshCw } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import {
  Company, CompanyBankAccount,
  getCompanies, getCompanyBankAccounts,
  saveCompany, saveCompanyBankAccount, setCompanyBankAccountStatus, setCompanyStatus
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { useSession } from "../context/SessionContext";
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

  return (
    <div className="stack">
      <Notice notice={notice} />

      {/* Formulário de empresa */}
      {showForm && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p>Cadastro base</p>
              <h2>{form.id ? "Editar empresa" : "Nova empresa"}</h2>
            </div>
            <button className="secondary-button" type="button" onClick={() => setShowForm(false)}>Fechar</button>
          </div>
          {error && <div className="alert error">{error}</div>}
          <div className="form-grid">
            <label>Nome fantasia *<input value={form.tradeName} onChange={(e) => setForm({ ...form, tradeName: e.target.value })} placeholder="Ex.: Pateo da Luz" /></label>
            <label>Razão social *<input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} placeholder="Ex.: Pateo da Luz Ltda" /></label>
            <label>CNPJ *<input value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: applyCnpjMask(e.target.value) })} placeholder="00.000.000/0000-00" maxLength={18} /></label>
            <label>Código<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="Gerado automaticamente" /></label>
            <label>Inscrição estadual<input value={form.stateRegistration} onChange={(e) => setForm({ ...form, stateRegistration: e.target.value })} /></label>
            <label>Inscrição municipal<input value={form.municipalRegistration} onChange={(e) => setForm({ ...form, municipalRegistration: e.target.value })} /></label>
            <label>E-mail financeiro<input type="email" value={form.financialEmail} onChange={(e) => setForm({ ...form, financialEmail: e.target.value })} /></label>
            <label>Telefone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: applyPhoneMask(e.target.value) })} placeholder="(00) 00000-0000" maxLength={15} /></label>
          </div>
          <div className="subsection">
            <p className="hint">Endereço</p>
            <div className="form-grid">
              <label>CEP<input value={form.zipCode} onChange={(e) => setForm({ ...form, zipCode: applyZipMask(e.target.value) })} placeholder="00000-000" maxLength={9} /></label>
              <label className="full-width">Logradouro<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
              <label>Número<input value={form.addressNumber} onChange={(e) => setForm({ ...form, addressNumber: e.target.value })} /></label>
              <label>Complemento<input value={form.addressComplement} onChange={(e) => setForm({ ...form, addressComplement: e.target.value })} /></label>
              <label>Bairro<input value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} /></label>
              <label>Cidade<input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
              <label>UF<input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase().slice(0, 2) })} maxLength={2} placeholder="SP" style={{ width: 60 }} /></label>
            </div>
          </div>
          <div className="form-grid">
            <label className="full-width">Observações<textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          </div>
          <div className="form-actions">
            <button className="secondary-button" type="button" onClick={() => setShowForm(false)}>Cancelar</button>
            <button className="primary-button" type="button" onClick={handleSaveCompany} disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </section>
      )}

      {/* Formulário de conta bancária */}
      {showAccountForm && (
        <div className="modal-backdrop">
          <section className="panel modal-panel">
            <div className="section-heading">
              <div>
                <p>Conta bancária</p>
                <h2>{accountForm.id ? "Editar conta" : "Nova conta"}</h2>
              </div>
              <button className="secondary-button" type="button" onClick={() => setShowAccountForm(false)}>Fechar</button>
            </div>
            {accountError && <div className="alert error">{accountError}</div>}
            <div className="form-grid">
              <label className="full-width">Nome / Descrição *<input value={accountForm.name} onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })} placeholder="Ex.: Conta principal Bradesco" /></label>
              <label>Tipo<select value={accountForm.accountType} onChange={(e) => setAccountForm({ ...accountForm, accountType: e.target.value as CompanyBankAccount["accountType"] })}>
                {(Object.entries(BANK_ACCOUNT_TYPE_LABELS) as [CompanyBankAccount["accountType"], string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select></label>
              <label>Banco<input value={accountForm.bankName} onChange={(e) => setAccountForm({ ...accountForm, bankName: e.target.value })} placeholder="Ex.: Bradesco" /></label>
              <label>Agência<input value={accountForm.agency} onChange={(e) => setAccountForm({ ...accountForm, agency: e.target.value })} placeholder="0000" /></label>
              <label>Conta<input value={accountForm.account} onChange={(e) => setAccountForm({ ...accountForm, account: e.target.value })} placeholder="00000" /></label>
              <label>Dígito<input value={accountForm.accountDigit} onChange={(e) => setAccountForm({ ...accountForm, accountDigit: e.target.value.slice(0, 2) })} maxLength={2} placeholder="0" style={{ width: 60 }} /></label>
              <label className="full-width">Chave PIX<input value={accountForm.pixKey} onChange={(e) => setAccountForm({ ...accountForm, pixKey: e.target.value })} placeholder="CNPJ, e-mail, telefone ou chave aleatória" /></label>
              <label className="full-width">Observações<input value={accountForm.notes} onChange={(e) => setAccountForm({ ...accountForm, notes: e.target.value })} /></label>
            </div>
            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setShowAccountForm(false)}>Cancelar</button>
              <button className="primary-button" type="button" onClick={handleSaveAccount} disabled={savingAccount}>
                {savingAccount ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Lista principal */}
      <section className="panel">
        <div className="section-heading">
          <div>
            <p>Cadastro base</p>
            <h2>Empresas / Filiais</h2>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="icon-button" type="button" onClick={loadCompanies} aria-label="Atualizar"><RefreshCw size={18} /></button>
            {canEdit && (
              <button className="primary-button" type="button" onClick={openNewCompany}>
                <Plus size={14} style={{ display: "inline", marginRight: 4 }} />Nova empresa
              </button>
            )}
          </div>
        </div>

        <div className="filters-row">
          <label>Busca<input placeholder="Nome, CNPJ ou código" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
            Incluir inativas
          </label>
          <button className="primary-button" type="button" onClick={loadCompanies}>Filtrar</button>
        </div>

        {error && <div className="alert error">{error}</div>}
        {loading && <div className="empty-state">Carregando empresas...</div>}

        {!loading && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th>
                  <th>Código</th>
                  <th>Nome fantasia</th>
                  <th>CNPJ</th>
                  <th>Cidade</th>
                  <th>Contas ativas</th>
                  <th>Status</th>
                  {canEdit && <th>Ações</th>}
                </tr>
              </thead>
              <tbody>
                {companies.map((company) => (
                  <Fragment key={company.id}>
                    <tr style={!company.isActive ? { opacity: 0.55 } : undefined}>
                      <td>
                        <button
                          type="button"
                          onClick={() => toggleExpand(company)}
                          style={{ background: "none", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 0", fontSize: "0.8em", fontWeight: 500, color: "var(--muted)", whiteSpace: "nowrap" }}
                        >
                          {expandedCompanyId === company.id
                            ? <><ChevronDown size={12} /> Ocultar</>
                            : <><ChevronRight size={12} /> Ver contas</>}
                        </button>
                      </td>
                      <td className="nowrap-cell">{company.code}</td>
                      <td>
                        <strong>{company.tradeName}</strong>
                        {company.legalName !== company.tradeName && (
                          <div style={{ fontSize: "0.8em", color: "var(--text-muted)" }}>{company.legalName}</div>
                        )}
                      </td>
                      <td className="nowrap-cell">{company.cnpj}</td>
                      <td>{company.city ? `${company.city}${company.state ? ` / ${company.state}` : ""}` : "—"}</td>
                      <td>{(() => { const n = Number(company.activeBankAccountCount ?? 0); return n === 0 ? <span style={{ color: "var(--muted)" }}>—</span> : n === 1 ? "1 conta" : `${n} contas`; })()}</td>
                      <td>{company.isActive ? "Ativa" : "Inativa"}</td>
                      {canEdit && (
                        <td className="actions-cell">
                          <button type="button" onClick={() => openEditCompany(company)}>Editar</button>
                          <button type="button" onClick={() => handleToggleStatus(company)}>
                            {company.isActive ? "Inativar" : "Reativar"}
                          </button>
                        </td>
                      )}
                    </tr>

                    {/* Linha expandida: contas bancárias */}
                    {expandedCompanyId === company.id && (
                      <tr>
                        <td colSpan={canEdit ? 8 : 7} style={{ padding: 0, background: "var(--surface-alt, var(--paper))" }}>
                          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                              <strong>Contas bancárias — {company.tradeName}</strong>
                              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <label style={{ flexDirection: "row", alignItems: "center", gap: 6, fontSize: "0.85em" }}>
                                  <input type="checkbox" checked={includeInactiveAccounts}
                                    onChange={(e) => {
                                      setIncludeInactiveAccounts(e.target.checked);
                                      void loadBankAccounts(company.id, e.target.checked);
                                    }} />
                                  Incluir inativas
                                </label>
                                {canEdit && (
                                  <button className="primary-button" type="button" style={{ fontSize: "0.8em", padding: "4px 10px" }} onClick={openNewAccount}>
                                    + Conta
                                  </button>
                                )}
                              </div>
                            </div>

                            {loadingAccounts ? (
                              <div style={{ padding: 12, color: "var(--text-muted)" }}>Carregando...</div>
                            ) : bankAccounts.length === 0 ? (
                              <div style={{ padding: 12, color: "var(--text-muted)" }}>Nenhuma conta bancária cadastrada.</div>
                            ) : (
                              <table style={{ width: "100%", fontSize: "0.9em" }}>
                                <thead>
                                  <tr>
                                    <th>Nome</th>
                                    <th>Tipo</th>
                                    <th>Banco</th>
                                    <th>Agência / Conta</th>
                                    <th>PIX</th>
                                    <th>Status</th>
                                    {canEdit && <th>Ações</th>}
                                  </tr>
                                </thead>
                                <tbody>
                                  {bankAccounts.map((account) => (
                                    <tr key={account.id} style={!account.isActive ? { opacity: 0.55 } : undefined}>
                                      <td><strong>{account.name}</strong></td>
                                      <td>{BANK_ACCOUNT_TYPE_LABELS[account.accountType]}</td>
                                      <td>{account.bankName ?? "—"}</td>
                                      <td className="nowrap-cell">
                                        {account.agency && account.account
                                          ? `${account.agency} / ${account.account}${account.accountDigit ? `-${account.accountDigit}` : ""}`
                                          : "—"
                                        }
                                      </td>
                                      <td style={{ fontSize: "0.9em" }}>{account.pixKey ?? "—"}</td>
                                      <td>{account.isActive ? "Ativa" : "Inativa"}</td>
                                      {canEdit && (
                                        <td className="actions-cell">
                                          <button type="button" onClick={() => openEditAccount(account)}>Editar</button>
                                          <button type="button" onClick={() => handleToggleAccountStatus(account)}>
                                            {account.isActive ? "Inativar" : "Reativar"}
                                          </button>
                                        </td>
                                      )}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {companies.length === 0 && (
                  <tr><td colSpan={canEdit ? 8 : 7} className="empty-state">Nenhuma empresa cadastrada.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
