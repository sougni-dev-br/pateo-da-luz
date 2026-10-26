import { describe, expect, test, vi } from "vitest";
import { NoventaNoveApiException } from "../noventa-nove-http-client.js";
import { comRetry, ehErroTransitorio, esperaDoRetry, RETRY_INTERATIVO } from "../noventa-nove-retry.js";

function erroApi(parcial: Partial<ConstructorParameters<typeof NoventaNoveApiException>[0]>): NoventaNoveApiException {
  return new NoventaNoveApiException({
    status: 200,
    errno: null,
    message: "erro",
    detail: null,
    isAuthError: false,
    isRateLimit: false,
    ...parcial
  });
}

describe("ehErroTransitorio", () => {
  test("rate limit é transitório", () => {
    expect(ehErroTransitorio(erroApi({ isRateLimit: true }))).toBe(true);
  });

  test("5xx da 99 é transitório", () => {
    expect(ehErroTransitorio(erroApi({ status: 503 }))).toBe(true);
  });

  test("falha de rede e timeout são transitórios", () => {
    expect(ehErroTransitorio(new TypeError("fetch failed"))).toBe(true);
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(ehErroTransitorio(abort)).toBe(true);
  });

  test("TypeError que não é de rede (bug de código) não repete", () => {
    expect(ehErroTransitorio(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false);
  });

  test("errno 10001 (erro interno da 99, HTTP 200) é transitório", () => {
    expect(ehErroTransitorio(erroApi({ errno: 10001 }))).toBe(true);
  });

  test("autenticação e erro de negócio não repetem", () => {
    expect(ehErroTransitorio(erroApi({ isAuthError: true, status: 401 }))).toBe(false);
    expect(ehErroTransitorio(erroApi({ status: 400, errno: 110005 }))).toBe(false);
    expect(ehErroTransitorio(new Error("outra coisa"))).toBe(false);
  });
});

describe("esperaDoRetry", () => {
  test("rate limit espera ao menos a janela de 20s da 99", () => {
    expect(esperaDoRetry(erroApi({ isRateLimit: true }), 1)).toBeGreaterThanOrEqual(20_000);
  });

  test("falha transitória comum cresce de forma exponencial", () => {
    const e = erroApi({ status: 502 });
    expect(esperaDoRetry(e, 2)).toBeGreaterThan(esperaDoRetry(e, 1));
  });
});

describe("comRetry", () => {
  test("devolve o resultado sem esperar quando dá certo de primeira", async () => {
    const dormir = vi.fn(async () => undefined);
    const resultado = await comRetry(async () => "ok", { dormir });
    expect(resultado).toBe("ok");
    expect(dormir).not.toHaveBeenCalled();
  });

  test("repete após rate limit e devolve o resultado da tentativa que passou", async () => {
    const dormir = vi.fn(async () => undefined);
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(erroApi({ isRateLimit: true }))
      .mockResolvedValueOnce("depois");
    await expect(comRetry(fn, { dormir })).resolves.toBe("depois");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(dormir).toHaveBeenCalledTimes(1);
    expect(dormir.mock.calls[0][0]).toBeGreaterThanOrEqual(20_000);
  });

  test("desiste depois do máximo de tentativas e lança o último erro", async () => {
    const dormir = vi.fn(async () => undefined);
    const ultimo = erroApi({ status: 503, message: "ultimo" });
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(ultimo);
    await expect(comRetry(fn, { dormir, tentativas: 3 })).rejects.toBe(ultimo);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(dormir).toHaveBeenCalledTimes(2);
  });

  test("erro não transitório sobe na hora, sem repetir", async () => {
    const dormir = vi.fn(async () => undefined);
    const auth = erroApi({ isAuthError: true, status: 401 });
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(auth);
    await expect(comRetry(fn, { dormir })).rejects.toBe(auth);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(dormir).not.toHaveBeenCalled();
  });
});

describe("política interativa (sync manual pela tela)", () => {
  test("poucas tentativas e espera curta: uma tela não pode esperar minutos", () => {
    expect(RETRY_INTERATIVO.tentativas).toBeLessThanOrEqual(2);
    expect(RETRY_INTERATIVO.esperaMaxMs).toBeLessThanOrEqual(5_000);
  });

  test("esperaMaxMs limita até a espera de rate limit (que sozinha seria de 21s)", async () => {
    const dormir = vi.fn(async () => undefined);
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(erroApi({ isRateLimit: true }))
      .mockResolvedValueOnce("ok");
    await comRetry(fn, { dormir, esperaMaxMs: 3_000 });
    expect(dormir).toHaveBeenCalledWith(3_000);
  });

  test("com a política interativa, desiste na 2ª falha", async () => {
    const dormir = vi.fn(async () => undefined);
    const erro = erroApi({ isRateLimit: true });
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(erro);
    await expect(comRetry(fn, { dormir, ...RETRY_INTERATIVO })).rejects.toBe(erro);
    expect(fn).toHaveBeenCalledTimes(RETRY_INTERATIVO.tentativas);
  });
});
