import { useCallback, useEffect, useRef, useState } from "react";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "wheel", "touchstart"] as const;
const TICK_MS = 1000;
const HEARTBEAT_MS = 3 * 60 * 1000;

type Options = {
  enabled: boolean;
  timeoutMs: number;
  warningMs: number;
  onTimeout: () => void;
  // Avisa o servidor que o usuário continua ativo (a sessão só enxerga requisições).
  onHeartbeat?: () => void;
  // Chave do localStorage que compartilha a última atividade entre abas com o mesmo token.
  sharedActivityKey?: string | null;
};

const SHARED_ACTIVITY_PREFIX = "pateo_last_activity:";
const SHARED_ACTIVITY_MAX_AGE_MS = 12 * 60 * 60 * 1000; // teto absoluto da sessão no servidor

// Abas fechadas sem "Sair" deixam a chave para trás; apaga as que já passaram do teto da sessão.
export function pruneStaleSharedActivity() {
  try {
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(SHARED_ACTIVITY_PREFIX)
        && Date.now() - (Number(window.localStorage.getItem(key)) || 0) > SHARED_ACTIVITY_MAX_AGE_MS) {
        stale.push(key);
      }
    }
    stale.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // localStorage indisponível: nada a limpar.
  }
}

function readSharedActivity(key: string | null | undefined) {
  if (!key) return 0;
  try {
    return Number(window.localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

function writeSharedActivity(key: string | null | undefined, value: number) {
  if (!key) return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // localStorage indisponível: cada aba conta o próprio tempo.
  }
}

// Conta o tempo sem mouse, teclado, rolagem ou toque. Usa o relógio (Date.now) em vez de
// somar ticks, para que aba em segundo plano ou computador suspenso derrubem no prazo certo.
export function useIdleLogout({ enabled, timeoutMs, warningMs, onTimeout, onHeartbeat, sharedActivityKey }: Options) {
  const lastActivityRef = useRef(Date.now());
  const lastHeartbeatRef = useRef(Date.now());
  const onTimeoutRef = useRef(onTimeout);
  const onHeartbeatRef = useRef(onHeartbeat);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  // Com o aviso aberto, mouse e teclado não reiniciam o contador: só o botão (stayActive)
  // ou atividade de outra aba com a mesma sessão. Senão o aviso sumiria ao mover o mouse.
  const warningOpenRef = useRef(false);

  useEffect(() => {
    onTimeoutRef.current = onTimeout;
    onHeartbeatRef.current = onHeartbeat;
  });

  const stayActive = useCallback(() => {
    lastActivityRef.current = Date.now();
    writeSharedActivity(sharedActivityKey, lastActivityRef.current);
    warningOpenRef.current = false;
    setSecondsLeft(null);
  }, [sharedActivityKey]);

  useEffect(() => {
    if (!enabled) return;
    lastActivityRef.current = Date.now();
    lastHeartbeatRef.current = Date.now();
    pruneStaleSharedActivity();

    const markActivity = () => {
      if (warningOpenRef.current) return;
      const now = Date.now();
      // Grava no localStorage no máximo 1x por segundo; mousemove dispara dezenas de vezes.
      if (now - lastActivityRef.current >= TICK_MS) writeSharedActivity(sharedActivityKey, now);
      lastActivityRef.current = now;
    };
    writeSharedActivity(sharedActivityKey, lastActivityRef.current);
    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, markActivity, { passive: true }));

    const timer = window.setInterval(() => {
      const now = Date.now();
      const lastActivity = Math.max(lastActivityRef.current, readSharedActivity(sharedActivityKey));
      const idle = now - lastActivity;
      if (idle >= timeoutMs) {
        window.clearInterval(timer);
        onTimeoutRef.current();
        return;
      }
      const remaining = timeoutMs - idle;
      warningOpenRef.current = remaining <= warningMs;
      setSecondsLeft(warningOpenRef.current ? Math.ceil(remaining / 1000) : null);
      if (idle < HEARTBEAT_MS && now - lastHeartbeatRef.current >= HEARTBEAT_MS) {
        lastHeartbeatRef.current = now;
        onHeartbeatRef.current?.();
      }
    }, TICK_MS);

    return () => {
      window.clearInterval(timer);
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, markActivity));
    };
  }, [enabled, timeoutMs, warningMs, sharedActivityKey]);

  return { secondsLeft, stayActive };
}
