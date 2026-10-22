import { describe, expect, test } from "vitest";
import { avaliarCartoesDoMes, type CartaoDoMes, type FaturaDoMes } from "../cartoes-do-fechamento.js";

const VISA: CartaoDoMes = { id: "c1", name: "Visa Empresa", last4Digits: "1234" };
const ELO: CartaoDoMes = { id: "c2", name: "Elo Compras", last4Digits: "9876" };

const fatura = (parcial: Partial<FaturaDoMes> & { creditCardId: string }): FaturaDoMes => ({
  status: "CHECKED",
  itensComDivergencia: 0,
  ...parcial
});

describe("conferência do cartão no fechamento do mês", () => {
  test("fatura conferida e sem divergência não gera pendência", () => {
    const pendencias = avaliarCartoesDoMes([VISA], [fatura({ creditCardId: "c1", status: "CHECKED" })]);
    expect(pendencias).toEqual([]);
  });

  test("fatura já fechada ou paga também conta como conferida", () => {
    const pendencias = avaliarCartoesDoMes(
      [VISA, ELO],
      [fatura({ creditCardId: "c1", status: "CLOSED" }), fatura({ creditCardId: "c2", status: "PAID" })]
    );
    expect(pendencias).toEqual([]);
  });

  test("cartão sem fatura no mês é pendência, com a chave do cartão", () => {
    const [p] = avaliarCartoesDoMes([VISA], []);
    expect(p.key).toBe("card:c1");
    expect(p.label).toContain("Visa Empresa");
    expect(p.label).toContain("1234");
    expect(p.label).toMatch(/sem fatura/i);
  });

  test("fatura aberta (OPEN) ainda não foi conferida", () => {
    const [p] = avaliarCartoesDoMes([VISA], [fatura({ creditCardId: "c1", status: "OPEN" })]);
    expect(p.key).toBe("card:c1");
    expect(p.label).toMatch(/não conferida/i);
  });

  test("fatura cancelada vale como se não existisse", () => {
    const [p] = avaliarCartoesDoMes([VISA], [fatura({ creditCardId: "c1", status: "CANCELLED" })]);
    expect(p.label).toMatch(/sem fatura/i);
  });

  test("divergência registrada e não resolvida segura o fechamento mesmo com fatura conferida", () => {
    const [p] = avaliarCartoesDoMes(
      [VISA],
      [fatura({ creditCardId: "c1", status: "CHECKED", itensComDivergencia: 3 })]
    );
    expect(p.key).toBe("card:c1");
    expect(p.label).toMatch(/3 item\(ns\) com divergência/i);
  });

  test("cada cartão pendente vira uma pendência própria, na ordem recebida", () => {
    const pendencias = avaliarCartoesDoMes(
      [VISA, ELO],
      [fatura({ creditCardId: "c2", status: "OPEN" })]
    );
    expect(pendencias.map((p) => p.key)).toEqual(["card:c1", "card:c2"]);
  });

  test("sem nenhum cartão ativo não há o que conferir", () => {
    expect(avaliarCartoesDoMes([], [])).toEqual([]);
  });

  test("fatura de outro cartão não conta para este", () => {
    const [p] = avaliarCartoesDoMes([VISA], [fatura({ creditCardId: "outro", status: "CHECKED" })]);
    expect(p.key).toBe("card:c1");
  });
});
