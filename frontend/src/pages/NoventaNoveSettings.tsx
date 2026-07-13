import { useEffect, useState } from "react";
import { Save, RefreshCw, CheckCircle2, AlertTriangle, PlugZap } from "lucide-react";
import {
  getCompanies,
  getNoventaNoveStatus,
  getNoventaNoveStores,
  saveNoventaNoveCredential,
  updateNoventaNoveStore,
  runNoventaNoveMockSync,
  testNoventaNoveConnection,
  type Company,
  type NoventaNoveConnectionTest,
  type NoventaNoveSmartSyncResult,
  type NoventaNoveStatusView,
  type NoventaNoveStoreView
} from "../api/client";
import { Alert, Button, Card, PanelEyebrow, TextField, Select } from "../design-system";
import "./DeliveryFinance.css";

// Configuração da integração 99 Food. Fluxo espelha o do iFood:
//   1. Cadastrar client_id/client_secret (obtidos em developer-food.99app.com
//      após o app do Pateo ser aprovado — hoje "Em análise")
//   2. Editar AppShopID de cada uma das 4 lojas quando o 99 autorizá-las
//   3. Ativar/desativar loja
//   4. Rodar "Sincronizar agora" (mock enquanto a aprovação não sai)
export function NoventaNoveSettings() {
  const [status, setStatus] = useState<NoventaNoveStatusView | null>(null);
  const [stores, setStores] = useState<NoventaNoveStoreView[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [savingCredential, setSavingCredential] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<NoventaNoveConnectionTest | null>(null);
  const [syncResult, setSyncResult] = useState<NoventaNoveSmartSyncResult | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [environment, setEnvironment] = useState<"PRODUCTION" | "SANDBOX">("PRODUCTION");

  useEffect(() => {
    void reload();
  }, []);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const [statusData, storesData, companiesData] = await Promise.all([
        getNoventaNoveStatus(),
        getNoventaNoveStores(),
        getCompanies({ includeInactive: false }).catch(() => [])
      ]);
      setStatus(statusData);
      setStores(storesData);
      setCompanies(companiesData);
      if (statusData.credential.environment) setEnvironment(statusData.credential.environment);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar dados da integração 99 Food.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveCredential(event: React.FormEvent) {
    event.preventDefault();
    setSavingCredential(true);
    setError(null);
    setFeedback(null);
    try {
      await saveNoventaNoveCredential({ clientId: clientId.trim(), clientSecret: clientSecret.trim(), environment });
      setClientId("");
      setClientSecret("");
      setFeedback("Credencial 99 Food salva. clientId e ambiente ficam registrados; o secret é gravado apenas no backend.");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar a credencial.");
    } finally {
      setSavingCredential(false);
    }
  }

  async function handleSaveStore(store: NoventaNoveStoreView, changes: Partial<NoventaNoveStoreView>) {
    setError(null);
    setFeedback(null);
    try {
      const updated = await updateNoventaNoveStore(store.id, {
        externalId: (changes.externalId ?? store.externalId).trim(),
        nickname: (changes.nickname ?? store.nickname).trim(),
        active: changes.active ?? store.active,
        companyId: changes.companyId !== undefined ? changes.companyId : store.companyId
      });
      setStores((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      setFeedback(`Loja "${updated.nickname}" atualizada.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao atualizar loja.");
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    setError(null);
    setFeedback(null);
    try {
      const result = await testNoventaNoveConnection();
      setTestResult(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao testar conexão.";
      setTestResult({
        ok: false,
        message,
        tokenPreview: null,
        expiresInSeconds: null,
        errorDetail: null,
        environment: null
      });
    } finally {
      setTesting(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setError(null);
    setFeedback(null);
    setSyncResult(null);
    try {
      const now = new Date();
      const result = await runNoventaNoveMockSync({ year: now.getFullYear(), month: now.getMonth() + 1 });
      setSyncResult(result);
      if (result.mode === "REAL") {
        setFeedback("Sync REAL executada. Registros persistidos do 99 Food.");
      } else {
        setFeedback("Sync em MODO MOCK: sem credencial válida ou sem lojas com AppShopID real. Aguarde aprovação do app em developer-food.99app.com.");
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao sincronizar.");
    } finally {
      setSyncing(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: "24px" }}>
        <p>Carregando integração 99 Food...</p>
      </div>
    );
  }

  return (
    <div className="df-page" style={{ maxWidth: "1080px" }}>
      {status?.awaitingApproval && (
        <Alert tone="warning" title="99 Food — cadastro em análise">
          O app do Pateo (CNPJ 46878233000192) está aguardando aprovação em
          <b> developer-food.99app.com</b> — até 3 dias úteis. Enquanto isso, os dados vêm de mock
          determinístico. Quando aprovar, cadastre clientId/clientSecret aqui e substitua os
          <b> AppShopID </b> das lojas — o sync real ativa automaticamente.
        </Alert>
      )}

      {error && <Alert tone="error">{error}</Alert>}
      {feedback && <Alert tone="success">{feedback}</Alert>}

      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <PanelEyebrow>Credencial da Integradora</PanelEyebrow>
            <h2 style={{ margin: "4px 0 0 0", fontSize: "20px" }}>99 Food — client_id / client_secret</h2>
            <p style={{ color: "var(--color-text-muted, #6b7280)", margin: "6px 0 0 0", fontSize: "14px" }}>
              Emitidos pelo 99 Food após aprovação do app em developer-food.99app.com.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {status?.credential.configured ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "#16a34a", fontWeight: 600, fontSize: "14px" }}>
                <CheckCircle2 size={18} /> Configurada — {status.credential.clientIdMasked} · {status.credential.environment}
              </span>
            ) : (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "#d97706", fontWeight: 600, fontSize: "14px" }}>
                <AlertTriangle size={18} /> Pendente
              </span>
            )}
          </div>
        </div>

        <form onSubmit={handleSaveCredential} style={{ display: "grid", gap: "12px", marginTop: "16px", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          <TextField
            label="clientId"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Ex: 99f-app-..."
            autoComplete="off"
          />
          <TextField
            label="clientSecret"
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
          />
          <Select
            label="Ambiente"
            value={environment}
            onChange={(e) => setEnvironment(e.target.value as "PRODUCTION" | "SANDBOX")}
            options={[
              { value: "PRODUCTION", label: "Produção" },
              { value: "SANDBOX", label: "Sandbox" }
            ]}
          />
          <div style={{ display: "flex", alignItems: "flex-end", gap: "8px", flexWrap: "wrap" }}>
            <Button type="submit" disabled={savingCredential || !clientId || !clientSecret} leadingIcon={<Save size={16} />}>
              {savingCredential ? "Salvando..." : "Salvar credencial"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={testing || !status?.credential.configured}
              onClick={handleTestConnection}
              leadingIcon={<PlugZap size={16} />}
            >
              {testing ? "Testando..." : "Testar conexão"}
            </Button>
          </div>
        </form>

        {testResult && (
          <div style={{ marginTop: "12px" }}>
            {testResult.ok ? (
              <Alert tone="success" title="Conexão OK">
                {testResult.message} Ambiente: <b>{testResult.environment}</b>. Token válido por {testResult.expiresInSeconds ? Math.floor(testResult.expiresInSeconds / 60) : 0} min.
                <div style={{ fontSize: "12px", marginTop: "6px", opacity: 0.75 }}>
                  Prévia do token: <code>{testResult.tokenPreview}</code>
                </div>
              </Alert>
            ) : (
              <Alert tone="error" title="Falha na conexão">
                {testResult.message}
                {testResult.errorDetail && (
                  <div style={{ fontSize: "12px", marginTop: "6px", opacity: 0.75 }}>
                    Detalhe 99 Food: <code>{testResult.errorDetail}</code>
                  </div>
                )}
              </Alert>
            )}
          </div>
        )}
      </Card>

      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <PanelEyebrow>Lojas cadastradas</PanelEyebrow>
            <h2 style={{ margin: "4px 0 0 0", fontSize: "20px" }}>4 lojas 99 Food do Pateo</h2>
            <p style={{ color: "var(--color-text-muted, #6b7280)", margin: "6px 0 0 0", fontSize: "14px" }}>
              Substitua o AppShopID "PENDENTE-99-*" pelo real quando o 99 liberar cada loja.
            </p>
          </div>
          <Button variant="secondary" onClick={handleSync} disabled={syncing} leadingIcon={<RefreshCw size={16} />}>
            {syncing ? "Sincronizando..." : "Sincronizar agora"}
          </Button>
        </div>

        <div style={{ display: "grid", gap: "12px", marginTop: "16px" }}>
          {stores.map((store) => (
            <StoreRow key={store.id} store={store} companies={companies} onSave={(changes) => handleSaveStore(store, changes)} />
          ))}
        </div>

        {syncResult && (
          <div style={{ marginTop: "16px" }}>
            <Alert tone={syncResult.mode === "REAL" ? "success" : "info"} title={`Resultado da sincronização — modo ${syncResult.mode}`}>
              {syncResult.mode === "REAL"
                ? "Sync real executada — veja registros persistidos no relatório de sync log."
                : "Modo mock ativado — nenhuma chamada real ao 99 Food."}
            </Alert>
          </div>
        )}
      </Card>

      <Card>
        <PanelEyebrow>Última sincronização</PanelEyebrow>
        {status?.lastSync ? (
          <div style={{ marginTop: "8px", fontSize: "14px" }}>
            <div><b>Status:</b> {status.lastSync.status}</div>
            <div><b>Início:</b> {new Date(status.lastSync.startedAt).toLocaleString("pt-BR")}</div>
            {status.lastSync.finishedAt && <div><b>Fim:</b> {new Date(status.lastSync.finishedAt).toLocaleString("pt-BR")}</div>}
            <div><b>Itens processados:</b> {status.lastSync.itemsProcessed}</div>
            {status.lastSync.errorMessage && <div style={{ color: "#dc2626" }}><b>Mensagem:</b> {status.lastSync.errorMessage}</div>}
          </div>
        ) : (
          <p style={{ margin: "8px 0 0 0", fontSize: "14px", color: "var(--color-text-muted, #6b7280)" }}>
            Nenhuma sincronização registrada ainda.
          </p>
        )}
      </Card>
    </div>
  );
}

type StoreRowProps = {
  store: NoventaNoveStoreView;
  companies: Company[];
  onSave: (changes: Partial<NoventaNoveStoreView>) => void;
};

function StoreRow({ store, companies, onSave }: StoreRowProps) {
  const [externalId, setExternalId] = useState(store.externalId);
  const [nickname, setNickname] = useState(store.nickname);
  const [active, setActive] = useState(store.active);
  const [companyId, setCompanyId] = useState<string>(store.companyId ?? "");
  const dirty = externalId !== store.externalId
    || nickname !== store.nickname
    || active !== store.active
    || (companyId || null) !== store.companyId;

  useEffect(() => {
    setExternalId(store.externalId);
    setNickname(store.nickname);
    setActive(store.active);
    setCompanyId(store.companyId ?? "");
  }, [store.externalId, store.nickname, store.active, store.companyId]);

  const companyOptions = [
    { value: "", label: "— sem empresa vinculada —" },
    ...companies.map((c) => ({ value: c.id, label: `${c.tradeName} (${c.cnpj})` }))
  ];

  const rowClasses = [
    "ifood-store-row",
    !store.companyId ? "is-missing-company" : "",
    !active ? "is-inactive" : ""
  ].filter(Boolean).join(" ");

  return (
    <div className={rowClasses}>
      <TextField label="Apelido interno" value={nickname} onChange={(e) => setNickname(e.target.value)} />
      <TextField label="AppShopID (99 Food)" value={externalId} onChange={(e) => setExternalId(e.target.value)} />
      <Select
        label="Empresa (CNPJ) do ERP"
        value={companyId}
        onChange={(e) => setCompanyId(e.target.value)}
        options={companyOptions}
        hint={!store.companyId && active ? "Sem empresa, dados não entram no DRE" : undefined}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <label className="ifood-store-row-toggle">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Ativa
        </label>
        <div className="ifood-store-row-save">
          <Button
            variant={dirty ? "primary" : "secondary"}
            disabled={!dirty}
            onClick={() => onSave({ externalId, nickname, active, companyId: companyId || null })}
            leadingIcon={<Save size={16} />}
          >
            Salvar
          </Button>
        </div>
      </div>
    </div>
  );
}
