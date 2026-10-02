import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { filaLimitada } from "../limite-requisicoes.js";

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
