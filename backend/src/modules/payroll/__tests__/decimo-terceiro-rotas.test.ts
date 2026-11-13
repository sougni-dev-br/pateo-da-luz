import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Rotas do 13º: lista (sem registro + CLT do extrato) e geração por parcela. Dados FICTÍCIOS: o repositório é público.
const tx = vi.hoisted(() => ({
  payrollItem: { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
}));
const prismaFalso = vi.hoisted(() => ({
  employee: { findMany: vi.fn() },
  payrollItem: { findMany: vi.fn() },
  tipPeriod: { findMany: vi.fn() },
  dRECategory: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("../../../config/database.js", () => ({ prisma: prismaFalso }));
vi.mock("../../security/security-utils.js", () => ({ getSessionUser: vi.fn(), auditLog: vi.fn(), requestIp: vi.fn(() => "127.0.0.1") }));
vi.mock("../dados-pessoais.js", () => ({ podeVerDadosPessoais: vi.fn(async () => true) }));
vi.mock("../cadastro-historico.service.js", () => ({ cadastrosVigentes: vi.fn() }));
vi.mock("../tip-commission.service.js", () => ({ computeTipCommission: vi.fn() }));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn(async () => undefined) }));
vi.mock("../folha-trava.js", () => ({ travarFolhaDaPessoa: vi.fn(async () => undefined) }));
vi.mock("../payroll.service.js", () => ({ FOLHA_CATEGORY: "Folha", computeStatus: vi.fn(() => "PENDING") }));

import { cadastrosVigentes } from "../cadastro-historico.service.js";
import { podeVerDadosPessoais } from "../dados-pessoais.js";
import { decimoTerceiroRouter } from "../decimo-terceiro.routes.js";
import { ROTULO_13_PARCELA_1 } from "../decimo-terceiro-sr.js";
import { getSessionUser } from "../../security/security-utils.js";

const app = express();
app.use(express.json());
app.use("/payroll/decimo-terceiro", decimoTerceiroRouter);

const empregado = (id: string, nome: string, modality: "CLT" | "NAO_CLT") => ({
  id, firstName: nome, lastName: "Exemplo", sector: null, modality, baseSalary: 2000,
  admissionDate: new Date("2026-01-01T00:00:00Z"), admissaoCarteira: null, terminationDate: null,
});
const CLT_ANA = empregado("c1", "Ana", "CLT");
const CLT_BIA = empregado("c2", "Bia", "CLT");
const SR_DORA = empregado("s1", "Dora", "NAO_CLT");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli" } as never);
  vi.mocked(podeVerDadosPessoais).mockResolvedValue(true);
  prismaFalso.tipPeriod.findMany.mockResolvedValue([]);
  prismaFalso.dRECategory.findFirst.mockResolvedValue({ id: "dre1" });
  prismaFalso.employee.findMany.mockResolvedValue([CLT_ANA, CLT_BIA, SR_DORA]);
  vi.mocked(cadastrosVigentes).mockImplementation((async (emps: Array<{ id: string; modality: string }>) =>
    new Map(emps.map((e) => [e.id, { modality: e.modality, baseSalary: 2000 }]))) as never);
  // A consulta do sem registro filtra por rótulo; a do CLT (extrato) não.
  prismaFalso.payrollItem.findMany.mockImplementation(async ({ where }: { where: { periodLabel?: unknown } }) =>
    where.periodLabel ? [] : [
      { employeeId: "c1", periodLabel: "13º Salário - 1ª parcela (extrato)", amount: "900.00", status: "PAID" },
      { employeeId: "c1", periodLabel: ROTULO_13_PARCELA_1, amount: "300.00", status: "PENDING" }, // 13º sem registro da mesma pessoa
    ]);
  tx.payrollItem.findMany.mockResolvedValue([]);
  tx.payrollItem.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
  tx.payrollItem.updateMany.mockResolvedValue({ count: 0 });
  prismaFalso.$transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
});

describe("GET /payroll/decimo-terceiro — lista de CLT", () => {
  test("traz só os CLT, com o valor do extrato por parcela e quem aguarda o extrato", async () => {
    const r = await request(app).get("/payroll/decimo-terceiro?year=2026");
    expect(r.status).toBe(200);
    expect(r.body.clt).toEqual([
      { employeeId: "c1", nome: "Ana Exemplo", setor: null, parcela1: { valor: 900, pago: true }, parcela2: null },
      { employeeId: "c2", nome: "Bia Exemplo", setor: null, parcela1: null, parcela2: null },
    ]);
  });

  test("o 13º sem registro da mesma pessoa não vira valor de extrato", async () => {
    const r = await request(app).get("/payroll/decimo-terceiro?year=2026");
    // c1 tem um lançamento sem registro de 300 na 1ª parcela: a lista de CLT mostra só os 900 do extrato.
    expect(r.body.clt[0].parcela1).toEqual({ valor: 900, pago: true });
  });

  test("só entra quem recebe 13º e não foi excluído ou desligado (filtro da consulta)", async () => {
    await request(app).get("/payroll/decimo-terceiro?year=2026");
    const consultas = prismaFalso.employee.findMany.mock.calls.map((c) => c[0].where);
    expect(consultas.length).toBeGreaterThanOrEqual(2); // sem registro e CLT
    for (const where of consultas) expect(where).toMatchObject({ deletedAt: null, terminationDate: null, recebeDecimoTerceiro: true });
  });

  test("só lê lançamentos de 13º do ano, das pessoas CLT", async () => {
    await request(app).get("/payroll/decimo-terceiro?year=2026");
    const doClt = prismaFalso.payrollItem.findMany.mock.calls.map((c) => c[0].where).find((w) => !w.periodLabel);
    expect(doClt).toMatchObject({ type: "DECIMO_TERCEIRO", competenceYear: 2026, deletedAt: null, employeeId: { in: ["c1", "c2"] } });
  });

  test("sem permissão de ver Funcionários: 403 e nenhuma consulta", async () => {
    vi.mocked(podeVerDadosPessoais).mockResolvedValue(false);
    const r = await request(app).get("/payroll/decimo-terceiro?year=2026");
    expect(r.status).toBe(403);
    expect(prismaFalso.employee.findMany).not.toHaveBeenCalled();
  });

  test("ano inválido: 400", async () => {
    const r = await request(app).get("/payroll/decimo-terceiro?year=abc");
    expect(r.status).toBe(400);
  });
});

describe("POST /payroll/decimo-terceiro/generate — parcela", () => {
  const rotulosCriados = () => tx.payrollItem.createMany.mock.calls.map((c) => (c[0].data as Array<{ periodLabel: string; competenceMonth: number }>)[0]);

  test("parcela 1: cria só a 1ª, vencendo em novembro", async () => {
    const r = await request(app).post("/payroll/decimo-terceiro/generate").send({ year: 2026, parcela: 1 });
    expect(r.status).toBe(200);
    expect(r.body.criadas).toBe(1);
    expect(rotulosCriados().map((x) => [x.periodLabel, x.competenceMonth])).toEqual([[ROTULO_13_PARCELA_1, 11]]);
  });

  test("sem parcela no corpo, gera a 1ª (padrão da rota)", async () => {
    const r = await request(app).post("/payroll/decimo-terceiro/generate").send({ year: 2026 });
    expect(r.status).toBe(200);
    expect(rotulosCriados().map((x) => x.periodLabel)).toEqual([ROTULO_13_PARCELA_1]);
  });

  test("parcela fora de 1 e 2 é recusada com 400 e nada é gravado", async () => {
    for (const parcela of [0, 3, "x"]) {
      const r = await request(app).post("/payroll/decimo-terceiro/generate").send({ year: 2026, parcela });
      expect(r.status).toBe(400);
    }
    expect(tx.payrollItem.createMany).not.toHaveBeenCalled();
  });

  test("a parcela já lançada não é recriada quando se pede a outra", async () => {
    tx.payrollItem.findMany.mockResolvedValue([{ id: "i1", periodLabel: ROTULO_13_PARCELA_1, deletedAt: null, deletedById: null, paymentDate: null }]);
    const r = await request(app).post("/payroll/decimo-terceiro/generate").send({ year: 2026, parcela: 1 });
    expect(r.body.criadas).toBe(0);
    expect(tx.payrollItem.createMany).not.toHaveBeenCalled();
  });

  test("CLT nunca é gerado por aqui, mesmo pedindo a parcela", async () => {
    await request(app).post("/payroll/decimo-terceiro/generate").send({ year: 2026, parcela: 1 });
    const donos = tx.payrollItem.createMany.mock.calls.flatMap((c) => (c[0].data as Array<{ employeeId: string }>).map((d) => d.employeeId));
    expect(donos).toEqual(["s1"]);
  });

  test("sem sessão: 401; sem permissão: 403; ano inválido: 400 — e nada é gravado", async () => {
    vi.mocked(getSessionUser).mockResolvedValueOnce(null as never);
    expect((await request(app).post("/payroll/decimo-terceiro/generate").send({ year: 2026, parcela: 1 })).status).toBe(401);
    vi.mocked(podeVerDadosPessoais).mockResolvedValueOnce(false);
    expect((await request(app).post("/payroll/decimo-terceiro/generate").send({ year: 2026, parcela: 1 })).status).toBe(403);
    expect((await request(app).post("/payroll/decimo-terceiro/generate").send({ year: "abc", parcela: 1 })).status).toBe(400);
    expect(tx.payrollItem.createMany).not.toHaveBeenCalled();
  });
});
