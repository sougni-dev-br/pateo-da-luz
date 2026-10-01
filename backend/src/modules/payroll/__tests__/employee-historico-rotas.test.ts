import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Cadastro de funcionários com o banco de mentira: salvar grava o histórico do cadastro
// (uma linha por campo rastreado que mudou, com "vale a partir de") e a rota do histórico
// esconde salário de quem não pode ver Funcionários.
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
  id: "e1", firstName: "Ana", lastName: "Silva", cpf: CPF, baseSalary: "2200", modality: "NAO_CLT", position: "Garçom",
  companyId: null, salarioCombinado: null, recebeAdiantamento: false, admissionDate: new Date("2025-03-01T00:00:00Z"), deletedAt: null,
};
// O corpo que a tela manda, igual ao cadastro (nada mudou).
const corpo = (over: Record<string, unknown> = {}) => ({
  firstName: "Ana", lastName: "Silva", cpf: CPF, baseSalary: "2200", modality: "NAO_CLT", position: "Garçom",
  recebeAdiantamento: false, admissionDate: "2025-03-01", ...over,
});
const linhasGravadas = () => db.employeeHistorico.createMany.mock.calls.flatMap((c: [{ data: unknown[] }]) => c[0].data);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Eli", email: "e@x", role: "VISUALIZACAO" } as never);
  vi.mocked(podeVerDadosPessoais).mockResolvedValue(true);
  // 1ª busca: o funcionário; 2ª: conflito de CPF (nenhum).
  db.employee.findFirst.mockImplementation(async (q: { where: { id?: unknown } }) =>
    (typeof q.where.id === "string" ? existente : null));
  db.employee.update.mockImplementation(async ({ data }: { data: object }) => ({ ...existente, ...data }));
  db.employeeHistorico.createMany.mockResolvedValue({ count: 1 });
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
});

describe("salvar o cadastro grava o histórico", () => {
  test("uma linha por campo alterado, vigente desde hoje por padrão, com quem registrou", async () => {
    const r = await request(app).put("/employees/e1").send(corpo({ baseSalary: "2500", modality: "CLT", motivoAlteracao: "Efetivada" }));
    expect(r.status).toBe(200);
    const linhas = linhasGravadas();
    expect(linhas).toHaveLength(2);
    expect(linhas).toEqual(expect.arrayContaining([
      expect.objectContaining({ employeeId: "e1", campo: "baseSalary", valorAnterior: "2200.00", valorNovo: "2500.00" }),
      expect.objectContaining({ campo: "modality", valorAnterior: "NAO_CLT", valorNovo: "CLT" }),
    ]));
    for (const l of linhas) {
      expect(l).toMatchObject({ vigenteDesde: new Date("2026-09-30T00:00:00Z"), motivo: "Efetivada", origem: "CADASTRO", criadoPorId: "u1", criadoPorNome: "Eli" });
      expect(JSON.stringify(l)).not.toContain(CPF);
    }
    // Na mesma transação da alteração do cadastro.
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  test("nada mudou nos campos rastreados: nenhuma linha", async () => {
    const r = await request(app).put("/employees/e1").send(corpo({ phone: "11999990000" }));
    expect(r.status).toBe(200);
    expect(db.employeeHistorico.createMany).not.toHaveBeenCalled();
  });

  test("vale a partir de informado (aumento retroativo, com motivo)", async () => {
    const r = await request(app).put("/employees/e1").send(corpo({ baseSalary: "2500", vigenteDesde: "2026-08-01", motivoAlteracao: "Dissídio de agosto" }));
    expect(r.status).toBe(200);
    expect(linhasGravadas()[0]).toMatchObject({ campo: "baseSalary", vigenteDesde: new Date("2026-08-01T00:00:00Z"), motivo: "Dissídio de agosto" });
  });

  test.each([
    ["salário base", { baseSalary: "2500" }],
    ["vínculo", { modality: "CLT" }],
    ["salário combinado", { salarioCombinado: 3000, salarioCombinadoMotivo: "Combinado na entrevista" }],
  ])("%s valendo desde mês passado sem motivo: 400 e nada gravado", async (_nome, mudanca) => {
    const r = await request(app).put("/employees/e1").send(corpo({ ...mudanca, vigenteDesde: "2026-08-15" }));
    expect(r.status).toBe(400);
    expect(r.body.message).toBe("Alteração valendo desde 08/2026 muda cálculos de meses passados: informe o motivo.");
    expect(db.employee.update).not.toHaveBeenCalled();
    expect(db.employeeHistorico.createMany).not.toHaveBeenCalled();
  });

  test("motivo com menos de 5 letras (números e espaços não contam) não serve", async () => {
    const r = await request(app).put("/employees/e1").send(corpo({ baseSalary: "2500", vigenteDesde: "2026-08-01", motivoAlteracao: "ok 2026 !!" }));
    expect(r.status).toBe(400);
  });

  test("retroativo dentro do mês atual, cargo retroativo ou data futura: motivo não é exigido", async () => {
    expect((await request(app).put("/employees/e1").send(corpo({ baseSalary: "2500", vigenteDesde: "2026-09-01" }))).status).toBe(200);
    expect((await request(app).put("/employees/e1").send(corpo({ position: "Líder", vigenteDesde: "2026-07-01" }))).status).toBe(200);
    expect((await request(app).put("/employees/e1").send(corpo({ baseSalary: "2500", vigenteDesde: "2026-10-01" }))).status).toBe(200);
  });

  test("data antes da admissão é recusada e nada é gravado", async () => {
    const r = await request(app).put("/employees/e1").send(corpo({ baseSalary: "2500", vigenteDesde: "2025-01-01" }));
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/antes da admissão/);
    expect(db.employee.update).not.toHaveBeenCalled();
    expect(db.employeeHistorico.createMany).not.toHaveBeenCalled();
  });

  test("data inválida é recusada; sem mudança nos campos, a data nem é conferida", async () => {
    expect((await request(app).put("/employees/e1").send(corpo({ position: "Líder", vigenteDesde: "31/12/2026" }))).status).toBe(400);
    expect((await request(app).put("/employees/e1").send(corpo({ vigenteDesde: "lixo" }))).status).toBe(200);
  });
});

describe("GET /employees/:id/historico", () => {
  const linhas = [
    { id: "h2", campo: "companyId", valorAnterior: null, valorNovo: "c1", vigenteDesde: new Date("2026-09-01T00:00:00Z"), motivo: null, origem: "EQUIPE_GORJETA", criadoPorNome: "Eli", createdAt: new Date("2026-09-01T12:00:00Z") },
    { id: "h1", campo: "baseSalary", valorAnterior: "2000.00", valorNovo: "2200.00", vigenteDesde: new Date("2026-08-01T00:00:00Z"), motivo: "Aumento", origem: "CADASTRO", criadoPorNome: "Eli", createdAt: new Date("2026-08-01T12:00:00Z") },
  ];
  beforeEach(() => {
    db.employee.findFirst.mockResolvedValue({ id: "e1" });
    db.employeeHistorico.findMany.mockResolvedValue(linhas);
    db.company.findMany.mockResolvedValue([{ id: "c1", tradeName: "Pateo Frei" }]);
  });

  test("com permissão: valores, empresa pelo nome, mais recente primeiro", async () => {
    const r = await request(app).get("/employees/e1/historico");
    expect(r.status).toBe(200);
    expect(db.employeeHistorico.findMany.mock.calls[0][0].orderBy[0]).toEqual({ vigenteDesde: "desc" });
    expect(r.body[0]).toMatchObject({ campo: "companyId", rotulo: "Empresa", valorNovo: "Pateo Frei", vigenteDesde: "2026-09-01" });
    expect(r.body[1]).toMatchObject({ campo: "baseSalary", valorAnterior: "2000.00", valorNovo: "2200.00", oculto: false, motivo: "Aumento" });
  });

  test("sem ver Funcionários: a linha de salário fica, sem os valores", async () => {
    vi.mocked(podeVerDadosPessoais).mockResolvedValue(false);
    const r = await request(app).get("/employees/e1/historico");
    expect(r.body[1]).toMatchObject({ campo: "baseSalary", valorAnterior: null, valorNovo: null, oculto: true, motivo: null });
    expect(JSON.stringify(r.body)).not.toContain("2200");
    expect(JSON.stringify(r.body)).not.toContain("Aumento");
    expect(r.body[0]).toMatchObject({ valorNovo: "Pateo Frei", oculto: false });
  });

  test("funcionário inexistente: 404", async () => {
    db.employee.findFirst.mockResolvedValue(null);
    expect((await request(app).get("/employees/x/historico")).status).toBe(404);
  });
});

describe("PATCH /employees/:id/terminate — data padrão", () => {
  test("sem data, o desligamento é hoje em São Paulo (não o dia em UTC)", async () => {
    const r = await request(app).patch("/employees/e1/terminate").send({});
    expect(r.status).toBe(200);
    expect(db.employee.update.mock.calls[0][0].data.terminationDate).toEqual(new Date("2026-09-30T00:00:00Z"));
  });
});

describe("forma de pagamento do sem registro (quinzena × adiantamento)", () => {
  test("passar a receber por quinzena grava o cadastro e uma linha no histórico", async () => {
    db.employee.findFirst.mockImplementation(async (q: { where: { id?: unknown } }) =>
      (typeof q.where.id === "string" ? { ...existente, pagamentoQuinzenal: false } : null));
    const r = await request(app).put("/employees/e1").send(corpo({ pagamentoQuinzenal: true }));
    expect(r.status).toBe(200);
    expect(db.employee.update.mock.calls[0][0].data).toMatchObject({ pagamentoQuinzenal: true, recebeAdiantamento: false });
    expect(linhasGravadas()).toEqual([
      expect.objectContaining({ campo: "pagamentoQuinzenal", valorAnterior: "false", valorNovo: "true", origem: "CADASTRO" }),
    ]);
  });

  test("quinzena e adiantamento juntos: 400 com mensagem clara, nada gravado", async () => {
    const r = await request(app).put("/employees/e1").send(corpo({ pagamentoQuinzenal: true, recebeAdiantamento: true }));
    expect(r.status).toBe(400);
    expect(r.body.message).toContain("Escolha uma forma de pagamento só");
    expect(db.employee.update).not.toHaveBeenCalled();
    expect(db.employeeHistorico.createMany).not.toHaveBeenCalled();
  });
});

describe("entrada na gorjeta (Entra na gorjeta em)", () => {
  test("preencher grava o cadastro e uma linha no histórico", async () => {
    const r = await request(app).put("/employees/e1").send(corpo({ inicioGorjeta: "2026-10-05" }));
    expect(r.status).toBe(200);
    expect(db.employee.update.mock.calls[0][0].data.inicioGorjeta).toEqual(new Date("2026-10-05T00:00:00Z"));
    expect(linhasGravadas()).toEqual([expect.objectContaining({ campo: "inicioGorjeta", valorAnterior: null, valorNovo: "2026-10-05" })]);
  });

  test("retroativa (mês passado) sem motivo: 400 e nada gravado; com motivo, grava", async () => {
    let r = await request(app).put("/employees/e1").send(corpo({ inicioGorjeta: "2026-08-10" }));
    expect(r.status).toBe(400);
    expect(r.body.message).toBe("Entrada na gorjeta em 08/2026 muda a gorjeta de meses passados: informe o motivo.");
    expect(db.employee.update).not.toHaveBeenCalled();
    r = await request(app).put("/employees/e1").send(corpo({ inicioGorjeta: "2026-08-10", motivoAlteracao: "Ficou depois do teste" }));
    expect(r.status).toBe(200);
    expect(linhasGravadas()[0]).toMatchObject({ campo: "inicioGorjeta", valorNovo: "2026-08-10", motivo: "Ficou depois do teste" });
  });

  test("antes da admissão é recusada", async () => {
    const r = await request(app).put("/employees/e1").send(corpo({ inicioGorjeta: "2025-02-01", motivoAlteracao: "qualquer motivo" }));
    expect(r.status).toBe(400);
    expect(r.body.message).toBe("\"Entra na gorjeta em\" não pode ser antes da admissão (01/03/2025).");
  });

  test("corpo sem o campo (tela antiga, importação) não mexe na data", async () => {
    const r = await request(app).put("/employees/e1").send(corpo());
    expect(r.status).toBe(200);
    expect(db.employee.update.mock.calls[0][0].data).not.toHaveProperty("inicioGorjeta");
  });
});
