import { describe, expect, test, vi } from "vitest";

const repasses = [
  { id: "r1", externalId: "portal-214485-20260901", periodStart: new Date("2026-09-01T00:00:00.000Z"), periodEnd: new Date("2026-09-06T00:00:00.000Z"), grossAmount: 540.45, totalFees: 10.75, netAmount: 529.7, paidAt: new Date("2026-09-09T00:00:00.000Z"), status: "PAGO" },
  { id: "r2", externalId: "portal-214485-20260928", periodStart: new Date("2026-09-28T00:00:00.000Z"), periodEnd: new Date("2026-09-30T00:00:00.000Z"), grossAmount: 36.49, totalFees: 2.44, netAmount: 34.05, paidAt: null, status: "EM_ABERTO" }
];

vi.mock("../../../../../config/database.js", () => ({
  prisma: {
    ifoodSale: { findMany: vi.fn(async () => []) },
    revenueEntry: {
      findMany: vi.fn(async () => [
        { date: new Date("2026-09-30T00:00:00.000Z"), description: "Delivery iFood - Pateo da Luz (consolidado do mes)", tickets: 65, grossAmount: 4386.4, platformFees: 1649.16, netAmount: 2737.24 }
      ])
    },
    ifoodSettlement: { findMany: vi.fn(async () => repasses) },
    ifoodFee: { findMany: vi.fn(async () => []) }
  }
}));

import { lerResumoDaLoja } from "../ifood.service.js";

describe("repasses do iFood levam a loja", () => {
  test("cada repasse do resumo traz o apelido da loja e o status real", async () => {
    const r = await lerResumoDaLoja("loja-1", "Pateo da Luz", 2026, 9);
    expect(r).not.toBeNull();
    expect(r!.settlements).toHaveLength(2);
    expect(r!.settlements.every((s) => s.storeLabel === "Pateo da Luz")).toBe(true);
    expect(r!.settlements.map((s) => s.status)).toEqual(["PAGO", "EM_ABERTO"]);
    expect(r!.settlements[0]!.paidAt).toBe("2026-09-09");
    expect(r!.settlements[1]!.paidAt).toBeNull();
  });
});
