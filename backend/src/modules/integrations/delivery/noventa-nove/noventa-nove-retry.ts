import { NoventaNoveApiException } from "./noventa-nove-http-client.js";

// Retry com backoff para as chamadas da 99 Food.
//
// O sync diário roda às 04:00 e ninguém assiste: um rate limit ou um 503
// passageiro derrubava a loja inteira até a rodada do dia seguinte. Aqui só se
// repete o que é passageiro — rate limit, 5xx e falha de rede/timeout. Erro de
// autenticação ou de negócio (data inválida, loja não autorizada) sobe na hora,
// porque repetir não muda a resposta e só gasta a cota da 99.

// A 99 aceita 1 chamada por janela de 20s; esperar menos que isso só renova o bloqueio.
const RATE_LIMIT_WINDOW_MS = 20_000;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;
const DEFAULT_ATTEMPTS = 4;

export function ehErroTransitorio(error: unknown): boolean {
  if (error instanceof NoventaNoveApiException) {
    if (error.info.isAuthError) return false;
    // errno 10001 = "erro interno da plataforma", que a 99 manda com HTTP 200.
    return error.info.isRateLimit || error.info.status >= 500 || error.info.errno === 10001;
  }
  if (error instanceof Error) {
    // fetch lança TypeError("fetch failed") em falha de DNS/conexão; o timeout aborta o controller.
    // Outro TypeError é bug de código: repetir só atrasaria o erro e gastaria a cota da 99.
    return error.name === "AbortError" || (error instanceof TypeError && error.message === "fetch failed");
  }
  return false;
}

// `tentativa` é a que acabou de falhar (1 = a primeira).
export function esperaDoRetry(error: unknown, tentativa: number): number {
  const exponencial = Math.min(BACKOFF_BASE_MS * 2 ** (tentativa - 1), BACKOFF_MAX_MS);
  const rateLimit = error instanceof NoventaNoveApiException && error.info.isRateLimit;
  // +1s de folga sobre a janela da 99 para não cair na borda dela.
  return rateLimit ? Math.max(exponencial, RATE_LIMIT_WINDOW_MS + 1_000) : exponencial;
}

export type PoliticaDeRetry = {
  tentativas?: number;
  // Teto da espera entre tentativas. Sem ele vale o backoff completo (até 60s).
  esperaMaxMs?: number;
};

// Sync disparado por uma pessoa na tela: a requisição HTTP fica aberta até o fim e proxies cortam em ~100s.
// Melhor falhar rápido e deixar a pessoa tentar de novo do que esperar minutos. O cron das 04:00 usa o padrão.
export const RETRY_INTERATIVO: Required<PoliticaDeRetry> = { tentativas: 2, esperaMaxMs: 3_000 };

type RetryOptions = PoliticaDeRetry & {
  dormir?: (ms: number) => Promise<void>;
  aoRepetir?: (error: unknown, tentativa: number, esperaMs: number) => void;
};

const dormirDeVerdade = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function comRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const tentativas = options.tentativas ?? DEFAULT_ATTEMPTS;
  const dormir = options.dormir ?? dormirDeVerdade;
  for (let tentativa = 1; ; tentativa += 1) {
    try {
      return await fn();
    } catch (error: unknown) {
      if (tentativa >= tentativas || !ehErroTransitorio(error)) throw error;
      const espera = Math.min(esperaDoRetry(error, tentativa), options.esperaMaxMs ?? Infinity);
      options.aoRepetir?.(error, tentativa, espera);
      await dormir(espera);
    }
  }
}
