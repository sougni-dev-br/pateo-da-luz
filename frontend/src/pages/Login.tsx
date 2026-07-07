import { Loader2, LogIn, ShieldAlert } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { API_BASE_URL, ApiError, AppUser, BACKEND_TARGET_URL, checkBackendHealth, login } from "../api/client";
import { PasswordField } from "../components/PasswordField";
import { Alert, Button, LoginShell, TextField } from "../design-system";
import { isLocal, isStaging } from "../utils/env";

export function Login({ onLogin }: { onLogin: (user: AppUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionConflict, setSessionConflict] = useState<{ canForce: boolean } | null>(null);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);

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
    if (backendOnline === null) return null;
    if (backendOnline) {
      return (
        <Alert tone="success" icon={null}>
          Sistema online
        </Alert>
      );
    }
    return (
      <Alert tone="error">
        Não foi possível conectar ao servidor. Verifique sua internet ou chame o responsável.
      </Alert>
    );
  }

  return (
    <LoginShell
      onSubmit={handleSubmit}
      brandName="Pateo da Luz"
      brandTagline="Desde 2003"
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
        value={email}
        autoComplete="off"
        onChange={(event) => {
          setEmail(event.target.value);
          setSessionConflict(null);
        }}
      />
      <PasswordField
        label="Senha"
        value={password}
        onChange={(v) => {
          setPassword(v);
          setSessionConflict(null);
        }}
        autoComplete="new-password"
      />
      <Button
        type="submit"
        disabled={loading}
        leadingIcon={loading ? <Loader2 size={18} className="spin" /> : <LogIn size={18} />}
      >
        Entrar
      </Button>
      {error && (
        <Alert tone="error" icon={sessionConflict ? <ShieldAlert size={16} /> : undefined}>
          {error}
        </Alert>
      )}
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
