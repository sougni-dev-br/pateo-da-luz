import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Rotas de leitura dos recibos de quem não tem registro: pagamento do mês (lista) e 1ª
// quinzena/adiantamento. Só para quem vê Funcionários; nada é gravado. Dados fictícios.
const prismaFalso = vi.hoisted(() => ({
  employee: { findMany: vi.fn() },
  payrollItem: { findMany: vi.fn() },
}));
vi.mock("../../../config/database.js", () => ({ prisma: prismaFalso }));
vi.mock("../../security/security-utils.js", () => ({ getSessionUser: vi.fn() }));
vi.mock("../dados-pessoais.js", () => ({ podeVerDadosPessoais: vi.fn(async () => true) }));
vi.mock("../tip-commission.service.js", () => ({ computeTipCommission: vi.fn() }));

import { getSessionUser } from "../../security/security-utils.js";
import { podeVerDadosPessoais } from "../dados-pessoais.js";
import { computeTipCommission } from "../tip-commission.service.js";
import { folhaRecibosRouter, tipRecibosRouter } from "../recibo-pagamento.routes.js";

const app = express();
app.use("/payroll/tip", tipRecibosRouter);
app.use("/payroll", folhaRecibosRouter);

const participante = (over: Record<string, unknown>) => ({
  employeeId: "e1", employeeName: "Fulana Exemplo", semRegistro: true, tipoCalculo: "MES", pagoNaRescisao: false,
  foraDaGorjeta: false, pagamentoQuinzenal: false, salarioProporcional: 2600, diasSalario: 30, adiantamentoSalarial: 1040,
  primeiraQuinzena: 0, rateioAmount: 500, descontos: 30, creditos: 0, netCommission: 470, valorHoraExtra: 0,
  valorAdicionalNoturno: 0, valorDsr: 0, totalAPagar: 2030, horaExtra: null, adicionalNoturno: null,
  vales: [{ id: "v1", type: "REFEICAO", amount: 30, date: "2026-09-10T00:00:00.000Z", notes: null }],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli" } as never);
  vi.mocked(podeVerDadosPessoais).mockResolvedValue(true);
  vi.mocked(computeTipCommission).mockResolvedValue({
    status: "CLOSED",
    participants: [
      participante({}),
      participante({ employeeId: "e2", employeeName: "Beltrano Exemplo", totalAPagar: 0 }),
      participante({ employeeId: "e3", employeeName: "Ciclano Exemplo", semRegistro: false }),
      participante({ employeeId: "e4", employeeName: "Deltrano Exemplo", pagoNaRescisao: true }),
      participante({ employeeId: "e5", employeeName: "Epsilon Exemplo", rescisaoPendente: true }),
    ],
  } as never);
  prismaFalso.employee.findMany.mockResolvedValue([{
    id: "e1", firstName: "Fulana", lastName: "de Tal Exemplo", cpf: "11122233344", position: "ATENDENTE", admissionDate: new Date("2026-03-21T00:00:00Z"),
    birthDate: new Date("1990-10-12T00:00:00Z"), baseSalary: 2600, tipFunction: { name: "Salão" },
  }]);
  prismaFalso.payrollItem.findMany.mockResolvedValue([]);
});

describe("GET /payroll/tip/recibos-pagamento", () => {
  const url = "/payroll/tip/recibos-pagamento?year=2026&month=9";

  test("só sem registro com total > 0, fora da rescisão; total = A pagar da lista", async () => {
    const r = await request(app).get(url);
    expect(r.status).toBe(200);
    expect(computeTipCommission).toHaveBeenCalledWith(2026, 9, { incluirDadosPessoais: true });
    expect(r.body.competencia).toBe("09/2026");
    expect(r.body.recibos).toHaveLength(1);
    const recibo = r.body.recibos[0];
    expect(recibo).toMatchObject({ tipo: "PAGAMENTO_MES", nome: "Fulana de Tal Exemplo", cpf: "11122233344", total: 2030, totalLista: 2030, acerto: null });
    expect(recibo.linhas.reduce((a: number, l: { valor: number }) => a + l.valor, 0)).toBeCloseTo(2030, 2);
  });

// O findMany do payrollItem responde conforme o tipo pedido (SALARIO = acerto; ADIANTAMENTO = pagos antes).
const responder = (salarios: unknown[], adiantamentos: unknown[]) =>
  prismaFalso.payrollItem.findMany.mockImplementation(async (a: { where: { type: string } }) => (a.where.type === "SALARIO" ? salarios : adiantamentos));
const chamada = (tipo: string) => prismaFalso.payrollItem.findMany.mock.calls.map((c) => c[0]).find((a) => a.where.type === tipo);

  test("acerto lançado com outro valor: total do acerto e linha de ajuste", async () => {
    responder([{ employeeId: "e1", periodLabel: "Acerto (lista de pagamento)", amount: 2100, paidAmount: 2100, paymentDate: new Date("2026-10-07T00:00:00Z"), details: {} }], []);
    const r = await request(app).get(url);
    const recibo = r.body.recibos[0];
    expect(recibo.total).toBe(2100);
    expect(recibo.dataPagamento).toBe("2026-10-07");
    expect(recibo.linhas.at(-1)).toMatchObject({ codigo: 999, valor: 70 });
    expect(chamada("SALARIO").where).toMatchObject({ type: "SALARIO", competenceYear: 2026, competenceMonth: 9, deletedAt: null, status: { not: "CANCELED" } });
    expect(chamada("SALARIO").where.periodLabel).toBeUndefined();
  });

  test("salário da competência lançado com outra origem: o recibo usa o valor dele, com ajuste; complemento não conta", async () => {
    responder([
      { employeeId: "e1", periodLabel: "Salário", amount: 2000, paidAmount: null, paymentDate: null, details: { origem: "EXTRATO" } },
      { employeeId: "e1", periodLabel: "Complemento", amount: 300, paidAmount: null, paymentDate: null, details: { complemento: { motivo: "x" } } },
    ], []);
    const recibo = (await request(app).get(url)).body.recibos[0];
    expect(recibo.total).toBe(2000);
    expect(recibo.linhas.at(-1)).toMatchObject({ codigo: 999, descricao: "AJUSTE CONTAS A PAGAR (LISTA 2.030,00)", valor: -30 });
  });

  test("o próprio acerto vale antes de outro salário da competência", async () => {
    responder([
      { employeeId: "e1", periodLabel: "Salário", amount: 2000, paidAmount: null, paymentDate: null, details: {} },
      { employeeId: "e1", periodLabel: "Acerto (lista de pagamento)", amount: 2030, paidAmount: null, paymentDate: null, details: {} },
    ], []);
    const recibo = (await request(app).get(url)).body.recibos[0];
    expect(recibo.total).toBe(2030);
    expect(recibo.linhas.some((l: { codigo: number }) => l.codigo === 999)).toBe(false);
  });

  test("adiantamento em dois títulos (500 + 540): soma, só títulos do sem registro, sem complemento", async () => {
    responder([], [
      { employeeId: "e1", amount: 500, paidAmount: 500, paymentDate: new Date("2026-09-20T00:00:00Z"), details: { semRegistro: true } },
      { employeeId: "e1", amount: 540, paidAmount: 540, paymentDate: new Date("2026-09-22T00:00:00Z"), details: { semRegistro: true } },
    ]);
    const recibo = (await request(app).get(url)).body.recibos[0];
    const desc = recibo.linhas.filter((l: { codigo: number }) => l.codigo >= 981 && l.codigo <= 984);
    expect(desc).toEqual([{ codigo: 981, descricao: "DESC. ADIANTAMENTO", referencia: "22/09/2026", valor: -1040 }]);
    const filtro = chamada("ADIANTAMENTO").where;
    expect(filtro).toMatchObject({ details: { path: ["semRegistro"], equals: true }, deletedAt: null, status: { not: "CANCELED" } });
    expect(filtro.paymentDate).toBeUndefined();
  });

  test("apuração aberta: 409 e nada é impresso", async () => {
    vi.mocked(computeTipCommission).mockResolvedValue({ status: "OPEN", participants: [participante({})] } as never);
    const r = await request(app).get(url);
    expect(r.status).toBe(409);
    expect(r.body.message).toBe("Feche a apuração antes de imprimir os recibos do mês.");
  });

  test("sem apuração no mês: 409", async () => {
    vi.mocked(computeTipCommission).mockResolvedValue({ status: null, participants: [] } as never);
    expect((await request(app).get(url)).status).toBe(409);
  });

  test("uma pessoa só (employeeId); quem não tem a receber: 404", async () => {
    const r = await request(app).get(`${url}&employeeId=e1`);
    expect(r.body.recibos.map((x: { employeeId: string }) => x.employeeId)).toEqual(["e1"]);
    expect((await request(app).get(`${url}&employeeId=e2`)).status).toBe(404);
    // Saiu e ainda não tem o valor da rescisão: sem recibo.
    expect((await request(app).get(`${url}&employeeId=e5`)).status).toBe(404);
  });

  test("sem ver Funcionários: 403 e não calcula nada", async () => {
    vi.mocked(podeVerDadosPessoais).mockResolvedValue(false);
    const r = await request(app).get(url);
    expect(r.status).toBe(403);
    expect(r.body.message).toMatch(/Funcionários/);
    expect(computeTipCommission).not.toHaveBeenCalled();
  });

  test("sem sessão: 401; competência inválida: 400", async () => {
    expect((await request(app).get("/payroll/tip/recibos-pagamento?year=2026&month=13")).status).toBe(400);
    expect((await request(app).get("/payroll/tip/recibos-pagamento")).status).toBe(400);
    vi.mocked(getSessionUser).mockResolvedValue(null as never);
    expect((await request(app).get(url)).status).toBe(401);
  });
});

describe("GET /payroll/recibos-adiantamento", () => {
  const url = "/payroll/recibos-adiantamento?year=2026&month=9";
  const titulo = (over: Record<string, unknown>) => ({
    id: "t1", employeeId: "e1", competenceYear: 2026, competenceMonth: 9, amount: 1040, paidAmount: null, paymentDate: null,
    details: { base: 2600, percent: 40, semRegistro: true }, employee: { firstName: "Fulana", lastName: "de Tal Exemplo" }, ...over,
  });

  test("quinzena e adiantamento do sem registro, com a base", async () => {
    prismaFalso.payrollItem.findMany.mockResolvedValue([
      titulo({}),
      titulo({ id: "t2", amount: 1300, details: { base: 2600, semRegistro: true, primeiraQuinzena: true } }),
    ]);
    const r = await request(app).get(url);
    expect(r.status).toBe(200);
    const filtro = prismaFalso.payrollItem.findMany.mock.calls[0][0].where;
    expect(filtro).toMatchObject({ type: "ADIANTAMENTO", competenceYear: 2026, competenceMonth: 9, deletedAt: null, details: { path: ["semRegistro"], equals: true } });
    expect(r.body.recibos.map((x: { tipo: string }) => x.tipo)).toEqual(["ADIANTAMENTO", "QUINZENA"]);
    expect(r.body.recibos[0]).toMatchObject({ referencia: "adiantamento de 09/2026", total: 1040, cpf: "11122233344" });
    expect(r.body.recibos[1].linhas[0]).toMatchObject({ descricao: "1ª QUINZENA", referencia: "50%" });
    expect(r.body.recibos[1]).toMatchObject({ valorMensal: 2600, funcao: "ATENDENTE", admissao: "2026-03-21", aniversario: "12/10" });
  });

  test("um lançamento (id); inexistente: 404", async () => {
    prismaFalso.payrollItem.findMany.mockResolvedValue([titulo({})]);
    await request(app).get(`${url}&id=t1`);
    expect(prismaFalso.payrollItem.findMany.mock.calls[0][0].where.id).toBe("t1");
    prismaFalso.payrollItem.findMany.mockResolvedValue([]);
    expect((await request(app).get(`${url}&id=nada`)).status).toBe(404);
  });

  test("sem ver Funcionários: 403 e não lê o Contas a Pagar", async () => {
    vi.mocked(podeVerDadosPessoais).mockResolvedValue(false);
    expect((await request(app).get(url)).status).toBe(403);
    expect(prismaFalso.payrollItem.findMany).not.toHaveBeenCalled();
  });
});
