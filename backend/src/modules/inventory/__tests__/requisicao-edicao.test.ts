import { describe, expect, test } from "vitest";
import { conferirEdicao, diferencaDaEdicao, notaDoAcerto, retiradoPorProduto, retiradoNaUnidadeDeHoje, type Conversor } from "../requisicao-edicao.js";

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

describe("retiradoNaUnidadeDeHoje", () => {
  // CX -> UN por 12; G -> KG por 0,001; o resto não converte.
  const converter: Conversor = (quantidade, de, para) => {
    if (de === "CX" && para === "UN") return { ok: true, quantidade: quantidade * 12 };
    if (de === "G" && para === "KG") return { ok: true, quantidade: quantidade / 1000 };
    return { ok: false };
  };
  const linha = (extra: Partial<Parameters<typeof retiradoNaUnidadeDeHoje>[0][number]>) =>
    ({ productId: "p1", productName: "FARINHA", quantidade: 2, unidade: "KG", unidadeDeHoje: "KG", ...extra });

  test("mesma unidade, ou unidade faltando de um lado, vale como veio", () => {
    expect(retiradoNaUnidadeDeHoje([linha({}), linha({ productId: "p2", unidade: null }), linha({ productId: "p3", unidadeDeHoje: null })], converter))
      .toEqual({ ok: true, retirado: [{ productId: "p1", quantidade: 2 }, { productId: "p2", quantidade: 2 }, { productId: "p3", quantidade: 2 }] });
  });

  test("unidade igual com caixa diferente não converte", () => {
    expect(retiradoNaUnidadeDeHoje([linha({ unidade: "kg" })], converter)).toEqual({ ok: true, retirado: [{ productId: "p1", quantidade: 2 }] });
  });

  test("gravado em CX, hoje em UN: 2 CX viram 24 UN", () => {
    expect(retiradoNaUnidadeDeHoje([linha({ unidade: "CX", unidadeDeHoje: "UN" })], converter)).toEqual({ ok: true, retirado: [{ productId: "p1", quantidade: 24 }] });
  });

  test("gravado em G, hoje em KG: 500 G viram 0,5 KG", () => {
    expect(retiradoNaUnidadeDeHoje([linha({ quantidade: 500, unidade: "G" })], converter)).toEqual({ ok: true, retirado: [{ productId: "p1", quantidade: 0.5 }] });
  });

  test("sem conversão devolve os nomes, e linha sem produto fica de fora", () => {
    expect(retiradoNaUnidadeDeHoje([linha({ unidade: "CX" }), linha({ productId: null, productName: "APAGADO", unidade: "CX" })], converter))
      .toEqual({ ok: false, semConversao: ["FARINHA (CX para KG)"] });
  });
});
