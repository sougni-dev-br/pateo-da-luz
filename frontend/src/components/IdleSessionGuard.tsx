import { ApiError, getMe, logout, sessionActivityKey } from "../api/client";
import { useIdleLogout } from "../lib/useIdleLogout";

const DEFAULT_TIMEOUT_MINUTES = 30;
const WARNING_MS = 60 * 1000;

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

type Props = {
  timeoutMinutes?: number;
  onExpired: () => void;
};

// Derruba a sessão após o prazo sem uso e avisa 1 minuto antes. O servidor também
// expira a sessão (com folga), então este componente é a experiência, não a segurança.
export function IdleSessionGuard({ timeoutMinutes, onExpired }: Props) {
  const timeoutMs = (timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES) * 60 * 1000;

  const { secondsLeft, stayActive } = useIdleLogout({
    enabled: true,
    timeoutMs,
    warningMs: WARNING_MS,
    onTimeout: () => {
      void logout("inactivity");
      onExpired();
    },
    sharedActivityKey: sessionActivityKey(),
    // 401 = o servidor já encerrou a sessão (admin a derrubou ou outro login a substituiu).
    onHeartbeat: () => {
      getMe().catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          void logout();
          onExpired();
        }
      });
    }
  });

  if (secondsLeft === null) return null;

  return (
    <div className="idle-guard-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="idle-guard-title">
      <div className="idle-guard-card">
        <h2 id="idle-guard-title">Você ainda está aí?</h2>
        <p>
          Por segurança, sua sessão será encerrada por inatividade em{" "}
          <strong>{formatCountdown(secondsLeft)}</strong>.
        </p>
        <button type="button" className="primary-button" onClick={stayActive} autoFocus>
          Continuar conectado
        </button>
      </div>
    </div>
  );
}
