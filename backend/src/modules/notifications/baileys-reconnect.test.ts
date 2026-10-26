import { describe, expect, it } from "vitest";
import {
  RECONNECT_BASE_MS,
  RECONNECT_MAX_ATTEMPTS,
  RECONNECT_MAX_MS,
  computeBackoffMs,
  decideReconnect
} from "./baileys-reconnect.js";

describe("computeBackoffMs", () => {
  it("dobra a cada tentativa a partir da base", () => {
    expect(computeBackoffMs(1)).toBe(RECONNECT_BASE_MS);
    expect(computeBackoffMs(2)).toBe(RECONNECT_BASE_MS * 2);
    expect(computeBackoffMs(3)).toBe(RECONNECT_BASE_MS * 4);
  });

  it("nunca passa do teto", () => {
    expect(computeBackoffMs(30)).toBe(RECONNECT_MAX_MS);
  });
});

describe("decideReconnect", () => {
  it("tenta de novo com backoff crescente em 405", () => {
    const first = decideReconnect(405, 0);
    const second = decideReconnect(405, 1);
    expect(first).toEqual({ action: "retry", delayMs: RECONNECT_BASE_MS, attempt: 1 });
    expect(second).toMatchObject({ action: "retry", attempt: 2, delayMs: RECONNECT_BASE_MS * 2 });
  });

  it("para ao esgotar o limite de tentativas", () => {
    const last = decideReconnect(405, RECONNECT_MAX_ATTEMPTS - 1);
    expect(last.action).toBe("retry");
    const over = decideReconnect(405, RECONNECT_MAX_ATTEMPTS);
    expect(over.action).toBe("stop");
  });

  it("para imediatamente em erro terminal", () => {
    expect(decideReconnect(403, 0).action).toBe("stop");
    expect(decideReconnect(411, 0).action).toBe("stop");
  });

  it("trata código desconhecido como tentável", () => {
    expect(decideReconnect(undefined, 0).action).toBe("retry");
  });
});
