import { Pencil, PowerOff, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import {
  getPaymentMethods,
  PaymentMethod,
  savePaymentMethod,
  setPaymentMethodStatus
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
  TextField
} from "../design-system";
import { hasPermission } from "../lib/permissions";

const emptyMethod = {
  id: "",
  name: "",
  type: "OTHER",
  group: "",
  notes: "",
  isActive: true
};

const methodTypeOptions = [
  { value: "CASH", label: "CASH" },
  { value: "PIX", label: "PIX" },
  { value: "CREDIT_CARD", label: "CREDIT_CARD" },
  { value: "DEBIT_CARD", label: "DEBIT_CARD" },
  { value: "BANK_SLIP", label: "BANK_SLIP" },
  { value: "TRANSFER", label: "TRANSFER" },
  { value: "OTHER", label: "OTHER" }
];

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
      setError(loadError instanceof Error ? loadError.message : "Erro ao carregar métodos.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    if (!form.name.trim()) return;
    if (looksLikeInstallmentVariant(form.name)) {
      setError("Cadastre apenas o método base. O número de parcelas deve ser informado no lançamento da compra.");
      setNotice({ tone: "warning", message: "Use apenas o método base, como BOLETO ou CARTÃO CRÉDITO." });
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
      setError(saveError instanceof Error ? saveError.message : "Erro ao salvar método.");
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
        <FormSection
          eyebrow="Tabela mestre"
          title="Método de pagamento"
          description="Cadastre apenas métodos base, como DINHEIRO, PIX, BOLETO, FATURADO, CARTÃO CRÉDITO e CARTÃO DÉBITO. O número de parcelas agora é informado no lançamento da compra."
        >
          <FormGrid cols={3}>
            <FormField label="Nome" required>
              <TextField value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </FormField>
            <FormField label="Tipo">
              <Select
                value={form.type}
                onChange={(event) => setForm({ ...form, type: event.target.value })}
                options={methodTypeOptions}
              />
            </FormField>
            <FormField label="Grupo">
              <TextField value={form.group} onChange={(event) => setForm({ ...form, group: event.target.value })} />
            </FormField>
            <div className="ds-form-grid-span-all">
              <FormField label="Observações">
                <TextField value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
              </FormField>
            </div>
            <FormField label="Ativo" inline>
              <Switch checked={form.isActive} onChange={(checked) => setForm({ ...form, isActive: checked })} />
            </FormField>
          </FormGrid>
          <div className="form-actions">
            <Button disabled={!canEdit} onClick={handleSubmit}>
              {form.id ? "Salvar alterações" : "Cadastrar"}
            </Button>
          </div>
        </FormSection>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <PanelEyebrow>Cadastro base</PanelEyebrow>
            <h2>Métodos de pagamento</h2>
          </div>
          <IconButton icon={<RefreshCw size={16} />} label="Atualizar métodos" onClick={loadMethods} />
        </div>

        <div className="filters-row">
          <FormField label="Busca">
            <TextField value={search} onChange={(event) => setSearch(event.target.value)} />
          </FormField>
          <Button variant="secondary" onClick={loadMethods}>Filtrar</Button>
        </div>

        {error && <Alert tone="error">{error}</Alert>}
        {loading && <EmptyState title="Carregando métodos..." />}

        {!loading && methods.length === 0 && (
          <EmptyState title="Nenhum método cadastrado." />
        )}

        {!loading && methods.length > 0 && (
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.Th>Status</Table.Th>
                <Table.Th minWidth={160}>Nome</Table.Th>
                <Table.Th>Normalizado</Table.Th>
                <Table.Th>Tipo</Table.Th>
                <Table.Th>Grupo</Table.Th>
                <Table.Th>Observações</Table.Th>
                <Table.Th actions>Ações</Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {methods.map((method) => (
                <Table.Row key={method.id}>
                  <Table.Td>
                    <StatusBadge tone={method.isActive ? "success" : "danger"}>
                      {method.isActive ? "Ativo" : "Inativo"}
                    </StatusBadge>
                  </Table.Td>
                  <Table.Td truncate title={method.name}>{method.name}</Table.Td>
                  <Table.Td truncate style={{ maxWidth: 160 }}>{method.normalizedName}</Table.Td>
                  <Table.Td>{method.type}</Table.Td>
                  <Table.Td>{method.group ?? "-"}</Table.Td>
                  <Table.Td truncate style={{ maxWidth: 200 }} title={method.notes ?? undefined}>{method.notes ?? "-"}</Table.Td>
                  <Table.Td actions>
                    <IconButton
                      icon={<Pencil size={16} />}
                      label="Editar"
                      disabled={!canEdit}
                      onClick={() => setForm({
                        id: method.id,
                        name: method.name,
                        type: method.type,
                        group: method.group ?? "",
                        notes: method.notes ?? "",
                        isActive: method.isActive
                      })}
                    />
                    <RowMenu
                      label={`Mais ações — ${method.name}`}
                      items={[
                        {
                          label: method.isActive ? "Inativar" : "Reativar",
                          icon: <PowerOff size={15} />,
                          tone: method.isActive ? "danger" : "default",
                          disabled: !canDelete,
                          onClick: () => toggleStatus(method)
                        }
                      ]}
                    />
                  </Table.Td>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </section>
    </div>
  );
}
