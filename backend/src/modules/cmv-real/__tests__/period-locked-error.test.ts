import { beforeEach, describe, expect, test, vi } from "vitest";

// A trava de periodo precisa ser DISTINGUIVEL de qualquer outro erro: o sync do PDV pula
// o dia travado, mas nao pode fazer o mesmo com uma falha de banco.
vi.mock("../../../config/database.js", () => ({ prisma: { $queryRaw: vi.fn() } }));

import { prisma } from "../../../config/database.js";
import { assertPeriodWritableForRange } from "../cmv-real.service.js";
import { PeriodLockedError, isPeriodLockedError } from "../period-locked-error.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const queryRaw = (prisma as any).$queryRaw as ReturnType<typeof vi.fn>;
const dia = new Date("2026-08-10T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PeriodLockedError", () => {
  test("e um Error de verdade, com nome proprio e a mensagem recebida", () => {
    const e = new PeriodLockedError("Sincronizacao bloqueada: mes travado.");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("PeriodLockedError");
    expect(e.message).toBe("Sincronizacao bloqueada: mes travado.");
  });

  test("isPeriodLockedError reconhece so a trava", () => {
    expect(isPeriodLockedError(new PeriodLockedError("x"))).toBe(true);
    expect(isPeriodLockedError(new Error("connection reset"))).toBe(false);
    expect(isPeriodLockedError("bloqueado")).toBe(false);
    expect(isPeriodLockedError(null)).toBe(false);
  });
});

describe("assertPeriodWritableForRange", () => {
  test("mes travado: lanca PeriodLockedError com o mes na mensagem", async () => {
    queryRaw.mockResolvedValueOnce([{ competenceYear: 2026, competenceMonth: 8 }]);
    const erro = await assertPeriodWritableForRange(dia, dia, "Sincronizacao do Agile PDV").catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(PeriodLockedError);
    expect((erro as Error).message).toContain("08/2026");
    expect((erro as Error).message).toContain("travado");
  });

  test("apuracao de CMV fechada: lanca PeriodLockedError com o codigo e as datas", async () => {
    queryRaw
      .mockResolvedValueOnce([]) // nenhum mes travado
      .mockResolvedValueOnce([{ id: "p1", code: "CMV-2026-0009", name: "x", dataInicial: new Date("2026-08-01T12:00:00Z"), dataFinal: new Date("2026-08-19T12:00:00Z") }]);
    const erro = await assertPeriodWritableForRange(dia, dia, "Sincronizacao do Agile PDV").catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(PeriodLockedError);
    expect((erro as Error).message).toContain("CMV-2026-0009");
    expect((erro as Error).message).toContain("2026-08-01");
  });

  test("sem trava nenhuma: resolve", async () => {
    queryRaw.mockResolvedValue([]);
    await expect(assertPeriodWritableForRange(dia, dia, "x")).resolves.toBeUndefined();
  });

  test("falha de banco NAO vira trava: o erro original passa intacto", async () => {
    const falha = new Error("Can't reach database server");
    queryRaw.mockRejectedValueOnce(falha);
    const erro = await assertPeriodWritableForRange(dia, dia, "x").catch((e: unknown) => e);
    expect(erro).toBe(falha);
    expect(erro).not.toBeInstanceOf(PeriodLockedError);
  });
});
