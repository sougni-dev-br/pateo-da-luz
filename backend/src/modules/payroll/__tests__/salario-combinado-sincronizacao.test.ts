import { beforeEach, describe, expect, test, vi } from "vitest";

// Sincronizar os salários de quem tem salário combinado: recalcula o SALARIO do extrato
// ainda não pago com o valor integral; nunca mexe em pago; audita a mudança.
vi.mock("../../../config/database.js", () => ({
  prisma: {
    payrollItem: { findMany: vi.fn(), update: vi.fn() },
    employee: { findMany: vi.fn() },
    employeeHistorico: { findMany: vi.fn() },
  },
}));
vi.mock("../cadastro-historico.service.js", () => ({ carregarHistorico: vi.fn(async () => new Map()) }));
vi.mock("../tip-commission.service.js", () => ({ computeTipCommission: vi.fn() }));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn(async () => undefined) }));
vi.mock("../../security/security-utils.js", () => ({ auditLog: vi.fn(async () => undefined) }));

import { prisma } from "../../../config/database.js";
import { computeTipCommission } from "../tip-commission.service.js";
import { assertPeriodWritableForDate } from "../../cmv-real/cmv-real.service.js";
import { auditLog } from "../../security/security-utils.js";
import { gorjetasDaCompetencia, sincronizarSalariosCombinados } from "../salario-combinado.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const usuario = { id: "u1", name: "Eli" };
const empregado = (id: string, combinado: number | null) => ({
  id, firstName: "Elioenai", lastName: "Silva", displayName: null, salarioCombinado: combinado, salarioCombinadoMotivo: "acordo", terminationDate: null,
});
const item = (over: Record<string, unknown> = {}) => ({
  id: "p1", employeeId: "e1", amount: 3030, paymentDate: null, status: "PENDING",
  details: { calculo: "MENSAL", liquido: 3030, gorjeta: 500, adiantamento: 1468.8, empresa: "X" },
  employee: { firstName: "Elioenai", lastName: "Silva" },
  ...over,
});
const apuracao = (participants: Array<{ employeeId: string; netCommission: number; tipoCalculo?: string }>) =>
  ({ periodId: "tp1", participants: participants.map((p) => ({ tipoCalculo: "NORMAL", ...p })) }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  db.employee.findMany.mockResolvedValue([empregado("e1", 5200)]);
  db.employeeHistorico.findMany.mockResolvedValue([]);
  db.payrollItem.findMany.mockResolvedValue([item()]);
  db.payrollItem.update.mockResolvedValue({});
  vi.mocked(computeTipCommission).mockResolvedValue(apuracao([{ employeeId: "e1", netCommission: 2223.54 }]));
});

describe("gorjetasDaCompetencia", () => {
  test("sem período de gorjeta: null", async () => {
    vi.mocked(computeTipCommission).mockResolvedValue({ periodId: null, participants: [] } as never);
    expect(await gorjetasDaCompetencia(2026, 9)).toBeNull();
  });

  test("gorjeta líquida dos pontos de cada participante", async () => {
    vi.mocked(computeTipCommission).mockResolvedValue(apuracao([
      { employeeId: "e1", netCommission: 2223.54 }, { employeeId: "e2", netCommission: 10, tipoCalculo: "FORA_DO_PERIODO" },
    ]));
    const g = await gorjetasDaCompetencia(2026, 9);
    expect(g?.get("e1")).toEqual({ noPeriodo: true, gorjetaLiquida: 2223.54, pagoNaRescisao: false });
    expect(g?.get("e2")).toEqual({ noPeriodo: false, gorjetaLiquida: 10, pagoNaRescisao: false });
  });
});

describe("sincronizarSalariosCombinados", () => {
  test("busca só o SALARIO do extrato da competência, ativo e não cancelado", async () => {
    await sincronizarSalariosCombinados(2026, 9, usuario);
    expect(db.payrollItem.findMany.mock.calls[0][0].where).toMatchObject({
      type: "SALARIO", competenceYear: 2026, competenceMonth: 9, periodLabel: "Extrato 09/2026", source: "EXTRATO_RH",
      deletedAt: null, status: { not: "CANCELED" },
    });
  });

  test("não pago: passa ao valor integral, guarda a composição e audita antes/depois", async () => {
    const r = await sincronizarSalariosCombinados(2026, 9, usuario);
    const upd = db.payrollItem.update.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "p1" });
    expect(upd.data.amount).toBe(5954.74);
    expect(upd.data.details).toMatchObject({
      calculo: "MENSAL", liquido: 3030, liquidoExtrato: 3030, combinado: 5200, adiantamento: 1468.8,
      gorjetaIntegral: 2223.54, complemento: 2924.74, origemValor: "SALARIO_COMBINADO",
    });
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      userId: "u1", action: "SALARIO_COMBINADO_SINCRONIZADO", entity: "PayrollItem", entityId: "p1",
      previousValue: expect.objectContaining({ amount: 3030 }), newValue: expect.objectContaining({ amount: 5954.74 }),
    }));
    expect(r.alterados).toEqual([{ payrollItemId: "p1", employeeId: "e1", nome: "Elioenai Silva", antes: 3030, depois: 5954.74, pendenteGorjeta: false }]);
    expect(r.pagosIgnorados).toBe(0);
  });

  test("pago: nunca mexe, e conta como ignorado", async () => {
    db.payrollItem.findMany.mockResolvedValue([item({ paymentDate: new Date("2026-10-05T12:00:00Z"), status: "PAID" })]);
    const r = await sincronizarSalariosCombinados(2026, 9, usuario);
    expect(db.payrollItem.update).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
    expect(r.pagosIgnorados).toBe(1);
  });

  test("valor já certo: não grava nem audita", async () => {
    db.payrollItem.findMany.mockResolvedValue([item({
      amount: 5954.74,
      details: { liquido: 3030, adiantamento: 1468.8, liquidoExtrato: 3030, combinado: 5200, gorjetaIntegral: 2223.54, complemento: 2924.74, origemValor: "SALARIO_COMBINADO" },
    })]);
    const r = await sincronizarSalariosCombinados(2026, 9, usuario);
    expect(db.payrollItem.update).not.toHaveBeenCalled();
    expect(r.semMudanca).toBe(1);
  });

  test("sem combinado (nunca teve): não mexe", async () => {
    db.employee.findMany.mockResolvedValue([]);
    const r = await sincronizarSalariosCombinados(2026, 9, usuario);
    expect(db.payrollItem.update).not.toHaveBeenCalled();
    expect(r.alterados).toEqual([]);
  });

  test("combinado tirado depois: volta ao líquido do extrato e tira a composição", async () => {
    db.employee.findMany.mockResolvedValue([]);
    db.payrollItem.findMany.mockResolvedValue([item({
      amount: 5954.74,
      details: { liquido: 3030, adiantamento: 1468.8, liquidoExtrato: 3030, combinado: 5200, gorjetaIntegral: 2223.54, complemento: 2924.74, origemValor: "SALARIO_COMBINADO", composicao: "x" },
    })]);
    await sincronizarSalariosCombinados(2026, 9, usuario);
    const upd = db.payrollItem.update.mock.calls[0][0];
    expect(upd.data.amount).toBe(3030);
    expect(upd.data.details).not.toHaveProperty("origemValor");
    expect(upd.data.details).not.toHaveProperty("combinado");
  });

  test("sem apuração da gorjeta: fica no líquido do extrato, pendente, com aviso", async () => {
    vi.mocked(computeTipCommission).mockResolvedValue({ periodId: null, participants: [] } as never);
    const r = await sincronizarSalariosCombinados(2026, 9, usuario);
    const upd = db.payrollItem.update.mock.calls[0][0];
    expect(upd.data.amount).toBe(3030);
    expect(upd.data.details.pendenteGorjeta).toBe(true);
    expect(r.avisos).toContain("Salário combinado de Elioenai Silva: gorjeta do mês ainda não apurada; mantido o líquido do extrato.");
  });

  test("lançamento antigo sem o adiantamento guardado: não calcula e pede para reimportar", async () => {
    db.payrollItem.findMany.mockResolvedValue([item({ details: { liquido: 3030 } })]);
    const r = await sincronizarSalariosCombinados(2026, 9, usuario);
    expect(db.payrollItem.update).not.toHaveBeenCalled();
    expect(r.avisos[0]).toContain("Elioenai Silva");
    expect(r.avisos[0]).toContain("reimporte o extrato");
  });

  test("mês travado: a trava do período impede (lança o erro)", async () => {
    vi.mocked(assertPeriodWritableForDate).mockRejectedValueOnce(new Error("travado"));
    await expect(sincronizarSalariosCombinados(2026, 9, usuario)).rejects.toThrow("travado");
    expect(db.payrollItem.update).not.toHaveBeenCalled();
  });

  test("nada a sincronizar: não consulta a trava nem calcula a gorjeta", async () => {
    db.payrollItem.findMany.mockResolvedValue([]);
    await sincronizarSalariosCombinados(2026, 9, usuario);
    expect(assertPeriodWritableForDate).not.toHaveBeenCalled();
    expect(computeTipCommission).not.toHaveBeenCalled();
  });
});

describe("sincronizarSalariosCombinados — auditoria 01/10", () => {
  test("apuração existe mas a pessoa está fora dela: gorjeta zero, não pendente", async () => {
    vi.mocked(computeTipCommission).mockResolvedValue(apuracao([{ employeeId: "outro", netCommission: 100 }]));
    const r = await sincronizarSalariosCombinados(2026, 9, usuario);
    const upd = db.payrollItem.update.mock.calls[0][0];
    expect(upd.data.amount).toBe(3731.2);
    expect(upd.data.details).toMatchObject({ origemValor: "SALARIO_COMBINADO", gorjetaIntegral: 0 });
    expect(upd.data.details.pendenteGorjeta).toBeUndefined();
    expect(r.avisos).toEqual([]);
  });

  test("gorjeta paga na rescisão (pagoNaRescisao): não soma de novo", async () => {
    vi.mocked(computeTipCommission).mockResolvedValue(apuracao([{ employeeId: "e1", netCommission: 2223.54, pagoNaRescisao: true } as never]));
    await sincronizarSalariosCombinados(2026, 9, usuario);
    expect(db.payrollItem.update.mock.calls[0][0].data.amount).toBe(3731.2);
  });
});
