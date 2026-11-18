import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Depois que o ciclo da saída fecha, o desligado deixa de constar como participante sem ninguém
// pedir: ao fechar o mês e ao atualizar do cadastro. Falhar na limpeza não derruba a operação.
vi.mock("../../../config/database.js", () => ({
  prisma: { tipPeriod: { findUnique: vi.fn(async () => ({ id: "per1", status: "OPEN", competenceYear: 2026, competenceMonth: 11 })) } },
}));
vi.mock("../../security/security-utils.js", () => ({
  getSessionUser: vi.fn(), auditLog: vi.fn(async () => undefined), requestIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("../../security/menu-permissions.js", () => ({ userHasPermission: vi.fn(async () => true) }));
vi.mock("../dados-pessoais.js", () => ({ podeVerDadosPessoais: vi.fn(async () => true) }));
vi.mock("../tip-commission.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tip-commission.service.js")>()),
  closeTipPeriod: vi.fn(async () => ({ code: "GOR-2026-0009", totals: {}, fechamento: { code: "GOR-2026-0009/v1" } })),
  syncParticipantsFromCadastro: vi.fn(async () => ({ added: 0, elegiveis: 3, atualizados: 0, removidos: 0 })),
  computeTipCommission: vi.fn(async () => ({ participants: [] })),
}));
vi.mock("../salario-combinado.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../salario-combinado.service.js")>()),
  sincronizarSalariosCombinados: vi.fn(async () => ({ competencia: "11/2026", alterados: [], semMudanca: 0, pagosIgnorados: 0, avisos: [] })),
}));
vi.mock("../acerto-lista.service.js", () => ({ lancarAcertosDaLista: vi.fn(async () => ({ criados: [], atualizados: [], semMudanca: 0, avisos: [], avisosSemValor: [], competencia: "11/2026" })) }));
vi.mock("../tip-desligados.service.js", () => ({ limparParticipaDeDesligados: vi.fn(), desligadosParaLimpar: vi.fn() }));

import { auditLog, getSessionUser } from "../../security/security-utils.js";
import { syncParticipantsFromCadastro } from "../tip-commission.service.js";
import { limparParticipaDeDesligados } from "../tip-desligados.service.js";
import { tipCommissionRouter } from "../tip-commission.routes.js";

const app = express();
app.use(express.json());
app.use("/payroll/tip", tipCommissionRouter);

const ANALIA = { employeeId: "a", nome: "Analia Teste", terminationDate: new Date("2026-09-17T00:00:00.000Z") };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli", email: "e@x", role: "VISUALIZACAO" } as never);
  vi.mocked(limparParticipaDeDesligados).mockResolvedValue([ANALIA]);
});

describe("limpeza automática de desligados", () => {
  test("fechar o mês limpa quem saiu em ciclo fechado e informa os nomes", async () => {
    const r = await request(app).post("/payroll/tip/periods/2026/11/close");
    expect(r.status).toBe(200);
    expect(limparParticipaDeDesligados).toHaveBeenCalledWith({ id: "u1", name: "Eli", email: "e@x", role: "VISUALIZACAO" });
    expect(r.body.desligadosLimpos).toEqual(["Analia Teste"]);
    expect(vi.mocked(auditLog)).toHaveBeenCalledWith(expect.objectContaining({
      action: "CLEAR_TIP_PARTICIPA_DESLIGADOS", newValue: expect.objectContaining({ origem: "fechamento" }),
    }));
  });

  test("falha na limpeza não derruba o fechamento", async () => {
    vi.mocked(limparParticipaDeDesligados).mockRejectedValue(new Error("banco fora"));
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await request(app).post("/payroll/tip/periods/2026/11/close");
    expect(r.status).toBe(200);
    expect(r.body.desligadosLimpos).toEqual([]);
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });

  test("atualizar do cadastro limpa antes de sincronizar e informa quem saiu", async () => {
    const r = await request(app).post("/payroll/tip/periods/per1/sync");
    expect(r.status).toBe(200);
    expect(r.body.desligadosLimpos).toEqual(["Analia Teste"]);
    expect(vi.mocked(limparParticipaDeDesligados).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(syncParticipantsFromCadastro).mock.invocationCallOrder[0]);
  });

  test("sem ninguém para limpar não grava auditoria", async () => {
    vi.mocked(limparParticipaDeDesligados).mockResolvedValue([]);
    const r = await request(app).post("/payroll/tip/periods/per1/sync");
    expect(r.body.desligadosLimpos).toEqual([]);
    expect(vi.mocked(auditLog)).not.toHaveBeenCalledWith(expect.objectContaining({ action: "CLEAR_TIP_PARTICIPA_DESLIGADOS" }));
  });
});
