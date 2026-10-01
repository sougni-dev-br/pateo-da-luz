import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, test, vi } from "vitest";

// Teto do IR para a gorjeta informada: editado na ficha (junto do salário combinado),
// só para CLT, rastreado no histórico do cadastro com "vale a partir de" e motivo.
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    employee: { findFirst: vi.fn(), update: vi.fn() },
    employeeHistorico: { createMany: vi.fn(), findMany: vi.fn() },
    company: { findMany: vi.fn() },
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
  hojeEmSaoPaulo: vi.fn(() => "2026-10-01"),
}));

import { prisma } from "../../../config/database.js";
import { getSessionUser } from "../../security/security-utils.js";
import { podeVerDadosPessoais } from "../dados-pessoais.js";
import { employeeRouter, lerTetoIrGorjeta } from "../employee.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/employees", employeeRouter);

const CPF = "52998224725";
const existente = {
  id: "e1", firstName: "Elioenai", lastName: "Silva", cpf: CPF, baseSalary: "3672", modality: "CLT", position: "Gerente",
  companyId: null, salarioCombinado: "5200", salarioCombinadoMotivo: "Combinado acima", tetoIrGorjeta: null,
  recebeAdiantamento: true, pagamentoQuinzenal: false, admissionDate: new Date("2024-01-01T00:00:00Z"), deletedAt: null,
};
const corpo = (over: Record<string, unknown> = {}) => ({
  firstName: "Elioenai", lastName: "Silva", cpf: CPF, baseSalary: "3672", modality: "CLT", position: "Gerente",
  salarioCombinado: "5200", salarioCombinadoMotivo: "Combinado acima", recebeAdiantamento: true, admissionDate: "2024-01-01", ...over,
});
const linhasGravadas = () => db.employeeHistorico.createMany.mock.calls.flatMap((c: [{ data: unknown[] }]) => c[0].data);

describe("lerTetoIrGorjeta", () => {
  it("não mexe quando o corpo não traz o campo", () => {
    expect(lerTetoIrGorjeta({}, "CLT")).toEqual({ dados: {} });
  });
  it("vazio tira o teto", () => {
    expect(lerTetoIrGorjeta({ tetoIrGorjeta: "" }, "CLT")).toEqual({ dados: { tetoIrGorjeta: null } });
    expect(lerTetoIrGorjeta({ tetoIrGorjeta: null }, "NAO_CLT")).toEqual({ dados: { tetoIrGorjeta: null } });
  });
  it("grava o valor para CLT", () => {
    expect(lerTetoIrGorjeta({ tetoIrGorjeta: "5000.00" }, "CLT")).toEqual({ dados: { tetoIrGorjeta: 5000 } });
  });
  it("recusa para quem não tem registro", () => {
    expect(lerTetoIrGorjeta({ tetoIrGorjeta: 5000 }, "NAO_CLT")).toEqual({ erro: "O teto do IR para a gorjeta só vale para quem é CLT." });
  });
  it("recusa zero, negativo, absurdo ou texto", () => {
    for (const v of [0, -1, 100001, "abc"]) expect(lerTetoIrGorjeta({ tetoIrGorjeta: v }, "CLT")).toHaveProperty("erro");
  });
});

describe("PUT /employees/:id com o teto", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli", email: "e@x", role: "VISUALIZACAO" } as never);
    vi.mocked(podeVerDadosPessoais).mockResolvedValue(true);
    db.employee.findFirst.mockImplementation(async (q: { where: { id?: unknown } }) => (typeof q.where.id === "string" ? existente : null));
    db.employee.update.mockImplementation(async ({ data }: { data: object }) => ({ ...existente, ...data }));
    db.employeeHistorico.createMany.mockResolvedValue({ count: 1 });
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
  });

  test("pôr o teto grava o cadastro e uma linha no histórico", async () => {
    const r = await request(app).put("/employees/e1").send(corpo({ tetoIrGorjeta: "5000" }));
    expect(r.status).toBe(200);
    expect(db.employee.update.mock.calls[0][0].data).toMatchObject({ tetoIrGorjeta: 5000 });
    expect(linhasGravadas()).toEqual([expect.objectContaining({
      campo: "tetoIrGorjeta", valorAnterior: null, valorNovo: "5000.00", vigenteDesde: new Date("2026-10-01T00:00:00Z"), origem: "CADASTRO",
    })]);
  });

  test("valendo desde um mês passado (setembro) exige motivo; com motivo grava a vigência", async () => {
    const sem = await request(app).put("/employees/e1").send(corpo({ tetoIrGorjeta: "5000", vigenteDesde: "2026-09-01" }));
    expect(sem.status).toBe(400);
    expect(sem.body.message).toMatch(/informe o motivo/);
    expect(db.employee.update).not.toHaveBeenCalled();
    const com = await request(app).put("/employees/e1").send(corpo({ tetoIrGorjeta: "5000", vigenteDesde: "2026-09-01", motivoAlteracao: "Acerto com a contabilidade" }));
    expect(com.status).toBe(200);
    expect(linhasGravadas()[0]).toMatchObject({ campo: "tetoIrGorjeta", vigenteDesde: new Date("2026-09-01T00:00:00Z"), motivo: "Acerto com a contabilidade" });
  });

  test("sem registro: 400 e nada gravado", async () => {
    const r = await request(app).put("/employees/e1").send(corpo({ modality: "NAO_CLT", tetoIrGorjeta: "5000" }));
    expect(r.status).toBe(400);
    expect(r.body.message).toBe("O teto do IR para a gorjeta só vale para quem é CLT.");
    expect(db.employee.update).not.toHaveBeenCalled();
  });

  test("sem permissão de ver Funcionários: 403 ao mexer no teto", async () => {
    vi.mocked(podeVerDadosPessoais).mockResolvedValue(false);
    const r = await request(app).put("/employees/e1").send(corpo({ tetoIrGorjeta: "5000" }));
    expect(r.status).toBe(403);
    expect(db.employee.update).not.toHaveBeenCalled();
  });

  test("corpo sem o campo não tira o teto gravado", async () => {
    db.employee.findFirst.mockImplementation(async (q: { where: { id?: unknown } }) =>
      (typeof q.where.id === "string" ? { ...existente, tetoIrGorjeta: "5000" } : null));
    const r = await request(app).put("/employees/e1").send(corpo());
    expect(r.status).toBe(200);
    expect(db.employee.update.mock.calls[0][0].data).not.toHaveProperty("tetoIrGorjeta");
    expect(db.employeeHistorico.createMany).not.toHaveBeenCalled();
  });
});
