import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { criarTokenDeMaquina } from "../token-de-maquina.middleware.js";

const TOKEN = "a".repeat(40);

function executar(opcoes: Parameters<typeof criarTokenDeMaquina>[0], enviado?: string) {
  const middleware = criarTokenDeMaquina(opcoes);
  const next = vi.fn();
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const request = { header: (nome: string) => (nome.toLowerCase() === opcoes.header ? enviado : undefined) } as unknown as Request;
  middleware(request, { status } as unknown as Response, next);
  return { next, status, json };
}

const opcoes = { envVar: "TOKEN_TESTE", header: "x-teste-token", mensagemNaoConfigurado: "não configurado" };

beforeEach(() => {
  process.env.TOKEN_TESTE = TOKEN;
  delete process.env.OUTRO_TOKEN_TESTE;
});
afterEach(() => {
  delete process.env.TOKEN_TESTE;
  delete process.env.OUTRO_TOKEN_TESTE;
});

describe("criarTokenDeMaquina", () => {
  test("token certo passa", () => {
    const r = executar(opcoes, TOKEN);
    expect(r.next).toHaveBeenCalledOnce();
    expect(r.status).not.toHaveBeenCalled();
  });

  test("token errado, de mesmo tamanho ou não, e ausente dão 401", () => {
    for (const enviado of ["b".repeat(40), "a".repeat(39), "a".repeat(41), "", undefined]) {
      const r = executar(opcoes, enviado);
      expect(r.status).toHaveBeenCalledWith(401);
      expect(r.next).not.toHaveBeenCalled();
    }
  });

  test("sem token configurado, ou curto demais, o servidor responde 503", () => {
    delete process.env.TOKEN_TESTE;
    expect(executar(opcoes, TOKEN).status).toHaveBeenCalledWith(503);
    process.env.TOKEN_TESTE = "curto";
    expect(executar(opcoes, "curto").status).toHaveBeenCalledWith(503);
  });

  test("espaço ou quebra de linha no fim da variável de ambiente não derruba o agente", () => {
    process.env.TOKEN_TESTE = `${TOKEN}\n`;
    const r = executar(opcoes, TOKEN);
    expect(r.next).toHaveBeenCalledOnce();
  });

  test("token igual ao de outro agente é recusado: um agente não pode valer pelo outro", () => {
    process.env.OUTRO_TOKEN_TESTE = TOKEN;
    const r = executar({ ...opcoes, diferenteDe: ["OUTRO_TOKEN_TESTE"] }, TOKEN);
    expect(r.status).toHaveBeenCalledWith(503);
    expect(r.next).not.toHaveBeenCalled();
  });

  test("com tokens diferentes entre os agentes, passa", () => {
    process.env.OUTRO_TOKEN_TESTE = "z".repeat(40);
    const r = executar({ ...opcoes, diferenteDe: ["OUTRO_TOKEN_TESTE"] }, TOKEN);
    expect(r.next).toHaveBeenCalledOnce();
  });
});
