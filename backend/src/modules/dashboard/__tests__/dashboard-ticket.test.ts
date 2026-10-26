import { describe, expect, it } from "vitest";
import { calcularTicketsSalao, variacaoPercentual } from "../dashboard-ticket.js";

describe("calcularTicketsSalao", () => {
  it("divide o bruto do salão pelas mesas e pelas pessoas do salão", () => {
    const r = calcularTicketsSalao({ netAmount: 100000, tickets: 500, peopleServed: 1000 });
    expect(r.perTable).toBe(200);
    expect(r.perPerson).toBe(100);
  });

  it("devolve zero, e não NaN, sem mesas nem pessoas", () => {
    expect(calcularTicketsSalao({ netAmount: 500, tickets: 0, peopleServed: 0 })).toEqual({ perTable: 0, perPerson: 0 });
    expect(calcularTicketsSalao({ netAmount: 0, tickets: 0, peopleServed: 0 })).toEqual({ perTable: 0, perPerson: 0 });
  });

  it("mesa sem pessoas informadas não zera o ticket por mesa", () => {
    const r = calcularTicketsSalao({ netAmount: 1000, tickets: 5, peopleServed: 0 });
    expect(r.perTable).toBe(200);
    expect(r.perPerson).toBe(0);
  });
});

describe("variacaoPercentual", () => {
  it("mês cheio x mês parcial: ticket do salão estável não vira alta enorme", () => {
    // o delivery (muitos pedidos, nenhuma pessoa) fica de fora das duas bases
    const set = calcularTicketsSalao({ netAmount: 180000, tickets: 900, peopleServed: 1800 });
    const out = calcularTicketsSalao({ netAmount: 100000, tickets: 500, peopleServed: 1000 });
    const variacao = variacaoPercentual(out.perTable, set.perTable);
    expect(variacao).not.toBeNull();
    expect(Math.abs(variacao as number)).toBeLessThan(5);
  });

  it("sem base anterior não há comparação", () => {
    expect(variacaoPercentual(100, 0)).toBeNull();
  });

  it("calcula queda e alta", () => {
    expect(variacaoPercentual(90, 100)).toBeCloseTo(-10);
    expect(variacaoPercentual(110, 100)).toBeCloseTo(10);
  });
});
