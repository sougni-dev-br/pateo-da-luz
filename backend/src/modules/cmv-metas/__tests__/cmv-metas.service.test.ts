import { beforeEach, describe, expect, test, vi } from "vitest";

const tx = {
  cmvMeta: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
};
vi.mock("../../../config/database.js", () => ({
  prisma: {
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    inventorySector: { findUnique: vi.fn() },
    cmvMeta: { findUnique: vi.fn(), delete: vi.fn() },
  },
}));

import { prisma } from "../../../config/database.js";
import { MetaInvalidaError, removerMeta, salvarMeta, type EntradaMeta } from "../cmv-metas.service.js";

const base: EntradaMeta = { escopo: "GERAL", sectorId: null, alvoPercentual: 30, alertaPercentual: 27, inicio: "2026-12", observacao: null, userId: "u1" };

beforeEach(() => {
  vi.clearAllMocks();
  tx.cmvMeta.findFirst.mockResolvedValue(null);
  tx.cmvMeta.create.mockResolvedValue({ id: "novo" });
  tx.cmvMeta.update.mockResolvedValue({ id: "igual" });
});

describe("salvarMeta", () => {
  test("recusa alerta acima da meta sem tocar no banco", async () => {
    await expect(salvarMeta({ ...base, alertaPercentual: 31 })).rejects.toBeInstanceOf(MetaInvalidaError);
    expect(tx.cmvMeta.create).not.toHaveBeenCalled();
  });

  test("recusa mês de início inválido", async () => {
    await expect(salvarMeta({ ...base, inicio: "2026-13" })).rejects.toBeInstanceOf(MetaInvalidaError);
  });

  test("meta de setor exige setor existente", async () => {
    await expect(salvarMeta({ ...base, escopo: "SETOR", sectorId: null })).rejects.toBeInstanceOf(MetaInvalidaError);
    (prisma.inventorySector.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(salvarMeta({ ...base, escopo: "SETOR", sectorId: "x" })).rejects.toThrow("Setor não encontrado.");
  });

  test("meta geral não aceita setor", async () => {
    await expect(salvarMeta({ ...base, sectorId: "s1" })).rejects.toThrow("Meta geral não tem setor.");
  });

  test("vigência nova encerra a anterior na véspera do início", async () => {
    await salvarMeta(base);
    const encerra = tx.cmvMeta.updateMany.mock.calls[0][0];
    expect(encerra.data.vigenciaFim.toISOString().slice(0, 10)).toBe("2026-11-30");
    const criada = tx.cmvMeta.create.mock.calls[0][0].data;
    expect(criada.vigenciaInicio.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(criada.vigenciaFim).toBeNull();
    expect(criada.createdById).toBe("u1");
  });

  test("com vigência futura já cadastrada, a nova termina na véspera dela", async () => {
    tx.cmvMeta.findFirst
      .mockResolvedValueOnce(null) // não há vigência com o mesmo início
      .mockResolvedValueOnce({ vigenciaInicio: new Date("2027-03-01T00:00:00.000Z") });
    await salvarMeta(base);
    const criada = tx.cmvMeta.create.mock.calls[0][0].data;
    expect(criada.vigenciaFim.toISOString().slice(0, 10)).toBe("2027-02-28");
  });

  test("mesmo escopo e mesmo início atualiza em vez de duplicar", async () => {
    tx.cmvMeta.findFirst.mockResolvedValueOnce({ id: "igual" });
    await salvarMeta({ ...base, alvoPercentual: 28, alertaPercentual: 25 });
    expect(tx.cmvMeta.update).toHaveBeenCalledOnce();
    expect(tx.cmvMeta.create).not.toHaveBeenCalled();
    expect(tx.cmvMeta.updateMany).not.toHaveBeenCalled();
  });
});

describe("removerMeta", () => {
  test("devolve null quando não existe, sem apagar nada", async () => {
    (prisma.cmvMeta.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await removerMeta("nada")).toBeNull();
    expect(prisma.cmvMeta.delete).not.toHaveBeenCalled();
  });

  test("apaga e devolve a linha removida", async () => {
    (prisma.cmvMeta.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "m1" });
    expect(await removerMeta("m1")).toEqual({ id: "m1" });
    expect(prisma.cmvMeta.delete).toHaveBeenCalledWith({ where: { id: "m1" } });
  });
});
