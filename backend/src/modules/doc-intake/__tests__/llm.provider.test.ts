import { afterEach, describe, expect, test, vi } from "vitest";
import { GeminiProvider, LlmRequestError } from "../llm.provider.js";

function respostaOk(texto: string, tokens = 100) {
  return {
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: texto }] } }],
      usageMetadata: { totalTokenCount: tokens },
    }),
  };
}

function respostaErro(status: number, corpo = "erro") {
  return { ok: false, status, text: async () => corpo };
}

function novoProvider(modelos = ["modelo-a", "modelo-b"]) {
  // backoff 0: o teste nao precisa dormir os 4,5s reais.
  return new GeminiProvider("chave-de-teste", modelos, 5_000, 0);
}

const PEDIDO = { prompt: "extraia", schema: { type: "OBJECT" } };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GeminiProvider", () => {
  test("devolve o JSON quando a primeira chamada funciona", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respostaOk('{"valorTotal":"209,00"}')));

    const resultado = await novoProvider().generateJson<{ valorTotal: string }>(PEDIDO);

    expect(resultado.data.valorTotal).toBe("209,00");
    expect(resultado.model).toBe("modelo-a");
    expect(resultado.tokensUsed).toBe(100);
  });

  test("insiste no mesmo modelo quando o erro e transitorio", async () => {
    // 503 "high demand" aconteceu de verdade no primeiro teste com nota real.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(respostaErro(503, "high demand"))
      .mockResolvedValueOnce(respostaOk('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await novoProvider().generateJson(PEDIDO);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(resultado.model).toBe("modelo-a");
  });

  test("cai para o modelo reserva quando o primeiro esgota as tentativas", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(String(url).includes("modelo-a")
        ? respostaErro(503, "high demand")
        : respostaOk('{"ok":true}'))
    );
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await novoProvider().generateJson(PEDIDO);

    expect(resultado.model).toBe("modelo-b");
    expect(fetchMock).toHaveBeenCalledTimes(4); // 3 no modelo-a + 1 no modelo-b
  });

  test("falha na hora em erro definitivo, sem gastar tentativa nem trocar de modelo", async () => {
    // 404/400 nao melhoram com insistencia — ficar tentando so atrasa o usuario.
    const fetchMock = vi.fn().mockResolvedValue(respostaErro(404, "model not found"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(novoProvider().generateJson(PEDIDO)).rejects.toBeInstanceOf(LlmRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("propaga o erro quando todos os modelos falham", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respostaErro(503, "high demand")));

    await expect(novoProvider().generateJson(PEDIDO)).rejects.toThrow(/503/);
  });

  test("trata resposta vazia como falha, em vez de devolver documento em branco", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respostaOk("   ")));

    await expect(novoProvider(["so-um"]).generateJson(PEDIDO)).rejects.toThrow(/vazia/);
  });

  test("nao coloca a chave na URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaOk('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);

    await novoProvider().generateJson(PEDIDO);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain("chave-de-teste");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("chave-de-teste");
  });
});
