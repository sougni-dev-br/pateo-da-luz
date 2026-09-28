import { describe, expect, test } from "vitest";
import type { TipFunction } from "../../api/client";
import { diferencas, problemas } from "./rascunhoFuncoes";

const f = (id: string, extra: Partial<TipFunction> = {}): TipFunction => ({
  id, name: id, points: 3, minPoints: 2, maxPoints: 4, group: "Salão", notes: null, isActive: true, ...extra,
});

describe("rascunho da tabela de funções", () => {
  test("sem mudança não há diferença, mesmo com texto vazio × nulo", () => {
    expect(diferencas([f("a")], [f("a", { notes: "" })])).toEqual([]);
  });

  test("aponta só os campos alterados, com antes e depois", () => {
    const d = diferencas([f("a")], [f("a", { points: 3.5, group: "Cozinha" })]);
    expect(d).toHaveLength(1);
    expect(d[0].campos).toEqual([
      { campo: "points", antes: 3, depois: 3.5 },
      { campo: "group", antes: "Salão", depois: "Cozinha" },
    ]);
  });

  test("função nova entra como nova", () => {
    const d = diferencas([f("a")], [f("a"), { name: "Caixa", points: 2, minPoints: null, maxPoints: null, group: null, notes: null, isActive: true }]);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ nova: true, nome: "Caixa", id: null });
  });

  test("barra nome vazio, repetido, negativo e fora da faixa", () => {
    expect(problemas([f("a", { name: " " })])).toContain("Há uma função sem nome.");
    expect(problemas([f("a"), f("b", { name: "A" })])).toEqual(['A função "a" aparece 2 vezes.']);
    expect(problemas([f("a", { points: -1, minPoints: null })])).toContain("a: pontos precisam ser 0 ou mais.");
    expect(problemas([f("a", { points: 5 })])[0]).toMatch(/fora da faixa 2 a 4/);
    expect(problemas([f("a", { minPoints: 5, maxPoints: 4 })])).toEqual(["a: o mínimo está maior que o máximo."]);
  });

  test("tabela válida não tem problemas", () => {
    expect(problemas([f("a"), f("b")])).toEqual([]);
  });
});
