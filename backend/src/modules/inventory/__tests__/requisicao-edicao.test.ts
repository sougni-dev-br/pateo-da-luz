import { describe, expect, test } from "vitest";
import { conferirEdicao, diferencaDaEdicao, notaDoAcerto, retiradoPorProduto, retiradoNaUnidadeDeHoje, type Conversor, dataValida, saldoDaEpocaPorProduto, saldosDasLinhas } from "../requisicao-edicao.js";

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

describe("conflito de versão marcado", () => {
  test("versão velha vem com conflito VERSAO; cancelada e sem versão não", () => {
    const atualizada = new Date("2026-11-26T10:00:00.000Z");
    expect(conferirEdicao({ status: "CONFIRMED", updatedAt: atualizada }, "2026-11-26T09:00:00.000Z")).toMatchObject({ status: 409, conflito: "VERSAO" });
    expect(conferirEdicao({ status: "CANCELLED", updatedAt: atualizada }, atualizada.toISOString())).not.toHaveProperty("conflito");
    expect(conferirEdicao({ status: "CONFIRMED", updatedAt: atualizada }, null)).not.toHaveProperty("conflito");
  });
});

describe("dataValida", () => {
  const local = (a: number, m: number, d: number) => new Date(a, m - 1, d);
  test("data que existe passa", () => {
    expect(dataValida(local(2026, 11, 25), "2026-11-25")).toBe(true);
    expect(dataValida(local(2028, 2, 29), "2028-02-29")).toBe(true);
  });
  test("dia que não existe não vira o mês seguinte", () => {
    // new Date(2026, 1, 31) rola para 3 de março: é o que parseLocalDate devolve para "2026-02-31".
    expect(dataValida(new Date(2026, 1, 31), "2026-02-31")).toBe(false);
    expect(dataValida(new Date(2026, 12, 1), "2026-13-01")).toBe(false);
  });
  test("texto ilegível e ano fora da faixa são recusados", () => {
    expect(dataValida(new Date("lixo"), "lixo")).toBe(false);
    expect(dataValida(local(1999, 12, 31), "1999-12-31")).toBe(false);
  });
  test("data com hora também é conferida no calendário", () => {
    expect(dataValida(new Date("2026-02-31T00:00:00"), "2026-02-31T00:00:00")).toBe(false);
    expect(dataValida(new Date("2026-11-25T00:00:00.000Z"), "2026-11-25T00:00:00.000Z")).toBe(true);
  });

  test("sem data digitada vale a data que veio", () => {
    expect(dataValida(local(2026, 11, 25), undefined)).toBe(true);
  });
});

describe("saldosDasLinhas", () => {
  test("cada produto parte do seu saldo; o repetido acumula", () => {
    const saldo: Record<string, number> = { p1: 10, p2: 5 };
    expect(saldosDasLinhas(
      [{ productId: "p1", quantidade: 2 }, { productId: "p2", quantidade: 1 }, { productId: "p1", quantidade: 3 }],
      (id) => saldo[id]
    )).toEqual([{ antes: 10, depois: 8 }, { antes: 5, depois: 4 }, { antes: 8, depois: 5 }]);
  });
  test("sem lixo de ponto flutuante", () => {
    expect(saldosDasLinhas([{ productId: "p1", quantidade: 0.1 }, { productId: "p1", quantidade: 0.2 }], () => 0.3))
      .toEqual([{ antes: 0.3, depois: 0.2 }, { antes: 0.2, depois: 0 }]);
  });
});

describe("saldoDaEpocaPorProduto", () => {
  const sempre = () => true;
  test("produto em várias linhas parte do maior antes, em qualquer ordem", () => {
    const r = saldoDaEpocaPorProduto([
      { productId: "p1", stockBefore: "8.0000", unit: "KG" },
      { productId: "p1", stockBefore: "10.0000", unit: "KG" },
      { productId: "p2", stockBefore: 5, unit: "UN" }
    ], sempre);
    expect(Object.fromEntries(r)).toEqual({ p1: 10, p2: 5 });
  });
  test("linha sem saldo gravado, sem produto ou em unidade diferente da de hoje fica de fora", () => {
    const r = saldoDaEpocaPorProduto([
      { productId: "p1", stockBefore: null, unit: "KG" },
      { productId: null, stockBefore: 3, unit: "KG" },
      { productId: "p2", stockBefore: 2, unit: "CX" }
    ], (_id, unidade) => unidade !== "CX");
    expect(r.size).toBe(0);
  });
});
