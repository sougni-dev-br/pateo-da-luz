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

describe("casarNotaComPedidos", () => {
  const linha = (orderId: string, productId: string, restante: number, over: Partial<ItemEmAberto> = {}) =>
    item({ purchaseOrderItemId: `${orderId}-${productId}`, orderId, orderCode: orderId.toUpperCase(), productId, productName: productId, restante, pedida: restante, ...over });

  test("nota que bate com os itens e as quantidades do pedido liga sozinha", async () => {
    const { casarNotaComPedidos } = await import("../vinculoPedido");
    const abertos = [linha("a", "p1", 5), linha("a", "p2", 3), linha("a", "p3", 2)];
    const r = casarNotaComPedidos([{ productId: "p1", quantity: 5 }, { productId: "p2", quantity: 3 }, { productId: "p3", quantity: 2 }], abertos);
    expect(r.automatico).toBe(true);
    expect(r.vinculos).toEqual({ "a-p1": 5, "a-p2": 3, "a-p3": 2 });
    expect(r.pedidos.map((p) => p.orderCode)).toEqual(["A"]);
  });

  test("entre dois pedidos, escolhe o que tem as quantidades exatas", async () => {
    const { casarNotaComPedidos } = await import("../vinculoPedido");
    const abertos = [
      linha("velho", "p1", 9, { orderCreatedAt: "2026-09-01" }), linha("velho", "p2", 9, { orderCreatedAt: "2026-09-01" }),
      linha("certo", "p1", 4, { orderCreatedAt: "2026-09-10" }), linha("certo", "p2", 2, { orderCreatedAt: "2026-09-10" })
    ];
    const r = casarNotaComPedidos([{ productId: "p1", quantity: 4 }, { productId: "p2", quantity: 2 }], abertos);
    expect(r.automatico).toBe(true);
    expect(Object.keys(r.vinculos).sort()).toEqual(["certo-p1", "certo-p2"]);
  });

  test("dois pedidos igualmente bons: não decide sozinho, só aponta o melhor", async () => {
    const { casarNotaComPedidos } = await import("../vinculoPedido");
    const abertos = [
      linha("a", "p1", 4, { orderCreatedAt: "2026-09-01" }), linha("a", "p2", 2, { orderCreatedAt: "2026-09-01" }),
      linha("b", "p1", 4, { orderCreatedAt: "2026-09-08" }), linha("b", "p2", 2, { orderCreatedAt: "2026-09-08" })
    ];
    const r = casarNotaComPedidos([{ productId: "p1", quantity: 4 }, { productId: "p2", quantity: 2 }], abertos);
    expect(r.automatico).toBe(false);
    expect(r.vinculos).toEqual({});
    expect(r.melhor?.orderCode).toBe("A");
  });

  test("nota maior que um pedido passa o resto para o segundo pedido", async () => {
    const { casarNotaComPedidos } = await import("../vinculoPedido");
    const abertos = [
      linha("a", "p1", 3, { orderCreatedAt: "2026-09-01" }), linha("a", "p2", 1, { orderCreatedAt: "2026-09-01" }),
      linha("b", "p1", 2, { orderCreatedAt: "2026-09-08" })
    ];
    const r = casarNotaComPedidos([{ productId: "p1", quantity: 5 }, { productId: "p2", quantity: 1 }], abertos);
    expect(r.automatico).toBe(true);
    expect(r.vinculos).toEqual({ "a-p1": 3, "a-p2": 1, "b-p1": 2 });
  });

  test("pedido pequeno que coincide com um item de nota grande não liga sozinho", async () => {
    const { casarNotaComPedidos } = await import("../vinculoPedido");
    const abertos = [linha("a", "p1", 4)];
    const itens = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"].map((productId) => ({ productId, quantity: 4 }));
    const r = casarNotaComPedidos(itens, abertos);
    expect(r.automatico).toBe(false);
    expect(r.melhor?.orderCode).toBe("A");
    expect(r.vinculosDoMelhor).toEqual({ "a-p1": 4 });
  });

  test("pouca coincidência (um item de um pedido grande) não liga sozinho", async () => {
    const { casarNotaComPedidos } = await import("../vinculoPedido");
    const abertos = Array.from({ length: 12 }, (_, i) => linha("grande", `p${i}`, 10));
    const r = casarNotaComPedidos([{ productId: "p0", quantity: 1 }, { productId: "outro", quantity: 3 }, { productId: "outro2", quantity: 3 }], abertos);
    expect(r.automatico).toBe(false);
    expect(r.vinculos).toEqual({});
  });

  test("pedido em outra unidade não entra no casamento", async () => {
    const { casarNotaComPedidos } = await import("../vinculoPedido");
    const abertos = [linha("a", "p1", 5, { unidadeCompativel: false })];
    const r = casarNotaComPedidos([{ productId: "p1", quantity: 5 }], abertos);
    expect(r.automatico).toBe(false);
    expect(r.vinculos).toEqual({});
  });

  test("nota sem itens ou sem pedidos em aberto não sugere nada", async () => {
    const { casarNotaComPedidos } = await import("../vinculoPedido");
    expect(casarNotaComPedidos([], [linha("a", "p1", 5)]).automatico).toBe(false);
    expect(casarNotaComPedidos([{ productId: "p1", quantity: 5 }], []).automatico).toBe(false);
  });
});
