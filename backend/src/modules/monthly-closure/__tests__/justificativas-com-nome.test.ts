import { describe, expect, test } from "vitest";
import { anexarNomes } from "../justificativas-com-nome.js";

const base = (blockKey: string, userId: string) => ({
  blockKey,
  reason: "motivo",
  justifiedByUserId: userId,
  justifiedAt: "2026-10-21T12:00:00.000Z"
});

describe("anexarNomes", () => {
  test("coloca o nome de quem registrou em cada justificativa", () => {
    const r = anexarNomes([base("card:1", "u1"), base("block:taxes", "u2")], [
      { id: "u1", name: "Eli" },
      { id: "u2", name: "Ana" }
    ]);
    expect(r.map((j) => j.justifiedByName)).toEqual(["Eli", "Ana"]);
  });

  test("usuário que não existe mais fica sem nome, sem quebrar", () => {
    const [j] = anexarNomes([base("block:taxes", "sumiu")], []);
    expect(j.justifiedByName).toBeNull();
    expect(j.justifiedByUserId).toBe("sumiu");
  });

  test("não muda o que já estava gravado", () => {
    const [j] = anexarNomes([base("card:1", "u1")], [{ id: "u1", name: "Eli" }]);
    expect(j.reason).toBe("motivo");
    expect(j.blockKey).toBe("card:1");
    expect(j.justifiedAt).toBe("2026-10-21T12:00:00.000Z");
  });

  test("lista vazia devolve lista vazia", () => {
    expect(anexarNomes([], [])).toEqual([]);
  });

  test("não altera a lista de entrada", () => {
    const entrada = [base("card:1", "u1")];
    anexarNomes(entrada, [{ id: "u1", name: "Eli" }]);
    expect((entrada[0] as { justifiedByName?: string }).justifiedByName).toBeUndefined();
  });
});
