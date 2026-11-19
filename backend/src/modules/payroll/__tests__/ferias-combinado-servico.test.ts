import { beforeEach, describe, expect, test, vi } from "vitest";

// Complemento do combinado no título FERIAS (aberto): valores fictícios — combinado 6.000, recibo líquido 6.000,
// gorjeta integral 1.500 por mês → remuneração (6.000 + 1.500) × 4/3 = 10.000; complemento 4.000.
vi.mock("../../../config/database.js", () => ({ prisma: { payrollItem: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() } } }));
vi.mock("../salario-combinado.service.js", () => ({ mapaCombinados: vi.fn(), gorjetasDaCompetencia: vi.fn() }));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn(async () => undefined) }));
vi.mock("../../security/security-utils.js", () => ({ auditLog: vi.fn(async () => undefined) }));

import { prisma } from "../../../config/database.js";
import { assertPeriodWritableForDate } from "../../cmv-real/cmv-real.service.js";
import { auditLog } from "../../security/security-utils.js";
import { gorjetasDaCompetencia, mapaCombinados } from "../salario-combinado.service.js";
import { RecusaFerias, somarCombinadoAFerias } from "../ferias-combinado.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const usuario = { id: "u1", name: "Eli" };
const baseDetails = () => ({ recibo: { hash: "h", liquido: 6000 }, feriasProgramacaoId: null });
const titulo = (over: Record<string, unknown> = {}) => ({
  id: "f1", employeeId: "e1", amount: 6000, status: "PENDING", paymentDate: null,
  periodStart: new Date("2027-01-10T00:00:00Z"), details: baseDetails(),
  employee: { firstName: "Teodoro", lastName: "Fictício" }, ...over,
});
const apuracaoDe = (liquida: number) => new Map([["e1", { noPeriodo: true, gorjetaLiquida: liquida, pagoNaRescisao: false }]]);
const somado = (amount: number, complemento: number) => titulo({
  amount,
  details: { ...baseDetails(), origemValor: "FERIAS_COMBINADO", liquidoExtrato: 6000, complemento, complementoDescricao: "x", composicao: "y", feriasCombinado: { meses: [] } },
});

beforeEach(() => {
  vi.clearAllMocks();
  db.payrollItem.findFirst.mockResolvedValue(titulo());
  db.payrollItem.updateMany.mockResolvedValue({ count: 1 });
  vi.mocked(mapaCombinados).mockResolvedValue(new Map([["e1", 6000]]));
  vi.mocked(gorjetasDaCompetencia).mockResolvedValue(apuracaoDe(1500));
});

describe("somarCombinadoAFerias", () => {
  test("prévia (aplicar=false): calcula e não grava nada", async () => {
    const r = await somarCombinadoAFerias({ payrollItemId: "f1", aplicar: false, usuario });
    expect(r.aplicado).toBe(false);
    expect(r.previa).toMatchObject({ combinado: 6000, mediaGorjeta: 1500, mesesContados: 12, remuneracao: 10000, complemento: 4000, valorAntes: 6000, valorDepois: 10000 });
    expect(db.payrollItem.updateMany).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  test("a janela são as 12 competências anteriores ao mês do início do gozo (jan/2027 → jan–dez/2026)", async () => {
    await somarCombinadoAFerias({ payrollItemId: "f1", aplicar: false, usuario });
    const meses = vi.mocked(gorjetasDaCompetencia).mock.calls.map((c) => `${c[0]}-${c[1]}`);
    expect(meses[0]).toBe("2026-1");
    expect(meses[11]).toBe("2026-12");
    expect(meses).toHaveLength(12);
    expect(mapaCombinados).toHaveBeenCalledWith(2027, 1, ["e1"]);
  });

  test("aplicar: soma ao título EM ABERTO, guarda composição, fórmula e fontes, e audita", async () => {
    const r = await somarCombinadoAFerias({ payrollItemId: "f1", aplicar: true, usuario });
    expect(r.aplicado).toBe(true);
    const upd = db.payrollItem.updateMany.mock.calls[0][0];
    expect(upd.where).toMatchObject({ id: "f1", deletedAt: null, paymentDate: null });
    expect(upd.data.amount).toBe(10000);
    expect(upd.data.details).toMatchObject({
      recibo: { hash: "h", liquido: 6000 }, origemValor: "FERIAS_COMBINADO", liquidoExtrato: 6000, complemento: 4000,
      feriasCombinado: { combinado: 6000, mediaGorjeta: 1500, remuneracao: 10000 },
    });
    expect(upd.data.details.feriasCombinado.meses).toHaveLength(12);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "FERIAS_COMBINADO_SOMADO", entityId: "f1" }));
    expect(assertPeriodWritableForDate).toHaveBeenCalled();
  });

  test("nunca cria segundo título: só atualiza o existente (sem create)", async () => {
    await somarCombinadoAFerias({ payrollItemId: "f1", aplicar: true, usuario });
    await somarCombinadoAFerias({ payrollItemId: "f1", aplicar: true, usuario });
    expect(db.payrollItem.create).not.toHaveBeenCalled();
  });

  test("título pago: recusa e não altera", async () => {
    db.payrollItem.findFirst.mockResolvedValue(titulo({ paymentDate: new Date("2027-01-05T00:00:00Z"), status: "PAID" }));
    await expect(somarCombinadoAFerias({ payrollItemId: "f1", aplicar: true, usuario })).rejects.toMatchObject({ status: 409 });
    expect(db.payrollItem.updateMany).not.toHaveBeenCalled();
  });

  test("a gravação é condicionada a continuar em aberto (alguém pagou no meio: não grava)", async () => {
    db.payrollItem.updateMany.mockResolvedValue({ count: 0 });
    const r = await somarCombinadoAFerias({ payrollItemId: "f1", aplicar: true, usuario });
    expect(r.aplicado).toBe(false);
    expect(auditLog).not.toHaveBeenCalled();
  });

  test("recalcular: já somado → recalcula a partir do líquido do recibo, não soma em cima da soma", async () => {
    db.payrollItem.findFirst.mockResolvedValue(somado(10000, 4000));
    vi.mocked(mapaCombinados).mockResolvedValue(new Map([["e1", 6600]])); // reajuste do combinado antes do pagamento
    const r = await somarCombinadoAFerias({ payrollItemId: "f1", aplicar: true, usuario });
    // (6.600 + 1.500) × 4/3 = 10.800 → complemento 4.800; valor = 6.000 + 4.800
    expect(db.payrollItem.updateMany.mock.calls[0][0].data.amount).toBe(10800);
    expect(r.previa.valorAntes).toBe(10000);
  });

  test("valor do título mexido à mão (≠ esperado): recusa para não sobrescrever", async () => {
    db.payrollItem.findFirst.mockResolvedValue(titulo({ amount: 7777 }));
    await expect(somarCombinadoAFerias({ payrollItemId: "f1", aplicar: true, usuario })).rejects.toMatchObject({ status: 409 });
    expect(db.payrollItem.updateMany).not.toHaveBeenCalled();
  });

  test("sem combinado: recusa; se já estava somado, desfaz e volta ao líquido do recibo", async () => {
    vi.mocked(mapaCombinados).mockResolvedValue(new Map());
    await expect(somarCombinadoAFerias({ payrollItemId: "f1", aplicar: true, usuario })).rejects.toBeInstanceOf(RecusaFerias);
    db.payrollItem.findFirst.mockResolvedValue(somado(10000, 4000));
    await somarCombinadoAFerias({ payrollItemId: "f1", aplicar: true, usuario });
    const upd = db.payrollItem.updateMany.mock.calls[0][0];
    expect(upd.data.amount).toBe(6000);
    expect(upd.data.details).toEqual(baseDetails());
  });

  test("título que não veio de recibo (sem líquido do recibo): recusa", async () => {
    db.payrollItem.findFirst.mockResolvedValue(titulo({ details: {} }));
    await expect(somarCombinadoAFerias({ payrollItemId: "f1", aplicar: false, usuario })).rejects.toMatchObject({ status: 422 });
  });

  test("título inexistente: 404", async () => {
    db.payrollItem.findFirst.mockResolvedValue(null);
    await expect(somarCombinadoAFerias({ payrollItemId: "x", aplicar: false, usuario })).rejects.toMatchObject({ status: 404 });
  });

  test("meses sem apuração: valores informados à mão preenchem e ficam marcados; o resto vira aviso", async () => {
    vi.mocked(gorjetasDaCompetencia).mockResolvedValue(null);
    const informadas = { "2026-01": 1000, "2026-02": 2000 };
    const r = await somarCombinadoAFerias({ payrollItemId: "f1", aplicar: false, usuario, informadas });
    expect(r.previa.mesesContados).toBe(2);
    expect(r.previa.mediaGorjeta).toBe(1500);
    expect(r.previa.mesesAusentes).toHaveLength(10);
    expect(r.previa.avisos.join(" ")).toContain("10 mês");
    expect(r.previa.meses.filter((m) => m.origem === "INFORMADA")).toHaveLength(2);
  });

  test("mês com apuração: vale a apuração e o valor informado à mão é ignorado (com aviso)", async () => {
    const r = await somarCombinadoAFerias({ payrollItemId: "f1", aplicar: false, usuario, informadas: { "2026-03": 0 } });
    expect(r.previa.meses.find((m) => m.chave === "2026-03")).toMatchObject({ valor: 1500, origem: "APURACAO" });
    expect(r.previa.mediaGorjeta).toBe(1500);
    expect(r.previa.avisos.join(" ")).toContain("2026-03: há apuração no sistema");
  });

  test("apuração indisponível (erro): o valor informado à mão preenche o mês", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(gorjetasDaCompetencia).mockRejectedValue(new Error("falha"));
    const r = await somarCombinadoAFerias({ payrollItemId: "f1", aplicar: false, usuario, informadas: { "2026-03": 900 } });
    expect(r.previa.meses.find((m) => m.chave === "2026-03")).toMatchObject({ valor: 900, origem: "INFORMADA" });
    expect(r.previa.mediaGorjeta).toBe(900);
  });

  test("valores informados guardados na soma anterior são reaproveitados ao recalcular", async () => {
    vi.mocked(gorjetasDaCompetencia).mockResolvedValue(null);
    db.payrollItem.findFirst.mockResolvedValue(titulo({
      details: { ...baseDetails(), feriasCombinado: { meses: [{ chave: "2026-05", valor: 3000, origem: "INFORMADA" }] } },
    }));
    const r = await somarCombinadoAFerias({ payrollItemId: "f1", aplicar: false, usuario });
    expect(r.previa.mesesContados).toBe(1);
    expect(r.previa.mediaGorjeta).toBe(3000);
  });

  test("valor informado inválido (negativo, não numérico, mês fora da janela, chave ruim) é recusado", async () => {
    const tenta = (informadas: Record<string, unknown>) => somarCombinadoAFerias({ payrollItemId: "f1", aplicar: false, usuario, informadas });
    await expect(tenta({ "2026-01": -1 })).rejects.toMatchObject({ status: 400 });
    await expect(tenta({ "2026-01": Number.NaN })).rejects.toMatchObject({ status: 400 });
    await expect(tenta({ "2026-01": "10" })).rejects.toMatchObject({ status: 400 });
    await expect(tenta({ "2027-06": 10 })).rejects.toMatchObject({ status: 400 });
    await expect(tenta({ jan: 10 })).rejects.toMatchObject({ status: 400 });
  });

  test("recibo já acima do devido: nada a somar, não grava", async () => {
    vi.mocked(mapaCombinados).mockResolvedValue(new Map([["e1", 3000]]));
    vi.mocked(gorjetasDaCompetencia).mockResolvedValue(apuracaoDe(0));
    const r = await somarCombinadoAFerias({ payrollItemId: "f1", aplicar: true, usuario });
    expect(r.aplicado).toBe(false);
    expect(r.previa.complemento).toBe(0);
    expect(db.payrollItem.updateMany).not.toHaveBeenCalled();
  });

  test("gorjeta paga na rescisão não entra; erro de apuração vira mês ausente com aviso", async () => {
    vi.mocked(gorjetasDaCompetencia)
      .mockResolvedValueOnce(new Map([["e1", { noPeriodo: true, gorjetaLiquida: 900, pagoNaRescisao: true }]]))
      .mockRejectedValueOnce(new Error("faturamento indisponível"))
      .mockResolvedValue(apuracaoDe(1500));
    const r = await somarCombinadoAFerias({ payrollItemId: "f1", aplicar: false, usuario });
    expect(r.previa.meses[0]).toMatchObject({ valor: 0, origem: "APURACAO" });
    expect(r.previa.meses[1]).toMatchObject({ valor: null, origem: "AUSENTE" });
    expect(r.previa.avisos.join(" ")).toContain("faturamento indisponível");
  });

  test("período do mês do gozo fechado: recusa ao aplicar", async () => {
    vi.mocked(assertPeriodWritableForDate).mockRejectedValueOnce(new Error("Período fechado."));
    await expect(somarCombinadoAFerias({ payrollItemId: "f1", aplicar: true, usuario })).rejects.toMatchObject({ status: 400 });
    expect(db.payrollItem.updateMany).not.toHaveBeenCalled();
  });
});

describe("férias fracionadas", () => {
  test("recibo de 14 dias: complemento proporcional e aviso de abono", async () => {
    db.payrollItem.findFirst.mockResolvedValue(titulo({ amount: 2800, details: { recibo: { hash: "h", liquido: 2800, dias: 14 } } }));
    const r = await somarCombinadoAFerias({ payrollItemId: "f1", aplicar: false, usuario });
    expect(r.previa.remuneracao).toBe(4666.67);
    expect(r.previa.complemento).toBe(1866.67);
    expect(r.previa.avisos.join(" ")).toContain("14/30");
  });
});
