import { useEffect, useState } from "react";
import { Save, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  getCompanies,
  getIfoodStatus,
  getIfoodStores,
  saveIfoodCredential,
  updateIfoodStore,
  runIfoodMockSync,
  testIfoodConnection,
  type Company,
  type IfoodConnectionTest,
  type IfoodSmartSyncResult,
  type IfoodStatusView,
  type IfoodStoreView
} from "../api/client";
import { Alert, Button, Card, PanelEyebrow, TextField, Select } from "../design-system";
import { PlugZap } from "lucide-react";
import "./DeliveryFinance.css";

// Configuração da integração iFood.
// Fluxo:
//   1. Cadastrar client_id/client_secret da Integradora (uma vez só)
//   2. Editar merchantId de cada uma das 4 lojas
//   3. Ativar/desativar loja
//   4. Rodar "Sincronizar agora" (mock enquanto credencial real não chega)
export function IfoodSettings() {
  const [status, setStatus] = useState<IfoodStatusView | null>(null);
  const [stores, setStores] = useState<IfoodStoreView[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [savingCredential, setSavingCredential] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<IfoodConnectionTest | null>(null);
  const [syncResult, setSyncResult] = useState<IfoodSmartSyncResult | null>(null);
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
        getIfoodStatus(),
        getIfoodStores(),
        getCompanies({ includeInactive: false }).catch(() => [])
      ]);
      setStatus(statusData);
      setStores(storesData);
      setCompanies(companiesData);
      if (statusData.credential.environment) setEnvironment(statusData.credential.environment);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar dados da integração iFood.");
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
      await saveIfoodCredential({ clientId: clientId.trim(), clientSecret: clientSecret.trim(), environment });
      setClientId("");
      setClientSecret("");
      setFeedback("Credencial iFood salva. Ambiente e clientId ficam registrados; o secret é gravado apenas no backend.");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar a credencial.");
    } finally {
      setSavingCredential(false);
    }
  }

  async function handleSaveStore(store: IfoodStoreView, changes: Partial<IfoodStoreView>) {
    setError(null);
    setFeedback(null);
    try {
      const updated = await updateIfoodStore(store.id, {
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
      const result = await testIfoodConnection();
      setTestResult(result);
    } catch (err) {
      // ApiError com 400 chega como throw — pega o corpo se possível
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
      const result = await runIfoodMockSync({ year: now.getFullYear(), month: now.getMonth() + 1 });
      setSyncResult(result);
      if (result.mode === "REAL") {
        setFeedback(`Sync REAL executada. ${result.real?.totalPersisted ?? 0} registros persistidos do iFood.`);
      } else {
        setFeedback("Sync em MODO MOCK: sem credencial ou sem lojas com merchantId real. Configure credencial e substitua PENDENTE-* pra usar dados reais.");
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
        <p>Carregando integração iFood...</p>
      </div>
    );
  }

  return (
    <div className="df-page" style={{ maxWidth: "1080px" }}>
      {status?.mockMode && (
        <Alert tone="info" title="Modo mock ativo">
          Enquanto o cadastro no <b>developer.ifood.com.br</b> não sai, todos os números vêm de dados fictícios
          determinísticos por loja + mês. UX validada agora; troca para dados reais é transparente.
        </Alert>
      )}

      {error && <Alert tone="error">{error}</Alert>}
      {feedback && <Alert tone="success">{feedback}</Alert>}

      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <PanelEyebrow>Credencial da Integradora</PanelEyebrow>
            <h2 style={{ margin: "4px 0 0 0", fontSize: "20px" }}>iFood — client_id / client_secret</h2>
            <p style={{ color: "var(--color-text-muted, #6b7280)", margin: "6px 0 0 0", fontSize: "14px" }}>
              Emitidos pelo iFood após aprovação da Software House.
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
            placeholder="Ex: 8f2c1d5e-..."
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
                    Detalhe iFood: <code>{testResult.errorDetail}</code>
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
            <h2 style={{ margin: "4px 0 0 0", fontSize: "20px" }}>4 lojas iFood do Pateo</h2>
            <p style={{ color: "var(--color-text-muted, #6b7280)", margin: "6px 0 0 0", fontSize: "14px" }}>
              Substitua o merchantId "PENDENTE-*" pelo real quando o iFood liberar cada loja na sua Integradora.
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
              {syncResult.real ? (
                <div style={{ display: "grid", gap: "8px", marginTop: "6px" }}>
                  {syncResult.real.perStore.map((row) => (
                    <div key={row.storeId} style={{
                      display: "grid",
                      gridTemplateColumns: "auto 1fr auto",
                      gap: "10px",
                      alignItems: "center",
                      fontSize: "13px",
                      padding: "8px",
                      borderRadius: "6px",
                      background: row.status === "SUCCESS" ? "rgba(22,163,74,0.08)" : row.status === "ERROR" ? "rgba(220,38,38,0.08)" : "rgba(107,114,128,0.08)"
                    }}>
                      <span style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        padding: "2px 6px",
                        borderRadius: "4px",
                        background: row.status === "SUCCESS" ? "#16a34a" : row.status === "ERROR" ? "#dc2626" : "#6b7280",
                        color: "white"
                      }}>{row.status}</span>
                      <div>
                        <b>{row.storeLabel}</b> · <code style={{ fontSize: "11px" }}>{row.externalId}</code>
                        <div style={{ opacity: 0.75, fontSize: "12px", marginTop: "2px" }}>{row.message}</div>
                      </div>
                      {row.status === "SUCCESS" && (
                        <div style={{ fontSize: "11px", opacity: 0.75, textAlign: "right" }}>
                          {row.itemsPersisted.sales} vendas<br />
                          {row.itemsPersisted.settlements} repasses<br />
                          {row.itemsPersisted.fees} taxas
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div>Modo mock ativado — nenhuma chamada real ao iFood.</div>
              )}
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
            {status.lastSync.errorMessage && <div style={{ color: "#dc2626" }}><b>Erro:</b> {status.lastSync.errorMessage}</div>}
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
  store: IfoodStoreView;
  companies: Company[];
  onSave: (changes: Partial<IfoodStoreView>) => void;
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
      <TextField label="merchantId (iFood)" value={externalId} onChange={(e) => setExternalId(e.target.value)} />
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
