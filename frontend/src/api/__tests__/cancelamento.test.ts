import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getAnaliseMetas } from "../client";

// O signal que a tela passa (trocar de período, de aba, sair) tem que cancelar a requisição de verdade.
const originalFetch = globalThis.fetch;
let chamadas: Array<{ url: string; signal: AbortSignal | null | undefined }> = [];

// Resposta que nunca chega, a menos que o fetch seja abortado (como o fetch real faz).
function fetchPendente() {
  return vi.fn((url: string, init?: RequestInit) => {
    chamadas.push({ url, signal: init?.signal });
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new DOMException("abortado", "AbortError")), { once: true });
    });
  });
}

beforeEach(() => {
  chamadas = [];
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("cancelamento de requisicao", () => {
  test("abortar o signal da tela aborta o fetch (a consulta pesada nao continua no servidor)", async () => {
    globalThis.fetch = fetchPendente() as unknown as typeof fetch;
    const controle = new AbortController();
    const promessa = getAnaliseMetas(2026, 10, controle.signal);
    const resultado = promessa.then(() => "ok", (e: unknown) => e);
    await Promise.resolve();
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].signal?.aborted).toBe(false);
    controle.abort();
    const erro = await resultado;
    expect(chamadas[0].signal?.aborted).toBe(true);
    expect((erro as DOMException).name).toBe("AbortError");
  });

  test("cancelada pela tela: nao tenta o segundo endereco e nao vira mensagem de 'demorou demais'", async () => {
    globalThis.fetch = fetchPendente() as unknown as typeof fetch;
    const controle = new AbortController();
    const resultado = getAnaliseMetas(2026, 10, controle.signal).then(() => "ok", (e: unknown) => e);
    await Promise.resolve();
    controle.abort();
    const erro = (await resultado) as Error;
    expect(chamadas).toHaveLength(1);
    expect(erro.message).not.toMatch(/demor|tempo|timeout/i);
  });

  test("signal ja abortado antes de chamar: nem chega a pedir", async () => {
    globalThis.fetch = fetchPendente() as unknown as typeof fetch;
    const controle = new AbortController();
    controle.abort();
    const erro = (await getAnaliseMetas(2026, 10, controle.signal).then(() => "ok", (e: unknown) => e)) as Error;
    expect(chamadas).toHaveLength(0);
    expect(erro.name).toBe("AbortError");
  });

  test("sem cancelamento a resposta chega normalmente", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    const controle = new AbortController();
    await expect(getAnaliseMetas(2026, 10, controle.signal)).resolves.toEqual({ ok: true });
  });

  test("sem signal nenhum (chamada comum) continua funcionando", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    await expect(getAnaliseMetas(2026, 10)).resolves.toEqual({ ok: true });
  });
});
