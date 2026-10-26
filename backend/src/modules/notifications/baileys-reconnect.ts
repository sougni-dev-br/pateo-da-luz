// Política de reconexão do Baileys, isolada do socket para ser testável.
// Antes: qualquer desconexão (inclusive 405 "Connection Failure") reconectava a
// cada 5s para sempre, poluindo o log de produção. Agora: backoff exponencial
// com teto, limite de tentativas e parada em erro terminal.

export const RECONNECT_BASE_MS = 5_000;
export const RECONNECT_MAX_MS = 15 * 60_000;
export const RECONNECT_MAX_ATTEMPTS = 8;

// Códigos de DisconnectReason do Baileys que reconectar não resolve:
// 401 loggedOut (tratado à parte: wipe + QR), 403 forbidden, 405 (versão do
// protocolo/cliente rejeitada ou sessão recusada), 411 multideviceMismatch.
// 405 só é terminal depois de esgotar as tentativas, pois pode ser transitório.
const TERMINAL_CODES = new Set([403, 411]);

export type ReconnectDecision =
  | { action: "retry"; delayMs: number; attempt: number }
  | { action: "stop"; reason: string };

export function computeBackoffMs(attempt: number): number {
  const exp = RECONNECT_BASE_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(exp, RECONNECT_MAX_MS);
}

export function decideReconnect(statusCode: number | undefined, failedAttempts: number): ReconnectDecision {
  if (statusCode !== undefined && TERMINAL_CODES.has(statusCode)) {
    return { action: "stop", reason: `erro terminal (${statusCode}) — reconectar não resolve` };
  }
  const attempt = failedAttempts + 1;
  if (attempt > RECONNECT_MAX_ATTEMPTS) {
    return {
      action: "stop",
      reason: `${RECONNECT_MAX_ATTEMPTS} tentativas falharam (último código ${statusCode ?? "?"}) — reconexão automática suspensa`
    };
  }
  return { action: "retry", delayMs: computeBackoffMs(attempt), attempt };
}
