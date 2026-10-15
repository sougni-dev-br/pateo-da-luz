import { describe, expect, test } from "vitest";
import {
  QUANTIDADE_MAXIMA,
  agruparPorFornecedor,
  fornecedorPadrao,
  precoParaFornecedor,
  quantidadeSugerida,
  totalEstimado,
  validarItensDoPedido
} from "../requisicao-pedido.js";

describe("fornecedorPadrao", () => {
  const opcao = (supplierId: string, conversionMissing = false) => ({ supplierId, conversionMissing });

  test("o de menor preço histórico vem primeiro, mesmo com fornecedor principal no cadastro", () => {
    expect(fornecedorPadrao([opcao("maisBarato"), opcao("outro")], "principal")).toBe("maisBarato");
  });

  test("preço sem conversão (de caixa) não entra na comparação: vale o mais barato comparável", () => {
    expect(fornecedorPadrao([opcao("caixa", true), opcao("porKg"), opcao("outro")], "principal")).toBe("porKg");
  });

  test("sem nenhum preço comparável, vale o principal; sem principal, o primeiro do histórico", () => {
    expect(fornecedorPadrao([opcao("caixa", true)], "principal")).toBe("principal");
    expect(fornecedorPadrao([opcao("caixa", true), opcao("outra", true)], null)).toBe("caixa");
  });

  test("sem histórico de preço, vale o principal do cadastro", () => {
    expect(fornecedorPadrao([], "principal")).toBe("principal");
    expect(fornecedorPadrao([], null)).toBeNull();
  });
});

describe("preço e quantidade", () => {
  const leitura = { supplierPriceOptions: [{ supplierId: "a", bestUnitPrice: 8 }, { supplierId: "b", bestUnitPrice: 12 }], lastUnitPrice: 11, bestUnitPrice: 8 };

  test("preço do fornecedor escolhido é o menor que ele já praticou", () => {
    expect(precoParaFornecedor(leitura, "b")).toBe(12);
  });

  test("fornecedor sem histórico usa o último preço, e sem ele o menor geral", () => {
    expect(precoParaFornecedor(leitura, "novo")).toBe(11);
    expect(precoParaFornecedor({ ...leitura, lastUnitPrice: null }, null)).toBe(8);
    expect(precoParaFornecedor({ supplierPriceOptions: [], lastUnitPrice: null, bestUnitPrice: null }, "x")).toBeNull();
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
