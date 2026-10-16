import { describe, expect, test } from "vitest";
import { agruparPorPedido, descartarOrfaos, lerQuantidade, produtosAcimaDaNota, sugerirDivisao, sugerirParaNota, type ItemEmAberto } from "../vinculoPedido";

const item = (over: Partial<ItemEmAberto>): ItemEmAberto => ({
  purchaseOrderItemId: "i", orderId: "o", orderCode: "PC-1", orderStatus: "RASCUNHO", orderCreatedAt: "2026-09-01",
  productId: "p", productName: "Tomate", unit: "KG", pedida: 5, restante: 5, vinculada: null, unidadeCompativel: true, ...over
});

describe("sugerirDivisao", () => {
  const abertos = [item({ purchaseOrderItemId: "novo", restante: 4, orderCreatedAt: "2026-09-10" }), item({ purchaseOrderItemId: "antigo", restante: 3 })];
  test("enche o pedido mais antigo primeiro e passa o resto adiante", () => {
    expect(sugerirDivisao(5, abertos)).toEqual({ antigo: 3, novo: 2 });
  });
  test("o que passa do total dos pedidos não vira vínculo", () => {
    expect(sugerirDivisao(20, abertos)).toEqual({ antigo: 3, novo: 4 });
  });
  test("decimais não acumulam erro", () => {
    expect(sugerirDivisao(0.3, [item({ purchaseOrderItemId: "a", restante: 0.1 }), item({ purchaseOrderItemId: "b", restante: 0.2, orderCreatedAt: "2026-09-02" })])).toEqual({ a: 0.1, b: 0.2 });
  });
});

describe("sugerirParaNota", () => {
  test("soma o mesmo produto repetido na nota e separa produtos diferentes", () => {
    const abertos = [item({ purchaseOrderItemId: "t", productId: "tomate", restante: 10 }), item({ purchaseOrderItemId: "c", productId: "cebola", restante: 1 })];
    const r = sugerirParaNota([{ productId: "tomate", quantity: 2 }, { productId: "tomate", quantity: 3 }, { productId: "cebola", quantity: 4 }], abertos);
    expect(r).toEqual({ t: 5, c: 1 });
  });
});

describe("agruparPorPedido", () => {
  test("agrupa por pedido, do mais antigo para o mais novo", () => {
    const g = agruparPorPedido([
      item({ purchaseOrderItemId: "1", orderId: "b", orderCode: "PC-B", orderCreatedAt: "2026-09-10" }),
      item({ purchaseOrderItemId: "2", orderId: "a", orderCode: "PC-A", orderCreatedAt: "2026-09-01" }),
      item({ purchaseOrderItemId: "3", orderId: "a", orderCode: "PC-A", orderCreatedAt: "2026-09-01" })
    ]);
    expect(g.map((x) => [x.orderCode, x.itens.length])).toEqual([["PC-A", 2], ["PC-B", 1]]);
  });
});

describe("produtosAcimaDaNota", () => {
  const abertos = [item({ purchaseOrderItemId: "a", productId: "p", productName: "Tomate" }), item({ purchaseOrderItemId: "b", productId: "p", productName: "Tomate" })];
  test("avisa quando a soma ligada passa do que a nota trouxe", () => {
    expect(produtosAcimaDaNota({ a: 3, b: 3 }, abertos, [{ productId: "p", quantity: 5 }])).toEqual(["Tomate"]);
  });
  test("dentro do total não avisa", () => {
    expect(produtosAcimaDaNota({ a: 3, b: 2 }, abertos, [{ productId: "p", quantity: 5 }])).toEqual([]);
  });
});

describe("lerQuantidade", () => {
  test("aceita vírgula e ponto; vazio, zero e texto viram null", () => {
    expect(lerQuantidade("1,5")).toBe(1.5);
    expect(lerQuantidade("2.25")).toBe(2.25);
    for (const t of ["", "0", "abc", "-1"]) expect(lerQuantidade(t)).toBeNull();
  });
});

describe("unidade incompatível", () => {
  test("a sugestão não liga pedido em outra unidade (caixa x unidade)", () => {
    const abertos = [item({ purchaseOrderItemId: "caixa", unidadeCompativel: false }), item({ purchaseOrderItemId: "un", orderCreatedAt: "2026-09-05" })];
    expect(sugerirParaNota([{ productId: "p", quantity: 24 }], abertos)).toEqual({ un: 5 });
  });
});

describe("descartarOrfaos", () => {
  test("remove o que não está mais na lista de pedidos em aberto e mantém o resto", () => {
    const abertos = [item({ purchaseOrderItemId: "fica" })];
    expect(descartarOrfaos({ fica: "2", some: "3" }, abertos)).toEqual({ fica: "2" });
  });
});
