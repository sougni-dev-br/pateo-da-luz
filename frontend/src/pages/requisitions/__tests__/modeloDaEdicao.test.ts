import { describe, expect, test } from "vitest";
import type { InventoryRequisition } from "../../../api/client";
import { escolhasDaRequisicao, modeloDeEdicao } from "../modeloDaEdicao";

const req = (items: Array<Record<string, unknown>>) =>
  ({
    id: "r7", code: "REQ-2026-0007", date: "2026-11-25T00:00:00.000Z", shift: "MORNING", reason: "DAILY_PRODUCTION",
    reasonNotes: null, sectorId: null, notes: null, updatedAt: "2026-11-25T12:00:00.000Z", items
  }) as unknown as InventoryRequisition & { updatedAt: string };

describe("modeloDeEdicao", () => {
  test("produto em duas linhas vira uma só com a soma, e o retirado bate com ela", () => {
    const modelo = modeloDeEdicao(req([
      { productId: "p1", quantity: "2.0000", unit: "KG", recordedUnit: "KG" },
      { productId: "p1", quantity: "1.5000", unit: "KG", recordedUnit: "KG" },
      { productId: "p4", quantity: "6", unit: "UN", recordedUnit: "UN" }
    ]));
    expect(modelo.escolhas).toEqual({ p1: { unit: "KG", quantity: "3,5" }, p4: { unit: "UN", quantity: "6" } });
    expect(modelo.edicao?.retirado).toEqual({ p1: 3.5, p4: 6 });
    expect(modelo.edicao?.unidadeRetirada).toEqual({ p1: "KG", p4: "UN" });
  });

  test("usa a unidade em que foi gravada, não a do cadastro de hoje", () => {
    expect(escolhasDaRequisicao(req([{ productId: "p1", quantity: "2", unit: "UN", recordedUnit: "CX" }]))).toEqual({ p1: { unit: "CX", quantity: "2" } });
  });

  test("linha sem produto fica de fora e a data é lida em UTC", () => {
    const modelo = modeloDeEdicao(req([{ productId: null, quantity: "1", unit: "KG" }]));
    expect(modelo.escolhas).toEqual({});
    expect(modelo.cabecalho.date).toBe("2026-11-25");
    expect(modelo.edicao).toEqual({ id: "r7", code: "REQ-2026-0007", updatedAt: "2026-11-25T12:00:00.000Z", retirado: {}, unidadeRetirada: {} });
  });

  test("soma sem lixo de ponto flutuante", () => {
    const { escolhas } = modeloDeEdicao(req([
      { productId: "p1", quantity: "0.1", unit: "KG" },
      { productId: "p1", quantity: "0.2", unit: "KG" }
    ]));
    expect(escolhas.p1.quantity).toBe("0,3");
  });
});
