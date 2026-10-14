import { describe, expect, test } from "vitest";
import {
  calcularIndicadores, diasDoPeriodo, LIMITE_CANCELAMENTO_GRANDE, montarSerieDiaria, periodoAnteriorDe, variacao, type VendaVisao
} from "../agile-analise-visao.report.js";

const dia = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const venda = (over: Partial<VendaVisao> = {}): VendaVisao => ({
  saleId: "1", movementDate: dia("2026-10-05"), shift: "Almoço", saleStatus: "RECEBIDA", saleHour: "13:00", people: 2, totalAmount: 200,
  subtotalAmount: 200, discountAmount: 0, cancelledBy: null, cancelReason: null, ...over
});

describe("calcularIndicadores — faturamento e pessoas", () => {
  test("soma so as vendas RECEBIDAS e calcula tickets e medias por dia", () => {
    const i = calcularIndicadores(
      [
        venda({ saleId: "a", totalAmount: 300, people: 3 }),
        venda({ saleId: "b", totalAmount: 100, people: 1, movementDate: dia("2026-10-06") }),
        venda({ saleId: "c", saleStatus: "CANCELADA", totalAmount: 999, people: 9 }),
        venda({ saleId: "d", saleStatus: "EM ABERTO", totalAmount: 555, people: 5 })
      ],
      0
    );
    expect(i).toMatchObject({ faturamento: 400, comandas: 2, pessoas: 4, ticketPessoa: 100, ticketComanda: 200, diasComMovimento: 2, pessoasPorDia: 2, faturamentoPorDia: 200 });
  });

  test("venda sem numero de pessoas entra no faturamento mas nao infla o ticket por pessoa", () => {
    const i = calcularIndicadores([venda({ saleId: "a", totalAmount: 200, people: 2 }), venda({ saleId: "b", totalAmount: 5000, people: 0 })], 0);
    expect(i.faturamento).toBe(5200);
    expect(i.ticketPessoa).toBe(100);
    expect(i.vendasSemPessoas).toBe(1);
  });

  test("sem vendas: tudo zero, sem divisao por zero", () => {
    const i = calcularIndicadores([], 0);
    expect(i).toMatchObject({ faturamento: 0, comandas: 0, pessoas: 0, ticketPessoa: 0, ticketComanda: 0, pessoasPorDia: 0, perdaPct: 0, descontoPct: 0 });
  });

  test("so cancelamentos: faturamento zero e perda percentual zero (sem base)", () => {
    const i = calcularIndicadores([venda({ saleStatus: "CANCELADA", totalAmount: 100 })], 0);
    expect(i.faturamento).toBe(0);
    expect(i.canceladoValor).toBe(100);
    expect(i.perdaPct).toBe(0);
  });
});

describe("calcularIndicadores — perda liquida", () => {
  const base = [
    venda({ saleId: "r1", totalAmount: 1000, people: 5, saleHour: "13:00" }),
    venda({ saleId: "c1", saleStatus: "CANCELADA", totalAmount: 200, people: 2, saleHour: "12:00", cancelReason: "erro de lancamento" }),
    venda({ saleId: "r2", totalAmount: 202, people: 2, saleHour: "12:05" }), // refaz c1
    venda({ saleId: "c2", saleStatus: "CANCELADA", totalAmount: 300, people: 4, saleHour: "20:00" }) // sem par
  ];

  test("cancelamento refeito sai da perda; o sem par fica", () => {
    const i = calcularIndicadores(base, 0);
    expect(i).toMatchObject({ canceladoVendas: 2, canceladoValor: 500, refeitoVendas: 1, refeitoValor: 200 });
    expect(i.perdaValor).toBe(300);
    expect(i.perdaPct).toBeCloseTo(300 / 1202, 4);
  });

  test("o teto soma o cancelamento INTEIRO (sem abater a refacao, que e provavel e nao certa)", () => {
    const i = calcularIndicadores(base, 0);
    expect(i.perdaTetoValor).toBe(500);
    expect(i.perdaTetoValor).toBeGreaterThanOrEqual(i.perdaValor);
  });

  test("perda soma cancelamento sem par, itens cancelados e descontos", () => {
    const i = calcularIndicadores(
      [...base, venda({ saleId: "d1", totalAmount: 180, people: 2, saleHour: "21:00", subtotalAmount: 200, discountAmount: 20 })],
      50
    );
    expect(i.itensCanceladosValor).toBe(50);
    expect(i.descontoValor).toBe(20);
    expect(i.perdaValor).toBe(300 + 50 + 20);
    expect(i.perdaTetoValor).toBe(500 + 50 + 20);
  });

  test("cancelamentos grandes sao contados a parte e seguem dentro do total", () => {
    const i = calcularIndicadores(
      [venda({ saleStatus: "CANCELADA", saleId: "g", totalAmount: LIMITE_CANCELAMENTO_GRANDE, people: 1 }), venda({ saleStatus: "CANCELADA", saleId: "p", totalAmount: 999.99, people: 1 })],
      0
    );
    expect(i).toMatchObject({ grandesVendas: 1, grandesValor: LIMITE_CANCELAMENTO_GRANDE, canceladoValor: 1999.99 });
  });

  test("sem motivo: conta so a cancelada sem texto", () => {
    const i = calcularIndicadores(
      [venda({ saleStatus: "CANCELADA", saleId: "a", cancelReason: null }), venda({ saleStatus: "CANCELADA", saleId: "b", cancelReason: "  " }), venda({ saleStatus: "CANCELADA", saleId: "c", cancelReason: "cliente desistiu" })],
      0
    );
    expect(i.semMotivo).toBe(2);
  });

  test("desconto sem dado (null) nao e zero: fica de fora do percentual e e contado", () => {
    const i = calcularIndicadores(
      [venda({ saleId: "a", subtotalAmount: 200, discountAmount: 20, totalAmount: 180 }), venda({ saleId: "b", subtotalAmount: null, discountAmount: null })],
      0
    );
    expect(i.descontoValor).toBe(20);
    expect(i.descontoPct).toBe(0.1);
    expect(i.descontoSemDado).toBe(1);
  });

  test("desconto negativo vindo do PDV nao reduz a perda", () => {
    const i = calcularIndicadores([venda({ subtotalAmount: 100, discountAmount: -30 })], 0);
    expect(i.descontoValor).toBe(0);
  });
});

describe("periodoAnteriorDe e diasDoPeriodo", () => {
  test("30 dias comparam com os 30 imediatamente anteriores", () => {
    expect(periodoAnteriorDe({ inicio: "2026-09-14", fim: "2026-10-13" })).toEqual({ inicio: "2026-08-15", fim: "2026-09-13" });
  });
  test("um dia compara com o dia anterior", () => {
    expect(periodoAnteriorDe({ inicio: "2026-10-13", fim: "2026-10-13" })).toEqual({ inicio: "2026-10-12", fim: "2026-10-12" });
  });
  test("atravessa a virada de ano e ano bissexto", () => {
    expect(periodoAnteriorDe({ inicio: "2028-03-01", fim: "2028-03-10" })).toEqual({ inicio: "2028-02-20", fim: "2028-02-29" });
    expect(periodoAnteriorDe({ inicio: "2027-01-01", fim: "2027-01-31" })).toEqual({ inicio: "2026-12-01", fim: "2026-12-31" });
  });
  test("conta dias inclusive nas duas pontas", () => {
    expect(diasDoPeriodo({ inicio: "2026-10-01", fim: "2026-10-01" })).toBe(1);
    expect(diasDoPeriodo({ inicio: "2026-10-01", fim: "2026-10-31" })).toBe(31);
  });
});

describe("variacao", () => {
  test("calcula diferenca e percentual", () => {
    expect(variacao(110, 100)).toEqual({ atual: 110, anterior: 100, diferenca: 10, pct: 0.1 });
    expect(variacao(80, 100).pct).toBe(-0.2);
  });
  test("base zero: sem percentual (nao existe variacao relativa sobre zero)", () => {
    expect(variacao(50, 0)).toEqual({ atual: 50, anterior: 0, diferenca: 50, pct: null });
    expect(variacao(0, 0).pct).toBeNull();
  });
});

describe("montarSerieDiaria", () => {
  test("um ponto por dia do periodo, com zero nos dias parados", () => {
    const s = montarSerieDiaria(
      [venda({ saleId: "a", movementDate: dia("2026-10-01"), totalAmount: 100, people: 2 }), venda({ saleId: "b", movementDate: dia("2026-10-03"), totalAmount: 50, people: 1 })],
      { inicio: "2026-10-01", fim: "2026-10-04" }
    );
    expect(s.map((d) => d.data)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(s.map((d) => d.faturamento)).toEqual([100, 0, 50, 0]);
    expect(s.map((d) => d.temMovimento)).toEqual([true, false, true, false]);
  });
  test("so recebidas entram e vendas do mesmo dia somam", () => {
    const s = montarSerieDiaria(
      [venda({ saleId: "a", totalAmount: 100 }), venda({ saleId: "b", totalAmount: 60 }), venda({ saleId: "c", saleStatus: "CANCELADA", totalAmount: 900 })],
      { inicio: "2026-10-05", fim: "2026-10-05" }
    );
    expect(s).toEqual([{ data: "2026-10-05", faturamento: 160, pessoas: 4, comandas: 2, temMovimento: true }]);
  });
  test("venda fora do periodo pedido e ignorada", () => {
    const s = montarSerieDiaria([venda({ movementDate: dia("2026-11-01") })], { inicio: "2026-10-05", fim: "2026-10-06" });
    expect(s.every((d) => !d.temMovimento)).toBe(true);
  });
});
