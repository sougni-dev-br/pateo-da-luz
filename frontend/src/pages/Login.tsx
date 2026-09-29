import { Loader2, LogIn, ShieldAlert } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { API_BASE_URL, ApiError, AppUser, BACKEND_TARGET_URL, checkBackendHealth, login } from "../api/client";
import { PasswordField } from "../components/PasswordField";
import { Alert, Button, LoginShell, TextField } from "../design-system";
import type { LoginStatus } from "../design-system";
import { isLocal, isStaging } from "../utils/env";

export function Login({ onLogin }: { onLogin: (user: AppUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionConflict, setSessionConflict] = useState<{ canForce: boolean } | null>(null);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Senha recusada: devolve o foco à senha, já selecionada, para redigitar sem mouse.
  // Espera o loading cair porque o campo fica desabilitado durante o envio.
  useEffect(() => {
    if (!error || loading || sessionConflict) return;
    // select() sozinho nao foca em todo navegador; o foco vem explicito antes.
    passwordRef.current?.focus();
    passwordRef.current?.select();
  }, [error, loading, sessionConflict]);

  useEffect(() => {
    window.localStorage.removeItem("pateo_login_email");
    window.localStorage.removeItem("pateo_login_password");

    let active = true;

    async function refreshBackendStatus() {
      const online = await checkBackendHealth();
      if (active) setBackendOnline(online);
    }

    refreshBackendStatus();
    const timer = window.setInterval(refreshBackendStatus, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  async function handleSubmit(event: FormEvent, force = false) {
    event.preventDefault();
    setError(null);
    setSessionConflict(null);
    setLoading(true);
    try {
      const result = await login(email, password, { force });
      onLogin(result.user);
    } catch (loginError) {
      if (loginError instanceof ApiError && loginError.status === 409) {
        setSessionConflict({ canForce: Boolean(loginError.body?.canForce) });
        setError(loginError.message);
      } else {
        setError(loginError instanceof Error ? loginError.message : "Erro ao entrar.");
      }
    } finally {
      setLoading(false);
    }
  }

  function renderBackendStatus() {
    if (isLocal) {
      return (
        <Alert tone={backendOnline === false ? "error" : "success"} icon={null}>
          <strong>Backend:</strong>{" "}
          {backendOnline === null ? "VERIFICANDO" : backendOnline ? "ONLINE" : "OFFLINE"}
          <br />
          <small>API: {API_BASE_URL}</small>
          <br />
          <small>Alvo: {BACKEND_TARGET_URL}</small>
        </Alert>
      );
    }
    // Online não ganha alerta: o painel escuro já mostra o indicador. Só o problema interrompe.
    if (backendOnline !== false) return null;
    return (
      <Alert tone="error">
        Não foi possível conectar ao servidor. Verifique sua internet ou chame o responsável.
      </Alert>
    );
  }

  const status: LoginStatus = backendOnline === null ? "checking" : backendOnline ? "online" : "offline";

  return (
    <LoginShell
      onSubmit={handleSubmit}
      brandName="Pateo da Luz"
      brandTagline="Desde 2003"
      status={status}
    >
      {isStaging && (
        <Alert tone="warning" icon={null}>
          Ambiente de testes
        </Alert>
      )}
      {renderBackendStatus()}
      <TextField
        label="Email"
        name="pateo-login-email"
        type="text"
        inputMode="email"
        placeholder="seu@email.com"
        value={email}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        autoFocus
        required
        disabled={loading}
        onChange={(event) => {
          setEmail(event.target.value);
          setError(null);
          setSessionConflict(null);
        }}
      />
      <PasswordField
        label="Senha"
        value={password}
        inputRef={passwordRef}
        required
        warnCapsLock
        disabled={loading}
        onChange={(v) => {
          setPassword(v);
          setError(null);
          setSessionConflict(null);
        }}
        autoComplete="new-password"
      />
      {error && (
        <Alert tone="error" role="alert" icon={sessionConflict ? <ShieldAlert size={16} /> : undefined}>
          {error}
        </Alert>
      )}
      <Button
        type="submit"
        disabled={loading}
        aria-busy={loading}
        leadingIcon={loading ? <Loader2 size={18} className="spin" /> : <LogIn size={18} />}
      >
        {loading ? "Entrando…" : "Entrar"}
      </Button>
      {sessionConflict?.canForce && (
        <Button
          type="button"
          variant="danger"
          disabled={loading}
          leadingIcon={loading ? <Loader2 size={18} className="spin" /> : <ShieldAlert size={18} />}
          onClick={(e) => handleSubmit(e as unknown as FormEvent, true)}
        >
          Encerrar sessão anterior e entrar
        </Button>
      )}
    </LoginShell>
  );
}
