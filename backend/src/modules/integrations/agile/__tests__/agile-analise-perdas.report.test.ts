import { describe, expect, test } from "vitest";
import { montarCancelamentos, montarDescontos, montarItensCancelados, type ItemCanceladoAnalise } from "../agile-analise.report.js";
import { montarPerdas } from "../agile-analise-perdas.report.js";
import { LIMITE_CANCELAMENTO_GRANDE, type VendaVisao } from "../agile-analise-visao.report.js";

const periodo = { inicio: "2026-10-01", fim: "2026-10-31" };
const dia = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const venda = (over: Partial<VendaVisao> & { saleId: string }): VendaVisao => ({
  movementDate: dia("2026-10-05"), shift: "Almoço", saleStatus: "RECEBIDA", saleHour: "13:00", people: 2, totalAmount: 200,
  subtotalAmount: null, discountAmount: null, cancelledBy: null, cancelReason: null, ...over
});
const item = (over: Partial<ItemCanceladoAnalise> & { saleId: string }): ItemCanceladoAnalise => ({
  movementDate: dia("2026-10-05"), saleHour: "13:00", productName: "Prato", productGroup: "Pratos", quantity: 1, totalAmount: 50,
  launchedBy: "Lia", cancelledBy: "Ana", cancelReason: null, ...over
});

function perdas(vendas: VendaVisao[], itens: ItemCanceladoAnalise[] = []) {
  return montarPerdas({
    periodo,
    vendas,
    cancelamentos: montarCancelamentos(vendas, periodo),
    itens: montarItensCancelados(itens, 10000, periodo),
    descontos: montarDescontos(
      vendas.filter((v) => v.saleStatus === "RECEBIDA").map((v) => ({
        saleId: v.saleId, movementDate: v.movementDate, shift: v.shift, saleHour: v.saleHour, people: v.people, totalAmount: v.totalAmount,
        subtotalAmount: v.subtotalAmount, discountAmount: v.discountAmount, discountLabel: "DESCONTO", registeredBy: v.cancelledBy
      })),
      periodo
    )
  });
}

describe("montarPerdas — funil", () => {
  const vendas = [
    venda({ saleId: "r1", totalAmount: 1000, people: 5 }),
    venda({ saleId: "c1", saleStatus: "CANCELADA", totalAmount: 200, people: 2, saleHour: "12:00", cancelledBy: "Ana" }),
    venda({ saleId: "r2", totalAmount: 202, people: 2, saleHour: "12:05" }), // refaz c1
    venda({ saleId: "c2", saleStatus: "CANCELADA", totalAmount: 300, people: 4, saleHour: "20:00", cancelledBy: "Ana" }),
    venda({ saleId: "d1", totalAmount: 180, people: 2, saleHour: "21:00", subtotalAmount: 200, discountAmount: 20, cancelledBy: "Bia" })
  ];

  test("faturado, cancelado, refeito, sem refacao, itens, descontos e perda total", () => {
    const f = perdas(vendas, [item({ saleId: "r1", totalAmount: 50 })]).funil;
    expect(f).toMatchObject({ faturado: 1382, cancelado: 500, refeito: 200, semRefacao: 300, itensCancelados: 50, descontos: 20, perdaTotal: 370, perdaTeto: 570 });
    expect(f.perdaPct).toBeCloseTo(370 / 1382, 4);
  });

  test("a refacao explica a regra para a tela (janela e tolerancia) e a participacao", () => {
    const r = perdas(vendas).refacao;
    expect(r).toMatchObject({ vendas: 1, valor: 200, pctDoCancelado: 0.4, janelaMinutos: 10, toleranciaValor: 0.02 });
  });

  test("sem nenhuma venda: tudo zero e sem divisao por zero", () => {
    const p = perdas([]);
    expect(p.funil).toMatchObject({ faturado: 0, cancelado: 0, perdaTotal: 0, perdaPct: 0 });
    expect(p.refacao.pctDoCancelado).toBe(0);
    expect(p.porPessoa).toEqual([]);
    expect(p.grandes).toEqual([]);
  });

  test("anexa os tres relatorios detalhados para a tela abrir o detalhe", () => {
    const p = perdas(vendas);
    expect(p.cancelamentos.resumo.canceladas).toBe(2);
    expect(p.itens.resumo.itens).toBe(0);
    expect(p.descontos.resumo.vendasComDesconto).toBe(1);
  });
});

describe("montarPerdas — cancelamentos grandes", () => {
  test("lista so os de valor muito alto, do maior para o menor, e diz se tem refacao", () => {
    const p = perdas([
      venda({ saleId: "g1", saleStatus: "CANCELADA", totalAmount: 5000, people: 1, cancelledBy: "Ana", cancelReason: "evento adiado" }),
      venda({ saleId: "g2", saleStatus: "CANCELADA", totalAmount: LIMITE_CANCELAMENTO_GRANDE, people: 1, saleHour: "10:00" }),
      venda({ saleId: "r2", totalAmount: LIMITE_CANCELAMENTO_GRANDE, people: 1, saleHour: "10:05" }),
      venda({ saleId: "p", saleStatus: "CANCELADA", totalAmount: LIMITE_CANCELAMENTO_GRANDE - 0.01, people: 1 })
    ]);
    expect(p.grandes.map((g) => g.saleId)).toEqual(["g1", "g2"]);
    expect(p.grandes[0]).toMatchObject({ valor: 5000, pessoa: "Ana", motivo: "evento adiado", refeita: false });
    expect(p.grandes[1]).toMatchObject({ pessoa: "(não informado)", motivo: null, refeita: true });
    expect(p.funil.grandes).toBe(5000 + LIMITE_CANCELAMENTO_GRANDE);
    expect(p.limiteGrande).toBe(LIMITE_CANCELAMENTO_GRANDE);
  });

  test("a lista de grandes e limitada a 10, mas o total de grandes continua sendo o real", () => {
    const muitas = Array.from({ length: 15 }, (_, i) => venda({ saleId: `g${i}`, saleStatus: "CANCELADA", totalAmount: 2000 + i, people: 1 }));
    const p = perdas(muitas);
    expect(p.grandes).toHaveLength(10);
    expect(p.funil.grandesVendas).toBe(15);
  });
});

describe("montarPerdas — por pessoa", () => {
  test("junta cancelamento, item cancelado e desconto da mesma pessoa e ordena pela perda", () => {
    const p = perdas(
      [
        venda({ saleId: "c1", saleStatus: "CANCELADA", totalAmount: 400, people: 2, saleHour: "12:00", cancelledBy: "Ana" }),
        venda({ saleId: "c2", saleStatus: "CANCELADA", totalAmount: 100, people: 3, saleHour: "20:00", cancelledBy: "Bia" }),
        venda({ saleId: "d1", totalAmount: 180, people: 2, saleHour: "21:00", subtotalAmount: 200, discountAmount: 20, cancelledBy: "Ana" })
      ],
      [item({ saleId: "d1", totalAmount: 30, cancelledBy: "Ana" })]
    );
    const ana = p.porPessoa.find((x) => x.pessoa === "Ana");
    expect(ana).toMatchObject({ canceladas: 1, valorCancelado: 400, valorRefeito: 0, itens: 1, valorItens: 30, descontos: 1, valorDescontos: 20, perda: 450 });
    expect(p.porPessoa.map((x) => x.pessoa)).toEqual(["Ana", "Bia"]);
  });

  test("o valor refeito sai da perda da pessoa que cancelou", () => {
    const p = perdas([
      venda({ saleId: "c1", saleStatus: "CANCELADA", totalAmount: 200, people: 2, saleHour: "12:00", cancelledBy: "Ana" }),
      venda({ saleId: "r1", totalAmount: 200, people: 2, saleHour: "12:10" })
    ]);
    expect(p.porPessoa[0]).toMatchObject({ pessoa: "Ana", valorCancelado: 200, valorRefeito: 200, perda: 0 });
  });

  test("'(não informado)' fica por ultimo mesmo com a maior perda", () => {
    const p = perdas([
      venda({ saleId: "c1", saleStatus: "CANCELADA", totalAmount: 900, people: 2, cancelledBy: null }),
      venda({ saleId: "c2", saleStatus: "CANCELADA", totalAmount: 100, people: 3, saleHour: "20:00", cancelledBy: "Ana" })
    ]);
    expect(p.porPessoa.map((x) => x.pessoa)).toEqual(["Ana", "(não informado)"]);
  });

  test("espacos extras no nome nao criam duas pessoas", () => {
    const p = perdas([
      venda({ saleId: "c1", saleStatus: "CANCELADA", totalAmount: 100, people: 2, cancelledBy: "Ana  Silva" }),
      venda({ saleId: "c2", saleStatus: "CANCELADA", totalAmount: 100, people: 3, saleHour: "20:00", cancelledBy: " Ana Silva " })
    ]);
    expect(p.porPessoa).toHaveLength(1);
    expect(p.porPessoa[0].canceladas).toBe(2);
  });
});
