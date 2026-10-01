import { beforeEach, expect, test, vi } from "vitest";

// Bilhete mensal fica com a pessoa: a rescisão não desconta a parte do mês depois da saída.
vi.mock("../../../config/database.js", () => ({
  prisma: {
    employeeHistorico: { findMany: vi.fn(async () => []) },
    employee: { findFirst: vi.fn() },
    payrollItem: { findMany: vi.fn() },
    tipPeriod: { findFirst: vi.fn(async () => null) },
    tipVale: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("../tip-commission.service.js", () => ({ computeTipCommission: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { apurarRescisao } from "../rescisao-apuracao.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

beforeEach(() => vi.clearAllMocks());

test("bilhete mensal: nada a descontar, sem pedir conferência manual", async () => {
  db.employee.findFirst.mockResolvedValue({ id: "e1", modality: "CLT", terminationDate: new Date("2026-09-29T00:00:00Z"), vtType: "BILHETE_MENSAL", vtLegs: [] });
  db.payrollItem.findMany.mockResolvedValue([{ periodLabel: "VT Bilhete Único Mensal", periodStart: new Date("2026-09-01T00:00:00Z"), details: { gross: 411.13 }, paymentDate: null }]);
  const a = (await apurarRescisao("e1"))!;
  expect(a.vt).toMatchObject({ total: 0, dias: [], semDetalhe: [], observacao: "Bilhete mensal: fica com a pessoa, não se desconta na rescisão." });
  expect(a.sugestao.vtDesconto).toBe(0);
});
