import { describe, expect, test } from "vitest";
import { correcoesDaRevisao, modoDeEdicao } from "../edicao-inventario.js";

describe("modoDeEdicao", () => {
  test("rascunho e devolvido seguem editaveis para quem pode editar", () => {
    expect(modoDeEdicao("RASCUNHO", false)).toBe("rascunho");
    expect(modoDeEdicao("REJEITADO", false)).toBe("rascunho");
  });

  test("em revisao, so quem aprova corrige", () => {
    // Antes a unica saida era rejeitar, corrigir e reenviar o inventario inteiro.
    expect(modoDeEdicao("EM_REVISAO", true)).toBe("revisao");
    expect(modoDeEdicao("EM_REVISAO", false)).toBeNull();
  });

  test("aprovado, fechado e cancelado nao editam: ja viraram base do CMV", () => {
    expect(modoDeEdicao("APROVADO", true)).toBeNull();
    expect(modoDeEdicao("FECHADO", true)).toBeNull();
    expect(modoDeEdicao("CANCELADO", true)).toBeNull();
  });
});

describe("correcoesDaRevisao", () => {
  const antes = new Map([
    ["a", { produto: "SACHE DE PALITO C/ 2000", quantidade: 1100 }],
    ["b", { produto: "ALCATRA", quantidade: 0 }],
    ["c", { produto: "BATATA", quantidade: 12 }]
  ]);

  test("registra so o que mudou, com antes e depois", () => {
    expect(correcoesDaRevisao(antes, [
      { id: "a", quantidade: 0.55 },
      { id: "b", quantidade: 0 },
      { id: "c", quantidade: 12.5 }
    ])).toEqual([
      { itemId: "a", produto: "SACHE DE PALITO C/ 2000", antes: 1100, depois: 0.55 },
      { itemId: "c", produto: "BATATA", antes: 12, depois: 12.5 }
    ]);
  });

  test("item de outro inventario e ignorado", () => {
    expect(correcoesDaRevisao(antes, [{ id: "x", quantidade: 3 }])).toEqual([]);
  });

  test("antes vazio conta como correcao", () => {
    const comVazio = new Map([["d", { produto: "QUIABO", quantidade: null }]]);
    expect(correcoesDaRevisao(comVazio, [{ id: "d", quantidade: 2 }])).toEqual([
      { itemId: "d", produto: "QUIABO", antes: null, depois: 2 }
    ]);
  });
});
