import "express-async-errors"; // como no app real: rejeição em handler async vira 500
import express from "express";
import request from "supertest";
import { beforeEach, expect, test, vi } from "vitest";

// Dados fictícios. As rotas só traduzem a requisição para o serviço e os erros de negócio para HTTP.

vi.mock("../../security/security-utils.js", () => ({
  requireRole: vi.fn(async () => ({ id: "u1", name: "Admin", role: "ADMIN" }))
}));
vi.mock("../parcelamento.service.js", async () => {
  class ParcelamentoError extends Error {
    constructor(message: string, public readonly status = 400) { super(message); }
  }
  return {
    ParcelamentoError,
    listarParcelamentos: vi.fn(async () => [{ id: "pl1" }]),
    detalharParcelamento: vi.fn(async (id: string) => {
      if (id === "nada") throw new ParcelamentoError("Parcelamento não encontrado.", 404);
      return { id };
    }),
    criarParcelamento: vi.fn(async () => ({ planId: "pl1", compras: [] })),
    renegociarParcelamento: vi.fn(async () => ({ planId: "pl2", saldoAnterior: 100, parcelasCanceladas: 1, compras: [] })),
    cancelarParcelamento: vi.fn(async () => ({ parcelasCanceladas: 2, parcelasPagasMantidas: 1 }))
  };
});

import { requireRole } from "../../security/security-utils.js";
import * as servico from "../parcelamento.service.js";
import { parcelamentoRouter } from "../parcelamento.routes.js";

const app = express();
app.use(express.json());
app.use("/installment-plans", parcelamentoRouter);

beforeEach(() => vi.clearAllMocks());

test("lista e detalha", async () => {
  expect((await request(app).get("/installment-plans")).body).toEqual([{ id: "pl1" }]);
  expect((await request(app).get("/installment-plans/pl1")).body).toEqual({ id: "pl1" });
});

test("devolve 404 do serviço", async () => {
  const r = await request(app).get("/installment-plans/nada");
  expect(r.status).toBe(404);
  expect(r.body.message).toMatch(/não encontrado/i);
});

test("criar converte o corpo e devolve 201 com o detalhe", async () => {
  const r = await request(app).post("/installment-plans").send({
    supplierId: " s1 ", companyId: "c1", productId: "p1", description: " Acordo ", total: "300", quantidade: "3",
    primeiroVencimento: "2026-11-10", parcelas: [{ valor: "100", vencimento: "2026-11-10" }], paymentMethodId: "", notes: "", foraDoDre: true
  });
  expect(r.status).toBe(201);
  expect(servico.criarParcelamento).toHaveBeenCalledWith({
    supplierId: "s1", companyId: "c1", productId: "p1", description: "Acordo", total: 300, quantidade: 3,
    primeiroVencimento: "2026-11-10", informadas: [{ valor: 100, vencimento: "2026-11-10" }], paymentMethodId: null, notes: null, excludeFromDre: true
  }, "u1");
});

test("erro de negócio do serviço vira a resposta HTTP", async () => {
  vi.mocked(servico.criarParcelamento).mockRejectedValueOnce(new (servico.ParcelamentoError as never as new (m: string, s: number) => Error)("Mês travado", 400));
  const r = await request(app).post("/installment-plans").send({});
  expect(r.status).toBe(400);
  expect(r.body.message).toBe("Mês travado");
});

test("erro inesperado não é engolido (500)", async () => {
  vi.mocked(servico.criarParcelamento).mockRejectedValueOnce(new Error("banco caiu"));
  const r = await request(app).post("/installment-plans").send({});
  expect(r.status).toBe(500);
});

test("renegociar manda total opcional e motivo", async () => {
  const r = await request(app).post("/installment-plans/pl1/renegociar").send({ quantidade: 2, primeiroVencimento: "2027-01-10", motivo: "novo acordo" });
  expect(r.status).toBe(201);
  expect(servico.renegociarParcelamento).toHaveBeenCalledWith("pl1", expect.objectContaining({ quantidade: 2, total: undefined, motivo: "novo acordo" }), "u1");
  await request(app).post("/installment-plans/pl1/renegociar").send({ quantidade: 2, total: 150.5, motivo: "m" });
  expect(vi.mocked(servico.renegociarParcelamento).mock.calls[1][1].total).toBe(150.5);
});

test("cancelar devolve o resumo", async () => {
  const r = await request(app).post("/installment-plans/pl1/cancelar").send({ motivo: "engano" });
  expect(r.status).toBe(200);
  expect(r.body.parcelasCanceladas).toBe(2);
});

test("sem permissão, nada é executado", async () => {
  vi.mocked(requireRole).mockImplementationOnce((async (_req: unknown, res: express.Response) => {
    res.status(403).json({ message: "Sem permissão." });
    return null;
  }) as never);
  const r = await request(app).post("/installment-plans").send({});
  expect(r.status).toBe(403);
  expect(servico.criarParcelamento).not.toHaveBeenCalled();
});
