import { describe, expect, test } from "vitest";
import { diaIsoValido, ordenarPessoasDoBrinde, resumirBrinde, type PessoaDoBrinde } from "../brinde.js";

const pessoa = (o: Partial<PessoaDoBrinde> & Pick<PessoaDoBrinde, "employeeId">): PessoaDoBrinde => ({
  nome: o.employeeId, nomeCompleto: o.employeeId, empresa: "Casa A", setor: null, cargo: null, ativo: true, saidaEm: null, entrega: null, ...o,
});
const entrega = { id: "e", entregueEm: "2026-12-20", observacao: null, registradoPor: null };

describe("diaIsoValido", () => {
  test.each([["2026-12-20", true], ["2026-02-30", false], ["20/12/2026", false], ["", false]])("%s", (v, ok) => {
    expect(diaIsoValido(v)).toBe(ok);
  });
  test("recusa o que não é texto", () => {
    expect(diaIsoValido(20261220)).toBe(false);
    expect(diaIsoValido(null)).toBe(false);
  });
});

describe("resumirBrinde", () => {
  test("conta ativos, entregues e quem falta; quem saiu e recebeu fica à parte", () => {
    const r = resumirBrinde([
      pessoa({ employeeId: "a", entrega }),
      pessoa({ employeeId: "b" }),
      pessoa({ employeeId: "c", ativo: false, entrega }),
      pessoa({ employeeId: "d", ativo: false }),
    ]);
    expect(r).toEqual({ ativos: 2, entregues: 1, faltam: 1, entreguesDeInativos: 1 });
  });
  test("lista vazia", () => {
    expect(resumirBrinde([])).toEqual({ ativos: 0, entregues: 0, faltam: 0, entreguesDeInativos: 0 });
  });
});

describe("ordenarPessoasDoBrinde", () => {
  test("empresa, ativos antes de inativos, depois nome sem considerar acento", () => {
    const ordem = ordenarPessoasDoBrinde([
      pessoa({ employeeId: "1", nome: "Zélia", empresa: "Casa A" }),
      pessoa({ employeeId: "2", nome: "Ana", empresa: "Casa B" }),
      pessoa({ employeeId: "3", nome: "Bia", empresa: "Casa A", ativo: false }),
      pessoa({ employeeId: "4", nome: "Álvaro", empresa: "Casa A" }),
    ]).map((p) => p.employeeId);
    expect(ordem).toEqual(["4", "1", "3", "2"]);
  });
  test("não altera a lista original", () => {
    const original = [pessoa({ employeeId: "b", nome: "B" }), pessoa({ employeeId: "a", nome: "A" })];
    ordenarPessoasDoBrinde(original);
    expect(original[0].employeeId).toBe("b");
  });
});
