import { describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({ prisma: {} }));

import { hashDoConteudo, jsonCanonico } from "../tip-fechamento.service.js";

describe("registro do fechamento: integridade", () => {
  const conteudo = {
    params: { deductionPercent: 20, pointsTotal: 100, periodStart: "2026-08-26" },
    totals: { netPool: 18632.99, saldo: 0 },
    participants: [{ nome: "Janete", pontos: 4, gorjeta: 745.32, vales: [] }],
    reserve: { pontos: 0, lancamentos: [] },
  };

  test("a ordem das chaves não muda o hash (o banco reordena ao gravar)", () => {
    const embaralhado = {
      reserve: { lancamentos: [], pontos: 0 },
      participants: [{ vales: [], gorjeta: 745.32, pontos: 4, nome: "Janete" }],
      totals: { saldo: 0, netPool: 18632.99 },
      params: { periodStart: "2026-08-26", pointsTotal: 100, deductionPercent: 20 },
    };
    expect(hashDoConteudo(embaralhado)).toBe(hashDoConteudo(conteudo));
  });

  test("qualquer centavo alterado muda o hash", () => {
    const adulterado = { ...conteudo, participants: [{ ...conteudo.participants[0], gorjeta: 745.33 }] };
    expect(hashDoConteudo(adulterado)).not.toBe(hashDoConteudo(conteudo));
  });

  test("a ordem das pessoas importa (é parte do retrato)", () => {
    const a = { ...conteudo, participants: [{ nome: "A" }, { nome: "B" }] };
    const b = { ...conteudo, participants: [{ nome: "B" }, { nome: "A" }] };
    expect(hashDoConteudo(a)).not.toBe(hashDoConteudo(b));
  });

  test("jsonCanonico ignora campos indefinidos e mantém null", () => {
    expect(jsonCanonico({ b: 1, a: undefined, c: null })).toBe('{"b":1,"c":null}');
  });
});
