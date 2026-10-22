import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Cadastro de cartão guiado: a conta e os cartões dela (físico e virtuais) são salvos
// juntos, numa transação, com o antes e o depois guardados no log (rastreabilidade).

const tx = {
  creditCard: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  creditCardFinal: { create: vi.fn(), update: vi.fn() },
};
vi.mock("../../../config/database.js", () => ({
  prisma: {
    creditCard: { findUnique: vi.fn() },
    creditCardFinal: { findMany: vi.fn() },
    auditLog: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}));
const auditLog = vi.fn();
vi.mock("../../security/security-utils.js", () => ({
  requireRole: vi.fn(async () => ({ id: "u1", role: "ADMIN" })), requireAdmin: vi.fn(), auditLog: (...a: unknown[]) => auditLog(...a), requestIp: vi.fn(),
}));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { cardsRouter } from "../cards.routes.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const app = express();
app.use(express.json());
app.use("/cards", cardsRouter);

const conta = { id: "c1", name: "Cartão Sicredi", bankName: "Sicredi", last4Digits: "1111", closingDay: 5, dueDay: 18, isActive: true, notes: null };
const fisico = { id: "f1", creditCardId: "c1", label: "Físico", last4Digits: "1111", kind: "PHYSICAL", isActive: true };
const virtual = { id: "f2", creditCardId: "c1", label: "Virtual", last4Digits: "2222", kind: "VIRTUAL", isActive: true };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("salvar o cartão com os cartões da conta", () => {
  test("cria a conta, o físico e o virtual de uma vez e registra no log", async () => {
    tx.creditCard.create.mockResolvedValue({ id: "c1" });
    tx.creditCard.findUnique.mockResolvedValue({ ...conta, finais: [fisico, virtual] });
    const r = await request(app).post("/cards").send({
      name: "Cartão Sicredi", bankName: "Sicredi", closingDay: 5, dueDay: 18,
      finais: [
        { label: "Físico", last4Digits: "1111", kind: "PHYSICAL" },
        { label: "Virtual", last4Digits: "2222", kind: "VIRTUAL" },
      ],
    });
    expect(r.status).toBe(201);
    expect(tx.creditCard.create.mock.calls[0][0].data.last4Digits).toBe("1111");
    expect(tx.creditCardFinal.create).toHaveBeenCalledTimes(2);
    expect(auditLog.mock.calls[0][0]).toMatchObject({ action: "CREATE_CREDIT_CARD", entity: "CreditCard", entityId: "c1", previousValue: null });
    expect(auditLog.mock.calls[0][0].newValue.finais).toHaveLength(2);
  });

  test("edição guarda o antes e o depois e atualiza o cartão existente", async () => {
    db.creditCard.findUnique.mockResolvedValue({ ...conta, finais: [fisico, virtual] });
    tx.creditCard.update.mockResolvedValue({ id: "c1" });
    tx.creditCard.findUnique.mockResolvedValue({ ...conta, finais: [fisico, { ...virtual, isActive: false }] });
    const r = await request(app).post("/cards").send({
      id: "c1", name: "Cartão Sicredi", bankName: "Sicredi", closingDay: 5, dueDay: 18,
      finais: [{ ...fisico }, { ...virtual, isActive: false }],
    });
    expect(r.status).toBe(200);
    expect(tx.creditCardFinal.update).toHaveBeenCalledTimes(2);
    const log = auditLog.mock.calls[0][0];
    expect(log.action).toBe("UPDATE_CREDIT_CARD");
    expect(log.previousValue.finais[1].isActive).toBe(true);
    expect(log.newValue.finais[1].isActive).toBe(false);
  });

  test("o final do físico vira o final da conta", async () => {
    tx.creditCard.create.mockResolvedValue({ id: "c1" });
    tx.creditCard.findUnique.mockResolvedValue({ ...conta, finais: [] });
    await request(app).post("/cards").send({
      name: "X", bankName: "B", closingDay: 5, dueDay: 18, last4Digits: "0000",
      finais: [{ label: "Físico", last4Digits: "4444", kind: "PHYSICAL" }],
    });
    expect(tx.creditCard.create.mock.calls[0][0].data.last4Digits).toBe("4444");
  });

  test("recusa dois cartões com o mesmo final, sem gravar nada", async () => {
    const r = await request(app).post("/cards").send({
      name: "X", bankName: "B", closingDay: 5, dueDay: 18,
      finais: [{ last4Digits: "1111", kind: "PHYSICAL" }, { last4Digits: "1111", kind: "VIRTUAL" }],
    });
    expect(r.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  test("recusa cartão de outra conta no meio da lista", async () => {
    db.creditCard.findUnique.mockResolvedValue({ ...conta, finais: [fisico] });
    const r = await request(app).post("/cards").send({
      id: "c1", name: "X", bankName: "B", closingDay: 5, dueDay: 18,
      finais: [{ id: "alheio", last4Digits: "9999", kind: "VIRTUAL" }],
    });
    expect(r.status).toBe(400);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  test("sem físico e sem final informado, o cadastro é recusado", async () => {
    const r = await request(app).post("/cards").send({ name: "X", bankName: "B", closingDay: 5, dueDay: 18, finais: [] });
    expect(r.status).toBe(400);
  });

  test("final repetido no banco (outra aba) devolve 409 em vez de erro genérico", async () => {
    tx.creditCard.create.mockResolvedValue({ id: "c1" });
    tx.creditCardFinal.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    const r = await request(app).post("/cards").send({
      name: "X", bankName: "B", closingDay: 5, dueDay: 18,
      finais: [{ last4Digits: "1111", kind: "PHYSICAL" }],
    });
    expect(r.status).toBe(409);
  });
});

describe("histórico do cartão", () => {
  test("lista as alterações da conta e dos cartões dela com autor e resumo", async () => {
    db.creditCardFinal.findMany.mockResolvedValue([{ id: "f2" }]);
    db.auditLog.findMany.mockResolvedValue([
      { id: "a2", userId: "u1", action: "UPDATE_CREDIT_CARD", entity: "CreditCard", entityId: "c1", createdAt: new Date("2026-10-22T15:00:00Z"),
        previousValue: { ...conta, finais: [] }, newValue: { ...conta, closingDay: 4, finais: [] } },
      { id: "a1", userId: "u1", action: "CREATE_CREDIT_CARD_FINAL", entity: "CreditCardFinal", entityId: "f2", createdAt: new Date("2026-10-22T14:00:00Z"),
        previousValue: null, newValue: virtual },
    ]);
    db.user.findMany.mockResolvedValue([{ id: "u1", name: "Eli" }]);
    const r = await request(app).get("/cards/c1/historico");
    expect(r.status).toBe(200);
    expect(r.body[0]).toMatchObject({ usuario: "Eli", resumo: ["Fechamento: dia 5 → dia 4"] });
    expect(r.body[1].resumo).toEqual(["Cartão virtual ·· 2222 cadastrado"]);
    const where = db.auditLog.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain("f2");
  });
});
