import { describe, expect, test, vi } from "vitest";

vi.mock("../../../../../config/database.js", () => ({ prisma: {} }));
vi.mock("../../../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn() }));
vi.mock("../../../../security/security-utils.js", () => ({ auditLog: vi.fn() }));

const { dataDaLinhaMensal } = await import("../ifood-conciliacao-import.service.js");

describe("dataDaLinhaMensal", () => {
  test("mês já encerrado usa o último dia do mês", () => {
    expect(dataDaLinhaMensal("2026-10", "2026-11-09")).toBe("2026-10-31");
    expect(dataDaLinhaMensal("2026-02", "2026-11-09")).toBe("2026-02-28");
  });

  test("mês em curso usa o dia de hoje, porque o portal só dá o acumulado até aqui", () => {
    expect(dataDaLinhaMensal("2026-11", "2026-11-09")).toBe("2026-11-09");
  });

  test("no último dia do mês em curso, usa esse mesmo dia", () => {
    expect(dataDaLinhaMensal("2026-11", "2026-11-30")).toBe("2026-11-30");
  });
});
