import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({
  prisma: {
    employee: { findFirst: vi.fn() },
    pontoDia: { findUnique: vi.fn(), update: vi.fn() },
    pontoFechamento: { findUnique: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForRange: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { abonarDia, validarAbono } from "../ponto.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const dia = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("validarAbono", () => {
  test("0 remove o abono, sem exigir motivo", () => {
    expect(validarAbono(0, null, undefined)).toEqual({ abonoMin: 0, abonoMotivo: null });
  });

  test("aceita minutos inteiros até 12h com motivo conhecido", () => {
    expect(validarAbono(181, "ATESTADO_HORAS", undefined)).toEqual({ abonoMin: 181, abonoMotivo: "ATESTADO_HORAS" });
    expect(validarAbono(720, "MEDICO_TRABALHO", undefined).abonoMin).toBe(720);
  });

  test.each([-1, 721, 1.5, "60", null, undefined, Number.NaN])("recusa minutos inválidos (%s)", (min) => {
    expect(() => validarAbono(min, "ATESTADO_HORAS", undefined)).toThrow(/horas abonadas/);
  });

  test("recusa abono sem motivo ou com motivo desconhecido", () => {
    expect(() => validarAbono(60, undefined, undefined)).toThrow(/motivo/);
    expect(() => validarAbono(60, "FERIAS", undefined)).toThrow(/motivo/);
  });

  test("Outro exige observação", () => {
    expect(() => validarAbono(60, "OUTRO", "")).toThrow(/observação/);
    expect(() => validarAbono(60, "OUTRO", "ab")).toThrow(/observação/);
    expect(validarAbono(60, "OUTRO", "Reunião com o contador").abonoMotivo).toBe("OUTRO");
  });
});

describe("abonarDia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.employee.findFirst.mockResolvedValue({ id: "e1", admissionDate: dia("2026-01-01"), terminationDate: null });
    db.pontoFechamento.findUnique.mockResolvedValue(null);
    db.pontoDia.findUnique.mockResolvedValue({ marcacoes: ["08:00", "12:19"], abonoMin: 0, abonoMotivo: null });
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
  });

  const pedido = { employeeId: "e1", date: "2026-10-13", abonoMin: 181, abonoMotivo: "ATESTADO_HORAS", userId: "u1" };

  test("grava só o abono; batidas e origem do dia não são tocadas", async () => {
    const r = await abonarDia(pedido);
    expect(r).toMatchObject({ abonoMin: 181, abonoMotivo: "ATESTADO_HORAS", anterior: { abonoMin: 0, abonoMotivo: null } });
    expect(db.pontoDia.update).toHaveBeenCalledTimes(1);
    expect(db.pontoDia.update.mock.calls[0][0].data).toEqual({ abonoMin: 181, abonoMotivo: "ATESTADO_HORAS" });
  });

  test("dia sem batidas não recebe abono", async () => {
    db.pontoDia.findUnique.mockResolvedValue(null);
    await expect(abonarDia(pedido)).rejects.toMatchObject({ status: 409 });
    db.pontoDia.findUnique.mockResolvedValue({ marcacoes: [], abonoMin: 0, abonoMotivo: null });
    await expect(abonarDia(pedido)).rejects.toMatchObject({ status: 409 });
    expect(db.pontoDia.update).not.toHaveBeenCalled();
  });

  test("mês fechado recusa", async () => {
    db.pontoFechamento.findUnique.mockResolvedValue({ status: "FECHADO" });
    await expect(abonarDia(pedido)).rejects.toMatchObject({ status: 409 });
    expect(db.pontoDia.update).not.toHaveBeenCalled();
  });

  test("remover o abono (0) limpa motivo e não mexe na observação", async () => {
    await abonarDia({ ...pedido, abonoMin: 0, abonoMotivo: null });
    expect(db.pontoDia.update.mock.calls[0][0].data).toEqual({ abonoMin: 0, abonoMotivo: null });
  });

  test("dia futuro e data inválida são recusados", async () => {
    await expect(abonarDia({ ...pedido, date: "2999-01-01" })).rejects.toMatchObject({ status: 400 });
    await expect(abonarDia({ ...pedido, date: "13/10/2026" })).rejects.toMatchObject({ status: 400 });
  });
});
