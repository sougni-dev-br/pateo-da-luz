import {
  CheckSquare,
  KeyRound,
  Lock,
  Monitor,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldOff,
  Square,
  UserCheck,
  UserX,
} from "lucide-react";
import { ReactNode, useEffect, useMemo, useState } from "react";
import {
  AppUser,
  changeOwnPassword,
  getActiveSessions,
  getMenuPermissions,
  getUsers,
  killUserSession,
  MenuDefinition,
  ModulePermissionMap,
  PermissionAction,
  resetUserPassword,
  saveUser,
  setUserStatus,
  updateUserMenuPermissions,
  updateUserPermissions,
  UserRole,
  UserSessionInfo,
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { isPasswordValid, PasswordField, passwordPolicyMessage } from "../components/PasswordField";
import { useSession } from "../context/SessionContext";
import { normalizeModulePermission } from "../lib/permissions";
import { formatDate } from "../utils/format";

// ─── constants ───────────────────────────────────────────────────────────────

const ALL_ROLES: UserRole[] = ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA", "VISUALIZACAO"];

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Administrador geral",
  GESTAO_COMPLETA: "Gestão completa",
  ESTOQUISTA: "Estoque e compras",
  VISUALIZACAO: "Somente consulta",
};

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  ADMIN: "Acesso total ao sistema, incluindo usuários, permissões, financeiro, estoque, CMV, DRE e configurações.",
  GESTAO_COMPLETA: "Acesso amplo para operação e gestão: compras, financeiro, faturamento, estoque, relatórios e dashboards.",
  ESTOQUISTA: "Acesso focado em compras, produtos, contagem de estoque e inventário.",
  VISUALIZACAO: "Pode visualizar as informações permitidas, sem criar, editar, excluir ou aprovar lançamentos.",
};

const ACTION_COLS: Array<{ action: PermissionAction; label: string; short: string }> = [
  { action: "view",    label: "Visualizar",        short: "Ver"   },
  { action: "create",  label: "Criar",              short: "Criar" },
  { action: "edit",    label: "Editar",             short: "Edit." },
  { action: "delete",  label: "Excluir/Cancelar",   short: "Excl." },
  { action: "approve", label: "Aprovar/Fechar",     short: "Apr."  },
  { action: "admin",   label: "Administrar",        short: "Adm."  },
];

type Tab = "dados" | "permissoes" | "sessoes" | "senha";

type ConfirmAction = {
  label: string;
  description: string;
  tone: "warning" | "danger";
  onConfirm: () => Promise<void>;
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

function formatRelative(dateStr: string | null | undefined) {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)   return "agora";
  if (m < 60)  return `${m} min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

function simplifyUA(ua: string | null) {
  if (!ua) return "—";
  if (/mobile|android/i.test(ua)) return "Mobile";
  if (/edg/i.test(ua))    return "Edge";
  if (/chrome/i.test(ua)) return "Chrome";
  if (/firefox/i.test(ua)) return "Firefox";
  if (/safari/i.test(ua)) return "Safari";
  return "Navegador";
}

function temporaryPassword() {
  return `Pateo${Math.floor(100_000 + Math.random() * 900_000)}`;
}

// ─── sub-views ───────────────────────────────────────────────────────────────

function TabBar({ tabs, active, onSelect }: {
  tabs: Array<{ id: Tab; label: string; icon?: ReactNode }>;
  active: Tab;
  onSelect: (tab: Tab) => void;
}) {
  return (
    <div className="users-tab-bar" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={active === t.id}
          className={`users-tab-btn${active === t.id ? " is-active" : ""}`}
          onClick={() => onSelect(t.id)}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

function PermRow({ label, checked, disabled, isCustom, isRoleDefault, onChange }: {
  label: string;
  checked: boolean;
  disabled: boolean;
  isCustom: boolean;
  isRoleDefault: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <td
      className={`perm-cell${isCustom ? " perm-cell-custom" : ""}${isRoleDefault && !isCustom ? " perm-cell-inherited" : ""}`}
      title={isCustom ? "Permissão personalizada" : isRoleDefault ? "Herdada do perfil" : ""}
    >
      <button
        type="button"
        className="perm-toggle"
        aria-label={`${label}: ${checked ? "concedida" : "negada"}`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        {checked
          ? <CheckSquare size={15} className={isCustom ? "perm-icon-custom" : "perm-icon-default"} />
          : <Square size={15} className="perm-icon-none" />
        }
      </button>
    </td>
  );
}

// ─── main component ──────────────────────────────────────────────────────────

export function Users() {
  const { user: sessionUser, hasPermission } = useSession();
  const canAdminUsers = hasPermission("users", "admin");
  const isAdmin = sessionUser?.role === "ADMIN";

  const [users, setUsers]           = useState<AppUser[]>([]);
  const [menus, setMenus]           = useState<MenuDefinition[]>([]);
  const [roleDefaults, setRoleDefaults] = useState<Partial<Record<UserRole, ModulePermissionMap>>>({});
  const [selectedId, setSelectedId] = useState<string>("");
  const [showNewForm, setShowNewForm] = useState(false);
  const [activeTab, setActiveTab]   = useState<Tab>("dados");
  const [sessions, setSessions]     = useState<UserSessionInfo[]>([]);
  const [sessionsReady, setSessionsReady] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const { notice, setNotice } = useNotice(7000);

  // ── forms
  const [newForm, setNewForm] = useState({
    name: "", email: "", password: "", confirmPassword: "", role: "VISUALIZACAO" as UserRole,
  });
  const [editor, setEditor] = useState({
    id: "", name: "", email: "", role: "VISUALIZACAO" as UserRole, isActive: true, mustChangePassword: false,
  });
  const [pwdForm, setPwdForm] = useState({ password: "", mustChangePassword: true });
  const [lastTemp, setLastTemp] = useState<string | null>(null);
  const [ownPwd, setOwnPwd] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });

  // ── derived
  const selectedUser = users.find((u) => u.id === selectedId) ?? null;
  const isSelf = sessionUser?.id === selectedId;
  const canManage = canAdminUsers && (isAdmin || !isSelf);
  const userSessions = sessions.filter((s) => s.userId === selectedId);

  const groupedMenus = useMemo(() =>
    menus.reduce<Array<{ group: string; rows: MenuDefinition[] }>>((acc, m) => {
      const g = acc.find((x) => x.group === m.group);
      if (g) g.rows.push(m); else acc.push({ group: m.group, rows: [m] });
      return acc;
    }, []),
  [menus]);

  // ── data loading
  async function load() {
    try {
      const [userRows, config] = await Promise.all([getUsers(), getMenuPermissions()]);
      setUsers(userRows);
      setMenus(config.menus);
      setRoleDefaults(config.roleModulePermissions as Record<UserRole, ModulePermissionMap>);
      setSelectedId((curr) => userRows.some((u) => u.id === curr) ? curr : userRows[0]?.id ?? "");
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao carregar dados." });
    }
  }

  async function loadSessions() {
    if (!isAdmin) return;
    setSessionsLoading(true);
    try {
      setSessions(await getActiveSessions());
      setSessionsReady(true);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao carregar sessões." });
    } finally {
      setSessionsLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!selectedUser) return;
    setEditor({
      id: selectedUser.id,
      name: selectedUser.name,
      email: selectedUser.email,
      role: selectedUser.role,
      isActive: Boolean(selectedUser.isActive),
      mustChangePassword: Boolean(selectedUser.mustChangePassword),
    });
    setPwdForm({ password: "", mustChangePassword: true });
    setLastTemp(null);
    setConfirmAction(null);
  }, [selectedId]);

  // ── tab navigation
  function handleTabSelect(tab: Tab) {
    setActiveTab(tab);
    setConfirmAction(null);
    if (tab === "sessoes" && !sessionsReady) loadSessions();
  }

  function pickUser(id: string) {
    setSelectedId(id);
    setShowNewForm(false);
    setActiveTab("dados");
    setConfirmAction(null);
  }

  // ── actions
  async function submitNewUser() {
    if (!canAdminUsers) { setNotice({ tone: "error", message: "Sem permissão para criar usuários." }); return; }
    if (!newForm.name || !newForm.email || !newForm.password) {
      setNotice({ tone: "error", message: "Preencha nome, e-mail e senha." }); return;
    }
    if (!isPasswordValid(newForm.password)) {
      setNotice({ tone: "error", message: "Senha deve ter mínimo 8 caracteres, 1 letra e 1 número." }); return;
    }
    if (newForm.password !== newForm.confirmPassword) {
      setNotice({ tone: "error", message: "As senhas não conferem." }); return;
    }
    try {
      const created = await saveUser({ name: newForm.name, email: newForm.email, password: newForm.password, role: newForm.role });
      setNotice({ tone: "success", message: `Usuário ${newForm.name} criado com sucesso.` });
      setNewForm({ name: "", email: "", password: "", confirmPassword: "", role: "VISUALIZACAO" });
      setShowNewForm(false);
      await load();
      setSelectedId(created.id);
      setActiveTab("dados");
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao criar usuário." });
    }
  }

  async function saveEditor() {
    if (!selectedUser || !canAdminUsers) { setNotice({ tone: "error", message: "Sem permissão." }); return; }
    if (!editor.name || !editor.email) { setNotice({ tone: "error", message: "Nome e e-mail são obrigatórios." }); return; }
    try {
      await updateUserPermissions(selectedUser.id, editor);
      setNotice({ tone: "success", message: `Cadastro de ${editor.name} atualizado.` });
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao salvar." });
    }
  }

  function confirmToggle() {
    if (!selectedUser) return;
    const deactivating = selectedUser.isActive;
    setConfirmAction({
      tone: deactivating ? "danger" : "warning",
      label: deactivating ? `Inativar ${selectedUser.name}` : `Reativar ${selectedUser.name}`,
      description: deactivating
        ? "O acesso ao sistema será bloqueado imediatamente."
        : "O usuário voltará a ter acesso conforme as permissões configuradas.",
      onConfirm: async () => {
        await setUserStatus(selectedUser.id, !selectedUser.isActive);
        setNotice({ tone: "success", message: deactivating ? `${selectedUser.name} inativado.` : `${selectedUser.name} reativado.` });
        await load();
      },
    });
  }

  function confirmResetPassword() {
    if (!selectedUser) return;
    if (!pwdForm.password) { setNotice({ tone: "error", message: "Informe a nova senha." }); return; }
    if (!isPasswordValid(pwdForm.password)) { setNotice({ tone: "error", message: "Senha fraca. Mínimo 8 caracteres, 1 letra e 1 número." }); return; }
    setConfirmAction({
      tone: "warning",
      label: `Redefinir senha de ${selectedUser.name}`,
      description: `A sessão ativa de ${selectedUser.name} será encerrada.${pwdForm.mustChangePassword ? " Será exigida troca de senha no próximo login." : ""}`,
      onConfirm: async () => {
        await resetUserPassword(selectedUser.id, pwdForm);
        setPwdForm({ password: "", mustChangePassword: true });
        setLastTemp(null);
        setNotice({ tone: "success", message: `Senha de ${selectedUser.name} redefinida com sucesso.` });
        await load();
      },
    });
  }

  function confirmKillSession(userId: string, userName: string) {
    setConfirmAction({
      tone: "warning",
      label: `Encerrar sessão de ${userName}`,
      description: "O usuário será desconectado imediatamente.",
      onConfirm: async () => {
        await killUserSession(userId);
        setNotice({ tone: "success", message: `Sessão de ${userName} encerrada.` });
        await loadSessions();
      },
    });
  }

  function confirmRestoreDefaults() {
    if (!selectedUser) return;
    setConfirmAction({
      tone: "warning",
      label: "Restaurar modelo padrão",
      description: `Isso vai remover alterações individuais e voltar às permissões do modelo "${ROLE_LABELS[selectedUser.role]}" para ${selectedUser.name}.`,
      onConfirm: async () => {
        const defaults = roleDefaults[selectedUser.role];
        if (!defaults) throw new Error("Modelo padrão não encontrado.");
        await updateUserMenuPermissions(selectedUser.id, defaults);
        setNotice({ tone: "success", message: "Permissões restauradas ao modelo padrão." });
        await load();
      },
    });
  }

  async function executeConfirm() {
    if (!confirmAction) return;
    setConfirmLoading(true);
    try {
      await confirmAction.onConfirm();
      setConfirmAction(null);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao executar ação." });
    } finally {
      setConfirmLoading(false);
    }
  }

  async function savePermission(menuId: string, action: PermissionAction, checked: boolean) {
    if (!selectedUser || !canManage || selectedUser.role === "ADMIN") return;
    const next = Object.fromEntries(
      Object.entries(selectedUser.modulePermissions ?? {}).map(([id, p]) => [id, normalizeModulePermission(p)])
    ) as ModulePermissionMap;
    const current = normalizeModulePermission(next[menuId]);
    next[menuId] = normalizeModulePermission({ ...current, [action]: checked });
    try {
      await updateUserMenuPermissions(selectedUser.id, next);
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao atualizar permissão." });
    }
  }

  async function doChangeOwnPassword() {
    if (!ownPwd.currentPassword || !ownPwd.newPassword) {
      setNotice({ tone: "error", message: "Informe a senha atual e a nova senha." }); return;
    }
    if (!isPasswordValid(ownPwd.newPassword)) {
      setNotice({ tone: "error", message: "A nova senha deve ter mínimo 8 caracteres, 1 letra e 1 número." }); return;
    }
    if (ownPwd.newPassword !== ownPwd.confirmPassword) {
      setNotice({ tone: "error", message: "As senhas não conferem." }); return;
    }
    try {
      await changeOwnPassword({ currentPassword: ownPwd.currentPassword, newPassword: ownPwd.newPassword });
      setOwnPwd({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setNotice({ tone: "success", message: "Senha alterada com sucesso." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao alterar senha." });
    }
  }

  // ── computed tabs for selected user
  const tabs: Array<{ id: Tab; label: string; icon?: ReactNode }> = [
    { id: "dados",      label: "Dados",       icon: null },
    { id: "permissoes", label: "Permissões",  icon: null },
    ...(isAdmin ? [{ id: "sessoes" as Tab, label: "Sessões", icon: null }] : []),
    { id: "senha",      label: "Senha",       icon: null },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="stack">
      <Notice notice={notice} />

      {/* ── Confirmation banner ── */}
      {confirmAction && (
        <div className={`confirm-banner tone-${confirmAction.tone}`}>
          <div className="confirm-banner-body">
            <ShieldAlert size={18} className="confirm-banner-icon" />
            <div>
              <strong>{confirmAction.label}</strong>
              {confirmAction.description && <p className="confirm-banner-desc">{confirmAction.description}</p>}
            </div>
          </div>
          <div className="confirm-banner-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={confirmLoading}
              onClick={() => setConfirmAction(null)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className={`primary-button${confirmAction.tone === "danger" ? " btn-danger" : ""}`}
              disabled={confirmLoading}
              onClick={executeConfirm}
            >
              {confirmLoading ? "Aguarde…" : "Confirmar"}
            </button>
          </div>
        </div>
      )}

      {/* ── Two-column layout ── */}
      <div className="users-shell">

        {/* ── LEFT: user list ── */}
        <aside className="users-sidebar panel">
          <div className="users-sidebar-header">
            <h2>Usuários</h2>
            <div className="users-sidebar-btns">
              <button type="button" className="icon-button" onClick={load} title="Atualizar lista">
                <RefreshCw size={16} />
              </button>
              {canAdminUsers && (
                <button type="button" className="icon-button" onClick={() => { setShowNewForm(true); setSelectedId(""); setConfirmAction(null); }} title="Novo usuário">
                  <Plus size={16} />
                </button>
              )}
            </div>
          </div>

          <div className="user-list">
            {showNewForm && (
              <div className="user-list-item is-new is-selected" aria-current="true">
                <div className="user-avatar role-new"><Plus size={14} /></div>
                <div className="user-list-info">
                  <div className="user-list-name">Novo usuário</div>
                </div>
              </div>
            )}

            {users.map((u) => {
              const active = !showNewForm && selectedId === u.id;
              const uSessions = sessions.filter((s) => s.userId === u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  className={`user-list-item${active ? " is-selected" : ""}${!u.isActive ? " is-inactive" : ""}`}
                  onClick={() => pickUser(u.id)}
                >
                  <div className={`user-avatar role-${u.role.toLowerCase().replace(/_/g, "-")}`}>
                    {initials(u.name)}
                  </div>
                  <div className="user-list-info">
                    <div className="user-list-name">
                      {u.name}
                      {u.id === sessionUser?.id && <span className="self-tag">Você</span>}
                    </div>
                    <div className="user-list-meta">
                      <span className={`status-dot${u.isActive ? "" : " off"}`} />
                      <span>{ROLE_LABELS[u.role]}</span>
                      {uSessions.length > 0 && (
                        <span className="session-dot" title="Sessão ativa">
                          <Monitor size={10} />
                        </span>
                      )}
                    </div>
                    <div className="user-list-login">
                      {u.lastLoginAt ? formatRelative(u.lastLoginAt) : "Nunca conectou"}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* ── RIGHT: detail panel ── */}
        <div className="users-detail">

          {/* ── New user form ── */}
          {showNewForm && (
            <section className="panel">
              <div className="section-heading">
                <div><p>Segurança</p><h2>Novo usuário</h2></div>
                <button type="button" className="icon-button" onClick={() => setShowNewForm(false)} title="Cancelar">
                  ✕
                </button>
              </div>
              <div className="form-grid">
                <label>
                  Nome
                  <input value={newForm.name} autoComplete="off" onChange={(e) => setNewForm({ ...newForm, name: e.target.value })} />
                </label>
                <label>
                  E-mail
                  <input type="email" value={newForm.email} autoComplete="off" onChange={(e) => setNewForm({ ...newForm, email: e.target.value })} />
                </label>
                <label>
                  Modelo de acesso
                  <select value={newForm.role} onChange={(e) => setNewForm({ ...newForm, role: e.target.value as UserRole })}>
                    {ALL_ROLES.filter((r) => r !== "ADMIN" || isAdmin).map((r) => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                </label>
                <p className="role-desc-hint" style={{ gridColumn: "1 / -1" }}>
                  {ROLE_DESCRIPTIONS[newForm.role]}
                </p>
                <PasswordField label="Senha inicial" value={newForm.password} onChange={(v) => setNewForm({ ...newForm, password: v })} />
                <PasswordField label="Confirmar senha" value={newForm.confirmPassword} onChange={(v) => setNewForm({ ...newForm, confirmPassword: v })} />
              </div>
              <div className={`password-hint ${isPasswordValid(newForm.password) ? "ok" : "error"}`}>
                {passwordPolicyMessage(newForm.password)}
              </div>
              {newForm.confirmPassword && (
                <div className={`password-hint ${newForm.password === newForm.confirmPassword ? "ok" : "error"}`}>
                  {newForm.password === newForm.confirmPassword ? "Senhas iguais." : "Senhas diferentes."}
                </div>
              )}
              <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                <button type="button" className="secondary-button" onClick={() => setShowNewForm(false)}>Cancelar</button>
                <button type="button" className="primary-button" onClick={submitNewUser}>Criar usuário</button>
              </div>
            </section>
          )}

          {/* ── Selected user detail ── */}
          {!showNewForm && selectedUser && (
            <>
              {/* User header card */}
              <div className="user-header-card panel">
                <div className={`user-header-avatar role-${selectedUser.role.toLowerCase().replace(/_/g, "-")}`}>
                  {initials(selectedUser.name)}
                </div>
                <div className="user-header-info">
                  <div className="user-header-name">
                    {selectedUser.name}
                    {isSelf && <span className="self-tag">Você</span>}
                    <span className={`status-badge${selectedUser.isActive ? " active" : " inactive"}`}>
                      {selectedUser.isActive ? "Ativo" : "Inativo"}
                    </span>
                    {selectedUser.mustChangePassword && (
                      <span className="status-badge warning"><Lock size={10} /> Troca obrigatória</span>
                    )}
                  </div>
                  <div className="user-header-meta">
                    {selectedUser.email}
                    <span className="separator">·</span>
                    <span className={`role-badge role-${selectedUser.role.toLowerCase().replace(/_/g, "-")}`}>
                      {ROLE_LABELS[selectedUser.role]}
                    </span>
                  </div>
                  <div className="user-header-login">
                    Último login: {selectedUser.lastLoginAt ? formatDate(selectedUser.lastLoginAt) : "nunca"}
                    {selectedUser.lastLoginAt && <span className="separator">·</span>}
                    {selectedUser.lastLoginAt && <span>{formatRelative(selectedUser.lastLoginAt)}</span>}
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <TabBar tabs={tabs} active={activeTab} onSelect={handleTabSelect} />

              {/* ── TAB: Dados ── */}
              {activeTab === "dados" && (
                <section className="panel">
                  <div className="form-grid">
                    <label>
                      Nome
                      <input value={editor.name} disabled={!canAdminUsers} autoComplete="off"
                        onChange={(e) => setEditor({ ...editor, name: e.target.value })} />
                    </label>
                    <label>
                      E-mail
                      <input type="email" value={editor.email} disabled={!canAdminUsers} autoComplete="off"
                        onChange={(e) => setEditor({ ...editor, email: e.target.value })} />
                    </label>
                    <label>
                      Modelo de acesso
                      <select value={editor.role} disabled={!canManage}
                        onChange={(e) => setEditor({ ...editor, role: e.target.value as UserRole })}>
                        {ALL_ROLES.filter((r) => r !== "ADMIN" || isAdmin).map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                    </label>
                    <p className="role-desc-hint" style={{ gridColumn: "1 / -1" }}>
                      {ROLE_DESCRIPTIONS[editor.role]}
                    </p>
                    <div className="form-checks">
                      <label className="checkbox-label">
                        <input type="checkbox" checked={editor.isActive} disabled={!canManage}
                          onChange={(e) => setEditor({ ...editor, isActive: e.target.checked })} />
                        Usuário ativo
                      </label>
                      <label className="checkbox-label">
                        <input type="checkbox" checked={editor.mustChangePassword} disabled={!canAdminUsers}
                          onChange={(e) => setEditor({ ...editor, mustChangePassword: e.target.checked })} />
                        Exigir troca de senha no próximo login
                      </label>
                    </div>
                  </div>

                  {canAdminUsers && (
                    <div className="users-action-row">
                      <button type="button" className="primary-button" onClick={saveEditor}>
                        Salvar dados
                      </button>
                      {canManage && (
                        <button
                          type="button"
                          className={`secondary-button${selectedUser.isActive ? " btn-danger-outline" : ""}`}
                          onClick={confirmToggle}
                        >
                          {selectedUser.isActive
                            ? <><UserX size={15} /> Inativar</>
                            : <><UserCheck size={15} /> Reativar</>
                          }
                        </button>
                      )}
                    </div>
                  )}

                  {!canManage && isSelf && (
                    <div className="alert warning" style={{ marginTop: 8 }}>
                      Você pode visualizar seus dados, mas não pode alterar o próprio perfil base.
                    </div>
                  )}
                </section>
              )}

              {/* ── TAB: Permissões ── */}
              {activeTab === "permissoes" && (
                <section className="panel">
                  {selectedUser.role === "ADMIN" ? (
                    <div className="alert success">
                      <ShieldAlert size={16} />
                      Administradores têm acesso total a todos os módulos. As permissões individuais não se aplicam.
                    </div>
                  ) : (
                    <>
                      {(() => {
                        const overrideCount = Object.keys(selectedUser.modulePermissionOverrides ?? {}).length;
                        return (
                          <div className="perm-model-banner">
                            <span>
                              Modelo de acesso: <strong>{ROLE_LABELS[selectedUser.role]}</strong>
                            </span>
                            {overrideCount > 0 && (
                              <span className="perm-model-override-hint">
                                · {overrideCount} módulo{overrideCount !== 1 ? "s" : ""} com permissões alteradas manualmente
                              </span>
                            )}
                          </div>
                        );
                      })()}

                      <div className="perm-legend">
                        <span className="perm-legend-item">
                          <CheckSquare size={13} className="perm-icon-default" /> Padrão do modelo
                        </span>
                        <span className="perm-legend-item">
                          <CheckSquare size={13} className="perm-icon-custom" /> Alterado manualmente
                        </span>
                        <span className="perm-legend-item">
                          <Square size={13} className="perm-icon-none" /> Sem permissão
                        </span>
                      </div>

                      {canManage && (
                        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                          <button type="button" className="secondary-button" onClick={confirmRestoreDefaults}>
                            <RotateCcw size={14} /> Restaurar modelo padrão
                          </button>
                        </div>
                      )}

                      <div className="perm-table-wrap">
                        {groupedMenus.map(({ group, rows }) => (
                          <div key={group} className="perm-group">
                            <div className="perm-group-label">{group}</div>
                            <table className="perm-table">
                              <thead>
                                <tr>
                                  <th className="perm-th-module">Módulo</th>
                                  {ACTION_COLS.map((c) => (
                                    <th key={c.action} className="perm-th-action" title={c.label}>{c.short}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((menu) => {
                                  const effective = normalizeModulePermission(selectedUser.modulePermissions?.[menu.id]);
                                  const isCustom  = Boolean(selectedUser.modulePermissionOverrides && menu.id in selectedUser.modulePermissionOverrides);
                                  const rolePerms = normalizeModulePermission(roleDefaults[selectedUser.role]?.[menu.id]);
                                  return (
                                    <tr key={menu.id} className={isCustom ? "perm-row-custom" : ""}>
                                      <td className="perm-td-module">{menu.label}</td>
                                      {ACTION_COLS.map((c) => (
                                        <PermRow
                                          key={c.action}
                                          label={`${menu.label} / ${c.label}`}
                                          checked={effective[c.action]}
                                          disabled={!canManage}
                                          isCustom={isCustom && effective[c.action] !== rolePerms[c.action]}
                                          isRoleDefault={rolePerms[c.action]}
                                          onChange={(v) => savePermission(menu.id, c.action, v)}
                                        />
                                      ))}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </section>
              )}

              {/* ── TAB: Sessões ── */}
              {activeTab === "sessoes" && isAdmin && (
                <section className="panel">
                  <div className="section-heading" style={{ marginBottom: 8 }}>
                    <span>Sessões ativas de {selectedUser.name}</span>
                    <button type="button" className="icon-button" onClick={loadSessions} title="Atualizar">
                      <RefreshCw size={15} className={sessionsLoading ? "spin" : ""} />
                    </button>
                  </div>
                  {!sessionsReady ? (
                    <div className="alert">Carregando sessões…</div>
                  ) : userSessions.length === 0 ? (
                    <div className="alert">Nenhuma sessão ativa para este usuário.</div>
                  ) : (
                    <div className="session-list">
                      {userSessions.map((s) => (
                        <div key={s.sessionId} className="session-item">
                          <Monitor size={16} className="session-icon" />
                          <div className="session-info">
                            <div className="session-device">{simplifyUA(s.userAgent)}</div>
                            <div className="session-meta">
                              {s.ipAddress ?? "IP desconhecido"}
                              <span className="separator">·</span>
                              Início: {formatRelative(s.createdAt)}
                              <span className="separator">·</span>
                              Atividade: {formatRelative(s.lastActivityAt ?? s.createdAt)}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="secondary-button btn-danger-outline session-kill-btn"
                            onClick={() => confirmKillSession(s.userId, s.userName)}
                          >
                            <ShieldOff size={13} /> Encerrar
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {/* ── TAB: Senha ── */}
              {activeTab === "senha" && (
                <div className="stack">
                  {/* Admin: reset password for this user */}
                  {canAdminUsers && canManage && (
                    <section className="panel">
                      <div className="section-heading">
                        <div><p>Administração</p><h2>Redefinir senha de {selectedUser.name}</h2></div>
                        <KeyRound size={20} />
                      </div>
                      <div className="form-grid">
                        <PasswordField
                          label="Nova senha"
                          value={pwdForm.password}
                          onChange={(v) => { setLastTemp(null); setPwdForm({ ...pwdForm, password: v }); }}
                        />
                        <div className="form-checks">
                          <label className="checkbox-label">
                            <input type="checkbox" checked={pwdForm.mustChangePassword}
                              onChange={(e) => setPwdForm({ ...pwdForm, mustChangePassword: e.target.checked })} />
                            Exigir troca de senha no próximo login
                          </label>
                        </div>
                        <div style={{ display: "flex", gap: 10, gridColumn: "1 / -1" }}>
                          <button type="button" className="secondary-button" onClick={() => {
                            const p = temporaryPassword();
                            setPwdForm({ ...pwdForm, password: p, mustChangePassword: true });
                            setLastTemp(p);
                          }}>
                            Gerar senha temporária
                          </button>
                          <button type="button" className="primary-button" onClick={confirmResetPassword}>
                            Redefinir senha
                          </button>
                        </div>
                      </div>
                      <div className={`password-hint ${isPasswordValid(pwdForm.password) ? "ok" : "error"}`}>
                        {passwordPolicyMessage(pwdForm.password)}
                      </div>
                      {lastTemp && (
                        <div className="alert warning" style={{ marginTop: 8 }}>
                          Senha temporária gerada: <strong>{lastTemp}</strong>
                          <br /><small>Ainda não salva. Clique em "Redefinir senha" para aplicar.</small>
                        </div>
                      )}
                    </section>
                  )}

                  {/* Self: change own password */}
                  {isSelf && (
                    <section className="panel">
                      <div className="section-heading">
                        <div><p>Minha conta</p><h2>Alterar minha senha</h2></div>
                        <Lock size={20} />
                      </div>
                      <div className="form-grid">
                        <PasswordField label="Senha atual" value={ownPwd.currentPassword}
                          onChange={(v) => setOwnPwd({ ...ownPwd, currentPassword: v })} />
                        <PasswordField label="Nova senha" value={ownPwd.newPassword}
                          onChange={(v) => setOwnPwd({ ...ownPwd, newPassword: v })} />
                        <PasswordField label="Confirmar nova senha" value={ownPwd.confirmPassword}
                          onChange={(v) => setOwnPwd({ ...ownPwd, confirmPassword: v })} />
                        <button type="button" className="primary-button" onClick={doChangeOwnPassword}>
                          Alterar minha senha
                        </button>
                      </div>
                      <div className={`password-hint ${isPasswordValid(ownPwd.newPassword) ? "ok" : "error"}`}>
                        {passwordPolicyMessage(ownPwd.newPassword)}
                      </div>
                      {ownPwd.confirmPassword && (
                        <div className={`password-hint ${ownPwd.newPassword === ownPwd.confirmPassword ? "ok" : "error"}`}>
                          {ownPwd.newPassword === ownPwd.confirmPassword ? "Senhas iguais." : "Senhas diferentes."}
                        </div>
                      )}
                    </section>
                  )}

                  {!canAdminUsers && !isSelf && (
                    <div className="alert warning">Sem permissão para gerenciar senhas.</div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── Empty state ── */}
          {!showNewForm && !selectedUser && (
            <div className="users-empty panel">
              <p>Selecione um usuário na lista para ver os detalhes.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
