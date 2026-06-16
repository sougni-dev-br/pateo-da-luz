import { KeyRound, Monitor, RefreshCw, ShieldOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  AppUser,
  changeOwnPassword,
  getActiveSessions,
  getMenuPermissions,
  getUsers,
  killUserSession,
  MenuDefinition,
  ModulePermission,
  ModulePermissionMap,
  PermissionAction,
  resetUserPassword,
  saveUser,
  setUserStatus,
  updateUserMenuPermissions,
  updateUserPermissions,
  UserRole,
  UserSessionInfo
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { isPasswordValid, PasswordField, passwordPolicyMessage } from "../components/PasswordField";
import { useSession } from "../context/SessionContext";
import { normalizeModulePermission } from "../lib/permissions";
import { formatDate } from "../utils/format";

const roles: UserRole[] = ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA", "VISUALIZACAO"];
const actionColumns: Array<{ action: PermissionAction; label: string }> = [
  { action: "view", label: "Visualizar" },
  { action: "create", label: "Criar" },
  { action: "edit", label: "Editar" },
  { action: "delete", label: "Excluir/Cancelar" },
  { action: "approve", label: "Aprovar/Fechar" },
  { action: "admin", label: "Administrar" }
];

function temporaryPassword() {
  return `Pateo${Math.floor(100000 + Math.random() * 900000)}`;
}

function clonePermissions(source?: ModulePermissionMap) {
  return Object.fromEntries(Object.entries(source ?? {}).map(([menuId, permission]) => [
    menuId,
    normalizeModulePermission(permission)
  ])) as ModulePermissionMap;
}

function permissionLabels(permission?: ModulePermission) {
  const normalized = normalizeModulePermission(permission);
  return actionColumns
    .filter((column) => normalized[column.action])
    .map((column) => column.label.toLowerCase());
}

export function Users() {
  const { user: sessionUser, hasPermission } = useSession();
  const canAdminUsers = hasPermission("users", "admin");
  const [users, setUsers] = useState<AppUser[]>([]);
  const [menus, setMenus] = useState<MenuDefinition[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: "VISUALIZACAO" as UserRole
  });
  const [passwordForm, setPasswordForm] = useState({ userId: "", password: "", mustChangePassword: true });
  const [ownPassword, setOwnPassword] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [editor, setEditor] = useState({
    id: "",
    name: "",
    email: "",
    role: "VISUALIZACAO" as UserRole,
    isActive: true,
    mustChangePassword: false
  });
  const [lastTemporaryPassword, setLastTemporaryPassword] = useState<string | null>(null);
  const [sessions, setSessions] = useState<UserSessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const { notice, setNotice } = useNotice(7000);

  const createPasswordsMatch = form.password.length > 0 && form.password === form.confirmPassword;
  const ownPasswordsMatch = ownPassword.newPassword.length > 0 && ownPassword.newPassword === ownPassword.confirmPassword;
  const selectedUser = users.find((user) => user.id === selectedUserId) ?? users[0] ?? null;
  const canManageSelectedUserAccess = selectedUser ? canAdminUsers && (sessionUser?.role === "ADMIN" || sessionUser?.id !== selectedUser.id) : canAdminUsers;

  async function load() {
    const [userRows, permissionConfig] = await Promise.all([getUsers(), getMenuPermissions()]);
    setUsers(userRows);
    setMenus(permissionConfig.menus);
    setSelectedUserId((current) => userRows.some((user) => user.id === current) ? current : userRows[0]?.id || "");
  }

  async function submit() {
    if (!canAdminUsers) {
      setNotice({ tone: "error", message: "Voce nao possui permissao para criar usuarios." });
      return;
    }
    if (!form.name || !form.email || !form.password) {
      setNotice({ tone: "error", message: "Preencha nome, email e senha para cadastrar o usuario." });
      return;
    }
    if (!isPasswordValid(form.password)) {
      setNotice({ tone: "error", message: "A senha deve ter no minimo 8 caracteres, 1 letra e 1 numero." });
      return;
    }
    if (!createPasswordsMatch) {
      setNotice({ tone: "error", message: "As senhas do novo usuário não conferem." });
      return;
    }
    try {
      await saveUser({ name: form.name, email: form.email, password: form.password, role: form.role });
      setForm({ name: "", email: "", password: "", confirmPassword: "", role: "VISUALIZACAO" });
      setNotice({ tone: "success", message: "Usuário criado com sucesso." });
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao criar usuário." });
    }
  }

  async function toggle(user: AppUser) {
    if (!canAdminUsers) {
      setNotice({ tone: "error", message: "Você não possui permissão para alterar status de usuários." });
      return;
    }
    try {
      await setUserStatus(user.id, !user.isActive);
      setNotice({
        tone: "success",
        message: user.isActive ? `Usuário ${user.name} inativado com sucesso.` : `Usuário ${user.name} reativado com sucesso.`
      });
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao alterar status do usuário." });
    }
  }

  async function saveSelectedUser() {
    if (!selectedUser) {
      setNotice({ tone: "error", message: "Selecione um usuario para editar." });
      return;
    }
    if (!canAdminUsers) {
      setNotice({ tone: "error", message: "Voce nao possui permissao para editar usuarios." });
      return;
    }
    if (!editor.name || !editor.email) {
      setNotice({ tone: "error", message: "Informe nome e email do usuario." });
      return;
    }
    try {
      await updateUserPermissions(selectedUser.id, editor);
      setNotice({
        tone: "success",
        message: editor.mustChangePassword
          ? `Cadastro de ${editor.name} atualizado. A troca de senha sera obrigatoria no proximo login.`
          : `Cadastro de ${editor.name} atualizado com sucesso.`
      });
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao atualizar cadastro do usuario." });
    }
  }

  async function resetPassword() {
    const user = users.find((item) => item.id === passwordForm.userId);
    if (!canAdminUsers) {
      setNotice({ tone: "error", message: "Voce nao possui permissao para redefinir senhas." });
      return;
    }
    if (!passwordForm.userId || !passwordForm.password) {
      setNotice({ tone: "error", message: "Selecione um usuario e informe a nova senha." });
      return;
    }
    if (!isPasswordValid(passwordForm.password)) {
      setNotice({ tone: "error", message: "A senha deve ter no minimo 8 caracteres, 1 letra e 1 numero." });
      return;
    }
    try {
      await resetUserPassword(passwordForm.userId, passwordForm);
      setPasswordForm({ userId: "", password: "", mustChangePassword: true });
      setLastTemporaryPassword(null);
      setNotice({
        tone: "success",
        message: passwordForm.mustChangePassword
          ? `Senha alterada com sucesso. ${user?.name ?? "Usuário"} deverá trocar a senha no próximo login.`
          : "Senha alterada com sucesso."
      });
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Falha ao redefinir senha." });
    }
  }

  function generateTemporaryPassword() {
    const password = temporaryPassword();
    setPasswordForm({ ...passwordForm, password, mustChangePassword: true });
    setLastTemporaryPassword(password);
    setNotice({
      tone: "warning",
      message: "Senha temporária gerada visualmente. Clique em Aplicar nova senha para salvar no banco."
    });
  }

  async function changePassword() {
    if (!ownPassword.currentPassword || !ownPassword.newPassword) {
      setNotice({ tone: "error", message: "Informe a senha atual e a nova senha." });
      return;
    }
    if (!isPasswordValid(ownPassword.newPassword)) {
      setNotice({ tone: "error", message: "A nova senha deve ter no minimo 8 caracteres, 1 letra e 1 numero." });
      return;
    }
    if (!ownPasswordsMatch) {
      setNotice({ tone: "error", message: "As senhas nao conferem." });
      return;
    }
    try {
      await changeOwnPassword({ currentPassword: ownPassword.currentPassword, newPassword: ownPassword.newPassword });
      setOwnPassword({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setNotice({ tone: "success", message: "Senha alterada com sucesso." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Falha ao alterar sua senha." });
    }
  }

  async function saveUserPermission(user: AppUser, menuId: string, action: PermissionAction, checked: boolean) {
    if (!canAdminUsers) {
      setNotice({ tone: "error", message: "Voce nao possui permissao para editar permissoes." });
      return;
    }

    const next = clonePermissions(user.modulePermissions);
    const current = normalizeModulePermission(next[menuId]);
    next[menuId] = normalizeModulePermission({ ...current, [action]: checked } as Partial<ModulePermission>);

    try {
      await updateUserMenuPermissions(user.id, next);
      setNotice({ tone: "success", message: `Permissoes de ${user.name} atualizadas.` });
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao atualizar permissoes do usuario." });
    }
  }

  async function loadSessions() {
    if (sessionUser?.role !== "ADMIN") return;
    setSessionsLoading(true);
    try {
      const data = await getActiveSessions();
      setSessions(data);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao carregar sessoes ativas." });
    } finally {
      setSessionsLoading(false);
    }
  }

  async function handleKillSession(userId: string, userName: string) {
    try {
      await killUserSession(userId);
      setNotice({ tone: "success", message: `Sessao de ${userName} encerrada.` });
      await loadSessions();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao encerrar sessao." });
    }
  }

  function formatRelative(dateStr: string | null) {
    if (!dateStr) return "—";
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "agora";
    if (minutes < 60) return `${minutes} min atrás`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h atrás`;
    return `${Math.floor(hours / 24)}d atrás`;
  }

  function simplifyUserAgent(ua: string | null) {
    if (!ua) return "—";
    if (/mobile|android/i.test(ua)) return "Mobile";
    if (/chrome/i.test(ua)) return "Chrome";
    if (/firefox/i.test(ua)) return "Firefox";
    if (/safari/i.test(ua)) return "Safari";
    if (/edge/i.test(ua)) return "Edge";
    return "Navegador";
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!selectedUser) {
      setEditor({ id: "", name: "", email: "", role: "VISUALIZACAO", isActive: true, mustChangePassword: false });
      return;
    }
    setEditor({
      id: selectedUser.id,
      name: selectedUser.name,
      email: selectedUser.email,
      role: selectedUser.role,
      isActive: Boolean(selectedUser.isActive),
      mustChangePassword: Boolean(selectedUser.mustChangePassword)
    });
  }, [selectedUser]);

  const groupedMenus = useMemo(() => menus.reduce<Array<{ group: string; rows: MenuDefinition[] }>>((acc, menu) => {
    const group = acc.find((item) => item.group === menu.group);
    if (group) group.rows.push(menu);
    else acc.push({ group: menu.group, rows: [menu] });
    return acc;
  }, []), [menus]);

  const selectedUserPermissionSummary = useMemo(() => {
    if (!selectedUser) return [];
    return menus
      .map((menu) => ({
        id: menu.id,
        label: menu.label,
        actions: permissionLabels(selectedUser.modulePermissions?.[menu.id])
      }))
      .filter((item) => item.actions.length > 0);
  }, [menus, selectedUser]);

  return (
    <div className="stack">
      <Notice notice={notice} />

      {!canAdminUsers && (
        <section className="panel">
          <div className="alert warning">
            Voce tem acesso de visualizacao ao modulo de usuarios, mas nao pode criar usuarios nem alterar permissoes.
          </div>
        </section>
      )}

      <section className="panel">
        <div className="section-heading"><div><p>Seguranca</p><h2>Usuarios e permissoes</h2></div></div>
        <div className="alert">
          Cadastre um novo usuario aqui. Depois selecione o usuario na lista para editar nome, email, perfil base, status e permissoes por modulo/acao.
        </div>
        <div className="form-grid">
          <label>Nome<input value={form.name} disabled={!canAdminUsers} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>Email<input value={form.email} disabled={!canAdminUsers} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
          <PasswordField label="Senha inicial" value={form.password} onChange={(password) => setForm({ ...form, password })} disabled={!canAdminUsers} />
          <PasswordField label="Confirmar senha" value={form.confirmPassword} onChange={(confirmPassword) => setForm({ ...form, confirmPassword })} disabled={!canAdminUsers} />
          <label>Perfil base<select value={form.role} disabled={!canAdminUsers} onChange={(event) => setForm({ ...form, role: event.target.value as UserRole })}>{roles.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
          <button className="primary-button" type="button" disabled={!canAdminUsers} onClick={submit}>Cadastrar usuario</button>
        </div>
        <div className={`password-hint ${isPasswordValid(form.password) ? "ok" : "error"}`}>{passwordPolicyMessage(form.password)}</div>
        <div className={`password-hint ${createPasswordsMatch ? "ok" : "error"}`}>
          {createPasswordsMatch ? "Senhas iguais." : "Senhas diferentes."}
        </div>
      </section>

      <section className="panel">
        <div className="section-heading"><div><p>Senha</p><h2>Redefinir senha de usuario</h2></div><KeyRound size={22} /></div>
        <div className="form-grid">
          <label>Usuário<select value={passwordForm.userId} disabled={!canAdminUsers} onChange={(event) => setPasswordForm({ ...passwordForm, userId: event.target.value })}><option value="">Selecione</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
          <PasswordField label="Nova senha" value={passwordForm.password} onChange={(password) => { setLastTemporaryPassword(null); setPasswordForm({ ...passwordForm, password }); }} disabled={!canAdminUsers} />
          <label className="checkbox-label"><input type="checkbox" checked={passwordForm.mustChangePassword} disabled={!canAdminUsers} onChange={(event) => setPasswordForm({ ...passwordForm, mustChangePassword: event.target.checked })} />Obrigar troca no proximo login</label>
          <button className="secondary-button" type="button" disabled={!canAdminUsers} onClick={generateTemporaryPassword}>Gerar senha temporaria</button>
          <button className="primary-button" type="button" disabled={!canAdminUsers} onClick={resetPassword}>Aplicar nova senha</button>
        </div>
        <div className={`password-hint ${isPasswordValid(passwordForm.password) ? "ok" : "error"}`}>{passwordPolicyMessage(passwordForm.password)}</div>
        {lastTemporaryPassword && (
          <div className="alert warning">
            Senha temporaria gerada: <strong>{lastTemporaryPassword}</strong>. Ela ainda nao foi salva. Clique em Aplicar nova senha.
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-heading"><div><p>Minha conta</p><h2>Alterar minha senha</h2></div></div>
        <div className="form-grid">
          <PasswordField label="Senha atual" value={ownPassword.currentPassword} onChange={(currentPassword) => setOwnPassword({ ...ownPassword, currentPassword })} />
          <PasswordField label="Nova senha" value={ownPassword.newPassword} onChange={(newPassword) => setOwnPassword({ ...ownPassword, newPassword })} />
          <PasswordField label="Confirmar nova senha" value={ownPassword.confirmPassword} onChange={(confirmPassword) => setOwnPassword({ ...ownPassword, confirmPassword })} />
          <button className="primary-button" type="button" onClick={changePassword}>Alterar minha senha</button>
        </div>
        <div className={`password-hint ${isPasswordValid(ownPassword.newPassword) ? "ok" : "error"}`}>{passwordPolicyMessage(ownPassword.newPassword)}</div>
        <div className={`password-hint ${ownPasswordsMatch ? "ok" : "error"}`}>
          {ownPasswordsMatch ? "Senhas iguais." : "Senhas diferentes."}
        </div>
      </section>

      <section className="panel">
        <div className="section-heading"><div><p>Lista</p><h2>Usuários</h2></div><button className="icon-button" type="button" onClick={load} aria-label="Atualizar"><RefreshCw size={18} /></button></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Status</th><th>Nome</th><th>Email</th><th>Perfil base</th><th>Troca senha</th><th>Última troca senha</th><th>Último login</th><th>Ações</th></tr></thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className={selectedUserId === user.id ? "is-selected-row" : ""}>
                  <td>{user.isActive ? "Ativo" : "Inativo"}</td>
                  <td><button type="button" className="link-button" onClick={() => setSelectedUserId(user.id)}>{user.name}</button></td>
                  <td>{user.email}</td>
                  <td>{user.role}</td>
                  <td>{user.mustChangePassword ? "Obrigatória" : "Não"}</td>
                  <td>{formatDate(user.passwordChangedAt ?? null)}</td>
                  <td>{formatDate(user.lastLoginAt ?? null)}</td>
                  <td><button type="button" onClick={() => setSelectedUserId(user.id)}>{selectedUserId === user.id ? "Selecionado" : "Selecionar"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {sessionUser?.role === "ADMIN" && (
        <section className="panel">
          <div className="section-heading">
            <div><p>Seguranca</p><h2>Sessoes ativas</h2></div>
            <button className="icon-button" type="button" onClick={loadSessions} aria-label="Atualizar sessoes">
              {sessionsLoading ? <RefreshCw size={18} style={{ animation: "spin 1s linear infinite" }} /> : <Monitor size={18} />}
            </button>
          </div>
          {sessions.length === 0 ? (
            <div className="alert">
              Clique no botao para carregar as sessoes ativas. Cada sessao tem inatividade maxima de 8 horas.
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Perfil</th>
                    <th>IP</th>
                    <th>Dispositivo</th>
                    <th>Ultima atividade</th>
                    <th>Inicio da sessao</th>
                    <th>Acao</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.sessionId}>
                      <td>
                        <strong>{s.userName}</strong>
                        <br />
                        <small>{s.userEmail}</small>
                      </td>
                      <td>{s.userRole}</td>
                      <td>{s.ipAddress ?? "—"}</td>
                      <td>{simplifyUserAgent(s.userAgent)}</td>
                      <td>{formatRelative(s.lastActivityAt ?? s.createdAt)}</td>
                      <td>{formatRelative(s.createdAt)}</td>
                      <td>
                        <button
                          type="button"
                          style={{ color: "var(--danger, #c0392b)" }}
                          onClick={() => handleKillSession(s.userId, s.userName)}
                          title="Encerrar sessao"
                        >
                          <ShieldOff size={15} style={{ verticalAlign: "middle", marginRight: 4 }} />
                          Encerrar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {selectedUser && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p>Edição do usuário</p>
              <h2>{selectedUser.name}</h2>
            </div>
          </div>
          <div className="form-grid">
            <label>Nome<input value={editor.name} disabled={!canAdminUsers} onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></label>
            <label>Email<input value={editor.email} disabled={!canAdminUsers} onChange={(event) => setEditor({ ...editor, email: event.target.value })} /></label>
            <label>
              Perfil base
              <select
                value={editor.role}
                disabled={!canAdminUsers || !canManageSelectedUserAccess}
                onChange={(event) => setEditor({ ...editor, role: event.target.value as UserRole })}
              >
                {roles.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={editor.isActive} disabled={!canAdminUsers} onChange={(event) => setEditor({ ...editor, isActive: event.target.checked })} />
              Usuário ativo
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={editor.mustChangePassword}
                disabled={!canAdminUsers}
                onChange={(event) => setEditor({ ...editor, mustChangePassword: event.target.checked })}
              />
              Obrigar troca de senha no próximo login
            </label>
            <button className="primary-button" type="button" disabled={!canAdminUsers} onClick={saveSelectedUser}>Salvar cadastro</button>
          </div>
          <div className="alert">
            O perfil base continua existindo para compatibilidade, mas as permissões abaixo definem o acesso efetivo por módulo.
          </div>
          {!canManageSelectedUserAccess && selectedUser.id === sessionUser?.id && sessionUser?.role !== "ADMIN" && (
            <div className="alert warning">
              Você pode editar seus dados básicos, mas não pode alterar o próprio perfil base nem as próprias permissões.
            </div>
          )}
          <div className="subsection">
            <h3>Permissões efetivas atuais</h3>
            {selectedUserPermissionSummary.length === 0 ? (
              <div className="alert warning">Este usuário não possui permissões efetivas em nenhum módulo.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Módulo</th><th>Ações permitidas</th></tr>
                  </thead>
                  <tbody>
                    {selectedUserPermissionSummary.map((item) => (
                      <tr key={item.id}>
                        <td>{item.label}</td>
                        <td>{item.actions.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {groupedMenus.map((group) => (
            <div className="subsection" key={group.group}>
              <h3>{group.group}</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Módulo</th>
                      {actionColumns.map((column) => <th key={column.action}>{column.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((menu) => {
                      const permission = normalizeModulePermission(selectedUser.modulePermissions?.[menu.id]);
                      return (
                        <tr key={menu.id}>
                          <td>{menu.label}</td>
                          {actionColumns.map((column) => (
                            <td key={column.action}>
                              <input
                                type="checkbox"
                                checked={permission[column.action]}
                                disabled={!canManageSelectedUserAccess || selectedUser.role === "ADMIN"}
                                onChange={(event) => saveUserPermission(selectedUser, menu.id, column.action, event.target.checked)}
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {selectedUser.role === "ADMIN" && (
            <div className="alert warning">
              O usuario ADMIN sempre possui acesso total. As permissoes individuais dele nao podem ser reduzidas nesta tela.
            </div>
          )}
          {canAdminUsers && selectedUser.role !== "ADMIN" && (
            <div className="subsection">
              <button type="button" onClick={() => toggle(selectedUser)}>
                {selectedUser.isActive ? "Inativar usuario selecionado" : "Reativar usuario selecionado"}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
