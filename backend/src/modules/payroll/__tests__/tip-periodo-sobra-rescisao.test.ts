import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// PUT do período grava o modo da parte de quem saiu, audita e respeita o fechamento.
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    tipPeriod: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  };
  return { prisma };
});
vi.mock("../../security/security-utils.js", () => ({
  getSessionUser: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("../../security/menu-permissions.js", () => ({ userHasPermission: vi.fn(async () => true) }));

import { prisma } from "../../../config/database.js";
import { auditLog, getSessionUser } from "../../security/security-utils.js";
import { tipCommissionRouter } from "../tip-commission.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/payroll/tip", tipCommissionRouter);

const periodo = (status: "OPEN" | "CLOSED", over: Record<string, unknown> = {}) => ({
  id: "per1", status, competenceYear: 2026, competenceMonth: 9,
  grossPool: 1000, servicoFaturamento: 1000, ajusteServico: 0, ajusteServicoMotivo: null, deductionPercent: 20, pointsTotal: 100,
  periodStart: new Date("2026-08-26"), periodEnd: new Date("2026-09-25"), diasPadrao: 26, reservaPontos: 0,
  descontaFalta: true, descontaAtestado: true, descontaFerias: true, descontaOutros: false, proporcionalEntrada: true,
  sobraRescisaoParaSaldo: false,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli", email: "e@x", role: "VISUALIZACAO", mustChangePassword: false } as never);
  db.tipPeriod.findUniqueOrThrow.mockResolvedValue({ servicoFaturamento: 1000, ajusteServico: 0 });
  db.tipPeriod.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => periodo("OPEN", { sobraRescisaoParaSaldo: data.sobraRescisaoParaSaldo ?? false }));
});

describe("PUT /periods/:id — parte de quem saiu", () => {
  test("grava o modo \"vai para o livre\" e registra antes e depois na auditoria", async () => {
    db.tipPeriod.findUnique.mockResolvedValue(periodo("OPEN"));
    const res = await request(app).put("/payroll/tip/periods/per1").send({ sobraRescisaoParaSaldo: true });
    expect(res.status).toBe(200);
    expect(db.tipPeriod.update.mock.calls[0][0].data.sobraRescisaoParaSaldo).toBe(true);
    const audit = vi.mocked(auditLog).mock.calls[0][0] as { previousValue: Record<string, unknown>; newValue: Record<string, unknown> };
    expect(audit.previousValue.sobraRescisaoParaSaldo).toBe(false);
    expect(audit.newValue.sobraRescisaoParaSaldo).toBe(true);
  });

  test("sem o campo no corpo, não mexe no modo; valor que não é booleano é ignorado", async () => {
    db.tipPeriod.findUnique.mockResolvedValue(periodo("OPEN"));
    await request(app).put("/payroll/tip/periods/per1").send({ diasPadrao: 26 });
    await request(app).put("/payroll/tip/periods/per1").send({ sobraRescisaoParaSaldo: "sim" });
    expect(db.tipPeriod.update.mock.calls[0][0].data.sobraRescisaoParaSaldo).toBeUndefined();
    expect(db.tipPeriod.update.mock.calls[1][0].data.sobraRescisaoParaSaldo).toBeUndefined();
  });

  test("período fechado não muda de modo", async () => {
    db.tipPeriod.findUnique.mockResolvedValue(periodo("CLOSED"));
    const res = await request(app).put("/payroll/tip/periods/per1").send({ sobraRescisaoParaSaldo: true });
    expect(res.status).toBe(409);
    expect(db.tipPeriod.update).not.toHaveBeenCalled();
  });
});
