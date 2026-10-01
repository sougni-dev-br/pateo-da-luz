import { describe, expect, test } from "vitest";
import {
  aposSaida, duplicadosDe, motivoValido, mesmoPagamento, pagamentosEmDuplicidade, resumoItem, rotuloLivre, suspeitosDoLote,
  type ItemFolha,
} from "../folha-duplicidade.js";

// Travas contra pagar duas vezes a mesma coisa na folha: o que conta como "o mesmo
// pagamento", o que fica liberado (parcela de rescisão, complemento) e o que é depois da saída.
const base = (over: Partial<ItemFolha> = {}): ItemFolha => ({
  id: "a", employeeId: "e1", type: "SALARIO", competenceYear: 2026, competenceMonth: 9,
  periodStart: null, periodLabel: "Salário", details: null, status: "PENDING", deletedAt: null, paymentDate: null,
  amount: 1000, dueDate: new Date("2026-10-05T00:00:00Z"),
  ...over,
});

describe("mesmoPagamento / duplicadosDe", () => {
  test("mesma pessoa, tipo e competência é duplicado, mesmo com rótulo diferente", () => {
    const novo = base({ id: undefined, periodLabel: "Salário (manual)" });
    const existentes = [base({ id: "x1", periodLabel: "Extrato 09/2026" })];
    expect(duplicadosDe(novo, existentes).map((e) => e.id)).toEqual(["x1"]);
  });

  test("outra competência, outra pessoa ou outro tipo não é duplicado", () => {
    const novo = base({ id: undefined });
    expect(duplicadosDe(novo, [
      base({ id: "m", competenceMonth: 8 }),
      base({ id: "p", employeeId: "e2" }),
      base({ id: "t", type: "ADIANTAMENTO" }),
    ])).toEqual([]);
  });

  test("excluído e cancelado não contam", () => {
    const novo = base({ id: undefined });
    expect(duplicadosDe(novo, [
      base({ id: "d", deletedAt: new Date() }),
      base({ id: "c", status: "CANCELED" }),
    ])).toEqual([]);
  });

  test("o próprio item não é duplicado dele mesmo", () => {
    expect(mesmoPagamento(base({ id: "a" }), base({ id: "a" }))).toBe(false);
  });

  test("VT: quinzenas diferentes não são duplicadas; a mesma quinzena é", () => {
    const q1 = base({ id: "q1", type: "VALE_TRANSPORTE", periodStart: new Date("2026-09-01T00:00:00Z") });
    const q2 = base({ id: "q2", type: "VALE_TRANSPORTE", periodStart: new Date("2026-09-16T00:00:00Z") });
    const outroQ1 = base({ id: undefined, type: "VALE_TRANSPORTE", periodStart: "2026-09-01" });
    expect(mesmoPagamento(q1, q2)).toBe(false);
    expect(duplicadosDe(outroQ1, [q1, q2]).map((e) => e.id)).toEqual(["q1"]);
  });

  test("VT: bilhete mensal e 1ª quinzena começam no mesmo dia — é o mesmo vale do mês", () => {
    const mensal = base({ id: "m", type: "VALE_TRANSPORTE", periodStart: new Date("2026-09-01T00:00:00Z"), periodLabel: "VT Bilhete Único Mensal" });
    const q1 = base({ id: undefined, type: "VALE_TRANSPORTE", periodStart: "2026-09-01" });
    expect(duplicadosDe(q1, [mensal])).toHaveLength(1);
  });

  test("VT sem início do período: não dá para saber a quinzena, conta como duplicado", () => {
    const antigo = base({ id: "v", type: "VALE_TRANSPORTE", periodStart: null });
    expect(duplicadosDe(base({ id: undefined, type: "VALE_TRANSPORTE", periodStart: "2026-09-16" }), [antigo])).toHaveLength(1);
  });

  test("RESCISAO: parcelas do mesmo grupo são liberadas; grupo diferente é duplicado", () => {
    const p1 = base({ id: "r1", type: "RESCISAO", details: { grupoRescisao: "g1" } });
    const p2 = base({ id: undefined, type: "RESCISAO", details: { grupoRescisao: "g1" } });
    const outra = base({ id: undefined, type: "RESCISAO", details: { grupoRescisao: "g2" } });
    expect(duplicadosDe(p2, [p1])).toEqual([]);
    expect(duplicadosDe(outra, [p1])).toHaveLength(1);
  });
});

describe("pagamentosEmDuplicidade (baixa)", () => {
  const pago = base({ id: "pg", periodLabel: "Extrato 09/2026", paymentDate: new Date("2026-10-05T12:00:00Z"), status: "PAID" });

  test("baixar um salário de setembro quando outro de setembro já foi pago acusa o pago", () => {
    expect(pagamentosEmDuplicidade(base({ id: "a" }), [pago]).map((p) => p.id)).toEqual(["pg"]);
  });

  test("o outro ainda em aberto não acusa (não foi pago)", () => {
    expect(pagamentosEmDuplicidade(base({ id: "a" }), [base({ id: "b" })])).toEqual([]);
  });

  test("complemento não acusa (nem o que se baixa, nem o já pago)", () => {
    const complemento = { complemento: { motivo: "Diferença de horas extras", por: "u1", em: "2026-10-01" } };
    expect(pagamentosEmDuplicidade(base({ id: "a", details: complemento }), [pago])).toEqual([]);
    expect(pagamentosEmDuplicidade(base({ id: "a" }), [{ ...pago, details: complemento }])).toEqual([]);
  });

  test("parcela de rescisão do mesmo grupo já paga não acusa", () => {
    const g = { grupoRescisao: "g1" };
    const p1 = base({ id: "r1", type: "RESCISAO", details: g, paymentDate: new Date() });
    expect(pagamentosEmDuplicidade(base({ id: "r2", type: "RESCISAO", details: g }), [p1])).toEqual([]);
  });

  test("VT da outra quinzena já pago não acusa", () => {
    const q1 = base({ id: "q1", type: "VALE_TRANSPORTE", periodStart: "2026-09-01", paymentDate: new Date() });
    expect(pagamentosEmDuplicidade(base({ id: "q2", type: "VALE_TRANSPORTE", periodStart: "2026-09-16" }), [q1])).toEqual([]);
  });
});

describe("suspeitosDoLote", () => {
  test("acusa o que já foi pago fora do lote e os pares duplicados dentro do próprio lote", () => {
    const a = base({ id: "a", employeeId: "e1" });
    const b = base({ id: "b", employeeId: "e2" });
    const b2 = base({ id: "b2", employeeId: "e2", periodLabel: "Salário (2)" });
    const c = base({ id: "c", employeeId: "e3" });
    const pagoA = base({ id: "pa", employeeId: "e1", paymentDate: new Date("2026-10-05T00:00:00Z"), periodLabel: "Extrato" });
    const s = suspeitosDoLote([a, b, b2, c], [pagoA]);
    expect(s.map((x) => x.item.id)).toEqual(["a", "b", "b2"]);
    expect(s[0].jaPagos.map((p) => p.id)).toEqual(["pa"]);
    expect(s[1].noLote.map((p) => p.id)).toEqual(["b2"]);
    expect(s[2].noLote.map((p) => p.id)).toEqual(["b"]);
  });

  test("lote sem nada repetido não acusa ninguém", () => {
    expect(suspeitosDoLote([base({ id: "a" }), base({ id: "b", type: "ADIANTAMENTO" })], [])).toEqual([]);
  });
});

describe("aposSaida", () => {
  const saida = new Date("2026-09-29T00:00:00Z");
  const vt = (inicio: string) => base({ type: "VALE_TRANSPORTE", periodStart: inicio, competenceMonth: Number(inicio.slice(5, 7)) });

  test("VT de outubro para quem saiu em 29/09 é depois da saída", () => {
    expect(aposSaida(vt("2026-10-01"), saida)).toBe(true);
  });

  test("VT da quinzena que contém a saída é liberado", () => {
    expect(aposSaida(vt("2026-09-16"), saida)).toBe(false);
  });

  test("quinzena que começa depois do dia da saída é bloqueada", () => {
    expect(aposSaida(vt("2026-09-16"), new Date("2026-09-15T00:00:00Z"))).toBe(true);
  });

  test("salário/adiantamento: o mês da saída é liberado, o mês seguinte não", () => {
    expect(aposSaida(base({ competenceMonth: 9 }), saida)).toBe(false);
    expect(aposSaida(base({ competenceMonth: 10 }), saida)).toBe(true);
    expect(aposSaida(base({ type: "ADIANTAMENTO", competenceMonth: 10 }), saida)).toBe(true);
  });

  test("bilhete mensal do mês da saída é liberado (começa no dia 1)", () => {
    expect(aposSaida(vt("2026-09-01"), saida)).toBe(false);
  });

  test("rescisão e férias nunca são barradas; sem saída nada é barrado", () => {
    expect(aposSaida(base({ type: "RESCISAO", competenceMonth: 10 }), saida)).toBe(false);
    expect(aposSaida(base({ type: "FERIAS", competenceMonth: 10, periodStart: "2026-10-05" }), saida)).toBe(false);
    expect(aposSaida(base({ competenceMonth: 12 }), null)).toBe(false);
  });

  test("VT sem início do período usa o 1º dia da competência", () => {
    expect(aposSaida(base({ type: "VALE_TRANSPORTE", periodStart: null, competenceMonth: 10 }), saida)).toBe(true);
  });
});

describe("rotuloLivre", () => {
  test("usa o rótulo base se estiver livre; senão numera", () => {
    expect(rotuloLivre("Salário", [])).toBe("Salário");
    expect(rotuloLivre("Salário", ["Salário", "Salário (2)"])).toBe("Salário (3)");
  });
});

describe("motivoValido e resumoItem", () => {
  test("motivo precisa de pelo menos 10 letras", () => {
    expect(motivoValido("curto")).toBeNull();
    expect(motivoValido("   diferença de horas   ")).toBe("diferença de horas");
    expect(motivoValido(123)).toBeNull();
  });

  test("resumo traz tipo, competência, valor, status e vencimento", () => {
    const r = resumoItem(base({ id: "x", amount: "1234.5", paymentDate: new Date("2026-10-05T15:00:00Z") }));
    expect(r).toMatchObject({ id: "x", tipo: "SALARIO", competencia: "09/2026", valor: 1234.5, status: "PAID", vencimento: "2026-10-05", pagoEm: "2026-10-05" });
  });
});
