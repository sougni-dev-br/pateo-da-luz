import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EVENTO_SESSAO_EXPIRADA, previewTaxImportXlsx } from "../client";

const originalFetch = globalThis.fetch;
const arquivo = () => new File(["x"], "guias.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

beforeEach(() => { sessionStorage.setItem("pateo_session_token", "token-de-teste"); });
afterEach(() => {
  globalThis.fetch = originalFetch;
  sessionStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("envio da planilha de impostos", () => {
  test("sessão encerrada (401): avisa as telas, apaga o token e falha com a mensagem certa", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ message: "x" }), { status: 401 })) as unknown as typeof fetch;
    const aviso = vi.fn();
    window.addEventListener(EVENTO_SESSAO_EXPIRADA, aviso);
    await expect(previewTaxImportXlsx(arquivo())).rejects.toMatchObject({ status: 401, message: expect.stringMatching(/Sessão encerrada/) });
    window.removeEventListener(EVENTO_SESSAO_EXPIRADA, aviso);
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("pateo_session_token")).toBeNull();
  });

  test("planilha que nunca termina de subir: o prazo corta e a mensagem diz o que fazer", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_ok, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("abortado", "AbortError")), { once: true });
    })) as unknown as typeof fetch;
    const falha = expect(previewTaxImportXlsx(arquivo())).rejects.toThrow(/demorou demais/);
    await vi.advanceTimersByTimeAsync(120_001);
    await falha;
  });

  test("resposta boa devolve a prévia", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ totalRows: 2, rows: [] }), { status: 200 })) as unknown as typeof fetch;
    await expect(previewTaxImportXlsx(arquivo())).resolves.toMatchObject({ totalRows: 2 });
  });
});
