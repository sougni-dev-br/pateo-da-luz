import { beforeEach, describe, expect, test, vi } from "vitest";

const findUnique = vi.hoisted(() => vi.fn());
vi.mock("../../../config/database.js", () => ({ prisma: { employee: { findUnique } } }));

import { lerFuncionarioDaGuia } from "../tax-payment-employee.js";

describe("lerFuncionarioDaGuia (guia de FGTS de rescisão)", () => {
  beforeEach(() => findUnique.mockReset());

  test("sem funcionário: aceita e não consulta o banco", async () => {
    for (const vazio of [undefined, null, ""]) expect(await lerFuncionarioDaGuia(vazio, "FGTS")).toEqual({ ok: true, id: null });
    expect(findUnique).not.toHaveBeenCalled();
  });

  test("funcionário desligado: aceita (por data de desligamento ou por estar inativo)", async () => {
    findUnique.mockResolvedValueOnce({ id: "e1", isActive: false, terminationDate: null });
    expect(await lerFuncionarioDaGuia("e1", "FGTS")).toEqual({ ok: true, id: "e1" });
    findUnique.mockResolvedValueOnce({ id: "e2", isActive: true, terminationDate: new Date("2026-09-03T00:00:00Z") });
    expect(await lerFuncionarioDaGuia("e2", "FGTS")).toEqual({ ok: true, id: "e2" });
  });

  test("funcionário ativo é recusado", async () => {
    findUnique.mockResolvedValueOnce({ id: "e3", isActive: true, terminationDate: null });
    const r = await lerFuncionarioDaGuia("e3", "FGTS");
    expect(r.ok).toBe(false);
  });

  test("funcionário inexistente, id que não é texto e tipo que não é FGTS são recusados", async () => {
    findUnique.mockResolvedValueOnce(null);
    expect((await lerFuncionarioDaGuia("nao-existe", "FGTS")).ok).toBe(false);
    expect((await lerFuncionarioDaGuia(123, "FGTS")).ok).toBe(false);
    expect((await lerFuncionarioDaGuia("e1", "Simples Nacional / DAS")).ok).toBe(false);
  });
});
