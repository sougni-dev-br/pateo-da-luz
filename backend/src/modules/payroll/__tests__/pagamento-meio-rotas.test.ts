import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Rota da lista do adiantamento / 1ª quinzena: só leitura, só para quem vê Funcionários. Dados fictícios.
const prismaFalso = vi.hoisted(() => ({
  employee: { findMany: vi.fn() },
  payrollItem: { findMany: vi.fn() },
}));
vi.mock("../../../config/database.js", () => ({ prisma: prismaFalso }));
vi.mock("../../security/security-utils.js", () => ({ getSessionUser: vi.fn() }));
vi.mock("../dados-pessoais.js", () => ({ podeVerDadosPessoais: vi.fn(async () => true) }));
vi.mock("../payroll.service.js", () => ({ computePayroll: vi.fn() }));

import { getSessionUser } from "../../security/security-utils.js";
import { podeVerDadosPessoais } from "../dados-pessoais.js";
import { computePayroll } from "../payroll.service.js";
import { pagamentoMeioRouter } from "../pagamento-meio.routes.js";

const app = express();
app.use("/payroll", pagamentoMeioRouter);
const url = "/payroll/pagamento-meio?year=2026&month=10&tipo=ADIANTAMENTO";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli" } as never);
  vi.mocked(podeVerDadosPessoais).mockResolvedValue(true);
  vi.mocked(computePayroll).mockResolvedValue({
    items: [{ employeeId: "s2", type: "ADIANTAMENTO", amount: 880, dueDate: "2026-10-20T00:00:00.000Z", details: { semRegistro: true }, exists: false }],
    warnings: [
      "Fulano Exemplo: adiantamento de 10/2026 já veio do extrato da contabilidade; não gerado de novo.",
      "Beltrano Exemplo: Adiantamento de 10/2026 não gerado — saiu em 05/10/2026.",
      "Ciclano Exemplo: VT 1ª quinzena não gerado — vale de R$ 0,00.",
    ],
  } as never);
  prismaFalso.payrollItem.findMany.mockResolvedValue([
    { id: "i1", employeeId: "c1", amount: "1034.00", dueDate: new Date("2026-10-20T00:00:00Z"), paymentDate: null, paidAmount: null, details: { empresa: "ALFA EXEMPLO LTDA" } },
  ]);
  prismaFalso.employee.findMany.mockResolvedValue([
    { id: "c1", firstName: "Ana", lastName: "Exemplo", modality: "CLT", company: { legalName: "Alfa Exemplo Ltda" }, pixKey: " ana@exemplo.com ", pixKeyType: "EMAIL", bankName: null, bankAgency: null, bankAccount: null, bankAccountDigit: null, bankAccountType: null },
    { id: "s2", firstName: "Dora", lastName: "Exemplo", modality: "NAO_CLT", company: null, pixKey: null, pixKeyType: null, bankName: "Banco Exemplo", bankAgency: "0001", bankAccount: "12345", bankAccountDigit: "6", bankAccountType: "CONTA_CORRENTE" },
  ]);
});

describe("GET /payroll/pagamento-meio", () => {
  test("lista lançados e a lançar com dados bancários; só os avisos que importam", async () => {
    const r = await request(app).get(url);
    expect(r.status).toBe(200);
    expect(computePayroll).toHaveBeenCalledWith(2026, 10);
    expect(prismaFalso.payrollItem.findMany.mock.calls[0][0].where).toMatchObject({ competenceYear: 2026, competenceMonth: 10, type: "ADIANTAMENTO", deletedAt: null });
    expect(r.body.competencia).toBe("10/2026");
    expect(r.body.linhas.map((l: { nome: string; situacao: string }) => [l.nome, l.situacao])).toEqual([["Ana Exemplo", "LANCADO"], ["Dora Exemplo", "A_LANCAR"]]);
    expect(r.body.linhas[0]).toMatchObject({ valor: 1034, pix: "ana@exemplo.com", grupo: "ALFA EXEMPLO LTDA" });
    expect(r.body.linhas[1].contaBancaria).toBe("Banco Exemplo · Ag. 0001 · C/C 12345-6");
    expect(r.body.avisos).toEqual(["Beltrano Exemplo: Adiantamento de 10/2026 não gerado — saiu em 05/10/2026."]);
  });

  test("sem permissão de ver Funcionários: 403 e nada consultado", async () => {
    vi.mocked(podeVerDadosPessoais).mockResolvedValue(false);
    const r = await request(app).get(url);
    expect(r.status).toBe(403);
    expect(prismaFalso.payrollItem.findMany).not.toHaveBeenCalled();
  });

  test("sem sessão: 401", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await request(app).get(url)).status).toBe(401);
  });

  test("tipo ou competência inválidos: 400", async () => {
    expect((await request(app).get("/payroll/pagamento-meio?year=2026&month=10&tipo=SALARIO")).status).toBe(400);
    expect((await request(app).get("/payroll/pagamento-meio?year=2026&month=13&tipo=QUINZENA")).status).toBe(400);
  });
});
