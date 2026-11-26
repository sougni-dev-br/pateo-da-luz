import { describe, expect, test } from "vitest";
import { conferirEdicao, diferencaDaEdicao, notaDoAcerto, retiradoPorProduto } from "../requisicao-edicao.js";

describe("diferencaDaEdicao", () => {
  test("aumentar a quantidade gera saída só da diferença", () => {
    expect(diferencaDaEdicao([{ productId: "a", quantidade: 2 }], [{ productId: "a", quantidade: 3.5 }]))
      .toEqual([{ productId: "a", antes: 2, depois: 3.5, delta: 1.5 }]);
  });

  test("diminuir devolve a diferença ao estoque", () => {
    expect(diferencaDaEdicao([{ productId: "a", quantidade: 2 }], [{ productId: "a", quantidade: 0.5 }]))
      .toEqual([{ productId: "a", antes: 2, depois: 0.5, delta: -1.5 }]);
  });

  test("tirar o produto devolve tudo; incluir um novo tira tudo", () => {
    const r = diferencaDaEdicao([{ productId: "a", quantidade: 2 }], [{ productId: "b", quantidade: 1 }]);
    expect(r).toEqual([
      { productId: "a", antes: 2, depois: 0, delta: -2 },
      { productId: "b", antes: 0, depois: 1, delta: 1 }
    ]);
  });

  test("produto sem mudança não gera acerto", () => {
    expect(diferencaDaEdicao([{ productId: "a", quantidade: 2 }], [{ productId: "a", quantidade: 2 }])).toEqual([]);
  });

  test("mesmo produto em duas linhas soma antes de comparar", () => {
    expect(diferencaDaEdicao([{ productId: "a", quantidade: 1 }, { productId: "a", quantidade: 1 }], [{ productId: "a", quantidade: 2 }])).toEqual([]);
  });

  test("conversão de 0,1 + 0,2 não gera acerto fantasma por arredondamento", () => {
    expect(diferencaDaEdicao([{ productId: "a", quantidade: 0.3 }], [{ productId: "a", quantidade: 0.1 }, { productId: "a", quantidade: 0.2 }])).toEqual([]);
  });
});

describe("retiradoPorProduto", () => {
  test("soma por produto", () => {
    expect(Object.fromEntries(retiradoPorProduto([{ productId: "a", quantidade: 1 }, { productId: "a", quantidade: 0.5 }, { productId: "b", quantidade: 2 }])))
      .toEqual({ a: 1.5, b: 2 });
  });
});

describe("conferirEdicao", () => {
  const atualizada = new Date("2026-11-26T10:00:00.000Z");

  test("aceita a requisição confirmada na versão aberta", () => {
    expect(conferirEdicao({ status: "CONFIRMED", updatedAt: atualizada }, atualizada.toISOString())).toEqual({ ok: true });
  });

  test("recusa versão diferente da aberta", () => {
    const r = conferirEdicao({ status: "CONFIRMED", updatedAt: atualizada }, "2026-11-26T09:00:00.000Z");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });

  test("recusa sem versão, cancelada ou inexistente", () => {
    expect(conferirEdicao({ status: "CONFIRMED", updatedAt: atualizada }, null)).toMatchObject({ ok: false, status: 400 });
    expect(conferirEdicao({ status: "CANCELLED", updatedAt: atualizada }, atualizada.toISOString())).toMatchObject({ ok: false, status: 409 });
    expect(conferirEdicao(null, atualizada.toISOString())).toMatchObject({ ok: false, status: 404 });
  });

  test("versão ilegível é recusada", () => {
    expect(conferirEdicao({ status: "CONFIRMED", updatedAt: atualizada }, "ontem")).toMatchObject({ ok: false, status: 409 });
  });
});

describe("notaDoAcerto", () => {
  test("diz de quanto para quanto, com a unidade", () => {
    expect(notaDoAcerto("REQ-2026-0001", { productId: "a", antes: 2, depois: 3, delta: 1 }, "KG"))
      .toBe("Edicao da requisicao REQ-2026-0001: retirada de 2 KG para 3 KG");
  });
});
