import { describe, expect, it } from "vitest";
import { resumoDasFaturas, vencimentoRelativo } from "../resumo-de-faturas";

const hoje = new Date(2026, 8, 20); // 20/09/2026

describe("vencimentoRelativo", () => {
  it("fatura em aberto que vence no futuro", () => {
    expect(vencimentoRelativo("2026-09-25T00:00:00.000Z", "OPEN", hoje)).toEqual({ texto: "vence em 5 dias", tom: "ok" });
  });
  it("vence hoje e amanhã", () => {
    expect(vencimentoRelativo("2026-09-20T00:00:00.000Z", "OPEN", hoje)).toEqual({ texto: "vence hoje", tom: "atencao" });
    expect(vencimentoRelativo("2026-09-21T00:00:00.000Z", "CHECKED", hoje)).toEqual({ texto: "vence amanhã", tom: "atencao" });
  });
  it("vencimento até 3 dias pede atenção", () => {
    expect(vencimentoRelativo("2026-09-23T00:00:00.000Z", "OPEN", hoje).tom).toBe("atencao");
    expect(vencimentoRelativo("2026-09-24T00:00:00.000Z", "OPEN", hoje).tom).toBe("ok");
  });
  it("vencida e ainda não paga", () => {
    expect(vencimentoRelativo("2026-09-18T00:00:00.000Z", "CLOSED", hoje)).toEqual({ texto: "venceu há 2 dias", tom: "atraso" });
    expect(vencimentoRelativo("2026-09-19T00:00:00.000Z", "OPEN", hoje).texto).toBe("venceu ontem");
  });
  it("paga ou cancelada não mostra prazo", () => {
    expect(vencimentoRelativo("2026-09-18T00:00:00.000Z", "PAID", hoje)).toEqual({ texto: "", tom: "neutro" });
    expect(vencimentoRelativo("2026-09-18T00:00:00.000Z", "CANCELLED", hoje).tom).toBe("neutro");
  });
});

const fatura = (o: object) => ({ status: "OPEN", totalAmount: "100.00", dueDate: "2026-09-25T00:00:00.000Z", itensSemCartao: 0, creditCard: { name: "Conta", finais: [] as Array<{ isActive: boolean }> }, ...o });

describe("resumoDasFaturas", () => {
  it("soma abertas e conferidas separadamente", () => {
    const r = resumoDasFaturas([fatura({ totalAmount: "100.50" }), fatura({ totalAmount: "50.00" }), fatura({ status: "CHECKED", totalAmount: "30" })], hoje);
    expect(r.abertas).toEqual({ valor: 150.5, qtd: 2 });
    expect(r.conferidas).toEqual({ valor: 30, qtd: 1 });
  });
  it("conta itens sem cartão só de conta que tem finais ativos", () => {
    const comFinais = { name: "A", finais: [{ isActive: true }] };
    const r = resumoDasFaturas([fatura({ itensSemCartao: 3, creditCard: comFinais }), fatura({ itensSemCartao: 5 })], hoje);
    expect(r.semCartao).toBe(3);
  });
  it("próximo vencimento é a fatura não paga mais cedo, vencida antes das futuras", () => {
    const r = resumoDasFaturas([
      fatura({ dueDate: "2026-10-18T00:00:00.000Z", totalAmount: "300" }),
      fatura({ dueDate: "2026-09-18T00:00:00.000Z", totalAmount: "200", status: "CLOSED" }),
      fatura({ dueDate: "2026-08-18T00:00:00.000Z", status: "PAID" })
    ], hoje);
    expect(r.proximoVencimento).toMatchObject({ dueDate: "2026-09-18T00:00:00.000Z", valor: 200, atrasada: true });
  });
  it("sem fatura a pagar, não há próximo vencimento", () => {
    expect(resumoDasFaturas([fatura({ status: "PAID" })], hoje).proximoVencimento).toBeNull();
  });
});
