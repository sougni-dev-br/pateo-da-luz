import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Rotas da gorjeta: a auditoria da importação do extrato guarda só contadores e ids (sem
// avisos, que trazem nome com valor), e o ajuste da reserva sem data usa hoje em São Paulo.
vi.mock("../../../config/database.js", () => ({ prisma: {} }));
vi.mock("../../security/security-utils.js", () => ({
  getSessionUser: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("../../security/menu-permissions.js", () => ({ userHasPermission: vi.fn(async () => true) }));
vi.mock("../dados-pessoais.js", () => ({ podeVerDadosPessoais: vi.fn(async () => true) }));
vi.mock("../extras-comum.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../extras-comum.js")>()),
  hojeEmSaoPaulo: vi.fn(() => "2026-09-30"),
}));
vi.mock("../rh-extract.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../rh-extract.service.js")>()),
  importExtrato: vi.fn(),
}));
vi.mock("../tip-historico.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tip-historico.service.js")>()),
  lancarAjusteReserva: vi.fn(async () => ({ id: "mov1" })),
}));

import { auditLog, getSessionUser } from "../../security/security-utils.js";
import { importExtrato, type ImportExtratoResult } from "../rh-extract.service.js";
import { lancarAjusteReserva } from "../tip-historico.service.js";
import { tipCommissionRouter } from "../tip-commission.routes.js";

const app = express();
app.use(express.json());
app.use("/payroll/tip", tipCommissionRouter);

const resultado: ImportExtratoResult = {
  calculo: "MENSAL", empresa: "RESTAURANTE FICTICIO LTDA", companyId: "c1", competenceYear: 2026, competenceMonth: 8,
  totalLiquido: 12345.67, funcionariosCadastrados: 1, titulosGerados: 3, titulosNovos: 1, titulosAtualizados: 2, titulosPulados: 1,
  rhExtractId: "rh1", extratoAtualizado: false, pessoasLidas: 4, pessoasConferidas: 4,
  avisos: ["Rescisão de FULANO DE TAL no extrato (líquido R$ 5.000,00): confira se está lançada em Contas a Pagar."],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli", email: "e@x", role: "VISUALIZACAO" } as never);
  vi.mocked(importExtrato).mockResolvedValue(resultado);
});

describe("POST /extrato/import — auditoria", () => {
  test("grava só contadores e ids; a resposta continua completa", async () => {
    const r = await request(app).post("/payroll/tip/extrato/import")
      .send({ fileBase64: Buffer.from("%PDF-1.4 teste").toString("base64"), fileName: "x.pdf" });
    expect(r.status).toBe(201);
    expect(r.body.avisos).toHaveLength(1);
    const audit = vi.mocked(auditLog).mock.calls[0][0] as { action: string; entityId: string; newValue: Record<string, unknown> };
    expect(audit).toMatchObject({ action: "IMPORT_RH_EXTRATO", entityId: "rh1" });
    expect(audit.newValue).toEqual({
      rhExtractId: "rh1", calculo: "MENSAL", competenceYear: 2026, competenceMonth: 8, companyId: "c1", empresa: "RESTAURANTE FICTICIO LTDA",
      titulosGerados: 3, titulosNovos: 1, titulosAtualizados: 2, titulosPulados: 1,
      pessoasLidas: 4, pessoasConferidas: 4, funcionariosCadastrados: 1, extratoAtualizado: false,
    });
    expect(JSON.stringify(audit.newValue)).not.toMatch(/FULANO|5\.000|12345/);
  });
});

describe("POST /reserve/adjustments — data padrão", () => {
  test("sem data, o ajuste é de hoje em São Paulo", async () => {
    const r = await request(app).post("/payroll/tip/reserve/adjustments").send({ amount: 100, notes: "Saldo inicial" });
    expect(r.status).toBeLessThan(300);
    expect(vi.mocked(lancarAjusteReserva).mock.calls[0][1]).toEqual(new Date("2026-09-30T00:00:00Z"));
  });
});
