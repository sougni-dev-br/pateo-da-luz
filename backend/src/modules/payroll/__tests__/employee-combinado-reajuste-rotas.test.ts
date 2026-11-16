import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Reajuste do salário base de quem tem salário combinado: o combinado sobe o mesmo valor e
// as duas mudanças vão para o histórico com a mesma vigência. Dados FICTÍCIOS (repo público).
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
  hojeEmSaoPaulo: vi.fn(() => "2026-09-30"),
}));

import { prisma } from "../../../config/database.js";
import { getSessionUser } from "../../security/security-utils.js";
import { podeVerDadosPessoais } from "../dados-pessoais.js";
import { employeeRouter } from "../employee.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/employees", employeeRouter);

const CPF = "52998224725";
const existente = {
  id: "e1", firstName: "Ana", lastName: "Silva", cpf: CPF, baseSalary: "3000", modality: "NAO_CLT", position: "Garçom",
  companyId: null, salarioCombinado: "4500", salarioCombinadoMotivo: "Acordo de teste", recebeAdiantamento: false,
  admissionDate: new Date("2025-03-01T00:00:00Z"), deletedAt: null,
};
const corpo = (over: Record<string, unknown> = {}) => ({
  firstName: "Ana", lastName: "Silva", cpf: CPF, baseSalary: "3000", modality: "NAO_CLT", position: "Garçom",
  recebeAdiantamento: false, admissionDate: "2025-03-01", ...over,
});
const linhas = () => db.employeeHistorico.createMany.mock.calls.flatMap((c: [{ data: { campo: string }[] }]) => c[0].data);
const gravado = () => db.employee.update.mock.calls[0][0].data;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli", email: "e@x", role: "VISUALIZACAO" } as never);
  vi.mocked(podeVerDadosPessoais).mockResolvedValue(true);
  db.employee.findFirst.mockImplementation(async (q: { where: { id?: unknown } }) => (typeof q.where.id === "string" ? existente : null));
  db.employee.update.mockImplementation(async ({ data }: { data: object }) => ({ ...existente, ...data }));
  db.employeeHistorico.createMany.mockResolvedValue({ count: 1 });
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
});

describe("PUT /employees/:id com salário combinado", () => {
  test("base sobe e o corpo não traz o combinado: combinado acompanha e as duas linhas têm a mesma vigência", async () => {
    const r = await request(app).put("/employees/e1").send(corpo({ baseSalary: "3150.50" }));
    expect(r.status).toBe(200);
    expect(gravado()).toMatchObject({ baseSalary: 3150.5, salarioCombinado: 4650.5 });
    expect(gravado().salarioCombinadoMotivo).toContain("Acompanhou o reajuste do salário base (+R$ 150,50)");
    const l = linhas();
    expect(l).toEqual(expect.arrayContaining([
      expect.objectContaining({ campo: "baseSalary", valorAnterior: "3000.00", valorNovo: "3150.50" }),
      expect.objectContaining({ campo: "salarioCombinado", valorAnterior: "4500.00", valorNovo: "4650.50" }),
    ]));
    expect(new Set(l.map((x: { vigenteDesde: Date }) => x.vigenteDesde.toISOString())).size).toBe(1);
  });

  test("o corpo traz o mesmo combinado (caso da tela): também acompanha", async () => {
    const r = await request(app).put("/employees/e1").send(corpo({ baseSalary: "3100", salarioCombinado: "4500", salarioCombinadoMotivo: "Acordo de teste" }));
    expect(r.status).toBe(200);
    expect(gravado().salarioCombinado).toBe(4600);
  });

  test("o corpo traz combinado diferente: vale o digitado, sem acompanhar", async () => {
    const r = await request(app).put("/employees/e1").send(corpo({ baseSalary: "3100", salarioCombinado: "5000", salarioCombinadoMotivo: "Novo acordo de teste" }));
    expect(r.status).toBe(200);
    expect(gravado().salarioCombinado).toBe(5000);
    expect(gravado().salarioCombinadoMotivo).toBe("Novo acordo de teste");
  });

  test("combinado limpo na mesma edição: não acompanha", async () => {
    const r = await request(app).put("/employees/e1").send(corpo({ baseSalary: "3100", salarioCombinado: null }));
    expect(r.status).toBe(200);
    expect(gravado().salarioCombinado).toBeNull();
  });

  test("base sem mudança: combinado intacto e nenhuma linha de combinado", async () => {
    const r = await request(app).put("/employees/e1").send(corpo({ phone: "11999990000" }));
    expect(r.status).toBe(200);
    expect(gravado().salarioCombinado).toBeUndefined();
    expect(linhas().filter((x: { campo: string }) => x.campo === "salarioCombinado")).toHaveLength(0);
  });

  test("reajuste retroativo sem motivo: recusa e não grava", async () => {
    const r = await request(app).put("/employees/e1").send(corpo({ baseSalary: "3100", vigenteDesde: "2026-08-01" }));
    expect(r.status).toBe(400);
    expect(db.employee.update).not.toHaveBeenCalled();
  });

  test("reajuste que estoura o limite do combinado: recusa", async () => {
    db.employee.findFirst.mockImplementation(async (q: { where: { id?: unknown } }) =>
      (typeof q.where.id === "string" ? { ...existente, salarioCombinado: "99000" } : null));
    const r = await request(app).put("/employees/e1").send(corpo({ baseSalary: "9000" }));
    expect(r.status).toBe(400);
    expect(db.employee.update).not.toHaveBeenCalled();
  });
});
