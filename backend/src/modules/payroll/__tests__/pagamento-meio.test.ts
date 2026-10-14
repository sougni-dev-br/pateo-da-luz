import { describe, expect, test } from "vitest";
import { GRUPO_SEM_EMPRESA, GRUPO_SEM_REGISTRO, type LancadoMeio, type PessoaMeio, type PrevistoMeio, montarPagamentoMeio } from "../pagamento-meio.js";

// Lista do adiantamento (dia 20) e da 1ª quinzena (dia 15). Dados fictícios.
const pessoa = (id: string, over: Partial<PessoaMeio> = {}): [string, PessoaMeio] => [id, {
  id, nome: `Pessoa ${id}`, semRegistro: false, empresa: "Empresa Exemplo Ltda", pix: null, pixTipo: null, contaBancaria: null, ...over,
}];
const lancado = (id: string, employeeId: string, over: Partial<LancadoMeio> = {}): LancadoMeio => ({
  id, employeeId, amount: 1000, dueDate: new Date("2026-10-20T00:00:00Z"), paymentDate: null, paidAmount: null, details: {}, ...over,
});
const previsto = (employeeId: string, over: Partial<PrevistoMeio> = {}): PrevistoMeio => ({
  employeeId, type: "ADIANTAMENTO", amount: 880, dueDate: "2026-10-20T00:00:00.000Z", details: { semRegistro: true }, exists: false, ...over,
});

const PESSOAS = new Map([
  pessoa("c1", { nome: "Bruna Exemplo", empresa: "Beta Exemplo Ltda" }),
  pessoa("c2", { nome: "Ana Exemplo", empresa: "Alfa Exemplo Ltda", pix: "ana@exemplo.com", pixTipo: "EMAIL" }),
  pessoa("s1", { nome: "Carla Exemplo", semRegistro: true, empresa: null }),
  pessoa("s2", { nome: "Dora Exemplo", semRegistro: true, empresa: null }),
  pessoa("q1", { nome: "Edu Exemplo", semRegistro: true, empresa: null }),
]);

describe("montarPagamentoMeio — adiantamento", () => {
  const lancados = [
    lancado("i1", "c1", { details: { empresa: "BETA EXEMPLO LTDA" } }),
    lancado("i2", "c2", { amount: 1200, details: { empresa: "ALFA EXEMPLO LTDA" }, paymentDate: new Date("2026-10-20T00:00:00Z"), paidAmount: 1200 }),
    lancado("i3", "s1", { amount: 920, details: { semRegistro: true } }),
    lancado("iq", "q1", { amount: 1000, details: { semRegistro: true, primeiraQuinzena: true } }),
  ];
  const previstos = [
    previsto("s1", { exists: true, amount: 920 }),
    previsto("s2"),
    previsto("q1", { details: { semRegistro: true, primeiraQuinzena: true }, exists: true }),
    previsto("c1", { details: {} }),
  ];
  const r = montarPagamentoMeio("ADIANTAMENTO", lancados, previstos, PESSOAS);

  test("lançados + sem registro a lançar; a 1ª quinzena fica de fora", () => {
    expect(r.linhas.map((l) => [l.nome, l.situacao])).toEqual([
      ["Ana Exemplo", "PAGO"], ["Bruna Exemplo", "LANCADO"], ["Carla Exemplo", "LANCADO"], ["Dora Exemplo", "A_LANCAR"],
    ]);
  });

  test("grupo pela empresa do extrato; sem registro num grupo só, por último", () => {
    expect(r.linhas.map((l) => l.grupo)).toEqual(["ALFA EXEMPLO LTDA", "BETA EXEMPLO LTDA", GRUPO_SEM_REGISTRO, GRUPO_SEM_REGISTRO]);
  });

  test("resumo por situação e total", () => {
    expect(r.aLancar).toEqual({ pessoas: 1, total: 880 });
    expect(r.lancado).toEqual({ pessoas: 2, total: 1920 });
    expect(r.pago).toEqual({ pessoas: 1, total: 1200 });
    expect(r.total).toBe(4000);
  });

  test("a lançar: vencimento e aviso; dados bancários do cadastro", () => {
    const dora = r.linhas.find((l) => l.employeeId === "s2")!;
    expect(dora).toMatchObject({ vencimento: "2026-10-20", payrollItemId: null, origem: "SEM_REGISTRO" });
    expect(dora.aviso).toContain("vence 20/10");
    const ana = r.linhas.find((l) => l.employeeId === "c2")!;
    expect(ana).toMatchObject({ pix: "ana@exemplo.com", pixTipo: "EMAIL", pagoEm: "2026-10-20", valorPago: 1200, aviso: null });
  });
});

describe("montarPagamentoMeio — avisos", () => {
  test("sem registro no cadastro vindo do extrato e CLT sem empresa", () => {
    const pessoas = new Map([pessoa("x", { semRegistro: true, empresa: null }), pessoa("y", { empresa: null })]);
    const r = montarPagamentoMeio("ADIANTAMENTO", [
      lancado("a", "x", { details: { empresa: "BETA EXEMPLO LTDA" } }),
      lancado("b", "y", { details: {} }),
    ], [], pessoas);
    const x = r.linhas.find((l) => l.employeeId === "x")!;
    expect(x.grupo).toBe("BETA EXEMPLO LTDA");
    expect(x.aviso).toContain("No cadastro está sem registro");
    const y = r.linhas.find((l) => l.employeeId === "y")!;
    expect(y.grupo).toBe(GRUPO_SEM_EMPRESA);
    expect(y.aviso).toContain("Sem empresa no cadastro");
  });

  test("pago com valor diferente do título", () => {
    const r = montarPagamentoMeio("ADIANTAMENTO", [
      lancado("a", "s1", { amount: 1040, details: { semRegistro: true }, paymentDate: new Date("2026-10-20T00:00:00Z"), paidAmount: 966.5 }),
    ], [], PESSOAS);
    expect(r.linhas[0].aviso).toContain("Pago R$");
    expect(r.linhas[0].valorPago).toBe(966.5);
  });

  test("valor zero calculado não vira a lançar", () => {
    const r = montarPagamentoMeio("ADIANTAMENTO", [], [previsto("s2", { amount: 0 })], PESSOAS);
    expect(r.linhas).toHaveLength(0);
  });
});

describe("montarPagamentoMeio — 1ª quinzena", () => {
  test("só a quinzena; desatualizada em aberto avisa o valor de hoje", () => {
    const r = montarPagamentoMeio("QUINZENA", [
      lancado("iq", "q1", { amount: 1000, dueDate: new Date("2026-10-15T00:00:00Z"), details: { semRegistro: true, primeiraQuinzena: true } }),
      lancado("i3", "s1", { amount: 920, details: { semRegistro: true } }),
    ], [
      previsto("q1", { amount: 1100, details: { semRegistro: true, primeiraQuinzena: true }, exists: true, desatualizado: true }),
    ], PESSOAS);
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]).toMatchObject({ nome: "Edu Exemplo", situacao: "LANCADO", vencimento: "2026-10-15" });
    expect(r.linhas[0].aviso).toContain("lançar de novo atualiza");
  });
});

describe("montarPagamentoMeio — correções da auditoria", () => {
  test("adiantamento de sem registro lançado à mão (sem marca) fica no grupo Sem registro, sem aviso de vínculo", () => {
    const r = montarPagamentoMeio("ADIANTAMENTO", [lancado("m", "s1", { amount: 880, details: { lancamentoManual: true }, source: "MANUAL" })], [], PESSOAS);
    expect(r.linhas[0]).toMatchObject({ grupo: GRUPO_SEM_REGISTRO, origem: "SEM_REGISTRO", aviso: null });
  });

  test("veio do extrato para quem está sem registro no cadastro: grupo da empresa e aviso de vínculo", () => {
    const r = montarPagamentoMeio("ADIANTAMENTO", [lancado("e", "s1", { details: { empresa: "BETA EXEMPLO LTDA" }, source: "EXTRATO_RH" })], [], PESSOAS);
    expect(r.linhas[0]).toMatchObject({ grupo: "BETA EXEMPLO LTDA", origem: "EXTRATO" });
    expect(r.linhas[0].aviso).toContain("No cadastro está sem registro");
  });

  test("total pago é o que saiu do banco", () => {
    const r = montarPagamentoMeio("ADIANTAMENTO", [
      lancado("a", "s1", { amount: 1040, details: { semRegistro: true }, paymentDate: new Date("2026-10-20T00:00:00Z"), paidAmount: 966.5 }),
    ], [], PESSOAS);
    expect(r.pago).toEqual({ pessoas: 1, total: 966.5 });
  });

  test("CLT esperado sem título no mês é listado; quem já tem título não", () => {
    const r = montarPagamentoMeio("ADIANTAMENTO", [lancado("i1", "c1")], [
      previsto("c1", { details: {}, exists: true }), previsto("c2", { details: {}, exists: false, amount: 1200 }),
    ], PESSOAS);
    expect(r.cltSemTitulo).toEqual(["Ana Exemplo"]);
    expect(montarPagamentoMeio("QUINZENA", [], [previsto("c2", { details: {} })], PESSOAS).cltSemTitulo).toEqual([]);
  });

  test("quinzena desatualizada devolve o valor novo em atualizarPara", () => {
    const r = montarPagamentoMeio("QUINZENA", [
      lancado("iq", "q1", { details: { semRegistro: true, primeiraQuinzena: true } }),
    ], [previsto("q1", { amount: 1100, details: { semRegistro: true, primeiraQuinzena: true }, exists: true, desatualizado: true })], PESSOAS);
    expect(r.linhas[0].atualizarPara).toBe(1100);
  });
});

