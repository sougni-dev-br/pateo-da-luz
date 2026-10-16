import { describe, expect, test } from "vitest";
import {
  QUANTIDADE_MAXIMA_VINCULO,
  calcularStatusDoPedido,
  mesmaUnidade,
  montarMapaDeUnidades,
  somarRecebido,
  unidadeCompativel,
  sugerirDivisao,
  validarVinculos
} from "../vinculo-nota.js";

describe("somarRecebido", () => {
  test("soma os vínculos de várias notas no mesmo item do pedido", () => {
    const soma = somarRecebido([
      { purchaseOrderItemId: "a", quantity: 3, purchaseCancelada: false },
      { purchaseOrderItemId: "a", quantity: 2, purchaseCancelada: false },
      { purchaseOrderItemId: "b", quantity: 1, purchaseCancelada: false }
    ]);
    expect(soma.get("a")).toBe(5);
    expect(soma.get("b")).toBe(1);
  });

  test("nota cancelada não conta como recebido", () => {
    const soma = somarRecebido([
      { purchaseOrderItemId: "a", quantity: 3, purchaseCancelada: true },
      { purchaseOrderItemId: "a", quantity: 2, purchaseCancelada: false }
    ]);
    expect(soma.get("a")).toBe(2);
  });

  test("evita erro de ponto flutuante nas casas decimais do estoque", () => {
    const soma = somarRecebido([
      { purchaseOrderItemId: "a", quantity: 0.1, purchaseCancelada: false },
      { purchaseOrderItemId: "a", quantity: 0.2, purchaseCancelada: false }
    ]);
    expect(soma.get("a")).toBe(0.3);
  });
});

describe("calcularStatusDoPedido", () => {
  const itens = (...pares: Array<[number, number]>) => pares.map(([meta, recebido]) => ({ meta, recebido }));

  test("tudo recebido: RECEBIDO", () => {
    expect(calcularStatusDoPedido("ENVIADO", itens([5, 5], [2, 3]))).toEqual({ status: "RECEBIDO", mudou: true, promovidoSemEnvio: false });
  });

  test("parte recebida: RECEBIDO_PARCIAL", () => {
    expect(calcularStatusDoPedido("ENVIADO", itens([5, 5], [2, 0])).status).toBe("RECEBIDO_PARCIAL");
    expect(calcularStatusDoPedido("ENVIADO", itens([5, 4])).status).toBe("RECEBIDO_PARCIAL");
  });

  test("rascunho que nunca foi enviado é promovido e a promoção é marcada para a auditoria", () => {
    expect(calcularStatusDoPedido("RASCUNHO", itens([5, 5]))).toEqual({ status: "RECEBIDO", mudou: true, promovidoSemEnvio: true });
    expect(calcularStatusDoPedido("EM_REVISAO", itens([5, 1]))).toEqual({ status: "RECEBIDO_PARCIAL", mudou: true, promovidoSemEnvio: true });
    expect(calcularStatusDoPedido("APROVADO", itens([5, 1])).promovidoSemEnvio).toBe(true);
  });

  test("pedido encerrado como legado nunca muda, nem com nota", () => {
    expect(calcularStatusDoPedido("ENCERRADO_LEGADO", itens([5, 5]))).toEqual({ status: "ENCERRADO_LEGADO", mudou: false, promovidoSemEnvio: false });
  });

  test("pedido cancelado nunca muda", () => {
    expect(calcularStatusDoPedido("CANCELADO", itens([5, 5]))).toEqual({ status: "CANCELADO", mudou: false, promovidoSemEnvio: false });
  });

  test("sem nenhum recebimento e ainda rascunho: continua rascunho", () => {
    expect(calcularStatusDoPedido("RASCUNHO", itens([5, 0]))).toEqual({ status: "RASCUNHO", mudou: false, promovidoSemEnvio: false });
  });

  test("vínculo desfeito: pedido que estava recebido volta para ENVIADO", () => {
    expect(calcularStatusDoPedido("RECEBIDO", itens([5, 0]))).toEqual({ status: "ENVIADO", mudou: true, promovidoSemEnvio: false });
    expect(calcularStatusDoPedido("RECEBIDO_PARCIAL", itens([5, 0])).status).toBe("ENVIADO");
  });

  test("recebimento parcial que vira total ao somar outra nota", () => {
    expect(calcularStatusDoPedido("RECEBIDO_PARCIAL", itens([5, 5])).status).toBe("RECEBIDO");
  });

  test("pedido sem itens não vira recebido", () => {
    expect(calcularStatusDoPedido("ENVIADO", []).status).toBe("ENVIADO");
  });
});

describe("validarVinculos", () => {
  const pedidos = new Map([
    ["i1", { orderId: "p1", orderStatus: "ENVIADO", supplierId: "f1", productId: "prod1" }],
    ["i2", { orderId: "p2", orderStatus: "RASCUNHO", supplierId: "f1", productId: "prod2" }],
    ["i3", { orderId: "p3", orderStatus: "CANCELADO", supplierId: "f1", productId: "prod3" }],
    ["i4", { orderId: "p4", orderStatus: "ENVIADO", supplierId: "outro", productId: "prod4" }]
  ]);
  const compra = { supplierId: "f1", productIds: new Set(["prod1", "prod2", "prod3", "prod4"]) };

  test("aceita vínculos de pedidos diferentes na mesma nota", () => {
    const r = validarVinculos([{ purchaseOrderItemId: "i1", quantity: 2 }, { purchaseOrderItemId: "i2", quantity: 1 }], pedidos, compra);
    expect(r).toEqual({ ok: true });
  });

  test("recusa pedido cancelado", () => {
    const r = validarVinculos([{ purchaseOrderItemId: "i3", quantity: 1 }], pedidos, compra);
    expect(r.ok).toBe(false);
  });

  test("recusa pedido encerrado como legado", () => {
    const comLegado = new Map(pedidos);
    comLegado.set("i5", { orderId: "p5", orderStatus: "ENCERRADO_LEGADO", supplierId: "f1", productId: "prod1" });
    expect(validarVinculos([{ purchaseOrderItemId: "i5", quantity: 1 }], comLegado, compra).ok).toBe(false);
  });

  test("recusa item de pedido de outro fornecedor", () => {
    const r = validarVinculos([{ purchaseOrderItemId: "i4", quantity: 1 }], pedidos, compra);
    expect(r.ok).toBe(false);
  });

  test("recusa item que não existe e produto que não está na nota", () => {
    expect(validarVinculos([{ purchaseOrderItemId: "zzz", quantity: 1 }], pedidos, compra).ok).toBe(false);
    expect(validarVinculos([{ purchaseOrderItemId: "i1", quantity: 1 }], pedidos, { ...compra, productIds: new Set(["outroProd"]) }).ok).toBe(false);
  });

  test("recusa quantidade zero, negativa, não numérica ou absurda", () => {
    for (const quantity of [0, -1, Number.NaN, QUANTIDADE_MAXIMA_VINCULO + 1]) {
      expect(validarVinculos([{ purchaseOrderItemId: "i1", quantity }], pedidos, compra).ok).toBe(false);
    }
  });

  test("recusa o mesmo item do pedido repetido na mesma nota", () => {
    const r = validarVinculos([{ purchaseOrderItemId: "i1", quantity: 1 }, { purchaseOrderItemId: "i1", quantity: 2 }], pedidos, compra);
    expect(r.ok).toBe(false);
  });
});

describe("sugerirDivisao", () => {
  const abertos = [
    { purchaseOrderItemId: "novo", restante: 4, criadoEm: "2026-09-10" },
    { purchaseOrderItemId: "antigo", restante: 3, criadoEm: "2026-09-01" }
  ];

  test("enche primeiro o pedido mais antigo e passa o resto para o seguinte", () => {
    expect(sugerirDivisao(5, abertos)).toEqual([
      { purchaseOrderItemId: "antigo", quantity: 3 },
      { purchaseOrderItemId: "novo", quantity: 2 }
    ]);
  });

  test("nota menor que o pedido: tudo no mais antigo", () => {
    expect(sugerirDivisao(1.5, abertos)).toEqual([{ purchaseOrderItemId: "antigo", quantity: 1.5 }]);
  });

  test("sobra além do que os pedidos pedem não vira vínculo", () => {
    expect(sugerirDivisao(20, abertos).reduce((s, v) => s + v.quantity, 0)).toBe(7);
  });

  test("pedido já completo (restante zero) é ignorado", () => {
    expect(sugerirDivisao(2, [{ purchaseOrderItemId: "x", restante: 0, criadoEm: "2026-09-01" }])).toEqual([]);
  });
});

describe("mesmaUnidade", () => {
  const mapa = montarMapaDeUnidades([{ code: "UN", name: "Unidade" }, { code: "PCT", name: "Pacote" }, { code: "KG", name: "Quilograma" }]);

  test("nome no pedido e código na nota são a mesma unidade", () => {
    expect(mesmaUnidade("unidade", "UN", mapa)).toBe(true);
    expect(mesmaUnidade("Pacote", "pct", mapa)).toBe(true);
  });

  test("unidades diferentes não casam", () => {
    expect(mesmaUnidade("pacote", "UN", mapa)).toBe(false);
    expect(mesmaUnidade("kg", "UN", mapa)).toBe(false);
  });

  test("unidade vazia nunca casa, nem com outra vazia", () => {
    expect(mesmaUnidade(null, null, mapa)).toBe(false);
    expect(mesmaUnidade("", "UN", mapa)).toBe(false);
  });

  test("unidade fora do cadastro casa só com ela mesma", () => {
    expect(mesmaUnidade("bandeja", "Bandeja", mapa)).toBe(true);
    expect(mesmaUnidade("bandeja", "UN", mapa)).toBe(false);
  });
});

describe("unidadeCompativel", () => {
  const mapa = montarMapaDeUnidades([{ code: "UN", name: "Unidade" }, { code: "CX", name: "Caixa" }]);

  test("casa pelo nome do pedido e pelo código da nota", () => {
    expect(unidadeCompativel("unidade", ["UN"], mapa)).toBe(true);
  });

  test("caixa no pedido e unidade na nota não casam", () => {
    expect(unidadeCompativel("caixa", ["UN"], mapa)).toBe(false);
  });

  test("basta uma das unidades da nota casar (produto repetido em duas linhas)", () => {
    expect(unidadeCompativel("caixa", ["UN", "CX"], mapa)).toBe(true);
  });

  test("sem unidade em uma das pontas não barra", () => {
    expect(unidadeCompativel(null, ["UN"], mapa)).toBe(true);
    expect(unidadeCompativel("caixa", [null, ""], mapa)).toBe(true);
  });
});
