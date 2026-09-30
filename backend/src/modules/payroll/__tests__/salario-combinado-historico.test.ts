import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Salário combinado mudado pela conferência da gorjeta também entra no histórico do
// cadastro, na mesma transação, com "vale a partir de".
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    employee: { findFirst: vi.fn(), update: vi.fn() },
    employeeHistorico: { createMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma };
});
vi.mock("../../security/security-utils.js", () => ({
  getSessionUser: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("../dados-pessoais.js", () => ({ podeVerDadosPessoais: vi.fn() }));
vi.mock("../extras-comum.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../extras-comum.js")>()),
  hojeEmSaoPaulo: vi.fn(() => "2026-09-30"),
}));

import { prisma } from "../../../config/database.js";
import { getSessionUser } from "../../security/security-utils.js";
import { podeVerDadosPessoais } from "../dados-pessoais.js";
import { tipConferenciaRouter } from "../tip-conferencia.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/payroll/tip", tipConferenciaRouter);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli", email: "e@x", role: "VISUALIZACAO" } as never);
  vi.mocked(podeVerDadosPessoais).mockResolvedValue(true);
  db.employee.findFirst.mockResolvedValue({ id: "e1", salarioCombinado: null, salarioCombinadoMotivo: null, admissionDate: new Date("2025-01-01T00:00:00Z") });
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
});

describe("PUT /team/:id/salario-combinado", () => {
  test("grava a linha do histórico com o motivo e a vigência informada", async () => {
    const r = await request(app).put("/payroll/tip/team/e1/salario-combinado").send({ valor: 5200, motivo: "acima do registrado", vigenteDesde: "2026-09-01" });
    expect(r.status).toBe(200);
    expect(db.employeeHistorico.createMany.mock.calls[0][0].data[0]).toMatchObject({
      campo: "salarioCombinado", valorAnterior: null, valorNovo: "5200.00", vigenteDesde: new Date("2026-09-01T00:00:00Z"),
      motivo: "acima do registrado", origem: "CONFERENCIA_GORJETA", criadoPorNome: "Eli",
    });
  });

  test("sem permissão de Funcionários: 403 e nada gravado", async () => {
    vi.mocked(podeVerDadosPessoais).mockResolvedValue(false);
    expect((await request(app).put("/payroll/tip/team/e1/salario-combinado").send({ valor: 5200, motivo: "acima do registrado" })).status).toBe(403);
    expect(db.employee.update).not.toHaveBeenCalled();
  });

  test("vigência antes da admissão: 422 e nada gravado", async () => {
    const r = await request(app).put("/payroll/tip/team/e1/salario-combinado").send({ valor: 5200, motivo: "acima do registrado", vigenteDesde: "2024-12-01" });
    expect(r.status).toBe(422);
    expect(db.employee.update).not.toHaveBeenCalled();
  });
});

describe("PUT /team/:id/salario-combinado — vigência de mês passado", () => {
  const url = "/payroll/tip/team/e1/salario-combinado";

  test("tirar o combinado valendo desde mês passado sem motivo: 400 e nada gravado", async () => {
    db.employee.findFirst.mockResolvedValue({ id: "e1", salarioCombinado: 5200, salarioCombinadoMotivo: "acima do registrado", admissionDate: new Date("2025-01-01T00:00:00Z") });
    const r = await request(app).put(url).send({ valor: null, vigenteDesde: "2026-08-01" });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe("Alteração valendo desde 08/2026 muda cálculos de meses passados: informe o motivo.");
    expect(db.employee.update).not.toHaveBeenCalled();
  });

  test("com motivo, o retroativo passa", async () => {
    const r = await request(app).put(url).send({ valor: 5200, motivo: "acima do registrado", vigenteDesde: "2026-08-01" });
    expect(r.status).toBe(200);
  });
});
