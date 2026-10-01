import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// RH → Rescisões com o banco de mentira: quem entra na lista, o que sai (sem CPF nem
// salário) e as pendências do detalhe.
vi.mock("../../../config/database.js", () => ({
  prisma: {
    employee: { findMany: vi.fn(), findFirst: vi.fn() },
    payrollItem: { findMany: vi.fn() },
    tipParticipant: { findMany: vi.fn(), findUnique: vi.fn() },
    tipPeriod: { findFirst: vi.fn() },
    rhExtract: { findFirst: vi.fn() },
  },
}));
vi.mock("../extras-comum.js", () => ({ hojeEmSaoPaulo: () => "2026-10-01" }));

import { prisma } from "../../../config/database.js";
import { rescisoesRouter } from "../rescisoes.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use("/payroll/rescisoes", rescisoesRouter);

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const pessoa = (over: Record<string, unknown>) => ({
  id: "e1", firstName: "Ana", lastName: "Silva", displayName: "Aninha", modality: "NAO_CLT",
  terminationDate: d("2026-09-12"), terminationReason: "Pedido de demissão", isActive: false,
  company: { tradeName: "Pateo" }, cpf: "12345678900", baseSalary: 2200, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.payrollItem.findMany.mockResolvedValue([]);
  db.tipParticipant.findMany.mockResolvedValue([]);
  db.tipParticipant.findUnique.mockResolvedValue(null);
  db.tipPeriod.findFirst.mockResolvedValue(null);
  db.rhExtract.findFirst.mockResolvedValue(null);
});

describe("GET /payroll/rescisoes", () => {
  test("lista quem saiu com a situação das parcelas e o termo, sem CPF nem salário", async () => {
    db.employee.findMany
      .mockResolvedValueOnce([
        pessoa({}),
        pessoa({ id: "e2", firstName: "Bruno", lastName: "Lima", displayName: null, modality: "CLT", terminationDate: d("2026-05-01") }),
        pessoa({ id: "e3", firstName: "Caio", lastName: "Reis", modality: "CLT", terminationDate: d("2026-09-25") }),
      ])
      .mockResolvedValueOnce([{ id: "a1", firstName: "Davi", lastName: "Melo", displayName: null, modality: "CLT", company: null }]);
    db.payrollItem.findMany.mockResolvedValueOnce([
      { employeeId: "e1", amount: 800, paymentDate: d("2026-09-20"), dueDate: d("2026-09-20") },
      { employeeId: "e1", amount: 200, paymentDate: null, dueDate: d("2026-10-20") },
    ]);
    db.tipParticipant.findMany.mockResolvedValueOnce([
      { employeeId: "e3", rescisaoRecibo: { fonte: "TRCT", arquivo: "trct.pdf", importadoEm: "2026-09-30T10:00:00Z", gorjeta: 321.5, liquido: 4100.25, pagamento: "2026-09-30" } },
      { employeeId: "e1", rescisaoRecibo: null },
    ]);

    const r = await request(app).get("/payroll/rescisoes");

    expect(r.status).toBe(200);
    expect(r.body.hoje).toBe("2026-10-01");
    // e2 saiu há mais de 90 dias e não tem rescisão em aberto.
    expect(r.body.pessoas.map((p: { employeeId: string }) => p.employeeId)).toEqual(["e3", "e1"]);
    const ana = r.body.pessoas[1];
    expect(ana).toMatchObject({
      nome: "Ana Silva", apelido: "Aninha", empresa: "Pateo", semRegistro: true, saida: "2026-09-12",
      rescisao: { parcelas: 2, pagas: 1, liquido: 1000, valorPago: 800, proximoVencimento: "2026-10-20" }, termo: null,
    });
    expect(r.body.pessoas[0].termo).toMatchObject({ arquivo: "trct.pdf", gorjeta: 321.5, liquido: 4100.25 });
    expect(r.body.ativos).toEqual([{ employeeId: "a1", nome: "Davi Melo", apelido: null, empresa: null, semRegistro: false }]);
    const texto = JSON.stringify(r.body);
    expect(texto).not.toContain("12345678900");
    expect(texto).not.toContain("2200");
  });
});

describe("GET /payroll/rescisoes/:employeeId", () => {
  test("404 para quem não existe", async () => {
    db.employee.findFirst.mockResolvedValue(null);
    const r = await request(app).get("/payroll/rescisoes/x");
    expect(r.status).toBe(404);
  });

  test("lançamentos da Folha depois da saída, período da gorjeta, termo e extrato do mês", async () => {
    db.employee.findFirst.mockResolvedValue(pessoa({ modality: "CLT" }));
    db.payrollItem.findMany
      .mockResolvedValueOnce([
        { id: "vt1", type: "VALE_TRANSPORTE", status: "PENDING", periodLabel: "VT 2ª quinzena", competenceYear: 2026, competenceMonth: 9, amount: 120, dueDate: d("2026-09-15"), paymentDate: null, details: null },
        { id: "vt0", type: "VALE_TRANSPORTE", status: "PENDING", periodLabel: "VT 1ª quinzena", competenceYear: 2026, competenceMonth: 9, amount: 120, dueDate: d("2026-08-31"), paymentDate: null, details: null },
      ])
      .mockResolvedValueOnce([]);
    db.tipPeriod.findFirst.mockResolvedValue({ id: "p9", competenceYear: 2026, competenceMonth: 9, label: "Gorjeta 26/08–25/09", status: "OPEN" });
    db.tipParticipant.findUnique.mockResolvedValue({ rescisaoRecibo: { arquivo: "trct.pdf", gorjeta: 99 } });
    db.rhExtract.findFirst.mockResolvedValue({ id: "x", pessoas: [] });

    const r = await request(app).get("/payroll/rescisoes/e1");

    expect(r.status).toBe(200);
    expect(r.body.pessoa).toMatchObject({ employeeId: "e1", semRegistro: false, saida: "2026-09-12", rescisao: null, termo: { arquivo: "trct.pdf", gorjeta: 99 } });
    expect(r.body.itensAposSaida.map((i: { id: string }) => i.id)).toEqual(["vt1"]);
    expect(r.body.periodoGorjeta).toEqual({ year: 2026, month: 9, label: "Gorjeta 26/08–25/09", fechado: false, participa: true });
    expect(r.body.extratoDoMes).toEqual({ competencia: "09/2026", importado: true, pessoaNoExtrato: false });
    // A busca do extrato é pela competência da saída, só a folha mensal.
    expect(db.rhExtract.findFirst.mock.calls[0][0].where).toEqual({ competenceYear: 2026, competenceMonth: 9, calculo: "MENSAL" });
  });

  test("sem data de saída: nada a buscar de período ou extrato", async () => {
    db.employee.findFirst.mockResolvedValue(pessoa({ terminationDate: null, isActive: true }));
    const r = await request(app).get("/payroll/rescisoes/e1");
    expect(r.body).toMatchObject({ itensAposSaida: [], periodoGorjeta: null, extratoDoMes: null });
    expect(db.tipPeriod.findFirst).not.toHaveBeenCalled();
    expect(db.rhExtract.findFirst).not.toHaveBeenCalled();
  });
});
