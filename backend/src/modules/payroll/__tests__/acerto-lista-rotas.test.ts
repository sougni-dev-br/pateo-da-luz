import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Fechar a gorjeta lança os acertos da lista de pagamento no Contas a Pagar; e há uma rota
// para fazer o mesmo à mão (botão na aba da lista de pagamento), com a permissão da Folha.
vi.mock("../../../config/database.js", () => ({ prisma: { tipPeriod: { findUnique: vi.fn(async () => ({ status: "CLOSED" })) } } }));
vi.mock("../../security/security-utils.js", () => ({
  getSessionUser: vi.fn(), auditLog: vi.fn(async () => undefined), requestIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("../../security/menu-permissions.js", () => ({ userHasPermission: vi.fn(async () => true) }));
vi.mock("../dados-pessoais.js", () => ({ podeVerDadosPessoais: vi.fn(async () => true) }));
vi.mock("../tip-commission.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tip-commission.service.js")>()),
  closeTipPeriod: vi.fn(async () => ({ code: "GOR-2026-0009", totals: {}, fechamento: { code: "GOR-2026-0009/v1" } })),
}));
vi.mock("../salario-combinado.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../salario-combinado.service.js")>()),
  sincronizarSalariosCombinados: vi.fn(async () => ({ competencia: "09/2026", alterados: [], semMudanca: 0, pagosIgnorados: 0, avisos: [] })),
}));
vi.mock("../acerto-lista.service.js", () => ({ lancarAcertosDaLista: vi.fn() }));

import { getSessionUser } from "../../security/security-utils.js";
import { userHasPermission } from "../../security/menu-permissions.js";
import { podeVerDadosPessoais } from "../dados-pessoais.js";
import { closeTipPeriod } from "../tip-commission.service.js";
import { lancarAcertosDaLista } from "../acerto-lista.service.js";
import { tipCommissionRouter } from "../tip-commission.routes.js";

const app = express();
app.use(express.json());
app.use("/payroll/tip", tipCommissionRouter);

const RESULTADO = {
  competencia: "09/2026",
  criados: [{ employeeId: "e1", nome: "Ana Exemplo", valor: 1695, vencimento: "2026-10-07" }],
  atualizados: [{ employeeId: "e2", nome: "Bruno Exemplo", antes: 900, depois: 950 }],
  semMudanca: 3,
  avisos: ["Ana Exemplo: acerto de 09/2026 já pago (R$ 1,00)."],
  avisosSemValor: ["Ana Exemplo: acerto de 09/2026 já pago."],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli", email: "e@x", role: "VISUALIZACAO" } as never);
  vi.mocked(userHasPermission).mockResolvedValue(true);
  vi.mocked(podeVerDadosPessoais).mockResolvedValue(true);
  vi.mocked(lancarAcertosDaLista).mockResolvedValue(RESULTADO);
});

const semFolha = () => vi.mocked(userHasPermission).mockImplementation(async (_u, menu, acao) => !(menu === "payroll" && acao === "edit"));

describe("fechar a gorjeta lança os acertos", () => {
  test("depois do fechamento gravado, lança os acertos da competência", async () => {
    const r = await request(app).post("/payroll/tip/periods/2026/9/close");
    expect(r.status).toBe(200);
    expect(lancarAcertosDaLista).toHaveBeenCalledWith(2026, 9, { id: "u1", name: "Eli" });
    expect(vi.mocked(closeTipPeriod).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(lancarAcertosDaLista).mock.invocationCallOrder[0]);
    expect(r.body.acertosLista).toEqual({ criados: 1, atualizados: 1, detalhes: RESULTADO, erro: null, avisos: RESULTADO.avisos });
  });

  test("quem não vê Funcionários recebe só as contagens e os avisos sem valor", async () => {
    vi.mocked(podeVerDadosPessoais).mockResolvedValue(false);
    const r = await request(app).post("/payroll/tip/periods/2026/9/close");
    expect(r.body.acertosLista).toEqual({ criados: 1, atualizados: 1, detalhes: null, erro: null, avisos: RESULTADO.avisosSemValor });
  });

  test("sem editar a Folha: fecha, não lança e devolve o aviso", async () => {
    semFolha();
    const r = await request(app).post("/payroll/tip/periods/2026/9/close");
    expect(r.status).toBe(200);
    expect(lancarAcertosDaLista).not.toHaveBeenCalled();
    expect(r.body.acertosLista).toMatchObject({ criados: 0, atualizados: 0, detalhes: null, erro: null });
    expect(r.body.acertosLista.aviso).toMatch(/Acertos da lista.*editar a Folha/);
  });

  test("falha ao lançar (ex.: mês travado) não desfaz o fechamento: vira erro no resultado", async () => {
    vi.mocked(lancarAcertosDaLista).mockRejectedValue(new Error("Mês 09/2026 fechado"));
    const r = await request(app).post("/payroll/tip/periods/2026/9/close");
    expect(r.status).toBe(200);
    expect(r.body.acertosLista).toMatchObject({ criados: 0, atualizados: 0, erro: "Mês 09/2026 fechado" });
  });

  test("fechamento que falha não lança", async () => {
    vi.mocked(closeTipPeriod).mockRejectedValueOnce(new Error("pendência"));
    const r = await request(app).post("/payroll/tip/periods/2026/9/close");
    expect(r.status).toBe(422);
    expect(lancarAcertosDaLista).not.toHaveBeenCalled();
  });
});

describe("POST /periods/:ano/:mes/acertos-lista (botão)", () => {
  const url = "/payroll/tip/periods/2026/9/acertos-lista";

  test("com permissão: lança e devolve o que criou e atualizou", async () => {
    const r = await request(app).post(url);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ criados: 1, atualizados: 1, semMudanca: 3, detalhes: RESULTADO, avisos: RESULTADO.avisos });
    expect(userHasPermission).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }), "payroll", "edit");
  });

  test("sem ver Funcionários: só as contagens, sem nomes com valor", async () => {
    vi.mocked(podeVerDadosPessoais).mockResolvedValue(false);
    const r = await request(app).post(url);
    expect(r.body).toEqual({ criados: 1, atualizados: 1, semMudanca: 3, detalhes: null, avisos: RESULTADO.avisosSemValor });
  });

  test("sem editar a Folha: 403", async () => {
    semFolha();
    const r = await request(app).post(url);
    expect(r.status).toBe(403);
    expect(r.body.message).toMatch(/Folha/);
    expect(lancarAcertosDaLista).not.toHaveBeenCalled();
  });

  test("sem sessão: 401", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await request(app).post(url)).status).toBe(401);
  });

  test("apuração ainda aberta: 409 e nada é lançado", async () => {
    const { prisma } = await import("../../../config/database.js");
    vi.mocked((prisma as unknown as { tipPeriod: { findUnique: ReturnType<typeof vi.fn> } }).tipPeriod.findUnique).mockResolvedValueOnce({ status: "OPEN" });
    const r = await request(app).post(url);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/aberta/);
    expect(lancarAcertosDaLista).not.toHaveBeenCalled();
  });

  test("sem apuração no mês: 409 dizendo que não há apuração", async () => {
    const { prisma } = await import("../../../config/database.js");
    vi.mocked((prisma as unknown as { tipPeriod: { findUnique: ReturnType<typeof vi.fn> } }).tipPeriod.findUnique).mockResolvedValueOnce(null);
    const r = await request(app).post(url);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/Não há apuração/);
    expect(lancarAcertosDaLista).not.toHaveBeenCalled();
  });

  test("competência inválida: 400", async () => {
    expect((await request(app).post("/payroll/tip/periods/2026/13/acertos-lista")).status).toBe(400);
  });

  test("erro do lançamento (mês travado, sem apuração): 409 com a mensagem", async () => {
    vi.mocked(lancarAcertosDaLista).mockRejectedValue(new Error("Não há apuração da gorjeta de 09/2026."));
    const r = await request(app).post(url);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/apuração/);
  });
});
