import { describe, expect, test } from "vitest";
import {
  montarCancelamentos,
  montarVendasPorPessoa,
  type ItemAnalise,
  type VendaAnalise
} from "../agile-analise.report.js";

const periodo = { inicio: "2026-10-01", fim: "2026-10-07" };
const dia = (d: string) => new Date(`${d}T12:00:00.000Z`);

function venda(over: Partial<VendaAnalise>): VendaAnalise {
  return {
    saleId: "1",
    movementDate: dia("2026-10-01"),
    shift: "Almoço",
    saleStatus: "RECEBIDA",
    saleHour: "12:10",
    people: 2,
    totalAmount: 100,
    cancelledBy: null,
    cancelReason: null,
    ...over
  };
}

const vendas: VendaAnalise[] = [
  venda({ saleId: "1", totalAmount: 100 }),
  venda({ saleId: "2", shift: "Jantar", saleHour: "20:05", totalAmount: 200 }),
  venda({ saleId: "3", saleStatus: "CANCELADA", saleHour: "12:40", totalAmount: 85.58, cancelledBy: "Ana" }),
  venda({ saleId: "4", movementDate: dia("2026-10-02"), shift: "Jantar", saleStatus: "CANCELADA", saleHour: "20:30", totalAmount: 120, cancelledBy: "Bruno", cancelReason: "Erro de lançamento", people: 4 }),
  venda({ saleId: "5", movementDate: dia("2026-10-02"), shift: "Jantar", saleStatus: "CANCELADA", saleHour: "21:10", totalAmount: 300 }),
  venda({ saleId: "6", movementDate: dia("2026-10-02"), shift: "Jantar", saleHour: null, totalAmount: 150 })
];

describe("montarCancelamentos", () => {
  const r = montarCancelamentos(vendas, periodo);

  test("resumo: taxa e valor perdido contam so as canceladas", () => {
    expect(r.resumo).toEqual({
      vendas: 6,
      canceladas: 3,
      taxaCancelamento: 0.5,
      valorCancelado: 505.58,
      valorFaturado: 450,
      semMotivo: 2
    });
  });

  test("por pessoa: ordena pelo valor e nao esconde quem nao foi informado", () => {
    expect(r.porPessoa.map((p) => [p.pessoa, p.canceladas, p.valor])).toEqual([
      ["(não informado)", 1, 300],
      ["Bruno", 1, 120],
      ["Ana", 1, 85.58]
    ]);
    expect(r.porPessoa[0].participacao).toBeCloseTo(300 / 505.58, 4);
    expect(r.porPessoa.reduce((s, p) => s + p.participacao, 0)).toBeCloseTo(1, 3);
  });

  test("por turno: taxa de cada turno sobre as vendas do proprio turno", () => {
    const almoco = r.porTurno.find((t) => t.turno === "Almoço")!;
    const jantar = r.porTurno.find((t) => t.turno === "Jantar")!;
    expect([almoco.vendas, almoco.canceladas, almoco.taxa]).toEqual([2, 1, 0.5]);
    expect([jantar.vendas, jantar.canceladas, jantar.taxa]).toEqual([4, 2, 0.5]);
    expect(jantar.valor).toBe(420);
  });

  test("por hora: agrupa pela hora cheia e separa venda sem hora", () => {
    const h = Object.fromEntries(r.porHora.map((x) => [x.hora, x]));
    expect(h["12"]).toMatchObject({ vendas: 2, canceladas: 1, valor: 85.58 });
    expect(h["20"]).toMatchObject({ vendas: 2, canceladas: 1, valor: 120 });
    expect(h["21"]).toMatchObject({ vendas: 1, canceladas: 1, valor: 300 });
    expect(h["—"]).toMatchObject({ vendas: 1, canceladas: 0 });
    expect(r.porHora.map((x) => x.hora)).toEqual(["12", "20", "21", "—"]);
  });

  test("por dia: uma linha por dia com dado, em ordem", () => {
    expect(r.porDia.map((d) => [d.data, d.vendas, d.canceladas, d.valor])).toEqual([
      ["2026-10-01", 3, 1, 85.58],
      ["2026-10-02", 3, 2, 420]
    ]);
  });

  test("maiores cancelamentos: do mais caro para o mais barato, com o motivo", () => {
    expect(r.maiores.map((m) => m.saleId)).toEqual(["5", "4", "3"]);
    expect(r.maiores[1]).toMatchObject({ saleId: "4", data: "2026-10-02", hora: "20:30", pessoa: "Bruno", pessoas: 4, motivo: "Erro de lançamento", valor: 120 });
    expect(r.maiores[2].motivo).toBeNull();
  });

  test("so lista os 10 maiores", () => {
    const muitas = Array.from({ length: 15 }, (_, i) => venda({ saleId: `c${i}`, saleStatus: "CANCELADA", totalAmount: 10 + i }));
    expect(montarCancelamentos(muitas, periodo).maiores).toHaveLength(10);
  });

  test("cobertura informa o intervalo que de fato tem detalhe", () => {
    expect(r.cobertura).toEqual({ vendasComDetalhe: 6, primeiroDia: "2026-10-01", ultimoDia: "2026-10-02" });
  });

  test("sem nenhuma venda detalhada: zeros e listas vazias, sem dividir por zero", () => {
    const vazio = montarCancelamentos([], periodo);
    expect(vazio.resumo).toEqual({ vendas: 0, canceladas: 0, taxaCancelamento: 0, valorCancelado: 0, valorFaturado: 0, semMotivo: 0 });
    expect(vazio.cobertura).toEqual({ vendasComDetalhe: 0, primeiroDia: null, ultimoDia: null });
    expect([vazio.porPessoa, vazio.porTurno, vazio.porHora, vazio.porDia, vazio.maiores]).toEqual([[], [], [], [], []]);
  });

  test("nome com espacos sobrando nao vira duas pessoas", () => {
    const rr = montarCancelamentos(
      [venda({ saleId: "a", saleStatus: "CANCELADA", cancelledBy: "Ana" }), venda({ saleId: "b", saleStatus: "CANCELADA", cancelledBy: " Ana  " })],
      periodo
    );
    expect(rr.porPessoa).toHaveLength(1);
    expect(rr.porPessoa[0].canceladas).toBe(2);
  });
});

function item(over: Partial<ItemAnalise>): ItemAnalise {
  return { saleId: "1", launchedBy: "Ana", productGroup: "Bebidas", quantity: 1, totalAmount: 10, ...over };
}

describe("montarVendasPorPessoa", () => {
  const itens: ItemAnalise[] = [
    item({ saleId: "1", launchedBy: "Ana", productGroup: "Bebidas", quantity: 2, totalAmount: 40 }),
    item({ saleId: "1", launchedBy: "Ana", productGroup: "Pratos", quantity: 1, totalAmount: 60 }),
    item({ saleId: "2", launchedBy: "Ana", productGroup: "Bebidas", quantity: 1, totalAmount: 20 }),
    item({ saleId: "2", launchedBy: "Bruno", productGroup: "Sobremesas", quantity: 3, totalAmount: 30 }),
    item({ saleId: "3", launchedBy: "Bruno", productGroup: null, quantity: 1, totalAmount: 50 }),
    item({ saleId: "4", launchedBy: null, productGroup: "Pratos", quantity: 2, totalAmount: 80 })
  ];
  const r = montarVendasPorPessoa(itens, periodo);

  test("ordena por valor e calcula participacao sobre quem tem nome", () => {
    expect(r.pessoas.map((p) => [p.pessoa, p.valor])).toEqual([["Ana", 120], ["Bruno", 80]]);
    expect(r.pessoas[0].participacao).toBeCloseTo(0.6, 4);
    expect(r.pessoas[1].participacao).toBeCloseTo(0.4, 4);
  });

  test("vendas contam vendas DISTINTAS em que a pessoa lancou item", () => {
    const ana = r.pessoas[0];
    expect(ana.vendas).toBe(2);
    expect(ana.itens).toBe(4);
    expect(ana.ticketMedio).toBe(60);
    expect(ana.itensPorVenda).toBe(2);
  });

  test("a venda dividida entre duas pessoas conta para as duas", () => {
    expect(r.pessoas.find((p) => p.pessoa === "Bruno")!.vendas).toBe(2);
  });

  test("mix por grupo, com a participacao dentro da propria pessoa", () => {
    const ana = r.pessoas[0];
    expect(ana.mix).toEqual([
      { grupo: "Pratos", valor: 60, participacao: 0.5 },
      { grupo: "Bebidas", valor: 60, participacao: 0.5 }
    ].sort((a, b) => b.valor - a.valor || a.grupo.localeCompare(b.grupo)));
    const bruno = r.pessoas[1];
    expect(bruno.mix.map((m) => m.grupo)).toEqual(["(sem grupo)", "Sobremesas"]);
  });

  test("mix mostra so os 5 maiores grupos", () => {
    const muitos = Array.from({ length: 7 }, (_, i) => item({ saleId: `m${i}`, productGroup: `G${i}`, totalAmount: 10 + i }));
    expect(montarVendasPorPessoa(muitos, periodo).pessoas[0].mix).toHaveLength(5);
  });

  test("item sem nome do funcionario nao some: aparece na cobertura", () => {
    expect(r.resumo).toEqual({ pessoas: 2, valorTotal: 200, valorSemPessoa: 80, itensSemPessoa: 1 });
    expect(r.cobertura).toEqual({ itensComPessoa: 5, itensSemPessoa: 1 });
  });

  test("sem itens: zeros e lista vazia", () => {
    const vazio = montarVendasPorPessoa([], periodo);
    expect(vazio.pessoas).toEqual([]);
    expect(vazio.resumo).toEqual({ pessoas: 0, valorTotal: 0, valorSemPessoa: 0, itensSemPessoa: 0 });
  });

  test("nome com caixa diferente continua sendo a mesma pessoa? NAO: respeita o que o PDV mandou", () => {
    const rr = montarVendasPorPessoa([item({ launchedBy: "Ana" }), item({ saleId: "2", launchedBy: "ANA" })], periodo);
    expect(rr.pessoas).toHaveLength(2);
  });
});
