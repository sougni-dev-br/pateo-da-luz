import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// PUT do periodo: quebra e destino da sobra sao validados, gravados e auditados.
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
  sobraRescisaoParaSaldo: false, quebraPct: 0, destinoSobra: "FUNDO",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli", email: "e@x", role: "VISUALIZACAO", mustChangePassword: false } as never);
  db.tipPeriod.findUnique.mockResolvedValue(periodo("OPEN"));
  db.tipPeriod.findUniqueOrThrow.mockResolvedValue({ servicoFaturamento: 1000, ajusteServico: 0 });
  db.tipPeriod.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    periodo("OPEN", { quebraPct: data.quebraPct ?? 0, destinoSobra: data.destinoSobra ?? "FUNDO" }));
});

const put = (body: Record<string, unknown>) => request(app).put("/payroll/tip/periods/per1").send(body);
const dadosGravados = () => db.tipPeriod.update.mock.calls[0][0].data as Record<string, unknown>;

describe("PUT /periods/:id - quebra e destino da sobra", () => {
  test("grava quebra e destino e registra antes e depois na auditoria", async () => {
    const res = await put({ quebraPct: 5, destinoSobra: "REDISTRIBUIR" });
    expect(res.status).toBe(200);
    expect(dadosGravados()).toMatchObject({ quebraPct: 5, destinoSobra: "REDISTRIBUIR" });
    const audit = vi.mocked(auditLog).mock.calls[0][0] as { previousValue: Record<string, unknown>; newValue: Record<string, unknown> };
    expect(audit.previousValue).toMatchObject({ quebraPct: 0, destinoSobra: "FUNDO" });
    expect(audit.newValue).toMatchObject({ quebraPct: 5, destinoSobra: "REDISTRIBUIR" });
  });

  test("destino desconhecido e erro 422 e nada e gravado", async () => {
    for (const destinoSobra of ["redistribuir", "", null, 3, "XPTO"]) {
      const res = await put({ destinoSobra });
      expect(res.status).toBe(422);
    }
    expect(db.tipPeriod.update).not.toHaveBeenCalled();
  });

  test("retencao mais quebra acima de 100% e erro 422", async () => {
    expect((await put({ deductionPercent: 60, quebraPct: 50 })).status).toBe(422);
    expect((await put({ quebraPct: 90 })).status).toBe(422); // retencao atual de 20 + 90
    expect(db.tipPeriod.update).not.toHaveBeenCalled();
  });

  test("quebra negativa vira 0 e acima de 100 e barrada pela soma", async () => {
    expect((await put({ quebraPct: -3 })).status).toBe(200);
    expect(dadosGravados().quebraPct).toBe(0);
    expect((await put({ quebraPct: 500 })).status).toBe(422);
  });

  test("sem os campos no corpo nao mexe neles", async () => {
    await put({ diasPadrao: 26 });
    expect(dadosGravados().quebraPct).toBeUndefined();
    expect(dadosGravados().destinoSobra).toBeUndefined();
  });

  test("periodo fechado nao muda quebra nem destino", async () => {
    db.tipPeriod.findUnique.mockResolvedValue(periodo("CLOSED"));
    const res = await put({ quebraPct: 5, destinoSobra: "LIVRE" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(db.tipPeriod.update).not.toHaveBeenCalled();
  });
});
