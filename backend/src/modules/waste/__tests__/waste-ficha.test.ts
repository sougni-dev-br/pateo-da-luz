import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../dishes/dish-detail.js", () => ({ carregarDetalhe: vi.fn() }));

import { carregarDetalhe } from "../../dishes/dish-detail.js";
import { FONTE_DO_CUSTO_RETROATIVO, chaveDoNome, concluirFichaDoPrato, validarPratoNovo } from "../waste-ficha.js";

describe("chaveDoNome", () => {
  test("ignora caixa, acento, pontuação e espaço repetido", () => {
    expect(chaveDoNome("  Purê  de BATATA. ")).toBe("pure de batata");
    expect(chaveDoNome("Pure de batata")).toBe(chaveDoNome("purê de batata!"));
  });

  test("nomes diferentes continuam diferentes", () => {
    expect(chaveDoNome("Purê de batata")).not.toBe(chaveDoNome("Purê de batata-doce"));
  });
});

describe("validarPratoNovo", () => {
  test("normaliza nome e observação; kg é o padrão", () => {
    expect(validarPratoNovo({ name: "  Farofa   de bacon ", notes: "  leva  bacon " })).toEqual({ ok: true, valor: { name: "Farofa de bacon", unit: "KG", observacao: "leva bacon" } });
  });

  test("aceita porção (UN) e as grafias de unidade da casa", () => {
    expect(validarPratoNovo({ name: "Farofa", unit: "und" })).toMatchObject({ ok: true, valor: { unit: "UN" } });
    expect(validarPratoNovo({ name: "Farofa", unit: "kgs" })).toMatchObject({ ok: true, valor: { unit: "KG" } });
  });

  test.each([[{ name: "" }], [{ name: "ab" }], [{ name: "123" }], [{ name: "Farofa", unit: "L" }]])("recusa %j", (entrada) => {
    expect(validarPratoNovo(entrada).ok).toBe(false);
  });
});

describe("concluirFichaDoPrato", () => {
  const entrada = (id: string, quantity: number, unit: string | null) => ({ id, quantity, unit });

  function banco(opcoes: { semValor: Array<{ id: string; quantity: number; unit: string | null }>; pendente: boolean }) {
    return {
      wasteEntry: { findMany: vi.fn().mockResolvedValue(opcoes.semValor), update: vi.fn().mockResolvedValue({}) },
      dish: { updateMany: vi.fn().mockResolvedValue({ count: opcoes.pendente ? 1 : 0 }) },
    };
  }

  beforeEach(() => vi.clearAllMocks());

  test("ficha completa: lançamentos sem valor passam a valer pelo custo e a pendência sai", async () => {
    vi.mocked(carregarDetalhe).mockResolvedValue({ custoIncompleto: false, custoPorcao: 12.5, yieldUnit: "KG" } as never);
    const db = banco({ semValor: [entrada("w1", 4, "KG"), entrada("w2", 0.5, "kg")], pendente: true });
    const r = await concluirFichaDoPrato(db as never, "d1");

    expect(r).toEqual({ completa: true, revalorizados: 2, emOutraUnidade: 0, concluiuPendencia: true });
    expect(db.wasteEntry.update).toHaveBeenCalledWith({ where: { id: "w1" }, data: { unitCost: 12.5, totalCost: 50, costSource: FONTE_DO_CUSTO_RETROATIVO } });
    expect(db.wasteEntry.update).toHaveBeenCalledWith({ where: { id: "w2" }, data: { unitCost: 12.5, totalCost: 6.25, costSource: FONTE_DO_CUSTO_RETROATIVO } });
    expect(db.dish.updateMany).toHaveBeenCalledWith({ where: { id: "d1", fichaPendente: true }, data: expect.objectContaining({ fichaPendente: false }) });
  });

  test("só mexe em lançamento SEM valor: a consulta filtra totalCost nulo e ignora cancelados", async () => {
    vi.mocked(carregarDetalhe).mockResolvedValue({ custoIncompleto: false, custoPorcao: 10, yieldUnit: "KG" } as never);
    const db = banco({ semValor: [], pendente: false });
    await concluirFichaDoPrato(db as never, "d1");
    expect(db.wasteEntry.findMany.mock.calls[0][0].where).toEqual({ dishId: "d1", totalCost: null, cancelledAt: null });
  });

  test("ficha ainda incompleta não valora nada nem tira a pendência", async () => {
    vi.mocked(carregarDetalhe).mockResolvedValue({ custoIncompleto: true, custoPorcao: 0, yieldUnit: "KG" } as never);
    const db = banco({ semValor: [entrada("w1", 4, "KG")], pendente: true });
    expect(await concluirFichaDoPrato(db as never, "d1")).toEqual({ completa: false, revalorizados: 0, emOutraUnidade: 0, concluiuPendencia: false });
    expect(db.wasteEntry.update).not.toHaveBeenCalled();
    expect(db.dish.updateMany).not.toHaveBeenCalled();
  });

  test("custo zero (sem ingredientes) conta como incompleta", async () => {
    vi.mocked(carregarDetalhe).mockResolvedValue({ custoIncompleto: false, custoPorcao: 0, yieldUnit: "KG" } as never);
    const db = banco({ semValor: [entrada("w1", 4, "KG")], pendente: true });
    expect((await concluirFichaDoPrato(db as never, "d1")).completa).toBe(false);
  });

  test("a ficha mudou de unidade (kg → porção): o lançamento em kg não ganha um valor errado", async () => {
    vi.mocked(carregarDetalhe).mockResolvedValue({ custoIncompleto: false, custoPorcao: 8, yieldUnit: "UN" } as never);
    const db = banco({ semValor: [entrada("w1", 4, "KG"), entrada("w2", 2, "UN")], pendente: true });
    const r = await concluirFichaDoPrato(db as never, "d1");
    expect(r).toMatchObject({ revalorizados: 1, emOutraUnidade: 1 });
    expect(db.wasteEntry.update).toHaveBeenCalledTimes(1);
    expect(db.wasteEntry.update.mock.calls[0][0].where.id).toBe("w2");
  });

  test("prato inexistente não faz nada", async () => {
    vi.mocked(carregarDetalhe).mockResolvedValue(null as never);
    const db = banco({ semValor: [], pendente: false });
    expect((await concluirFichaDoPrato(db as never, "x")).completa).toBe(false);
  });

  test("quantidade tão pequena que o valor não cabe fica sem valor, sem derrubar o resto", async () => {
    vi.mocked(carregarDetalhe).mockResolvedValue({ custoIncompleto: false, custoPorcao: 2_000_000, yieldUnit: "KG" } as never);
    const db = banco({ semValor: [entrada("w1", 1, "KG")], pendente: false });
    const r = await concluirFichaDoPrato(db as never, "d1");
    expect(r.revalorizados).toBe(0);
  });
});
