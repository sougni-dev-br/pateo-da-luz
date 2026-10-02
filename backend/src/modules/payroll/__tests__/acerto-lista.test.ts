import { beforeEach, describe, expect, test, vi } from "vitest";

// Acerto do mês (lista de pagamento) dos sem registro como título SALARIO no Contas a Pagar.
// Pessoas fictícias.
vi.mock("../../../config/database.js", () => ({
  prisma: {
    payrollItem: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    employee: { findMany: vi.fn() },
    dRECategory: { findFirst: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ assertPeriodWritableForDate: vi.fn(async () => undefined) }));
vi.mock("../../security/security-utils.js", () => ({ auditLog: vi.fn(async () => undefined) }));
vi.mock("../tip-commission.service.js", () => ({ computeTipCommission: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { assertPeriodWritableForDate } from "../../cmv-real/cmv-real.service.js";
import { computeTipCommission } from "../tip-commission.service.js";
import { ROTULO_ACERTO, composicaoDoAcerto, quintoDiaUtil, vencimentoDoAcerto } from "../acerto-lista.js";
import { lancarAcertosDaLista } from "../acerto-lista.service.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const USUARIO = { id: "u1", name: "Fulano" };

function pessoa(over: Record<string, unknown>) {
  return {
    employeeId: "e1", employeeName: "Ana Exemplo", semRegistro: true, tipoCalculo: "MES", pagoNaRescisao: false, foraDaGorjeta: false,
    pagamentoQuinzenal: false, salarioProporcional: 2000, diasSalario: 30, adiantamentoSalarial: 800, primeiraQuinzena: 0,
    rateioAmount: 500, descontos: 50, creditos: 10, netCommission: 460, valorHoraExtra: 30, valorAdicionalNoturno: 5,
    totalAPagar: 1695, terminationDate: null, ...over,
  };
}

function apuracao(participants: unknown[], extra: Record<string, unknown> = {}) {
  vi.mocked(computeTipCommission).mockResolvedValue({
    year: 2026, month: 9, periodId: "per1", code: "GOR-2026-0009", status: "CLOSED", label: "Gorjeta 26/08–25/09", participants, ...extra,
  } as never);
}

type Existente = Record<string, unknown>;
function existentes(itens: Existente[]) {
  db.payrollItem.findMany.mockResolvedValue(itens.map((i) => ({
    id: "x", employeeId: "e1", type: "SALARIO", periodLabel: ROTULO_ACERTO, amount: 1695, paymentDate: null, paidAmount: null,
    deletedAt: null, deletedById: null, status: "PENDING", dueDate: d("2026-10-06"), details: { origem: "LISTA_PAGAMENTO" }, ...i,
  })));
}

beforeEach(() => {
  vi.clearAllMocks();
  db.payrollItem.findMany.mockResolvedValue([]);
  db.payrollItem.create.mockResolvedValue({ id: "novo" });
  db.payrollItem.update.mockResolvedValue({});
  db.payrollItem.updateMany.mockResolvedValue({ count: 1 });
  db.$executeRaw.mockResolvedValue(1);
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
  db.employee.findMany.mockResolvedValue([{ id: "e1", terminationDate: null }, { id: "e2", terminationDate: null }, { id: "e3", terminationDate: null }]);
  db.dRECategory.findFirst.mockResolvedValue({ id: "dre-folha" });
});

describe("regras puras", () => {
  test("5º dia útil: seg a sáb (o sábado conta), sem os feriados", () => {
    expect(quintoDiaUtil(2026, 10)).toEqual(d("2026-10-06")); // 01, 02, 03 (sáb), 05, 06
    expect(quintoDiaUtil(2027, 1)).toEqual(d("2027-01-07")); // 01 é feriado; 02 (sáb), 04, 05, 06, 07
    expect(quintoDiaUtil(2026, 11)).toEqual(d("2026-11-07")); // 01 dom, 02 Finados; 03 a 07 (sáb)
  });

  test("vencimento: por quinzena no último dia do mês; os outros no 5º dia útil do mês seguinte", () => {
    expect(vencimentoDoAcerto(2026, 9, true)).toEqual(d("2026-09-30"));
    expect(vencimentoDoAcerto(2026, 2, true)).toEqual(d("2026-02-28"));
    expect(vencimentoDoAcerto(2026, 9, false)).toEqual(d("2026-10-06"));
    expect(vencimentoDoAcerto(2026, 12, false)).toEqual(d("2027-01-07"));
  });

  test("composição guarda a conta inteira da lista", () => {
    expect(composicaoDoAcerto(pessoa({}) as never, "GOR-2026-0009")).toEqual({
      origem: "LISTA_PAGAMENTO", semRegistro: true, apuracao: "GOR-2026-0009", pagamentoQuinzenal: false,
      salario: 2000, diasSalario: 30, adiantamento: 800, primeiraQuinzena: 0,
      gorjeta: 500, vales: 50, creditos: 10, gorjetaLiquida: 460, horaExtra: 30, adicionalNoturno: 5, totalAPagar: 1695,
    });
  });

  test("composição leva o DSR quando há (sem DSR, igual à de antes)", () => {
    expect(composicaoDoAcerto(pessoa({ valorDsr: 7, totalAPagar: 1702 }) as never, "GOR-2026-0009"))
      .toMatchObject({ horaExtra: 30, adicionalNoturno: 5, dsr: 7, totalAPagar: 1702 });
    expect(composicaoDoAcerto(pessoa({ valorDsr: 0 }) as never, "GOR-2026-0009")).not.toHaveProperty("dsr");
  });
});

describe("acerto com o DSR", () => {
  test("acerto lançado antes do DSR: a lista com DSR atualiza o valor e a composição", async () => {
    apuracao([pessoa({ valorDsr: 7, totalAPagar: 1702 })]);
    existentes([{ details: composicaoDoAcerto(pessoa({}) as never, "GOR-2026-0009") }]);
    await lancarAcertosDaLista(2026, 9, USUARIO);
    expect(db.payrollItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: 1702, details: expect.objectContaining({ dsr: 7, totalAPagar: 1702 }) }),
    }));
  });

  test("acerto lançado sem DSR e a lista também sem: não mexe", async () => {
    apuracao([pessoa({ valorDsr: 0 })]);
    existentes([{ details: composicaoDoAcerto(pessoa({}) as never, "GOR-2026-0009") }]);
    await lancarAcertosDaLista(2026, 9, USUARIO);
    expect(db.payrollItem.updateMany).not.toHaveBeenCalled();
    expect(db.payrollItem.create).not.toHaveBeenCalled();
  });
});

describe("lançar os acertos da lista", () => {
  test("cria um SALARIO por sem registro da lista, com o valor a pagar e a composição", async () => {
    apuracao([pessoa({})]);
    const r = await lancarAcertosDaLista(2026, 9, USUARIO);
    expect(db.payrollItem.create).toHaveBeenCalledTimes(1);
    expect(db.payrollItem.create.mock.calls[0][0].data).toMatchObject({
      employeeId: "e1", type: "SALARIO", competenceYear: 2026, competenceMonth: 9, periodLabel: "Acerto (lista de pagamento)",
      amount: 1695, dueDate: d("2026-10-06"), dreCategoryId: "dre-folha", source: "GENERATED", createdById: "u1",
      details: expect.objectContaining({ origem: "LISTA_PAGAMENTO", totalAPagar: 1695, adiantamento: 800 }),
    });
    expect(r.criados).toEqual([{ employeeId: "e1", nome: "Ana Exemplo", valor: 1695, vencimento: "2026-10-06" }]);
    expect(assertPeriodWritableForDate).toHaveBeenCalledWith(d("2026-09-01"), expect.any(String));
  });

  test("por quinzena: vence no último dia do mês", async () => {
    apuracao([pessoa({ pagamentoQuinzenal: true, adiantamentoSalarial: 0, primeiraQuinzena: 1000, totalAPagar: 1495 })]);
    await lancarAcertosDaLista(2026, 9, USUARIO);
    expect(db.payrollItem.create.mock.calls[0][0].data).toMatchObject({ amount: 1495, dueDate: d("2026-09-30") });
  });

  test("fica de fora: CLT, pago na rescisão, fora do período e quem não tem nada a receber", async () => {
    apuracao([
      pessoa({ employeeId: "clt", semRegistro: false }),
      pessoa({ employeeId: "resc", pagoNaRescisao: true, totalAPagar: 0 }),
      pessoa({ employeeId: "fora", tipoCalculo: "FORA_DO_PERIODO" }),
      pessoa({ employeeId: "zero", totalAPagar: 0 }),
      pessoa({ employeeId: "negativo", totalAPagar: -20 }),
    ]);
    const r = await lancarAcertosDaLista(2026, 9, USUARIO);
    expect(db.payrollItem.create).not.toHaveBeenCalled();
    expect(r.criados).toEqual([]);
    expect(assertPeriodWritableForDate).not.toHaveBeenCalled();
  });

  test("só pelo salário (fora da gorjeta) também entra", async () => {
    apuracao([pessoa({ foraDaGorjeta: true, rateioAmount: 0, netCommission: 0, descontos: 0, creditos: 0, totalAPagar: 1235 })]);
    await lancarAcertosDaLista(2026, 9, USUARIO);
    expect(db.payrollItem.create.mock.calls[0][0].data).toMatchObject({ amount: 1235, details: expect.objectContaining({ gorjeta: 0 }) });
  });

  test("lançar de novo sem mudança: não mexe", async () => {
    apuracao([pessoa({})]);
    existentes([{ details: composicaoDoAcerto(pessoa({}) as never, "GOR-2026-0009") }]);
    const r = await lancarAcertosDaLista(2026, 9, USUARIO);
    expect(db.payrollItem.create).not.toHaveBeenCalled();
    expect(db.payrollItem.update).not.toHaveBeenCalled();
    expect(db.payrollItem.updateMany).not.toHaveBeenCalled();
    expect(r.semMudanca).toBe(1);
  });

  test("valor mudou e o título não foi pago: atualiza", async () => {
    apuracao([pessoa({ totalAPagar: 1800 })]);
    existentes([{ amount: 1695 }]);
    const r = await lancarAcertosDaLista(2026, 9, USUARIO);
    // Só grava se continua sem baixa e ninguém mexeu desde a releitura (updatedAt).
    expect(db.payrollItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "x", paymentDate: null }), data: expect.objectContaining({ amount: 1800, updatedById: "u1" }),
    }));
    expect(db.$executeRaw).toHaveBeenCalled(); // trava da folha da pessoa
    expect(r.atualizados).toEqual([{ employeeId: "e1", nome: "Ana Exemplo", antes: 1695, depois: 1800 }]);
  });

  test("título pago nunca muda: avisa a diferença", async () => {
    apuracao([pessoa({ totalAPagar: 1800 })]);
    existentes([{ amount: 1695, paymentDate: d("2026-10-06"), paidAmount: 1695, status: "PAID" }]);
    const r = await lancarAcertosDaLista(2026, 9, USUARIO);
    expect(db.payrollItem.update).not.toHaveBeenCalled();
    expect(db.payrollItem.updateMany).not.toHaveBeenCalled();
    expect(r.avisos).toEqual([expect.stringMatching(/Ana Exemplo.*já pago.*1\.695,00.*1\.800,00/)]);
  });

  test("excluído à mão não volta", async () => {
    apuracao([pessoa({})]);
    existentes([{ deletedAt: d("2026-10-02"), deletedById: "u9" }]);
    const r = await lancarAcertosDaLista(2026, 9, USUARIO);
    expect(db.payrollItem.create).not.toHaveBeenCalled();
    expect(db.payrollItem.update).not.toHaveBeenCalled();
    expect(db.payrollItem.updateMany).not.toHaveBeenCalled();
    expect(r.avisos).toEqual([expect.stringMatching(/Ana Exemplo.*excluído à mão.*não foi recriado/)]);
  });

  test("excluído sem autor (antigo): volta, atualizado", async () => {
    apuracao([pessoa({})]);
    existentes([{ deletedAt: d("2026-10-02"), deletedById: null, amount: 1 }]);
    await lancarAcertosDaLista(2026, 9, USUARIO);
    expect(db.payrollItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: 1695, deletedAt: null, deletedById: null }),
    }));
  });

  test("salário da competência já lançado por outra origem: não cria outro e avisa", async () => {
    apuracao([pessoa({})]);
    existentes([{ periodLabel: "Salário", details: { base: 2000 } }]);
    const r = await lancarAcertosDaLista(2026, 9, USUARIO);
    expect(db.payrollItem.create).not.toHaveBeenCalled();
    expect(r.avisos).toEqual([expect.stringMatching(/Ana Exemplo.*salário de 09\/2026 já lançado como "Salário".*acerto não lançado/)]);
  });

  test("complemento lançado não impede o acerto", async () => {
    apuracao([pessoa({})]);
    existentes([{ periodLabel: "Complemento", details: { complemento: { motivo: "diferença" } } }]);
    await lancarAcertosDaLista(2026, 9, USUARIO);
    expect(db.payrollItem.create).toHaveBeenCalledTimes(1);
  });

  test("acerto lançado de quem saiu da lista (sem nada a pagar agora): avisa, não apaga", async () => {
    apuracao([pessoa({ totalAPagar: 0, pagoNaRescisao: true })]);
    existentes([{}]);
    const r = await lancarAcertosDaLista(2026, 9, USUARIO);
    expect(db.payrollItem.update).not.toHaveBeenCalled();
    expect(db.payrollItem.updateMany).not.toHaveBeenCalled();
    expect(r.avisos).toEqual([expect.stringMatching(/Ana Exemplo.*acerto.*lançado.*não tem mais nada a receber/)]);
  });

  test("sem apuração da competência: erro claro", async () => {
    apuracao([], { periodId: null });
    await expect(lancarAcertosDaLista(2026, 9, USUARIO)).rejects.toThrow(/apuração da gorjeta de 09\/2026/);
  });

  test("mês travado: a trava do período barra a gravação", async () => {
    apuracao([pessoa({})]);
    vi.mocked(assertPeriodWritableForDate).mockRejectedValueOnce(new Error("Mês 09/2026 fechado"));
    await expect(lancarAcertosDaLista(2026, 9, USUARIO)).rejects.toThrow(/fechado/);
    expect(db.payrollItem.create).not.toHaveBeenCalled();
  });

  test("saiu antes da competência: não lança", async () => {
    apuracao([pessoa({})]);
    db.employee.findMany.mockResolvedValue([{ id: "e1", terminationDate: d("2026-08-20") }]);
    const r = await lancarAcertosDaLista(2026, 9, USUARIO);
    expect(db.payrollItem.create).not.toHaveBeenCalled();
    expect(r.avisos).toEqual([expect.stringMatching(/Ana Exemplo.*saiu em 20\/08\/2026/)]);
  });
});

describe("acerto: corrida e ajuste à mão", () => {
  test("pago entre a leitura e a gravação: não atualiza (MANTER) e avisa", async () => {
    apuracao([pessoa({ totalAPagar: 1800 })]);
    existentes([{ amount: 1695 }]);
    db.payrollItem.updateMany.mockResolvedValue({ count: 0 });
    const r = await lancarAcertosDaLista(2026, 9, USUARIO);
    expect(r.atualizados).toEqual([]);
    expect(r.semMudanca).toBe(1);
    expect(r.avisos).toEqual([expect.stringMatching(/Ana Exemplo.*mudou ou foi pago.*não atualizado/)]);
  });

  test("a releitura dentro da trava vê o título já pago: não grava e avisa como pago", async () => {
    apuracao([pessoa({ totalAPagar: 1800 })]);
    const base = { id: "x", employeeId: "e1", type: "SALARIO", periodLabel: ROTULO_ACERTO, amount: 1695, paidAmount: null, deletedAt: null,
      deletedById: null, dueDate: d("2026-10-06"), details: { origem: "LISTA_PAGAMENTO" } };
    db.payrollItem.findMany
      .mockResolvedValueOnce([{ ...base, paymentDate: null, status: "PENDING" }])
      .mockResolvedValue([{ ...base, paymentDate: d("2026-10-06"), paidAmount: 1695, status: "PAID" }]);
    const r = await lancarAcertosDaLista(2026, 9, USUARIO);
    expect(db.payrollItem.updateMany).not.toHaveBeenCalled();
    expect(r.avisos).toEqual([expect.stringMatching(/Ana Exemplo.*já pago/)]);
  });

  test("acerto não pago ajustado à mão (details.editadoAMao): não sobrescreve e avisa o valor da lista", async () => {
    apuracao([pessoa({ totalAPagar: 1800 })]);
    existentes([{ amount: 1500, details: { origem: "LISTA_PAGAMENTO", editadoAMao: true } }]);
    const r = await lancarAcertosDaLista(2026, 9, USUARIO);
    expect(db.payrollItem.updateMany).not.toHaveBeenCalled();
    expect(r.avisos).toEqual([expect.stringMatching(/^Ana Exemplo: acerto ajustado à mão: não atualizado \(lista diz R\$\s1\.800,00\)\.$/)]);
    expect(r.avisosSemValor).toEqual(["Ana Exemplo: acerto ajustado à mão: não atualizado."]);
  });

  test("ajustado à mão com o mesmo valor da lista: nada a fazer", async () => {
    apuracao([pessoa({ totalAPagar: 1800 })]);
    existentes([{ amount: 1800, details: { origem: "LISTA_PAGAMENTO", editadoAMao: true } }]);
    const r = await lancarAcertosDaLista(2026, 9, USUARIO);
    expect(r.semMudanca).toBe(1);
    expect(r.avisos).toEqual([]);
  });
});
