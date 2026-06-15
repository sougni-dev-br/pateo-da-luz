import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import {
  getPaymentMethods,
  PaymentMethod,
  savePaymentMethod,
  setPaymentMethodStatus
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { useSession } from "../context/SessionContext";
import { hasPermission } from "../lib/permissions";

const emptyMethod = {
  id: "",
  name: "",
  type: "OTHER",
  group: "",
  notes: "",
  isActive: true
};

const methodTypes = ["CASH", "PIX", "CREDIT_CARD", "DEBIT_CARD", "BANK_SLIP", "TRANSFER", "OTHER"];

function looksLikeInstallmentVariant(name: string) {
  return /(?:\s+|\/|-)?\d{1,2}\s*x$/i.test(String(name).trim());
}

export function PaymentMethods() {
  const { user } = useSession();
  const canEdit = hasPermission(user, "payment-methods", "edit");
  const canDelete = hasPermission(user, "payment-methods", "delete");
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyMethod);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { notice, setNotice } = useNotice();

  async function loadMethods() {
    setLoading(true);
    setError(null);

    try {
      setMethods(await getPaymentMethods(search));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Erro ao carregar metodos.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    if (!form.name.trim()) return;
    if (looksLikeInstallmentVariant(form.name)) {
      setError("Cadastre apenas o metodo base. O numero de parcelas deve ser informado no lancamento da compra.");
      setNotice({ tone: "warning", message: "Use apenas o metodo base, como BOLETO ou CARTAO CREDITO." });
      return;
    }
    const isUpdate = Boolean(form.id);
    setError(null);

    try {
      await savePaymentMethod(form);
      setForm(emptyMethod);
      await loadMethods();
      setNotice({
        tone: "success",
        message: isUpdate ? "Cadastro atualizado com sucesso." : "Cadastro criado com sucesso."
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Erro ao salvar metodo.");
      setNotice({ tone: "error", message: "Erro ao salvar." });
    }
  }

  async function toggleStatus(method: PaymentMethod) {
    setError(null);

    try {
      await setPaymentMethodStatus(method.id, !method.isActive);
      await loadMethods();
      setNotice({
        tone: "success",
        message: method.isActive ? "Cadastro inativado com sucesso." : "Cadastro reativado com sucesso."
      });
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Erro ao alterar status.");
      setNotice({ tone: "error", message: "Erro ao salvar." });
    }
  }

  useEffect(() => {
    loadMethods();
  }, []);

  return (
    <div className="stack">
      <Notice notice={notice} />

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>Tabela mestre</p>
            <h2>Metodo de pagamento</h2>
          </div>
        </div>

        <div className="alert info">
          Cadastre apenas metodos base, como DINHEIRO, PIX, BOLETO, FATURADO, CARTAO CREDITO e CARTAO DEBITO. O numero de parcelas agora e informado no lancamento da compra.
        </div>

        <div className="form-grid">
          <label>
            Nome
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label>
            Tipo
            <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
              {methodTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label>
            Grupo
            <input value={form.group} onChange={(event) => setForm({ ...form, group: event.target.value })} />
          </label>
          <label>
            Observacoes
            <input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
            />
            Ativo
          </label>
          <button className="primary-button" type="button" disabled={!canEdit} onClick={handleSubmit}>
            {form.id ? "Salvar alteracoes" : "Cadastrar"}
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>Cadastro base</p>
            <h2>Metodos de pagamento</h2>
          </div>
          <button className="icon-button" type="button" onClick={loadMethods} aria-label="Atualizar metodos">
            <RefreshCw size={18} />
          </button>
        </div>

        <div className="filters-row">
          <label>
            Busca
            <input value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <button className="primary-button" type="button" onClick={loadMethods}>
            Filtrar
          </button>
        </div>

        {error && <div className="alert error">{error}</div>}
        {loading && <div className="empty-state">Carregando metodos...</div>}

        {!loading && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Nome</th>
                  <th>Normalizado</th>
                  <th>Tipo</th>
                  <th>Grupo</th>
                  <th>Observacoes</th>
                  <th>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {methods.map((method) => (
                  <tr key={method.id}>
                    <td>{method.isActive ? "Ativo" : "Inativo"}</td>
                    <td>{method.name}</td>
                    <td>{method.normalizedName}</td>
                    <td>{method.type}</td>
                    <td>{method.group ?? "-"}</td>
                    <td>{method.notes ?? "-"}</td>
                    <td className="actions-cell">
                      <button type="button" disabled={!canEdit} onClick={() => setForm({
                        id: method.id,
                        name: method.name,
                        type: method.type,
                        group: method.group ?? "",
                        notes: method.notes ?? "",
                        isActive: method.isActive
                      })}>
                        Editar
                      </button>
                      <button type="button" disabled={!canDelete} onClick={() => toggleStatus(method)}>
                        {method.isActive ? "Inativar" : "Reativar"}
                      </button>
                    </td>
                  </tr>
                ))}
                {methods.length === 0 && (
                  <tr>
                    <td colSpan={7}>Nenhum metodo cadastrado.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
