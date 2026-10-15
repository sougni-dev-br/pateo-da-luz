import { describe, expect, test } from "vitest";
import {
  QUANTIDADE_MAXIMA,
  agruparPorFornecedor,
  fornecedorPadrao,
  precoDoFornecedor,
  quantidadeSugerida,
  totalEstimado,
  validarItensDoPedido,
  type OpcaoDeFornecedor
} from "../requisicao-pedido.js";

const opcao = (supplierId: string, dia: number, preco: number | null = 10): OpcaoDeFornecedor => ({
  supplierId, supplierName: `Fornecedor ${supplierId}`, lastUnitPrice: preco, lastPurchaseDate: new Date(2026, 8, dia), purchaseCount: 1
});

describe("fornecedorPadrao", () => {
  test("o fornecedor principal do cadastro vem primeiro", () => {
    expect(fornecedorPadrao("principal", [opcao("outro", 20)])).toBe("principal");
  });

  test("sem principal, vale o da compra mais recente", () => {
    expect(fornecedorPadrao(null, [opcao("a", 3), opcao("b", 20), opcao("c", 9)])).toBe("b");
  });

  test("sem principal e sem histórico, não chuta", () => {
    expect(fornecedorPadrao(null, [])).toBeNull();
  });
});

describe("preço e quantidade", () => {
  test("preço do fornecedor escolhido; null quando não há histórico dele ou a compra não tinha conversão", () => {
    const opcoes = [opcao("a", 1, 12.5), opcao("b", 2, null)];
    expect(precoDoFornecedor(opcoes, "a")).toBe(12.5);
    expect(precoDoFornecedor(opcoes, "b")).toBeNull();
    expect(precoDoFornecedor(opcoes, "x")).toBeNull();
    expect(precoDoFornecedor(opcoes, null)).toBeNull();
  });

  test("a sugestão é o que saiu, em 3 casas", () => {
    expect(quantidadeSugerida(2.5)).toBe(2.5);
    expect(quantidadeSugerida(0.3333333)).toBe(0.333);
  });

  test("total estimado arredonda em centavos e some sem preço", () => {
    expect(totalEstimado(3, 2.333)).toBe(7);
    expect(totalEstimado(3, null)).toBeNull();
  });
});

describe("validarItensDoPedido", () => {
  const daRequisicao = new Set(["p1", "p2", "p3"]);

  test("aceita item da requisição com fornecedor e quantidade válidos", () => {
    const r = validarItensDoPedido([{ productId: "p1", supplierId: "f1", requestedQuantity: "2,5".replace(",", "."), unitPriceEstimated: 4 }], daRequisicao);
    expect(r.validos).toEqual([{ productId: "p1", supplierId: "f1", quantity: 2.5, unitPrice: 4 }]);
  });

  test("a quantidade confirmada vale: não volta para a retirada", () => {
    const r = validarItensDoPedido([{ productId: "p1", supplierId: "f1", requestedQuantity: 7 }], daRequisicao);
    expect(r.validos[0].quantity).toBe(7);
  });

  test("produto de fora da requisição, repetido, sem quantidade e sem fornecedor ficam de fora com o motivo", () => {
    const r = validarItensDoPedido([
      { productId: "x", supplierId: "f1", requestedQuantity: 1 },
      { productId: "p1", supplierId: "f1", requestedQuantity: 1 },
      { productId: "p1", supplierId: "f1", requestedQuantity: 2 },
      { productId: "p2", supplierId: "f1", requestedQuantity: 0 },
      { productId: "p3", supplierId: "", requestedQuantity: 3 }
    ], daRequisicao);
    expect(r.validos.map((l) => l.productId)).toEqual(["p1"]);
    expect(r.ignorados.map((i) => i.reason)).toEqual([
      "Produto não faz parte desta requisição.",
      "Produto repetido.",
      "Quantidade inválida.",
      "Fornecedor não selecionado."
    ]);
  });

  test("quantidade que arredonda para zero é inválida; item nulo não derruba", () => {
    const r = validarItensDoPedido([{ productId: "p1", supplierId: "f1", requestedQuantity: 0.0004 }, null as never], daRequisicao);
    expect(r.validos).toHaveLength(0);
    expect(r.ignorados.map((i) => i.reason)).toEqual(["Quantidade inválida.", "Item inválido."]);
  });

  test("preço acima do teto vira sem preço (o servidor usa o do histórico)", () => {
    const r = validarItensDoPedido([{ productId: "p1", supplierId: "f1", requestedQuantity: 1, unitPriceEstimated: 5_000_000 }], daRequisicao);
    expect(r.validos[0].unitPrice).toBeNull();
  });

  test("quantidade fora da escala é separada para abortar tudo", () => {
    const r = validarItensDoPedido([{ productId: "p1", supplierId: "f1", requestedQuantity: QUANTIDADE_MAXIMA + 1 }], daRequisicao);
    expect(r.foraDaEscala).toEqual([{ productId: "p1", quantity: QUANTIDADE_MAXIMA + 1 }]);
    expect(r.validos).toHaveLength(0);
  });

  test("preço negativo ou ilegível vira sem preço", () => {
    const r = validarItensDoPedido([
      { productId: "p1", supplierId: "f1", requestedQuantity: 1, unitPriceEstimated: -3 },
      { productId: "p2", supplierId: "f1", requestedQuantity: 1, unitPriceEstimated: "abc" }
    ], daRequisicao);
    expect(r.validos.map((l) => l.unitPrice)).toEqual([null, null]);
  });
});

describe("agruparPorFornecedor", () => {
  test("um pedido por fornecedor, na ordem em que aparecem", () => {
    const grupos = agruparPorFornecedor([{ supplierId: "a", n: 1 }, { supplierId: "b", n: 2 }, { supplierId: "a", n: 3 }, { supplierId: null, n: 4 }]);
    expect(Array.from(grupos.keys())).toEqual(["a", "b"]);
    expect(grupos.get("a")?.map((l) => l.n)).toEqual([1, 3]);
  });
});
