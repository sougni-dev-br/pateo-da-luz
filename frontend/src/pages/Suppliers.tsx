import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { getPaymentMethods, getSupplierHistory, getSuppliers, PaymentMethod, saveSupplier, setSupplierStatus, Supplier, SupplierHistory } from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { useSession } from "../context/SessionContext";
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
  isActive: true
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

export function Suppliers({ onOpenPurchases }: { onOpenPurchases?: () => void }) {
  const { user } = useSession();
  const canEdit = hasPermission(user, "suppliers", "edit");
  const canDelete = hasPermission(user, "suppliers", "delete");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptySupplier);
  const [loading, setLoading] = useState(true);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [history, setHistory] = useState<SupplierHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { notice, setNotice } = useNotice();

  async function loadSuppliers() {
    setLoading(true);
    setError(null);
    try {
      const [supplierList, methodList] = await Promise.all([getSuppliers(search), getPaymentMethods()]);
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
        defaultFinancialNotes: form.defaultFinancialNotes || null
      });
      setForm(emptySupplier);
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
      isActive: supplier.isActive
    });
  }

  useEffect(() => {
    loadSuppliers();
  }, []);

  return (
    <div className="stack">
      <Notice notice={notice} />

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>Tabela mestre</p>
            <h2>Fornecedor</h2>
          </div>
        </div>

        <div className="form-grid">
          <label>
            Código do fornecedor
            <input readOnly value={form.externalCode || "Gerado automaticamente"} title={form.externalCode || "Gerado automaticamente ao salvar"} />
          </label>
          <label>
            Nome
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label>
            CNPJ/CPF
            <input value={form.document} onChange={(event) => setForm({ ...form, document: event.target.value })} />
          </label>
          <label>
            Telefone
            <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
          </label>
          <label>
            Email
            <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
          </label>
          <label>
            Contato
            <input value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} />
          </label>
          <label>
            Categoria principal
            <input value={form.mainCategory} onChange={(event) => setForm({ ...form, mainCategory: event.target.value })} />
          </label>
          <label>
            Data cadastro
            <input type="date" value={form.registrationDate} onChange={(event) => setForm({ ...form, registrationDate: event.target.value })} />
          </label>
          <label>
            Observações
            <input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
            Ativo
          </label>
        </div>

        <div className="subsection">
          <h3>Condição padrão de pagamento</h3>
          <p className="hint">Ao selecionar este fornecedor numa compra, esses valores são aplicados automaticamente. Se não informado, o sistema usa BOLETO com 2 parcelas em 15 e 30 dias.</p>
          <div className="form-grid">
            <label>
              Forma de pagamento padrão
              <select value={form.defaultPaymentMethodId} onChange={(event) => setForm({ ...form, defaultPaymentMethodId: event.target.value })}>
                <option value="">Padrão do sistema (BOLETO)</option>
                {paymentMethods.map((method) => (
                  <option key={method.id} value={method.id}>{method.name}</option>
                ))}
              </select>
            </label>
            <label>
              Número de parcelas padrão
              <input type="number" min="1" step="1" placeholder="Ex: 2" value={form.defaultInstallmentCount} onChange={(event) => setForm({ ...form, defaultInstallmentCount: event.target.value })} />
            </label>
            <label>
              Dias de vencimento (separados por vírgula)
              <input placeholder="Ex: 15, 30  ou  10, 20, 30" value={form.defaultInstallmentDays} onChange={(event) => setForm({ ...form, defaultInstallmentDays: event.target.value })} />
            </label>
            <label>
              Prazo padrão (dias, campo legado)
              <input type="number" min="0" placeholder="Ex: 30" value={form.defaultPaymentTermDays} onChange={(event) => setForm({ ...form, defaultPaymentTermDays: event.target.value })} />
            </label>
            <label className="full-width">
              Observação financeira padrão
              <input placeholder="Ex: Boleto enviado por email até o dia 5" value={form.defaultFinancialNotes} onChange={(event) => setForm({ ...form, defaultFinancialNotes: event.target.value })} />
            </label>
          </div>
        </div>

        <div className="form-actions">
          <button className="secondary-button" type="button" onClick={() => setForm(emptySupplier)}>Cancelar</button>
          <button className="primary-button" type="button" disabled={!canEdit} onClick={handleSubmit}>
            {form.id ? "Salvar alterações" : "Cadastrar"}
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>Cadastro base</p>
            <h2>Fornecedores</h2>
          </div>
          <button className="icon-button" type="button" onClick={loadSuppliers} aria-label="Atualizar fornecedores">
            <RefreshCw size={18} />
          </button>
        </div>

        <div className="filters-row">
          <label>
            Busca
            <input placeholder="Nome, código ou documento" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <button className="primary-button" type="button" onClick={loadSuppliers}>Filtrar</button>
        </div>

        {error && <div className="alert error">{error}</div>}
        {loading && <div className="empty-state">Carregando fornecedores...</div>}

        {!loading && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Código</th>
                  <th>Nome</th>
                  <th>CNPJ/CPF</th>
                  <th>Contato</th>
                  <th>Categoria</th>
                  <th>Pagamento padrão</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <tr key={supplier.id}>
                    <td>{supplier.isActive ? "Ativo" : "Inativo"}</td>
                    <td>{supplier.externalCode ?? "-"}</td>
                    <td>{supplier.name}</td>
                    <td>{supplier.document ?? "-"}</td>
                    <td>{supplier.contactName ?? supplier.phone ?? supplier.email ?? "-"}</td>
                    <td>{supplier.mainCategory ?? "-"}</td>
                    <td>
                      {supplier.defaultInstallmentDays && Array.isArray(supplier.defaultInstallmentDays) && supplier.defaultInstallmentDays.length > 0
                        ? `${supplier.defaultInstallmentCount ?? supplier.defaultInstallmentDays.length}x — dias ${(supplier.defaultInstallmentDays as number[]).join(", ")}`
                        : supplier.defaultPaymentTermDays
                          ? `${supplier.defaultPaymentTermDays} dias`
                          : "-"}
                    </td>
                    <td className="actions-cell">
                      <button type="button" disabled={!canEdit} onClick={() => editSupplier(supplier)}>Editar</button>
                      <button type="button" disabled={!canDelete} onClick={() => toggleStatus(supplier)}>
                        {supplier.isActive ? "Inativar" : "Reativar"}
                      </button>
                      <button type="button" onClick={() => loadHistory(supplier)}>Histórico</button>
                    </td>
                  </tr>
                ))}
                {suppliers.length === 0 && (
                  <tr><td colSpan={8}>Nenhum fornecedor cadastrado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedSupplier && history && (
        <div className="modal-backdrop">
          <section className="panel modal-panel">
            <div className="section-heading">
              <div>
                <p>Histórico do fornecedor</p>
                <h2>{selectedSupplier.name}</h2>
              </div>
              <button className="secondary-button" type="button" onClick={() => { setSelectedSupplier(null); setHistory(null); }}>Fechar</button>
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
            <div className="subsection table-wrap">
              <table>
                <thead><tr><th>Pedido interno</th><th>Data</th><th>NF</th><th>Total</th><th>Status</th><th>Abrir</th></tr></thead>
                <tbody>{history.recentInvoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>{invoice.purchaseNumber ?? "-"}</td>
                    <td>{formatDate(invoice.purchaseDate)}</td>
                    <td>{invoice.invoiceNumber ?? "-"}</td>
                    <td>{formatCurrency(invoice.totalAmount)}</td>
                    <td>{invoice.status}</td>
                    <td><button type="button" onClick={onOpenPurchases}>Abrir compra</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
