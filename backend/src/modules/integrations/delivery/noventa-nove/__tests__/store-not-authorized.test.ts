import { describe, expect, test } from "vitest";
import { NoventaNoveApiException } from "../noventa-nove-http-client.js";
import { isStoreNotAuthorized } from "../noventa-nove-real-sync.service.js";

// Corpo REAL devolvido pela Financial API da 99 em 17/09/2026, ao sincronizar
// uma loja que ja tem app_shop_id definitivo mas ainda nao foi autorizada no
// portal. Apareceu na tela como ERROR vermelho nas 3 lojas do Pateo.
const DETALHE_REAL =
  '{"error_code":"0017","error_description":"STORE_NOT_AUTHORIZED",' +
  '"Details":[{"field":"acceptor_code","error":"The store not authorized"}]}';

function erroDa99(detail: string | null, message = "99 Food retornou erro financeiro: HTTP 400"): NoventaNoveApiException {
  return new NoventaNoveApiException({
    status: 400,
    errno: null,
    message,
    detail,
    isAuthError: false,
    isRateLimit: false
  });
}

describe("isStoreNotAuthorized", () => {
  test("reconhece o corpo real de loja nao autorizada", () => {
    expect(isStoreNotAuthorized(erroDa99(DETALHE_REAL))).toBe(true);
  });

  test("reconhece pelo error_code 0017 mesmo sem a descricao textual", () => {
    expect(isStoreNotAuthorized(erroDa99('{"error_code":"0017"}'))).toBe(true);
  });

  test("NAO confunde com erro de credencial — esse continua sendo falha de verdade", () => {
    const authErro = new NoventaNoveApiException({
      status: 401,
      errno: 1001,
      message: "Autenticação 99 Food falhou. Verifique app_id/app_secret.",
      detail: '{"error_code":"1001"}',
      isAuthError: true,
      isRateLimit: false
    });
    expect(isStoreNotAuthorized(authErro)).toBe(false);
  });

  test("NAO confunde com rate limit", () => {
    expect(isStoreNotAuthorized(erroDa99('{"errno":10005}', "rate limit"))).toBe(false);
  });

  test("erro sem detail nao quebra", () => {
    expect(isStoreNotAuthorized(erroDa99(null))).toBe(false);
  });

  test("erro que nao e da 99 nao e tratado como nao-autorizada", () => {
    expect(isStoreNotAuthorized(new Error("ECONNRESET"))).toBe(false);
    expect(isStoreNotAuthorized(null)).toBe(false);
    expect(isStoreNotAuthorized("STORE_NOT_AUTHORIZED")).toBe(false);
  });
});
