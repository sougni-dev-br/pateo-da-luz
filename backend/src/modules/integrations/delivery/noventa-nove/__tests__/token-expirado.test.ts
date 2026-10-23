import { beforeEach, describe, expect, test, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  noventaNoveCredential: { findFirst: vi.fn() },
  noventaNoveShopAuthToken: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() }
}));
vi.mock("../../../../../config/database.js", () => ({ prisma: prismaMock }));

import {
  NoventaNoveApiException,
  callNoventaNoveShop,
  getShopAuthToken,
  isAuthorizationExpired
} from "../noventa-nove-http-client.js";

// Mensagem REAL devolvida pela 99 em 22/10/2026 para as 3 lojas vinculadas em
// 17/09 (token de 30 dias vencido em 17/10): HTTP 200 com errno != 0, que o
// cliente nao classificava como erro de autenticacao e portanto nunca renovava.
const ERRMSG_REAL = "The store authorization information has expired";

function resposta(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}
const expirado = () => resposta({ errno: 10001, errmsg: ERRMSG_REAL });
const tokenOk = (token: string) =>
  resposta({ errno: 0, errmsg: "ok", data: { auth_token: token, token_expiration_time: 2_000_000_000 } });
const refreshOk = () => resposta({ errno: 0, errmsg: "ok", data: {} });

function chamadas(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((c) => new URL(String(c[0])).pathname);
}

beforeEach(() => {
  vi.restoreAllMocks();
  prismaMock.noventaNoveCredential.findFirst.mockResolvedValue({ clientId: "app", clientSecret: "segredo" });
  prismaMock.noventaNoveShopAuthToken.findUnique.mockResolvedValue(null);
  prismaMock.noventaNoveShopAuthToken.upsert.mockResolvedValue({});
  prismaMock.noventaNoveShopAuthToken.deleteMany.mockResolvedValue({ count: 1 });
});

describe("isAuthorizationExpired", () => {
  const erro = (message: string) =>
    new NoventaNoveApiException({
      status: 200, errno: 10001, message, detail: null, isAuthError: false, isRateLimit: false
    });

  test("reconhece a mensagem real da 99", () => {
    expect(isAuthorizationExpired(erro(`99 Food retornou erro: ${ERRMSG_REAL}`))).toBe(true);
  });

  test("nao confunde com loja sem autorizacao nem com rate limit", () => {
    expect(isAuthorizationExpired(erro("99 Food retornou erro: The store authorization information does not exist"))).toBe(false);
    expect(isAuthorizationExpired(erro("99 Food retornou 429 (rate limit)."))).toBe(false);
  });

  test("valor que nao e erro da 99 nao quebra", () => {
    expect(isAuthorizationExpired(new Error("ECONNRESET"))).toBe(false);
    expect(isAuthorizationExpired(null)).toBe(false);
  });
});

describe("getShopAuthToken com token expirado na 99", () => {
  test("renova (refresh) e busca o token de novo em vez de repassar o erro", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(expirado())
      .mockResolvedValueOnce(refreshOk())
      .mockResolvedValueOnce(tokenOk("token-novo"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getShopAuthToken("loja-1", "PATEO-LUZ-PIZZA")).resolves.toBe("token-novo");
    expect(chamadas(fetchMock)).toEqual([
      "/v1/auth/authtoken/get", "/v1/auth/authtoken/refresh", "/v1/auth/authtoken/get"
    ]);
  });
});

describe("callNoventaNoveShop com token em cache vencido", () => {
  test("invalida o cache, renova e repete a chamada UMA vez", async () => {
    prismaMock.noventaNoveShopAuthToken.findUnique.mockResolvedValueOnce({
      authToken: "token-velho", expiresAt: new Date(Date.now() + 3_600_000)
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(expirado())
      .mockResolvedValueOnce(tokenOk("token-novo"))
      .mockResolvedValueOnce(resposta({ errno: 0, errmsg: "ok", data: { items: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    const dados = await callNoventaNoveShop<{ items: unknown[] }>("loja-1", "PATEO-LUZ-PIZZA", {
      method: "GET", path: "/v1/item/item/list"
    });

    expect(dados).toEqual({ items: [] });
    expect(prismaMock.noventaNoveShopAuthToken.deleteMany).toHaveBeenCalledWith({ where: { deliveryStoreId: "loja-1" } });
    expect(chamadas(fetchMock)).toEqual(["/v1/item/item/list", "/v1/auth/authtoken/get", "/v1/item/item/list"]);
  });

  test("se continuar expirado depois de renovar, para e devolve o erro (sem laco)", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(expirado())
      .mockResolvedValueOnce(tokenOk("token-novo"))
      .mockResolvedValueOnce(expirado());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callNoventaNoveShop("loja-1", "PATEO-LUZ-PIZZA", { method: "GET", path: "/v1/item/item/list" })
    ).rejects.toThrow(/expired/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
