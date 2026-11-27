import { describe, expect, it } from "vitest";
import type { PurchaseOrder } from "../../api/client";
import { contagemPorVista, entregaAtrasada, filtrarPedidos, passosDoFluxo, totaisPorEtapa } from "./regras";

function pedido(parcial: Partial<PurchaseOrder>): PurchaseOrder {
  return {
    id: parcial.code ?? "x",
    code: "PC-2026-0001",
    supplierId: "f1",
    supplierNameSnapshot: "Hortifruti Exemplo",
    status: "RASCUNHO",
    source: "REQUISICAO",
    createdByUserId: null,
    expectedDeliveryDate: null,
    notes: null,
    cancelReason: null,
    sentToReviewAt: null,
    approvedAt: null,
    sentAt: null,
    receivedAt: null,
    canceledAt: null,
    createdAt: "2026-11-20T12:00:00.000Z",
    updatedAt: "2026-11-20T12:00:00.000Z",
    estimatedTotal: "100",
    ...parcial
  };
}

const lista = [
  pedido({ code: "PC-1", status: "RASCUNHO", estimatedTotal: "150.5" }),
  pedido({ code: "PC-2", status: "ENVIADO", estimatedTotal: "200" }),
  pedido({ code: "PC-3", status: "RECEBIDO_PARCIAL", estimatedTotal: "50" }),
  pedido({ code: "PC-4", status: "RECEBIDO", supplierNameSnapshot: "Padaria São João" }),
  pedido({ code: "PC-5", status: "ENCERRADO_LEGADO" }),
  pedido({ code: "PC-6", status: "CANCELADO" })
];

describe("totaisPorEtapa", () => {
  it("soma quantidade e valor por etapa, juntando enviado e recebido parcial", () => {
    const totais = totaisPorEtapa(lista);
    expect(totais.rascunho).toEqual({ quantidade: 1, valor: 150.5 });
    expect(totais.aReceber).toEqual({ quantidade: 2, valor: 250 });
    expect(totais.recebidos.quantidade).toBe(1);
    expect(totais.aEnviar.quantidade).toBe(0);
  });
});

describe("contagemPorVista", () => {
  it("conta o legado entre os concluídos e o cancelado à parte", () => {
    expect(contagemPorVista(lista)).toEqual({ abertos: 3, concluidos: 2, cancelados: 1, todos: 6 });
  });
});

describe("filtrarPedidos", () => {
  it("mostra só os em aberto por padrão", () => {
    const codigos = filtrarPedidos(lista, { vista: "abertos", etapa: null, busca: "" }).map((p) => p.code);
    expect(codigos).toEqual(["PC-1", "PC-2", "PC-3"]);
  });

  it("a etapa escolhida manda sobre a aba", () => {
    const codigos = filtrarPedidos(lista, { vista: "todos", etapa: "aReceber", busca: "" }).map((p) => p.code);
    expect(codigos).toEqual(["PC-2", "PC-3"]);
  });

  it("busca o fornecedor sem acento", () => {
    const codigos = filtrarPedidos(lista, { vista: "todos", etapa: null, busca: "sao joao" }).map((p) => p.code);
    expect(codigos).toEqual(["PC-4"]);
  });
});

describe("entregaAtrasada", () => {
  it("só marca previsão vencida de pedido que ainda espera entrega", () => {
    const enviado = pedido({ status: "ENVIADO", expectedDeliveryDate: "2026-11-25T00:00:00.000Z" });
    expect(entregaAtrasada(enviado, "2026-11-27")).toBe(true);
    expect(entregaAtrasada(enviado, "2026-11-25")).toBe(false);
    expect(entregaAtrasada({ ...enviado, status: "RECEBIDO" }, "2026-11-27")).toBe(false);
  });
});

describe("passosDoFluxo", () => {
  it("marca os passos feitos, o atual e os pendentes", () => {
    const passos = passosDoFluxo(pedido({ status: "APROVADO", sentToReviewAt: "2026-11-21T12:00:00.000Z", approvedAt: "2026-11-22T12:00:00.000Z" }));
    expect(passos.map((p) => p.estado)).toEqual(["feito", "feito", "atual", "pendente", "pendente"]);
  });

  it("recebido fecha o fluxo todo como feito", () => {
    expect(passosDoFluxo(pedido({ status: "RECEBIDO" })).every((p) => p.estado === "feito")).toBe(true);
  });

  it("cancelado e legado ficam fora da linha do tempo", () => {
    expect(passosDoFluxo(pedido({ status: "CANCELADO" }))).toEqual([]);
    expect(passosDoFluxo(pedido({ status: "ENCERRADO_LEGADO" }))).toEqual([]);
  });
});
