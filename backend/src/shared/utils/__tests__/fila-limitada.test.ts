import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { filaLimitada, ipConfiavel, limiteDeRequisicoes } from "../limite-requisicoes.js";

// Requisição/resposta de mentira: só o que a fila usa (fechar a conexão e o prazo do corpo).
function conexao() {
  const resposta = new EventEmitter() as unknown as Response;
  const requisicao = Object.assign(new EventEmitter(), { setTimeout: vi.fn(), destroy: vi.fn() }) as unknown as Request;
  const next = vi.fn() as unknown as NextFunction;
  return { requisicao, resposta, next, fechar: () => (resposta as unknown as EventEmitter).emit("close") };
}

describe("filaLimitada", () => {
  test("no máximo N ao mesmo tempo; o próximo entra quando um termina", () => {
    const fila = filaLimitada({ maximo: 2, tempoMaximoMs: 1000 });
    const [a, b, c] = [conexao(), conexao(), conexao()];
    for (const x of [a, b, c]) fila(x.requisicao, x.resposta, x.next);
    expect(a.next).toHaveBeenCalled();
    expect(b.next).toHaveBeenCalled();
    expect(c.next).not.toHaveBeenCalled();
    expect(fila.situacao()).toEqual({ ativos: 2, naFila: 1 });
    a.fechar();
    expect(c.next).toHaveBeenCalled();
    expect(fila.situacao()).toEqual({ ativos: 2, naFila: 0 });
  });

  test("quem desiste na fila sai dela sem ocupar vaga (celular que perde o sinal)", () => {
    const fila = filaLimitada({ maximo: 1, tempoMaximoMs: 1000 });
    const [a, b, c] = [conexao(), conexao(), conexao()];
    for (const x of [a, b, c]) fila(x.requisicao, x.resposta, x.next);
    b.fechar();
    expect(fila.situacao()).toEqual({ ativos: 1, naFila: 1 });
    a.fechar();
    expect(b.next).not.toHaveBeenCalled();
    expect(c.next).toHaveBeenCalled();
    c.fechar();
    expect(fila.situacao()).toEqual({ ativos: 0, naFila: 0 });
  });

  test("fechar duas vezes não devolve vaga em dobro; corpo lento tem prazo", () => {
    const fila = filaLimitada({ maximo: 1, tempoMaximoMs: 1234 });
    const a = conexao();
    fila(a.requisicao, a.resposta, a.next);
    expect(a.requisicao.setTimeout).toHaveBeenCalledWith(1234, expect.any(Function));
    a.fechar();
    a.fechar();
    expect(fila.situacao()).toEqual({ ativos: 0, naFila: 0 });
  });
});

describe("ipConfiavel e limite por IP", () => {
  const req = (headers: Record<string, string>, remoto = "10.0.0.9") =>
    ({ headers, socket: { remoteAddress: remoto } }) as unknown as Request;

  test("usa o IP que o Cloudflare informa; X-Forwarded-For inventado não muda nada", () => {
    expect(ipConfiavel(req({ "cf-connecting-ip": "200.1.2.3", "x-forwarded-for": "1.1.1.1, 172.70.0.1" }))).toBe("200.1.2.3");
    expect(ipConfiavel(req({ "x-forwarded-for": "1.1.1.1" }))).toBe("10.0.0.9");
  });

  test("o limite acumula para o mesmo aparelho mesmo trocando o X-Forwarded-For", () => {
    const limite = limiteDeRequisicoes({ janelaMs: 60_000, maximo: 2 });
    const status: number[] = [];
    for (let i = 0; i < 3; i++) {
      const resposta = { setHeader: vi.fn(), status: vi.fn((s: number) => { status.push(s); return { json: vi.fn() }; }) } as unknown as Response;
      limite(req({ "cf-connecting-ip": "200.1.2.3", "x-forwarded-for": `9.9.9.${i}` }), resposta, vi.fn());
    }
    expect(status).toEqual([429]);
  });
});
