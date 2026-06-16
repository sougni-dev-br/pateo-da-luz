import { Loader2, LogIn, ShieldAlert } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { API_BASE_URL, ApiError, AppUser, BACKEND_TARGET_URL, checkBackendHealth, login } from "../api/client";
import { PasswordField } from "../components/PasswordField";

const logoPath = "/logo-pateo-luz.png";

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

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={handleSubmit} autoComplete="off">
        <img src={logoPath} alt="Pateo da Luz" />
        <div>
          <p>Pateo da Luz</p>
          <h1>Gestão Eficiente</h1>
        </div>
        <div className={`alert ${backendOnline === false ? "error" : "success"}`}>
          <strong>Backend:</strong>{" "}
          {backendOnline === null ? "VERIFICANDO" : backendOnline ? "ONLINE" : "OFFLINE"}
          <br />
          <small>API: {API_BASE_URL}</small>
          <br />
          <small>Backend alvo: {BACKEND_TARGET_URL}</small>
        </div>
        <label>
          Email
          <input name="pateo-login-email" value={email} autoComplete="off" onChange={(event) => { setEmail(event.target.value); setSessionConflict(null); }} />
        </label>
        <PasswordField label="Senha" value={password} onChange={(v) => { setPassword(v); setSessionConflict(null); }} autoComplete="new-password" />
        <button className="primary-button" type="submit" disabled={loading}>
          {loading ? <Loader2 size={18} /> : <LogIn size={18} />}
          Entrar
        </button>
        {error && (
          <div className="alert error">
            {sessionConflict ? <ShieldAlert size={16} style={{ flexShrink: 0 }} /> : null}
            {error}
          </div>
        )}
        {sessionConflict?.canForce && (
          <button
            className="primary-button"
            type="button"
            disabled={loading}
            style={{ background: "var(--danger, #c0392b)" }}
            onClick={(e) => handleSubmit(e as unknown as FormEvent, true)}
          >
            {loading ? <Loader2 size={18} /> : <ShieldAlert size={18} />}
            Encerrar sessão anterior e entrar
          </button>
        )}
        <small>V1 local</small>
      </form>
    </main>
  );
}
