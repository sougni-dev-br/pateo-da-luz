import { describe, expect, test } from "vitest";
import type { RequisitionPurchaseItem } from "../../../api/client";
import { decisoesIniciais, itensParaEnviar, podeGerar, resumirPedido, situacaoDoItem } from "../pedido";

const item = (id: string, extra: Partial<RequisitionPurchaseItem> = {}): RequisitionPurchaseItem => ({
  productId: id, name: id.toUpperCase(), code: null, unit: "KG", withdrawn: 3, balance: 10, estoqueMinimo: null, estoqueIdeal: null,
  suggestedQuantity: 3, defaultSupplierId: "f1", unitPrice: 10,
  supplierOptions: [{ supplierId: "f1", supplierName: "F1", unitPrice: 10, lastPurchaseDate: "2026-09-01", purchaseCount: 2 }], ...extra
});

describe("decisões", () => {
  test("começa no que saiu e no fornecedor de sempre", () => {
    expect(decisoesIniciais([item("a", { suggestedQuantity: 2.5 })])).toEqual({ a: { quantity: "2,5", supplierId: "f1" } });
  });

  test("a quantidade que a pessoa digitar é a que vale e é marcada como alterada", () => {
    const s = situacaoDoItem(item("a"), { quantity: "5", supplierId: "f1" });
    expect(s).toMatchObject({ quantidade: 5, alterada: true, total: 50, foraDoPedido: false, invalida: false });
  });

  test("a sugestão intacta não conta como alterada", () => {
    expect(situacaoDoItem(item("a"), { quantity: "3", supplierId: "f1" }).alterada).toBe(false);
  });

  test("vazio ou zero deixa o item fora do pedido", () => {
    expect(situacaoDoItem(item("a"), { quantity: "", supplierId: "f1" })).toMatchObject({ foraDoPedido: true, quantidade: 0 });
    expect(situacaoDoItem(item("a"), { quantity: "0", supplierId: "f1" }).foraDoPedido).toBe(true);
  });

  test("texto ilegível e negativo são inválidos, não somem", () => {
    expect(situacaoDoItem(item("a"), { quantity: "abc", supplierId: "f1" }).invalida).toBe(true);
    expect(situacaoDoItem(item("a"), { quantity: "-2", supplierId: "f1" }).invalida).toBe(true);
  });

  test("preço vem do fornecedor escolhido; outro fornecedor sem histórico fica sem preço", () => {
    expect(situacaoDoItem(item("a"), { quantity: "2", supplierId: "f1" }).preco).toBe(10);
    expect(situacaoDoItem(item("a"), { quantity: "2", supplierId: "f9" })).toMatchObject({ preco: null, total: null });
  });
});

describe("resumo e envio", () => {
  const itens = [item("a"), item("b", { defaultSupplierId: null }), item("c", { suggestedQuantity: 1 })];

  test("item sem fornecedor bloqueia a geração até a pessoa escolher ou deixar de fora", () => {
    const decisoes = decisoesIniciais(itens);
    const r = resumirPedido(itens, decisoes);
    expect(r.semFornecedor).toEqual(["b"]);
    expect(podeGerar(r)).toBe(false);

    decisoes.b = { quantity: "", supplierId: null };
    const depois = resumirPedido(itens, decisoes);
    expect(podeGerar(depois)).toBe(true);
    expect(depois).toMatchObject({ itens: 2, fornecedores: 1, foraDoPedido: 1, total: 40 });
  });

  test("quantidade inválida bloqueia", () => {
    const decisoes = { ...decisoesIniciais([item("a")]), a: { quantity: "x", supplierId: "f1" } };
    expect(podeGerar(resumirPedido([item("a")], decisoes))).toBe(false);
  });

  test("conta quantos itens ficaram sem preço, para a tela dizer que o total é estimado", () => {
    const sem = item("s", { supplierOptions: [] });
    const r = resumirPedido([item("a"), sem], decisoesIniciais([item("a"), sem]));
    expect(r.semPreco).toBe(1);
    expect(r.total).toBe(30);
  });

  test("envia só o que tem quantidade e fornecedor, com as quantidades confirmadas", () => {
    const decisoes = { ...decisoesIniciais(itens), a: { quantity: "7", supplierId: "f1" }, b: { quantity: "", supplierId: null } };
    expect(itensParaEnviar(itens, decisoes)).toEqual([
      { productId: "a", supplierId: "f1", requestedQuantity: 7, unitPriceEstimated: 10 },
      { productId: "c", supplierId: "f1", requestedQuantity: 1, unitPriceEstimated: 10 }
    ]);
  });
});
