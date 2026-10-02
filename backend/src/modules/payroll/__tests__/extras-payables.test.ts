import { describe, expect, it, vi } from "vitest";
import { limitesDeData } from "../extras-payables.js";

// As datas são montadas como o Contas a Pagar monta (construtor local), então o
// resultado tem de ser o mesmo em UTC (produção) e em São Paulo (dev).
describe("limitesDeData", () => {
  it("período escolhido (fim 23:59:59.999) inclui o último dia", () => {
    const r = limitesDeData({ startToday: new Date(2026, 8, 29), startDate: new Date(2026, 8, 1), endDate: new Date(2026, 8, 30, 23, 59, 59, 999) });
    expect(r).toEqual({ hoje: "2026-09-29", inicio: "2026-09-01", ultimoDia: "2026-09-30" });
  });

  it("filtro 'hoje' (fim = meia-noite de amanhã, exclusivo) termina hoje", () => {
    expect(limitesDeData({ startToday: new Date(2026, 8, 22), startDate: new Date(2026, 8, 22), endDate: new Date(2026, 8, 23) }).ultimoDia).toBe("2026-09-22");
  });

  it("filtro 'vencidos' (fim = hoje à meia-noite) termina ontem", () => {
    expect(limitesDeData({ startToday: new Date(2026, 9, 1), startDate: null, endDate: new Date(2026, 9, 1) }).ultimoDia).toBe("2026-09-30");
  });

  it("sem período não limita", () => {
    expect(limitesDeData({ startToday: new Date(2026, 8, 1), startDate: null, endDate: null })).toEqual({ hoje: "2026-09-01", inicio: null, ultimoDia: null });
  });
});

describe("extras no Contas a Pagar: mesmo limite de segurança das outras origens", () => {
  it("lista e PDF usam LIMITE_POR_ORIGEM, com ORDER BY determinístico antes do LIMIT", async () => {
    vi.resetModules();
    const queryRaw = vi.fn(async () => []);
    vi.doMock("../../../config/database.js", () => ({ prisma: { $queryRaw: queryRaw } }));
    const { extrasParaPayables, extrasParaPayablesPdf } = await import("../extras-payables.js");
    const { LIMITE_POR_ORIGEM } = await import("../../purchases/payables-limite.js");
    const f = { startToday: new Date(2026, 8, 1), startDate: null, endDate: null };
    await extrasParaPayables(f);
    await extrasParaPayablesPdf(f);
    // Tagged template: (strings, ...valores).
    for (const [strings, ...values] of queryRaw.mock.calls as unknown as Array<[string[], ...unknown[]]>) {
      const texto = strings.join("?");
      expect(texto).toMatch(/ORDER BY ep\."dueDate"( NULLS LAST)?, ep\."code"[\s\S]*LIMIT \?\s*$/);
      expect(values[values.length - 1]).toBe(LIMITE_POR_ORIGEM);
    }
    expect(queryRaw).toHaveBeenCalledTimes(2);
    vi.doUnmock("../../../config/database.js");
  });
});
