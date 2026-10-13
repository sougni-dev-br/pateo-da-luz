import { describe, expect, test } from "vitest";
import { montarDescontos, type VendaDescontoAnalise } from "../agile-analise.report.js";

const periodo = { inicio: "2026-10-01", fim: "2026-10-07" };
const dia = (d: string) => new Date(`${d}T12:00:00.000Z`);

function venda(over: Partial<VendaDescontoAnalise>): VendaDescontoAnalise {
  return {
    saleId: "1",
    movementDate: dia("2026-10-01"),
    shift: "Almoço",
    saleHour: "13:10",
    people: 2,
    subtotalAmount: 200,
    discountAmount: 0,
    totalAmount: 220,
    discountLabel: null,
    registeredBy: null,
    ...over
  };
}

const vendas: VendaDescontoAnalise[] = [
  venda({ saleId: "1" }),
  venda({ saleId: "2", subtotalAmount: 100, totalAmount: 110 }),
  venda({ saleId: "3", shift: "Jantar", saleHour: "20:30", subtotalAmount: 200, discountAmount: 60, totalAmount: 160, discountLabel: "DESCONTO 30%", registeredBy: "Ana" }),
  venda({ saleId: "4", movementDate: dia("2026-10-02"), shift: "Jantar", saleHour: "21:00", subtotalAmount: 150, discountAmount: 82, totalAmount: 83.5, discountLabel: "DESCONTO PRATO DUO APP", registeredBy: "Bruno" }),
  venda({ saleId: "5", movementDate: dia("2026-10-02"), shift: "Jantar", saleHour: null, subtotalAmount: 100, discountAmount: 90, totalAmount: 20, discountLabel: "POR VALOR", registeredBy: "Ana" }),
  venda({ saleId: "6", movementDate: dia("2026-10-02"), subtotalAmount: 50, discountAmount: 5, totalAmount: 50, discountLabel: null, registeredBy: null })
];

describe("montarDescontos", () => {
  const r = montarDescontos(vendas, periodo);

  test("resumo: vendas, valor e percentual sobre o subtotal dos itens", () => {
    // subtotal total = 200+100+200+150+100+50 = 800; desconto = 60+82+90+5 = 237
    expect(r.resumo.vendasRecebidas).toBe(6);
    expect(r.resumo.vendasComDesconto).toBe(4);
    expect(r.resumo.taxaVendas).toBeCloseTo(4 / 6, 4);
    expect(r.resumo.valorDescontos).toBe(237);
    expect(r.resumo.valorSubtotal).toBe(800);
    expect(r.resumo.percentualSobreSubtotal).toBeCloseTo(237 / 800, 4);
    expect(r.resumo.descontoMedio).toBe(59.25);
  });

  test("desconto acima de 50% do subtotal e sinalizado", () => {
    // venda 4 (54,7%) e venda 5 (90%)
    expect(r.resumo.acimaDe50).toBe(2);
  });

  test("desconto com subtotal zero (item a zero) conta como acima de 50%, nao some do alerta", () => {
    const rr = montarDescontos([venda({ saleId: "z", subtotalAmount: 0, discountAmount: 40, totalAmount: 0 })], periodo);
    expect(rr.resumo.acimaDe50).toBe(1);
    expect(rr.resumo.vendasComDesconto).toBe(1);
  });

  test("sem pessoa e sem tipo sao contados, sem inventar nome", () => {
    expect(r.resumo.semPessoa).toBe(1);
    expect(r.resumo.semTipo).toBe(1);
  });

  test("por tipo: valor, participacao e percentual medio do proprio tipo", () => {
    expect(r.porTipo.map((t) => [t.tipo, t.vendas, t.valor])).toEqual([
      ["POR VALOR", 1, 90],
      ["DESCONTO PRATO DUO APP", 1, 82],
      ["DESCONTO 30%", 1, 60],
      ["(tipo não informado)", 1, 5]
    ]);
    const duo = r.porTipo.find((t) => t.tipo === "DESCONTO PRATO DUO APP")!;
    expect(duo.percentualMedio).toBeCloseTo(82 / 150, 4);
    expect(r.porTipo.reduce((s, t) => s + t.participacao, 0)).toBeCloseTo(1, 3);
  });

  test("por pessoa: quem registrou o desconto, '(nao informado)' por ultimo", () => {
    expect(r.porPessoa.map((p) => [p.pessoa, p.vendas, p.valor])).toEqual([
      ["Ana", 2, 150],
      ["Bruno", 1, 82],
      ["(não informado)", 1, 5]
    ]);
    expect(r.porPessoa[0].percentualMedio).toBeCloseTo(150 / 300, 4);
  });

  test("por turno: taxa de vendas com desconto no proprio turno", () => {
    const almoco = r.porTurno.find((t) => t.turno === "Almoço")!;
    const jantar = r.porTurno.find((t) => t.turno === "Jantar")!;
    expect([almoco.vendas, almoco.vendasComDesconto, almoco.valor]).toEqual([3, 1, 5]);
    expect([jantar.vendas, jantar.vendasComDesconto, jantar.valor]).toEqual([3, 3, 232]);
    expect(jantar.taxa).toBe(1);
  });

  test("maiores: pelo valor do desconto, com percentual, tipo e pessoa", () => {
    expect(r.maiores.map((m) => m.saleId)).toEqual(["5", "4", "3", "6"]);
    expect(r.maiores[0]).toMatchObject({ data: "2026-10-02", hora: null, subtotal: 100, desconto: 90, percentual: 0.9, tipo: "POR VALOR", pessoa: "Ana", pessoas: 2 });
  });

  test("so lista os 10 maiores", () => {
    const muitas = Array.from({ length: 15 }, (_, i) => venda({ saleId: `d${i}`, discountAmount: 10 + i, totalAmount: 100 }));
    expect(montarDescontos(muitas, periodo).maiores).toHaveLength(10);
  });

  test("cobertura: vendas com dado de desconto e intervalo", () => {
    expect(r.cobertura).toEqual({ vendasComDado: 6, vendasSemDado: 0, primeiroDia: "2026-10-01", ultimoDia: "2026-10-02" });
  });

  test("venda sem dado de desconto (null) nao vira zero: fica fora das contas e e contada a parte", () => {
    const rr = montarDescontos(
      [
        venda({ saleId: "a", discountAmount: 50, subtotalAmount: 100, discountLabel: "POR VALOR", registeredBy: "Ana" }),
        venda({ saleId: "b", subtotalAmount: null, discountAmount: null }),
        venda({ saleId: "c", subtotalAmount: null, discountAmount: null })
      ],
      periodo
    );
    expect(rr.cobertura).toMatchObject({ vendasComDado: 1, vendasSemDado: 2 });
    expect(rr.resumo.vendasRecebidas).toBe(1);
    expect(rr.resumo.taxaVendas).toBe(1);
  });

  test("tudo sem dado: zeros e listas vazias, sem dividir por zero", () => {
    const vazio = montarDescontos([venda({ subtotalAmount: null, discountAmount: null })], periodo);
    expect(vazio.cobertura).toMatchObject({ vendasComDado: 0, vendasSemDado: 1, primeiroDia: null, ultimoDia: null });
    expect(vazio.resumo).toMatchObject({ vendasRecebidas: 0, vendasComDesconto: 0, taxaVendas: 0, valorDescontos: 0, percentualSobreSubtotal: 0, descontoMedio: 0 });
    expect([vazio.porTipo, vazio.porPessoa, vazio.porTurno, vazio.maiores]).toEqual([[], [], [], []]);
  });

  test("nome com espacos sobrando nao vira duas pessoas", () => {
    const rr = montarDescontos([venda({ saleId: "a", discountAmount: 10, registeredBy: "Ana" }), venda({ saleId: "b", discountAmount: 10, registeredBy: " Ana  " })], periodo);
    expect(rr.porPessoa).toHaveLength(1);
  });
});
