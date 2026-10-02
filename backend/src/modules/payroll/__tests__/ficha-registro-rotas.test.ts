import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Rota da ficha de registro (dependentes, férias, carteira) e os campos da ficha no salvar do
// cadastro, com o banco de mentira. Pessoa fictícia.
vi.mock("../../../config/database.js", () => {
  const prisma: Record<string, unknown> = {
    employee: { findFirst: vi.fn(), update: vi.fn() },
    employeeHistorico: { createMany: vi.fn(), findMany: vi.fn() },
    employeeDependente: { findMany: vi.fn() },
    employeeFerias: { findMany: vi.fn() },
    employeeAnotacaoCarteira: { findMany: vi.fn() },
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
import { employeeRouter } from "../employee.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/employees", employeeRouter);

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const CPF = "52998224725";
const existente = {
  id: "e1", firstName: "Ana", lastName: "Silva", cpf: CPF, baseSalary: "2600", modality: "CLT", position: "Lider de Praca",
  companyId: null, salarioCombinado: null, recebeAdiantamento: false, pagamentoQuinzenal: false, tetoIrGorjeta: null,
  admissionDate: d("2025-03-01"), admissaoCarteira: d("2025-03-01"), terminationDate: null, deletedAt: null,
  nomeMae: "MARIA DE TAL", ctpsNumero: "5299822",
};
const corpo = (over: Record<string, unknown> = {}) => ({
  firstName: "Ana", lastName: "Silva", cpf: CPF, baseSalary: "2600", modality: "CLT", position: "Lider de Praca",
  recebeAdiantamento: false, admissionDate: "2025-03-01", ...over,
});
const gravado = () => db.employee.update.mock.calls[0][0].data;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli", email: "e@x", role: "ADMIN" } as never);
  vi.mocked(podeVerDadosPessoais).mockResolvedValue(true);
  db.employee.findFirst.mockImplementation(async (q: { where: { id?: unknown } }) => (typeof q.where.id === "string" ? existente : null));
  db.employee.update.mockImplementation(async ({ data }: { data: object }) => ({ ...existente, ...data }));
  db.employeeHistorico.createMany.mockResolvedValue({ count: 0 });
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
  db.employeeDependente.findMany.mockResolvedValue([{ id: "dp1", nome: "CICLANO DE TAL", parentesco: null, dataNascimento: null }]);
  db.employeeFerias.findMany.mockResolvedValue([
    { aquisitivoInicio: d("2025-03-01"), aquisitivoFim: d("2026-02-28"), gozoInicio: d("2026-07-01"), gozoFim: d("2026-07-30"), abonoInicio: null, abonoFim: null },
  ]);
  db.employeeAnotacaoCarteira.findMany.mockResolvedValue([
    { id: "a2", tipo: "SALARIO", data: d("2026-05-01"), salario: "2600.00", retroativoCompetencia: null, cargoAnterior: null, cboAnterior: null, cargo: null, cbo: null },
    { id: "a1", tipo: "ADMISSAO", data: d("2025-03-01"), salario: "2000.00", retroativoCompetencia: null, cargoAnterior: null, cboAnterior: null, cargo: "COZINHEIRO (A)", cbo: "513205" },
  ]);
});

describe("GET /employees/:id/ficha", () => {
  test("devolve dependentes, férias por período aquisitivo e carteira com salário", async () => {
    const r = await request(app).get("/employees/e1/ficha");
    expect(r.status).toBe(200);
    expect(r.body.dependentes).toEqual([{ id: "dp1", nome: "CICLANO DE TAL", parentesco: null, dataNascimento: null }]);
    expect(r.body.ferias.map((p: { aquisitivoInicio: string; status: string }) => [p.aquisitivoInicio, p.status])).toEqual([
      ["2025-03-01", "QUITADO"], ["2026-03-01", "EM_AQUISICAO"],
    ]);
    expect(r.body.salarioOculto).toBe(false);
    expect(r.body.carteira.map((a: { salario: number }) => a.salario)).toEqual([2600, 2000]);
  });

  test("sem a permissão de ver Funcionários, o salário da carteira não sai", async () => {
    vi.mocked(podeVerDadosPessoais).mockResolvedValue(false);
    const r = await request(app).get("/employees/e1/ficha");
    expect(r.body.salarioOculto).toBe(true);
    expect(r.body.carteira.map((a: { salario: unknown }) => a.salario)).toEqual([null, null]);
    expect(JSON.stringify(r.body)).not.toContain("2600");
    expect(r.body.carteira[1]).toMatchObject({ cargo: "COZINHEIRO (A)", cbo: "513205" });
  });

  test("funcionário inexistente: 404", async () => {
    db.employee.findFirst.mockResolvedValue(null);
    expect((await request(app).get("/employees/x/ficha")).status).toBe(404);
  });
});

describe("salvar o cadastro com os campos da ficha", () => {
  test("tela que não manda os campos da ficha não apaga o que a importação gravou", async () => {
    const r = await request(app).put("/employees/e1").send(corpo({ phone: "11999990000" }));
    expect(r.status).toBe(200);
    expect(gravado()).not.toHaveProperty("nomeMae");
    expect(gravado()).not.toHaveProperty("ctpsNumero");
  });

  test("campos enviados são gravados: texto aparado, vazio vira null, data e UF normalizadas", async () => {
    const r = await request(app).put("/employees/e1").send(corpo({
      nomeCompleto: " ANA SILVA DE TAL ", nomeMae: "  MARIA DE TAL  ", nomePai: "", ctpsUf: "sp", rgDataEmissao: "2016-01-15", possuiDeficiencia: false, cbo: "513210",
    }));
    expect(r.status).toBe(200);
    expect(gravado()).toMatchObject({ nomeCompleto: "Ana Silva de Tal", nomeMae: "Maria de Tal", nomePai: null, ctpsUf: "SP", possuiDeficiencia: false, cbo: "513210" });
    expect(gravado().rgDataEmissao).toEqual(d("2016-01-15"));
  });

  test("nome, endereço e filiação são gravados como nome próprio; cidade da lista com acento", async () => {
    await request(app).put("/employees/e1").send(corpo({
      firstName: "ANA", lastName: "SILVA DE TAL", address: "RUA DAS FLORES", neighborhood: "JARDIM TESTE", city: "SAO PAULO",
      nomeMae: "MARIA DE TAL", naturalidade: "CARAPICUIBA - SP", displayName: "ANINHA",
    }));
    expect(gravado()).toMatchObject({
      firstName: "Ana", lastName: "Silva de Tal", address: "Rua das Flores", neighborhood: "Jardim Teste", city: "São Paulo",
      nomeMae: "Maria de Tal", naturalidade: "Carapicuíba - SP", displayName: "ANINHA",
    });
  });

  test("deficiência que não é sim/não vira null, não true", async () => {
    await request(app).put("/employees/e1").send(corpo({ possuiDeficiencia: "false" }));
    expect(gravado().possuiDeficiencia).toBeNull();
  });
});
