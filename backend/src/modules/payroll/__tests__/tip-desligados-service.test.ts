import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => {
  const tx = { employee: { updateMany: vi.fn(), findMany: vi.fn() }, tipPeriod: { findMany: vi.fn() } };
  return {
    prisma: {
      employee: { findMany: vi.fn() },
      tipPeriod: { findMany: vi.fn() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  };
});
vi.mock("../tip-historico.service.js", () => ({ registrarHistorico: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { registrarHistorico } from "../tip-historico.service.js";
import { desligadosParaLimpar, limparParticipaDeDesligados } from "../tip-desligados.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const func = (id: string, nome: string, saida: string) => ({ id, firstName: nome, lastName: "Teste", displayName: null, terminationDate: d(saida) });

beforeEach(() => {
  vi.clearAllMocks();
  db.tipPeriod.findMany.mockResolvedValue([
    { periodStart: d("2026-08-26"), periodEnd: d("2026-09-25"), status: "CLOSED" },
    { periodStart: d("2026-10-26"), periodEnd: d("2026-11-25"), status: "OPEN" },
  ]);
  db.__tx.employee.updateMany.mockResolvedValue({ count: 1 });
});

describe("desligadosParaLimpar", () => {
  test("só entra quem saiu em ciclo fechado, em ordem de nome", async () => {
    db.employee.findMany.mockResolvedValue([func("b", "Bia", "2026-09-17"), func("a", "Ana", "2026-09-10"), func("n", "Nova", "2026-11-03")]);
    const r = await desligadosParaLimpar();
    expect(r.map((x) => x.nome)).toEqual(["Ana Teste", "Bia Teste"]);
  });
  test("sem candidatos não consulta os períodos", async () => {
    db.employee.findMany.mockResolvedValue([]);
    expect(await desligadosParaLimpar()).toEqual([]);
    expect(db.tipPeriod.findMany).not.toHaveBeenCalled();
  });
});

describe("limparParticipaDeDesligados", () => {
  const PERIODOS = [
    { periodStart: d("2026-08-26"), periodEnd: d("2026-09-25"), status: "CLOSED" },
    { periodStart: d("2026-10-26"), periodEnd: d("2026-11-25"), status: "OPEN" },
  ];
  // A elegibilidade é lida dentro da transação.
  const lerNaTransacao = (pessoas: unknown[], periodos: unknown[] = PERIODOS) => {
    db.__tx.employee.findMany.mockResolvedValue(pessoas);
    db.__tx.tipPeriod.findMany.mockResolvedValue(periodos);
  };

  test("desmarca, grava o histórico com a data da saída e devolve quem foi limpo", async () => {
    lerNaTransacao([func("a", "Ana", "2026-09-10"), func("n", "Nova", "2026-11-03")]);
    const r = await limparParticipaDeDesligados({ id: "u1" });
    expect(r.map((x) => x.employeeId)).toEqual(["a"]);
    expect(db.__tx.employee.updateMany).toHaveBeenCalledTimes(1);
    expect(db.__tx.employee.updateMany).toHaveBeenCalledWith({
      where: { id: "a", isActive: false, participaGorjeta: true, deletedAt: null, terminationDate: d("2026-09-10") },
      data: { participaGorjeta: false, updatedById: "u1" },
    });
    expect(registrarHistorico).toHaveBeenCalledWith(db.__tx, "a", d("2026-09-10"), "u1", expect.stringContaining("10/09/2026"));
  });
  test("só limpa os ids que a tela mostrou, mesmo que apareçam outros elegíveis", async () => {
    lerNaTransacao([func("a", "Ana", "2026-09-10"), func("b", "Bia", "2026-09-12")]);
    const r = await limparParticipaDeDesligados({ id: "u1" }, ["b"]);
    expect(r.map((x) => x.employeeId)).toEqual(["b"]);
    expect(db.__tx.employee.updateMany).toHaveBeenCalledTimes(1);
  });
  test("ciclo reaberto no meio do clique: a leitura dentro da transação já o barra", async () => {
    lerNaTransacao([func("a", "Ana", "2026-09-10")], [{ periodStart: d("2026-08-26"), periodEnd: d("2026-09-25"), status: "OPEN" }]);
    expect(await limparParticipaDeDesligados({ id: "u1" })).toEqual([]);
    expect(db.__tx.employee.updateMany).not.toHaveBeenCalled();
  });
  test("reativado e desligado de novo no intervalo (data mudou): o UPDATE não pega e não há histórico", async () => {
    lerNaTransacao([func("a", "Ana", "2026-09-10")]);
    db.__tx.employee.updateMany.mockResolvedValue({ count: 0 });
    await limparParticipaDeDesligados({ id: "u1" });
    expect(registrarHistorico).not.toHaveBeenCalled();
  });
  test("nada a limpar: não grava nada", async () => {
    lerNaTransacao([func("n", "Nova", "2026-11-03")]);
    expect(await limparParticipaDeDesligados({ id: "u1" })).toEqual([]);
    expect(db.__tx.employee.updateMany).not.toHaveBeenCalled();
    expect(registrarHistorico).not.toHaveBeenCalled();
  });
});
