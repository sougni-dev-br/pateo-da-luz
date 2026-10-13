import { describe, expect, test } from "vitest";
import { montarItensCancelados, type ItemCanceladoAnalise } from "../agile-analise.report.js";

const periodo = { inicio: "2026-10-01", fim: "2026-10-07" };
const dia = (d: string) => new Date(`${d}T12:00:00.000Z`);

function item(over: Partial<ItemCanceladoAnalise>): ItemCanceladoAnalise {
  return {
    saleId: "1",
    movementDate: dia("2026-10-01"),
    saleHour: "13:10",
    productName: "BUFFET PROMO 15",
    productGroup: "Buffet",
    quantity: 1,
    totalAmount: 100,
    launchedBy: "Ana",
    cancelledBy: null,
    cancelReason: null,
    ...over
  };
}

const itens: ItemCanceladoAnalise[] = [
  item({ saleId: "1", quantity: 14, totalAmount: 1216.6, launchedBy: "Ana", cancelledBy: "Ana" }),
  item({ saleId: "1", productName: "AGUA COM GAS", productGroup: "Bebidas", quantity: 2, totalAmount: 16, launchedBy: "Ana", cancelledBy: "Bruno" }),
  item({ saleId: "2", movementDate: dia("2026-10-02"), saleHour: "20:30", productName: "AGUA COM GAS", productGroup: "Bebidas", quantity: 1, totalAmount: 8, launchedBy: "Bruno", cancelledBy: "Carla", cancelReason: "Cliente desistiu" }),
  item({ saleId: "3", movementDate: dia("2026-10-02"), saleHour: null, productName: "SOBREMESA", productGroup: null, quantity: 3, totalAmount: 60, launchedBy: null, cancelledBy: null })
];

describe("montarItensCancelados", () => {
  const r = montarItensCancelados(itens, 18000, periodo);

  test("resumo: itens, vendas afetadas, valor e taxa sobre o valor vendido", () => {
    expect(r.resumo.itens).toBe(4);
    expect(r.resumo.vendasAfetadas).toBe(3);
    expect(r.resumo.valorCancelado).toBe(1300.6);
    expect(r.resumo.valorItensRecebidos).toBe(18000);
    // 1300,60 / (18000 + 1300,60)
    expect(r.resumo.taxaValor).toBeCloseTo(1300.6 / 19300.6, 4);
  });

  test("quem cancelou ainda nao importado conta separado, sem inventar nome", () => {
    expect(r.resumo.semQuemCancelou).toBe(1);
    expect(r.porQuemCancelou.find((p) => p.pessoa === "(não informado)")).toMatchObject({ itens: 1, valor: 60 });
  });

  test("mesma pessoa lancou e cancelou: so conta quando os dois nomes existem", () => {
    expect(r.resumo.mesmaPessoa).toBe(1);
    expect(r.resumo.comOsDoisNomes).toBe(3);
  });

  test("motivo: conta os itens sem motivo informado", () => {
    expect(r.resumo.semMotivo).toBe(3);
  });

  test("por quem lancou: ordena por valor, com vendas distintas e participacao", () => {
    // "(não informado)" vai sempre para o fim, mesmo valendo mais que os outros: não é uma pessoa.
    expect(r.porQuemLancou.map((p) => [p.pessoa, p.itens, p.vendas, p.valor])).toEqual([
      ["Ana", 2, 1, 1232.6],
      ["Bruno", 1, 1, 8],
      ["(não informado)", 1, 1, 60]
    ]);
    expect(r.porQuemLancou.reduce((s, p) => s + p.participacao, 0)).toBeCloseTo(1, 3);
  });

  test("por produto: soma quantidade e valor, do maior valor para o menor", () => {
    expect(r.porProduto.map((p) => [p.produto, p.linhas, p.quantidade, p.valor])).toEqual([
      ["BUFFET PROMO 15", 1, 14, 1216.6],
      ["SOBREMESA", 1, 3, 60],
      ["AGUA COM GAS", 2, 3, 24]
    ]);
    expect(r.porProduto[1].grupo).toBe("(sem grupo)");
  });

  test("por hora: hora cheia e venda sem hora no fim", () => {
    expect(r.porHora.map((h) => [h.hora, h.itens, h.valor])).toEqual([["13", 2, 1232.6], ["20", 1, 8], ["—", 1, 60]]);
  });

  test("maiores: item a item, com quem lancou, quem cancelou e motivo", () => {
    expect(r.maiores[0]).toMatchObject({ produto: "BUFFET PROMO 15", quantidade: 14, valor: 1216.6, data: "2026-10-01", hora: "13:10", quemLancou: "Ana", quemCancelou: "Ana", motivo: null });
    expect(r.maiores[3]).toMatchObject({ quemCancelou: "Carla", motivo: "Cliente desistiu" });
    expect(r.maiores).toHaveLength(4);
  });

  test("so lista os 10 maiores e os 10 produtos principais", () => {
    const muitos = Array.from({ length: 15 }, (_, i) => item({ saleId: `m${i}`, productName: `P${i}`, totalAmount: 10 + i }));
    const rr = montarItensCancelados(muitos, 1000, periodo);
    expect(rr.maiores).toHaveLength(10);
    expect(rr.porProduto).toHaveLength(10);
  });

  test("cobertura informa o intervalo com dado e quantos itens ficaram de fora por falta da venda", () => {
    expect(r.cobertura).toEqual({ itensCancelados: 4, itensSemVenda: 0, primeiroDia: "2026-10-01", ultimoDia: "2026-10-02" });
    expect(montarItensCancelados(itens, 18000, periodo, 7).cobertura.itensSemVenda).toBe(7);
  });

  test("sem nenhum item cancelado: zeros, sem dividir por zero", () => {
    const vazio = montarItensCancelados([], 0, periodo);
    expect(vazio.resumo).toEqual({
      itens: 0, vendasAfetadas: 0, valorCancelado: 0, valorItensRecebidos: 0, taxaValor: 0,
      semQuemCancelou: 0, semMotivo: 0, mesmaPessoa: 0, comOsDoisNomes: 0
    });
    expect(vazio.cobertura).toEqual({ itensCancelados: 0, itensSemVenda: 0, primeiroDia: null, ultimoDia: null });
    expect([vazio.porQuemLancou, vazio.porQuemCancelou, vazio.porProduto, vazio.porHora, vazio.maiores]).toEqual([[], [], [], [], []]);
  });

  test("nome com espacos sobrando nao vira duas pessoas", () => {
    const rr = montarItensCancelados([item({ saleId: "a", launchedBy: "Ana" }), item({ saleId: "b", launchedBy: " Ana  " })], 0, periodo);
    expect(rr.porQuemLancou).toHaveLength(1);
    expect(rr.porQuemLancou[0].itens).toBe(2);
  });
});
