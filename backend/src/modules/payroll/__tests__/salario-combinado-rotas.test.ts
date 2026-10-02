import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Fechar a gorjeta sincroniza o salário de quem tem salário combinado; e há uma rota para
// fazer o mesmo à mão (botão na Folha de líquidos), com permissão.
vi.mock("../../../config/database.js", () => ({ prisma: {} }));
vi.mock("../../security/security-utils.js", () => ({
  getSessionUser: vi.fn(), auditLog: vi.fn(async () => undefined), requestIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("../../security/menu-permissions.js", () => ({ userHasPermission: vi.fn(async () => true) }));
vi.mock("../dados-pessoais.js", () => ({ podeVerDadosPessoais: vi.fn(async () => true) }));
vi.mock("../tip-commission.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tip-commission.service.js")>()),
  closeTipPeriod: vi.fn(async () => ({ code: "GOR-2026-0009", totals: {}, fechamento: { code: "GOR-2026-0009/v1" } })),
}));
vi.mock("../tip-fechamento.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tip-fechamento.service.js")>()),
  detalheFechamento: vi.fn(),
}));
vi.mock("../salario-combinado.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../salario-combinado.service.js")>()),
  sincronizarSalariosCombinados: vi.fn(),
}));

import { getSessionUser } from "../../security/security-utils.js";
import { userHasPermission } from "../../security/menu-permissions.js";
import { podeVerDadosPessoais } from "../dados-pessoais.js";
import { closeTipPeriod } from "../tip-commission.service.js";
import { sincronizarSalariosCombinados } from "../salario-combinado.service.js";
import { tipCommissionRouter } from "../tip-commission.routes.js";
import { detalheFechamento } from "../tip-fechamento.service.js";

const app = express();
app.use(express.json());
app.use("/payroll/tip", tipCommissionRouter);

const sinc = {
  competencia: "09/2026", semMudanca: 0, pagosIgnorados: 0, avisos: [],
  alterados: [{ payrollItemId: "p1", employeeId: "e1", nome: "Elioenai Silva", antes: 3030, depois: 5954.74, pendenteGorjeta: false }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli", email: "e@x", role: "VISUALIZACAO" } as never);
  vi.mocked(userHasPermission).mockResolvedValue(true);
  vi.mocked(podeVerDadosPessoais).mockResolvedValue(true);
  vi.mocked(sincronizarSalariosCombinados).mockResolvedValue(sinc);
});

describe("fechar a gorjeta", () => {
  test("depois de gravar o fechamento, sincroniza os salários combinados da competência", async () => {
    const r = await request(app).post("/payroll/tip/periods/2026/9/close");
    expect(r.status).toBe(200);
    expect(sincronizarSalariosCombinados).toHaveBeenCalledWith(2026, 9, { id: "u1", name: "Eli" });
    expect(vi.mocked(closeTipPeriod).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(sincronizarSalariosCombinados).mock.invocationCallOrder[0]);
    expect(r.body.salariosCombinados).toEqual({ atualizados: 1, detalhes: sinc, erro: null });
  });

  test("quem não vê Funcionários recebe só a contagem", async () => {
    vi.mocked(podeVerDadosPessoais).mockResolvedValue(false);
    const r = await request(app).post("/payroll/tip/periods/2026/9/close");
    expect(r.body.salariosCombinados).toEqual({ atualizados: 1, detalhes: null, erro: null });
  });

  test("falha da sincronização (ex.: mês travado) não desfaz o fechamento: vira aviso", async () => {
    vi.mocked(sincronizarSalariosCombinados).mockRejectedValue(new Error("Atualização dos salários combinados bloqueado"));
    const r = await request(app).post("/payroll/tip/periods/2026/9/close");
    expect(r.status).toBe(200);
    expect(r.body.salariosCombinados).toEqual({ atualizados: 0, detalhes: null, erro: "Atualização dos salários combinados bloqueado" });
  });

  test("fechamento que falha não sincroniza", async () => {
    vi.mocked(closeTipPeriod).mockRejectedValueOnce(new Error("pendência"));
    const r = await request(app).post("/payroll/tip/periods/2026/9/close");
    expect(r.status).toBe(422);
    expect(sincronizarSalariosCombinados).not.toHaveBeenCalled();
  });
});

describe("POST /periods/:ano/:mes/salarios-combinados/sincronizar", () => {
  const url = "/payroll/tip/periods/2026/9/salarios-combinados/sincronizar";

  test("com permissão: sincroniza e devolve o que mudou", async () => {
    const r = await request(app).post(url);
    expect(r.status).toBe(200);
    expect(r.body).toEqual(sinc);
    expect(userHasPermission).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }), "payroll-tips", "edit");
  });

  test("sem editar a gorjeta: 403", async () => {
    vi.mocked(userHasPermission).mockResolvedValue(false);
    expect((await request(app).post(url)).status).toBe(403);
    expect(sincronizarSalariosCombinados).not.toHaveBeenCalled();
  });

  test("sem ver Funcionários: 403", async () => {
    vi.mocked(podeVerDadosPessoais).mockResolvedValue(false);
    expect((await request(app).post(url)).status).toBe(403);
    expect(sincronizarSalariosCombinados).not.toHaveBeenCalled();
  });

  test("sem sessão: 401", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await request(app).post(url)).status).toBe(401);
  });

  test("mês travado: 409 com a mensagem", async () => {
    vi.mocked(sincronizarSalariosCombinados).mockRejectedValue(new Error("travado"));
    const r = await request(app).post(url);
    expect(r.status).toBe(409);
    expect(r.body.message).toBe("travado");
  });
});

// O retrato do fechamento guarda a gorjeta informada pelo teto (teto − salário): sem a
// permissão de Funcionários, o valor e o teto não saem (revelariam o salário).
describe("GET /closings/:id — gorjeta informada pelo teto", () => {
  const detalhe = {
    id: "c1", totals: {}, participants: [
      { employeeId: "e1", gorjetaInformada: 1328, gorjetaInformadaPeloTeto: true, tetoIrGorjeta: 5000, liquido: 2223.54 },
      { employeeId: "e2", gorjetaInformada: 500, liquido: 500 },
    ],
  };
  beforeEach(() => { vi.mocked(detalheFechamento).mockResolvedValue(detalhe as never); });

  test("com permissão: tudo", async () => {
    const r = await request(app).get("/payroll/tip/closings/c1");
    expect(r.body.participants[0]).toMatchObject({ gorjetaInformada: 1328, tetoIrGorjeta: 5000 });
  });

  test("sem permissão: some o valor pelo teto e o teto; o indicador e a informada sem teto ficam", async () => {
    vi.mocked(podeVerDadosPessoais).mockResolvedValue(false);
    const r = await request(app).get("/payroll/tip/closings/c1");
    expect(r.body.participants[0]).not.toHaveProperty("gorjetaInformada");
    expect(r.body.participants[0]).not.toHaveProperty("tetoIrGorjeta");
    expect(r.body.participants[0].gorjetaInformadaPeloTeto).toBe(true);
    expect(r.body.participants[1].gorjetaInformada).toBe(500);
  });
});

// Auditoria 01/10: sincronizar o salário combinado grava no SALARIO da Folha (Contas a
// Pagar): exige também a permissão de editar a Folha (módulo payroll).
describe("salário combinado — permissão de editar a Folha", () => {
  const semFolha = () => vi.mocked(userHasPermission).mockImplementation(async (_u, menu) => menu !== "payroll");

  test("rota manual sem editar a Folha: 403, nada sincronizado", async () => {
    semFolha();
    const r = await request(app).post("/payroll/tip/periods/2026/9/salarios-combinados/sincronizar");
    expect(r.status).toBe(403);
    expect(r.body.message).toMatch(/Folha/);
    expect(sincronizarSalariosCombinados).not.toHaveBeenCalled();
  });

  test("rota manual confere a ação de editar na Folha", async () => {
    await request(app).post("/payroll/tip/periods/2026/9/salarios-combinados/sincronizar");
    expect(userHasPermission).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }), "payroll", "edit");
  });

  test("fechamento sem editar a Folha: fecha, não sincroniza e devolve o aviso", async () => {
    semFolha();
    const r = await request(app).post("/payroll/tip/periods/2026/9/close");
    expect(r.status).toBe(200);
    expect(closeTipPeriod).toHaveBeenCalled();
    expect(sincronizarSalariosCombinados).not.toHaveBeenCalled();
    expect(r.body.salariosCombinados).toMatchObject({ atualizados: 0, detalhes: null, erro: null });
    expect(r.body.salariosCombinados.aviso).toMatch(/editar a Folha/);
  });
});
