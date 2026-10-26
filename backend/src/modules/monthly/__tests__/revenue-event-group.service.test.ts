import { beforeEach, describe, expect, test, vi } from "vitest";

const executeRaw = vi.fn();
const transaction = vi.fn();
const ensureCompetenceOpen = vi.fn();
const assertPeriodWritableForDate = vi.fn();

vi.mock("../../../config/database.js", () => ({
  prisma: { $executeRaw: (...args: unknown[]) => executeRaw(...args), $transaction: (...args: unknown[]) => transaction(...args) }
}));
vi.mock("../monthly.service.js", () => ({ ensureCompetenceOpen: (...args: unknown[]) => ensureCompetenceOpen(...args) }));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({
  assertPeriodWritableForDate: (...args: unknown[]) => assertPeriodWritableForDate(...args)
}));

import { createEventGroup } from "../revenue-event-group.service.js";
import { normalizeEventGroup } from "../revenue-event-group.js";

const rows = normalizeEventGroup({
  entries: [
    { date: "2026-10-14", description: "Congresso — Staff (5 × R$ 45,00)", grossAmount: 225, tickets: 5 },
    { date: "2026-10-15", description: "Congresso — Staff (6 × R$ 45,00)", grossAmount: 270, tickets: 6 },
    { date: "2026-11-02", description: "Congresso — Staff (2 × R$ 45,00)", grossAmount: 90, tickets: 2 }
  ]
});

beforeEach(() => {
  vi.clearAllMocks();
  executeRaw.mockImplementation(() => Promise.resolve(1));
  transaction.mockImplementation((operations: Promise<unknown>[]) => Promise.all(operations));
  ensureCompetenceOpen.mockResolvedValue(undefined);
  assertPeriodWritableForDate.mockResolvedValue(undefined);
});

describe("createEventGroup", () => {
  test("verifica cada mês e cada dia uma vez e grava todas as linhas numa transação", async () => {
    const ids = await createEventGroup(rows, "user-1");
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(ensureCompetenceOpen).toHaveBeenCalledTimes(2);
    expect(assertPeriodWritableForDate).toHaveBeenCalledTimes(3);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalledTimes(3);
  });

  test("se um mês está fechado, nada é gravado", async () => {
    ensureCompetenceOpen.mockImplementation((_year: number, month: number) =>
      month === 11 ? Promise.reject(new Error("Competência 11/2026 fechada")) : Promise.resolve()
    );
    await expect(createEventGroup(rows, "user-1")).rejects.toThrow(/fechada/);
    expect(transaction).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  test("se um dia está em período travado, nada é gravado", async () => {
    assertPeriodWritableForDate.mockImplementation((date: Date) =>
      date.getUTCDate() === 15 ? Promise.reject(new Error("período travado")) : Promise.resolve()
    );
    await expect(createEventGroup(rows, "user-1")).rejects.toThrow(/travado/);
    expect(transaction).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  test("se a transação falha, o erro sobe e nenhum id é devolvido", async () => {
    transaction.mockRejectedValue(new Error("falha no banco"));
    await expect(createEventGroup(rows, "user-1")).rejects.toThrow(/falha no banco/);
  });
});
