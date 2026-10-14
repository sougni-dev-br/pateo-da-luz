import { describe, expect, test } from "vitest";
import type { LinhaPagamentoMeio, PagamentoMeio } from "../../../api/client";
import { aLancar, regrasDoPdf, resultadoDoLancamento, seloDoPdf, textoSituacao, vencimentoDaLista } from "../regrasPagamentoMeio";

// Dados fictícios.
const linha = (over: Partial<LinhaPagamentoMeio>): LinhaPagamentoMeio => ({
  employeeId: "x", nome: "Fulano Exemplo", grupo: "Sem registro", origem: "SEM_REGISTRO", valor: 880, situacao: "A_LANCAR",
  vencimento: "2026-10-20", pagoEm: null, valorPago: null, payrollItemId: null, pix: null, pixTipo: null, contaBancaria: null, aviso: null, ...over,
});
const dados = (linhas: LinhaPagamentoMeio[], aLancarN = linhas.filter((l) => l.situacao === "A_LANCAR").length): PagamentoMeio => ({
  tipo: "ADIANTAMENTO", competencia: "10/2026", linhas, avisos: [], total: 0,
  aLancar: { pessoas: aLancarN, total: 0 }, lancado: { pessoas: 0, total: 0 }, pago: { pessoas: 0, total: 0 },
});

describe("regras da lista do adiantamento", () => {
  test("a lançar inclui a quinzena desatualizada (o mesmo botão atualiza)", () => {
    const d = dados([
      linha({ employeeId: "a" }),
      linha({ employeeId: "b", situacao: "LANCADO", aviso: "O cálculo de hoje dá R$ 1.100,00: lançar de novo atualiza o título." }),
      linha({ employeeId: "c", situacao: "LANCADO" }),
    ]);
    expect(aLancar(d).map((l) => l.employeeId)).toEqual(["a", "b"]);
  });

  test("resultado: quem foi lançado agora e quem continua faltando", () => {
    const antes = [linha({ employeeId: "a", valor: 880 }), linha({ employeeId: "b", valor: 920 })];
    const depois = dados([linha({ employeeId: "a", situacao: "LANCADO", valor: 880 }), linha({ employeeId: "b" })]);
    const r = resultadoDoLancamento(antes, depois);
    expect(r.lancados.map((l) => l.employeeId)).toEqual(["a"]);
    expect(r.pendentes.map((l) => l.employeeId)).toEqual(["b"]);
    expect(r.total).toBe(880);
  });

  test("texto da situação", () => {
    expect(textoSituacao(linha({}))).toBe("vence 20/10");
    expect(textoSituacao(linha({ situacao: "LANCADO" }))).toBe("vence 20/10");
    expect(textoSituacao(linha({ situacao: "PAGO", pagoEm: "2026-10-18" }))).toBe("em 18/10");
  });

  test("selo: prévia enquanto falta lançar; lançado quando completo", () => {
    expect(seloDoPdf(dados([], 2))).toEqual({ texto: "PRÉVIA - FALTAM LANÇAR 2", tom: "aviso" });
    expect(seloDoPdf(dados([], 0))).toEqual({ texto: "LANÇADO NO CONTAS A PAGAR", tom: "ok" });
  });

  test("regras do PDF com o percentual das configurações", () => {
    expect(regrasDoPdf("ADIANTAMENTO", 40)[1]).toContain("40% do salário base");
    expect(regrasDoPdf("ADIANTAMENTO", null)[1]).toContain("percentual do salário base");
    expect(regrasDoPdf("QUINZENA", 40)[0]).toContain("metade do salário base");
  });

  test("vencimento do cabeçalho: o mais comum", () => {
    expect(vencimentoDaLista([linha({}), linha({}), linha({ vencimento: "2026-10-15" })])).toBe("2026-10-20");
    expect(vencimentoDaLista([])).toBeNull();
  });
});
