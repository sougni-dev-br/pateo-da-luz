import { beforeEach, describe, expect, test, vi } from "vitest";

// Ligacao ponta a ponta do runRealSync: o iFood APAGA as vendas do mes e recria a partir da API.
// Mes vazio so zera o faturamento quando a busca de vendas deu certo; se ela falhou, o vazio nao
// prova nada e o faturamento do mes tem que ficar intacto.
vi.mock("../../../../../config/database.js", () => ({
  prisma: {
    deliveryStore: { findMany: vi.fn() },
    ifoodSale: { deleteMany: vi.fn(), create: vi.fn(), findMany: vi.fn(), aggregate: vi.fn() },
    ifoodSettlement: { upsert: vi.fn() },
    ifoodFee: { deleteMany: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    ifoodMonthlyExpense: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    ifoodSyncLog: { create: vi.fn() },
    revenueEntry: { upsert: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() }
  }
}));
vi.mock("../ifood-financial-api.js", async () => {
  const real = await vi.importActual<typeof import("../ifood-financial-api.js")>("../ifood-financial-api.js");
  return { ...real, getSales: vi.fn(), getSettlements: vi.fn(), getMaintenanceFees: vi.fn() };
});
vi.mock("../ifood-http-client.js", async () => {
  const real = await vi.importActual<typeof import("../ifood-http-client.js")>("../ifood-http-client.js");
  return { ...real, hasValidCredential: vi.fn() };
});
vi.mock("../../../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn() }));
vi.mock("../../../../receivables/receivable.service.js", () => ({ upsertReceivableFromIfoodSettlement: vi.fn() }));

import { prisma } from "../../../../../config/database.js";
import { getMaintenanceFees, getSales, getSettlements } from "../ifood-financial-api.js";
import { hasValidCredential } from "../ifood-http-client.js";
import { assertPeriodWritableForDate } from "../../../../cmv-real/cmv-real.service.js";
import { runRealSync } from "../ifood-real-sync.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hasValidCredential).mockResolvedValue(true);
  vi.mocked(assertPeriodWritableForDate).mockResolvedValue(undefined);
  vi.mocked(getSales).mockResolvedValue([]);
  vi.mocked(getSettlements).mockResolvedValue([]);
  vi.mocked(getMaintenanceFees).mockResolvedValue([]);
  db.deliveryStore.findMany.mockResolvedValue([
    { id: "l1", externalId: "merchant-ficticio", nickname: "Loja fictícia", companyId: "c1", platform: "IFOOD", active: true }
  ]);
  db.ifoodSale.deleteMany.mockResolvedValue({ count: 0 });
  db.ifoodSale.findMany.mockResolvedValue([]);
  db.ifoodSale.aggregate.mockResolvedValue({ _sum: { ifoodFeeAmount: 0, deliveryFeeAmount: 0 } });
  db.ifoodFee.deleteMany.mockResolvedValue({ count: 0 });
  db.ifoodFee.findMany.mockResolvedValue([]);
  db.ifoodMonthlyExpense.findUnique.mockResolvedValue(null);
  db.ifoodSyncLog.create.mockResolvedValue({});
  db.revenueEntry.upsert.mockResolvedValue({});
  db.revenueEntry.findMany.mockResolvedValue([
    { id: "ifood-l1-20260805", date: new Date("2026-08-05T12:00:00.000Z") }
  ]);
  db.revenueEntry.updateMany.mockResolvedValue({ count: 1 });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("iFood runRealSync — mes vazio so zera o faturamento se a busca de vendas deu certo", () => {
  test("API respondeu com sucesso e sem vendas: o faturamento antigo do mes e zerado", async () => {
    await runRealSync({ year: 2026, month: 8, triggeredByUserId: null });
    expect(db.revenueEntry.updateMany).toHaveBeenCalledTimes(1);
    expect(db.revenueEntry.updateMany.mock.calls[0][0].where.id).toEqual({ in: ["ifood-l1-20260805"] });
  });

  test("busca de vendas FALHOU (apos o wipeout): o faturamento do mes nao e tocado", async () => {
    vi.mocked(getSales).mockRejectedValue(new Error("timeout na API"));
    const r = await runRealSync({ year: 2026, month: 8, triggeredByUserId: null });
    expect(db.revenueEntry.findMany).not.toHaveBeenCalled();
    expect(db.revenueEntry.updateMany).not.toHaveBeenCalled();
    expect(r.perStore[0].message).toContain("timeout na API");
  });

  test("falha em outro passo (repasses) nao impede a zeragem: as vendas foram atualizadas", async () => {
    vi.mocked(getSettlements).mockRejectedValue(new Error("falha nos repasses"));
    await runRealSync({ year: 2026, month: 8, triggeredByUserId: null });
    expect(db.revenueEntry.updateMany).toHaveBeenCalledTimes(1);
  });
});
