import {
  Activity,
  CheckCircle2,
  Clock,
  LinkIcon,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  Power,
  PowerOff,
  QrCode,
  RefreshCw,
  Send,
  Smartphone,
  Trash2,
  Users,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createWhatsAppRecipient,
  deleteWhatsAppRecipient,
  getWhatsAppQr,
  getWhatsAppRecipients,
  getWhatsAppStatus,
  logoutWhatsApp,
  testWhatsAppSend,
  updateWhatsAppRecipient,
  type WhatsAppRecipient,
  type WhatsAppStatus
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { useSession } from "../context/SessionContext";
import {
  Alert,
  Button,
  EmptyState,
  FormField,
  IconButton,
  RowMenu,
  StatusBadge,
  Switch,
  Table,
  TextField,
  type StatusTone
} from "../design-system";
import { hasPermission } from "../lib/permissions";

// Página /configuracoes/notificacoes.
// Convenções visuais desta tela:
//  - Verde WhatsApp (--wa-green) reservado para o hero de status quando "open"
//    e para o ícone da tela. Nunca aplicado em botões primários (que seguem o
//    padrão preto do design system) para não competir por atenção.
//  - Live dot pulsante é o único indicador de "conexão ativa em tempo real";
//    quando a sessão cai, o dot some (não fica pulsando em vermelho).
//  - Mostra "Ativo há Xs" em vez de timestamp absoluto: o número absoluto é
//    ruído para o operador; o que importa é "há quanto tempo".
//  - "Próximo envio" é derivado (sem cron real ainda), assumindo 23:00 SP.
//    Se o cron for reconfigurado, tem que alterar aqui também.

type FormState = {
  id: string;
  name: string;
  phone: string;
  notes: string;
  isActive: boolean;
};

const emptyForm: FormState = {
  id: "",
  name: "",
  phone: "",
  notes: "",
  isActive: true
};

// Horário fixo do envio diário. Se mudar o cron externo, atualizar aqui.
const CRON_HOUR_SP = 23;

function prettyPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("55")) {
    const ddd = digits.slice(2, 4);
    const first = digits.slice(4, 9);
    const last = digits.slice(9);
    return `+55 (${ddd}) ${first}-${last}`;
  }
  if (digits.length === 12 && digits.startsWith("55")) {
    const ddd = digits.slice(2, 4);
    const first = digits.slice(4, 8);
    const last = digits.slice(8);
    return `+55 (${ddd}) ${first}-${last}`;
  }
  return `+${digits}`;
}

function statusView(status: WhatsAppStatus["status"]): {
  label: string;
  tone: StatusTone;
  helper: string;
  live: boolean;
} {
  switch (status) {
    case "open":
      return { label: "Conectado", tone: "success", helper: "Canal WhatsApp ativo.", live: true };
    case "connecting":
      return {
        label: "Conectando",
        tone: "info",
        helper: "Estabelecendo conexão com o WhatsApp…",
        live: false
      };
    case "waiting_qr":
      return {
        label: "Aguardando QR",
        tone: "warning",
        helper: "Nenhum aparelho pareado. Peça o QR ao admin para escanear.",
        live: false
      };
    case "starting":
      return { label: "Iniciando", tone: "info", helper: "Baileys está inicializando…", live: false };
    case "logged_out":
      return {
        label: "Desconectado",
        tone: "danger",
        helper: "O WhatsApp encerrou a sessão. Escaneie um QR novo para reconectar.",
        live: false
      };
    case "closed":
    default:
      return {
        label: "Desconectado",
        tone: "danger",
        helper: "Sem conexão ativa. Tentando reconectar…",
        live: false
      };
  }
}

// "há 3 min", "há 2 h" — descarta segundos exatos, humaniza.
function timeAgo(iso: string | null, now: number): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffSec = Math.max(0, Math.round((now - then) / 1000));
  if (diffSec < 60) return `há ${diffSec}s`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `há ${diffHr} h`;
  const diffDay = Math.round(diffHr / 24);
  return `há ${diffDay} dias`;
}

// Descreve o próximo envio programado do resumo diário.
// "Hoje às 23:00" ou "Amanhã às 23:00" dependendo da hora atual SP.
function nextRunLabel(now: Date): string {
  // Extrai hora atual em SP sem depender de bibliotecas.
  const spNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const isAfterCron = spNow.getHours() >= CRON_HOUR_SP;
  return `${isAfterCron ? "Amanhã" : "Hoje"} às ${String(CRON_HOUR_SP).padStart(2, "0")}:00`;
}

export function Notifications() {
  const { user } = useSession();
  const canEdit = hasPermission(user, "notifications", "edit");
  const canCreate = hasPermission(user, "notifications", "create");
  const canDelete = hasPermission(user, "notifications", "delete");

  const [recipients, setRecipients] = useState<WhatsAppRecipient[]>([]);
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [broadcasting, setBroadcasting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrFetching, setQrFetching] = useState(false);
  const [logoutRequested, setLogoutRequested] = useState(false);
  const qrIntervalRef = useRef<number | null>(null);
  const { notice, setNotice } = useNotice();

  const isEditing = Boolean(form.id);
  const activeCount = useMemo(() => recipients.filter((r) => r.isActive).length, [recipients]);
  const view = status ? statusView(status.status) : null;

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [list, st] = await Promise.all([getWhatsAppRecipients(), getWhatsAppStatus()]);
      setRecipients(list);
      setStatus(st);
    } catch (loadErr) {
      setError(loadErr instanceof Error ? loadErr.message : "Erro ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshStatus() {
    try {
      setStatus(await getWhatsAppStatus());
    } catch {
      /* silencioso — reload geral já reporta */
    }
  }

  // Puxa o QR atual do Baileys. Se sessão já pareada, backend retorna null.
  async function fetchQr() {
    setQrFetching(true);
    try {
      const result = await getWhatsAppQr();
      setQrDataUrl(result?.dataUrl ?? null);
      if (result?.status) setStatus(result.status);
    } catch {
      /* silencioso — QR é opcional */
    } finally {
      setQrFetching(false);
    }
  }

  async function requestLogout() {
    const ok = window.confirm(
      "Desconectar o WhatsApp do restaurante e gerar um novo QR?\n\n" +
        "IMPORTANTE:\n" +
        "• Se quiser TROCAR de aparelho, primeiro remova o Pateo da lista " +
        "de Aparelhos conectados no WhatsApp do celular atual — senão o " +
        "próprio celular reautoriza a conexão automaticamente.\n" +
        "• Enquanto ninguém escanear o QR novo, o resumo diário NÃO é enviado."
    );
    if (!ok) return;
    setLogoutRequested(true);
    try {
      await logoutWhatsApp();
      setNotice({ tone: "success", message: "Sessão encerrada. Aguardando novo QR…" });
      setQrDataUrl(null);
      // O backend leva 2-4s pra estabilizar o novo websocket e emitir QR.
      // Damos um pequeno delay antes de tentar puxar.
      setTimeout(() => {
        refreshStatus();
        fetchQr();
      }, 3000);
    } catch (logoutErr) {
      const message = logoutErr instanceof Error ? logoutErr.message : "Falha ao desconectar.";
      setNotice({ tone: "error", message });
    } finally {
      setLogoutRequested(false);
    }
  }

  async function handleSubmit() {
    if (!form.name.trim() || !form.phone.trim()) {
      setNotice({ tone: "warning", message: "Nome e telefone são obrigatórios." });
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isEditing) {
        await updateWhatsAppRecipient(form.id, {
          name: form.name.trim(),
          phone: form.phone.trim(),
          notes: form.notes.trim() || null,
          isActive: form.isActive
        });
        setNotice({ tone: "success", message: `Destinatário "${form.name}" atualizado.` });
      } else {
        await createWhatsAppRecipient({
          name: form.name.trim(),
          phone: form.phone.trim(),
          notes: form.notes.trim() || null,
          isActive: form.isActive
        });
        setNotice({ tone: "success", message: `Destinatário "${form.name}" adicionado.` });
      }
      setForm(emptyForm);
      await loadAll();
    } catch (saveErr) {
      const message = saveErr instanceof Error ? saveErr.message : "Erro ao salvar destinatário.";
      setError(message);
      setNotice({ tone: "error", message });
    } finally {
      setSaving(false);
    }
  }

  function startEdit(recipient: WhatsAppRecipient) {
    setForm({
      id: recipient.id,
      name: recipient.name,
      phone: recipient.phone,
      notes: recipient.notes ?? "",
      isActive: recipient.isActive
    });
    focusForm();
  }

  // Rola até o form + foca o primeiro campo — usado pelo botão "Editar"
  // e pelo CTA do empty state ("Adicionar primeiro destinatário").
  function focusForm() {
    document.querySelector(".wa-form-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Delay curto para o scroll acontecer antes do foco.
    setTimeout(() => {
      const first = document.querySelector<HTMLInputElement>(".wa-form-grid input");
      first?.focus();
    }, 220);
  }

  async function toggleActive(recipient: WhatsAppRecipient) {
    try {
      await updateWhatsAppRecipient(recipient.id, { isActive: !recipient.isActive });
      setNotice({
        tone: "success",
        message: recipient.isActive
          ? `"${recipient.name}" pausado.`
          : `"${recipient.name}" reativado.`
      });
      await loadAll();
    } catch (statusErr) {
      const message = statusErr instanceof Error ? statusErr.message : "Erro ao atualizar status.";
      setNotice({ tone: "error", message });
    }
  }

  async function removeRecipient(recipient: WhatsAppRecipient) {
    const ok = window.confirm(
      `Remover "${recipient.name}" da lista de destinatários? Esta ação é permanente.`
    );
    if (!ok) return;
    try {
      await deleteWhatsAppRecipient(recipient.id);
      setNotice({ tone: "success", message: `"${recipient.name}" removido.` });
      if (form.id === recipient.id) setForm(emptyForm);
      await loadAll();
    } catch (deleteErr) {
      const message = deleteErr instanceof Error ? deleteErr.message : "Erro ao remover.";
      setNotice({ tone: "error", message });
    }
  }

  async function sendTest(recipient: WhatsAppRecipient) {
    setTestingId(recipient.id);
    try {
      const result = await testWhatsAppSend(recipient.id);
      if (result.ok) {
        setNotice({ tone: "success", message: `Teste enviado para ${recipient.name}.` });
      } else {
        setNotice({
          tone: "error",
          message: `Falha ao enviar teste para ${recipient.name}: ${result.error}`
        });
      }
    } catch (testErr) {
      const message = testErr instanceof Error ? testErr.message : "Erro ao enviar teste.";
      setNotice({ tone: "error", message });
    } finally {
      setTestingId(null);
    }
  }

  async function sendTestToAll() {
    const targets = recipients.filter((r) => r.isActive);
    if (targets.length === 0) {
      setNotice({ tone: "warning", message: "Nenhum destinatário ativo." });
      return;
    }
    setBroadcasting(true);
    let ok = 0;
    let fail = 0;
    try {
      // Sequencial — Baileys anti-spam e feedback previsível.
      for (const t of targets) {
        try {
          const r = await testWhatsAppSend(t.id);
          if (r.ok) ok++; else fail++;
        } catch {
          fail++;
        }
      }
      if (fail === 0) {
        setNotice({ tone: "success", message: `Teste enviado para ${ok} destinatário(s).` });
      } else if (ok === 0) {
        setNotice({ tone: "error", message: `Falha ao enviar para todos (${fail}).` });
      } else {
        setNotice({
          tone: "warning",
          message: `Parcial: ${ok} enviado(s), ${fail} falha(s).`
        });
      }
    } finally {
      setBroadcasting(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  // Auto-refresh do status a cada 15s; "há X min" atualiza a cada 30s (barato).
  useEffect(() => {
    const statusInt = setInterval(refreshStatus, 15000);
    const clockInt = setInterval(() => setNowMs(Date.now()), 30000);
    return () => {
      clearInterval(statusInt);
      clearInterval(clockInt);
    };
  }, []);

  // Enquanto o Baileys estiver esperando QR (ou deslogado), poll de 5s pega
  // o QR mais recente. Baileys rotaciona a cada ~20s, então esse intervalo
  // garante que a UI nunca fica com um QR expirado.
  useEffect(() => {
    const needsQr = status?.status === "waiting_qr" || status?.status === "logged_out";
    if (!needsQr) {
      setQrDataUrl(null);
      if (qrIntervalRef.current !== null) {
        window.clearInterval(qrIntervalRef.current);
        qrIntervalRef.current = null;
      }
      return;
    }
    // Fetch imediato + polling.
    fetchQr();
    qrIntervalRef.current = window.setInterval(fetchQr, 5000);
    return () => {
      if (qrIntervalRef.current !== null) {
        window.clearInterval(qrIntervalRef.current);
        qrIntervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.status]);

  const nextRun = useMemo(() => nextRunLabel(new Date(nowMs)), [nowMs]);

  return (
    <div className="stack">
      <Notice notice={notice} />

      {/* ─── Hero: status da conexão ─────────────────────────────────────── */}
      <section className={`panel wa-hero-panel wa-hero-${status?.status ?? "closed"}`}>
        <div className="wa-hero-left">
          <div className={`wa-hero-icon ${view?.live ? "wa-hero-icon-live" : ""}`}>
            <MessageCircle size={28} strokeWidth={2.25} />
            {view?.live && <span className="wa-hero-pulse" aria-hidden />}
          </div>
        </div>

        <div className="wa-hero-body">
          <div className="wa-hero-headline">
            <span className="wa-hero-badge-wrap">
              {view?.live && <span className="wa-live-dot" aria-hidden />}
              {view ? (
                <StatusBadge tone={view.tone}>{view.label}</StatusBadge>
              ) : (
                <StatusBadge tone="neutral">Carregando…</StatusBadge>
              )}
            </span>
            <span className="wa-hero-helper">{view?.helper ?? "—"}</span>
          </div>

          <div className="wa-hero-meta">
            <span className="wa-hero-meta-item">
              <Activity size={13} className="wa-hero-meta-icon" />
              Sessão <strong>{status?.sessionName ?? "—"}</strong>
            </span>
            <span className="wa-hero-meta-sep" aria-hidden>·</span>
            <span className="wa-hero-meta-item">
              <Clock size={13} className="wa-hero-meta-icon" />
              Ativo <strong>{timeAgo(status?.startedAt ?? null, nowMs)}</strong>
            </span>
            <span className="wa-hero-meta-sep" aria-hidden>·</span>
            <span className="wa-hero-meta-item">
              <Users size={13} className="wa-hero-meta-icon" />
              <strong>{activeCount}</strong> de {recipients.length} destinatários
            </span>
          </div>

          <div className="wa-hero-next">
            <span className="wa-hero-next-label">Próximo envio</span>
            <strong>{nextRun}</strong>
          </div>
        </div>

        <div className="wa-hero-actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={sendTestToAll}
            disabled={broadcasting || status?.status !== "open" || activeCount === 0}
            aria-label="Testar todos: envia uma mensagem de teste para todos os destinatários ativos"
          >
            <Send size={14} aria-hidden />{" "}
            {broadcasting ? "Enviando…" : "Testar todos"}
          </Button>
          {status?.status === "open" && (
            <Button
              variant="secondary"
              size="sm"
              onClick={requestLogout}
              disabled={logoutRequested}
              aria-label="Gerar novo QR: encerra a sessão atual e permite parear outro dispositivo"
              className="wa-danger-action"
            >
              <Smartphone size={14} aria-hidden />{" "}
              {logoutRequested ? "Encerrando…" : "Novo QR"}
            </Button>
          )}
          <IconButton
            icon={<RefreshCw size={16} />}
            label="Atualizar status"
            onClick={refreshStatus}
          />
        </div>

        {status?.lastError && (
          <div className="wa-hero-error">
            <Alert tone="warning">
              <strong>Último erro:</strong> {status.lastError}
            </Alert>
          </div>
        )}
      </section>

      {/* ─── Painel QR (aparece só quando precisa parear) ─────────────────── */}
      {(status?.status === "waiting_qr" || status?.status === "logged_out") && (
        <section className="panel wa-qr-panel">
          <div className="wa-qr-side">
            <div className="wa-qr-icon">
              <QrCode size={22} />
            </div>
            <h2 className="wa-qr-title">Parear WhatsApp</h2>
            <p className="wa-qr-hint">
              Escaneie o QR ao lado no <strong>WhatsApp do restaurante</strong> para
              conectar. Enquanto a sessão não estiver pareada, o resumo diário
              <em> não é enviado</em>.
            </p>
            <ol className="wa-qr-steps">
              <li>Abra o WhatsApp no celular do restaurante</li>
              <li>Configurações → <strong>Aparelhos conectados</strong></li>
              <li>
                (Só se estiver trocando de aparelho) Remova entradas antigas
                do <em>Pateo da Luz ERP</em>
              </li>
              <li>Toque em <strong>Conectar um aparelho</strong></li>
              <li>Aponte a câmera para o QR ao lado</li>
            </ol>
            <div className="wa-qr-footer">
              {qrFetching && (
                <span className="wa-qr-loading">
                  <Loader2 size={13} className="wa-spin" /> Atualizando…
                </span>
              )}
              <span className="wa-qr-refresh-info">
                <LinkIcon size={12} /> O QR é rotacionado automaticamente a cada ~20s.
              </span>
            </div>
          </div>
          <div className="wa-qr-visual">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="QR code para parear WhatsApp"
                className="wa-qr-image"
              />
            ) : (
              <div className="wa-qr-placeholder">
                <Loader2 size={28} className="wa-spin" />
                <span>Gerando QR…</span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ─── Formulário ─────────────────────────────────────────────────── */}
      <section className="panel wa-form-panel">
        <div className="wa-form-head">
          <div>
            <h2 className="wa-form-title">
              {isEditing ? "Editar destinatário" : "Adicionar destinatário"}
            </h2>
            <p className="wa-form-hint">Formato internacional com DDI. Ex.: 5511961894636.</p>
          </div>
          {isEditing && (
            <span className="wa-form-mode">Editando: {form.name || "…"}</span>
          )}
        </div>

        <div className="wa-form-grid">
          <FormField label="Nome" required>
            <TextField
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Ex.: Marcos"
            />
          </FormField>
          <FormField label="Telefone (com DDI)" required>
            <TextField
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              placeholder="5511XXXXXXXXX"
              inputMode="tel"
            />
          </FormField>
          <FormField label="Observação">
            <TextField
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder="Ex.: sócio, gerente"
            />
          </FormField>
          <FormField label="Ativo" inline>
            <Switch
              checked={form.isActive}
              onChange={(checked) => setForm({ ...form, isActive: checked })}
            />
          </FormField>
          <div className="wa-form-submit">
            {isEditing && (
              <button
                type="button"
                className="wa-ghost-button"
                onClick={() => setForm(emptyForm)}
                disabled={saving}
              >
                Cancelar
              </button>
            )}
            <Button
              disabled={saving || (isEditing ? !canEdit : !canCreate)}
              onClick={handleSubmit}
            >
              {isEditing ? (
                saving ? "Salvando…" : "Salvar alterações"
              ) : (
                <>
                  <Plus size={14} /> {saving ? "Adicionando…" : "Adicionar"}
                </>
              )}
            </Button>
          </div>
        </div>
      </section>

      {/* ─── Lista ──────────────────────────────────────────────────────── */}
      <section className="panel wa-list-panel">
        <div className="wa-list-head">
          <div>
            <h2 className="wa-list-title">
              Destinatários {!loading && <span className="wa-list-count">({recipients.length})</span>}
            </h2>
            <p className="wa-list-sub">Quem receberá o resumo diário no WhatsApp.</p>
          </div>
          <IconButton icon={<RefreshCw size={16} />} label="Recarregar lista" onClick={loadAll} />
        </div>

        {error && <Alert tone="error">{error}</Alert>}
        {loading && <EmptyState title="Carregando destinatários…" />}

        {!loading && recipients.length === 0 && (
          <div className="wa-empty-wrap">
            <EmptyState
              title="Nenhum destinatário cadastrado."
              description="Enquanto estiver vazio, o resumo diário não é enviado."
            />
            <Button variant="secondary" size="sm" onClick={focusForm} disabled={!canCreate}>
              <Plus size={14} /> Adicionar primeiro destinatário
            </Button>
          </div>
        )}

        {!loading && recipients.length > 0 && (
          <>
            {/* Desktop: table. aria-hidden é gerenciado por CSS (media query
                troca display:none em cada) mas explicitamos aqui para reforçar
                — screen readers respeitam display:none, então basta o CSS. */}
            <div className="wa-desktop-list">
              <Table>
                <Table.Head>
                  <Table.Row>
                    <Table.Th>Status</Table.Th>
                    <Table.Th minWidth={140}>Nome</Table.Th>
                    <Table.Th minWidth={160}>Telefone</Table.Th>
                    <Table.Th>Observação</Table.Th>
                    <Table.Th actions>Ações</Table.Th>
                  </Table.Row>
                </Table.Head>
                <Table.Body>
                  {recipients.map((recipient) => (
                    <Table.Row key={recipient.id}>
                      <Table.Td>
                        <StatusBadge tone={recipient.isActive ? "success" : "neutral"}>
                          {recipient.isActive ? "Ativo" : "Pausado"}
                        </StatusBadge>
                      </Table.Td>
                      <Table.Td truncate title={recipient.name}>
                        <span className="wa-name">{recipient.name}</span>
                      </Table.Td>
                      <Table.Td>
                        <span className="wa-phone">{prettyPhone(recipient.phone)}</span>
                      </Table.Td>
                      <Table.Td truncate style={{ maxWidth: 220 }} title={recipient.notes ?? undefined}>
                        {recipient.notes ?? <span className="wa-muted">—</span>}
                      </Table.Td>
                      <Table.Td actions>
                        <div className="wa-row-actions">
                          <IconButton
                            icon={<Send size={16} />}
                            label={`Enviar teste para ${recipient.name}`}
                            disabled={testingId === recipient.id || status?.status !== "open"}
                            onClick={() => sendTest(recipient)}
                          />
                          <IconButton
                            icon={<Pencil size={16} />}
                            label={`Editar ${recipient.name}`}
                            disabled={!canEdit}
                            onClick={() => startEdit(recipient)}
                          />
                          <RowMenu
                            label={`Mais ações — ${recipient.name}`}
                            items={[
                              {
                                label: recipient.isActive ? "Pausar envios" : "Reativar envios",
                                icon: recipient.isActive ? <PowerOff size={15} /> : <Power size={15} />,
                                tone: recipient.isActive ? "danger" : "default",
                                disabled: !canEdit,
                                onClick: () => toggleActive(recipient)
                              },
                              {
                                label: "Remover",
                                icon: <Trash2 size={15} />,
                                tone: "danger",
                                disabled: !canDelete,
                                onClick: () => removeRecipient(recipient)
                              }
                            ]}
                          />
                        </div>
                      </Table.Td>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            </div>

            {/* Mobile: cards */}
            <ul className="wa-mobile-list">
              {recipients.map((recipient) => (
                <li key={recipient.id} className={`wa-mobile-card ${recipient.isActive ? "" : "wa-mobile-card-paused"}`}>
                  <div className="wa-mobile-card-head">
                    <span className="wa-mobile-card-name">{recipient.name}</span>
                    <StatusBadge tone={recipient.isActive ? "success" : "neutral"}>
                      {recipient.isActive ? "Ativo" : "Pausado"}
                    </StatusBadge>
                  </div>
                  <div className="wa-mobile-card-phone">{prettyPhone(recipient.phone)}</div>
                  {recipient.notes && (
                    <div className="wa-mobile-card-notes">{recipient.notes}</div>
                  )}
                  <div className="wa-mobile-card-actions">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => sendTest(recipient)}
                      disabled={testingId === recipient.id || status?.status !== "open"}
                    >
                      <Send size={14} /> {testingId === recipient.id ? "…" : "Testar"}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => startEdit(recipient)} disabled={!canEdit}>
                      <Pencil size={14} /> Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => toggleActive(recipient)}
                      disabled={!canEdit}
                    >
                      {recipient.isActive ? (
                        <>
                          <PowerOff size={14} /> Pausar
                        </>
                      ) : (
                        <>
                          <Power size={14} /> Ativar
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => removeRecipient(recipient)}
                      disabled={!canDelete}
                    >
                      <Trash2 size={14} /> Remover
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {!loading && recipients.length > 0 && status && (
          <div className="wa-list-footer">
            {status.status === "open" && activeCount > 0 ? (
              <span className="wa-list-footer-ok">
                <CheckCircle2 size={14} /> {activeCount} pessoa{activeCount === 1 ? "" : "s"}{" "}
                {activeCount === 1 ? "receberá" : "receberão"} o resumo{" "}
                <strong>{nextRun.toLowerCase()}</strong>.
              </span>
            ) : status.status === "open" && activeCount === 0 ? (
              <span className="wa-list-footer-warn">
                <XCircle size={14} /> Nenhum destinatário ativo — o resumo não será enviado.
              </span>
            ) : (
              <span className="wa-list-footer-warn">
                <XCircle size={14} /> Canal fora do ar — próximo envio pode falhar até reconectar.
              </span>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
