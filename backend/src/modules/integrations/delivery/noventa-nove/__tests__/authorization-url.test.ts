import { describe, expect, test } from "vitest";
import { extractAuthorizationUrl } from "../noventa-nove-http-client.js";

// Resposta REAL de POST /v1/auth/authorizationpage/getUrl colhida contra a API
// de produção em 17/09/2026. O campo `data` é um OBJETO `{ url }` — o código
// original só aceitava string ou array e por isso rejeitava toda resposta
// bem-sucedida da 99 como "formato inesperado".
const DATA_REAL = {
  url: "https://merchant.99app.com/pt-BR/manager/app-authorize?app_id=5764607571057444871&scope=all"
};

describe("extractAuthorizationUrl", () => {
  test("le o formato real da 99: data.url", () => {
    expect(extractAuthorizationUrl(DATA_REAL)).toBe(DATA_REAL.url);
  });

  test("aceita string pura", () => {
    expect(extractAuthorizationUrl("https://x.test/a")).toBe("https://x.test/a");
  });

  test("aceita array de uma url, como o YAML previa", () => {
    expect(extractAuthorizationUrl(["https://x.test/a"])).toBe("https://x.test/a");
  });

  test("devolve null em vez de string vazia quando a url vem vazia", () => {
    expect(extractAuthorizationUrl({ url: "" })).toBeNull();
    expect(extractAuthorizationUrl("")).toBeNull();
    expect(extractAuthorizationUrl([])).toBeNull();
  });

  test("devolve null para formatos que nao carregam url", () => {
    expect(extractAuthorizationUrl(null)).toBeNull();
    expect(extractAuthorizationUrl(undefined)).toBeNull();
    expect(extractAuthorizationUrl(42)).toBeNull();
    expect(extractAuthorizationUrl({ outra: "coisa" })).toBeNull();
  });
});
