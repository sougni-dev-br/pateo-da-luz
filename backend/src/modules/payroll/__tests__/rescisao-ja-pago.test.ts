import { beforeEach, describe, expect, test, vi } from "vitest";

// Sem registro que saiu no mês e foi pago na lista da gorjeta fechada: a rescisão não
// pode sugerir salário e gorjeta de novo (pagaria duas vezes sem aviso).
vi.mock("../../../config/database.js", () => ({
  prisma: {
    employee: { findFirst: vi.fn() },
    payrollItem: { findMany: vi.fn() },
    tipPeriod: { findFirst: vi.fn() },
    tipParticipant: { findUnique: vi.fn() },
    tipVale: { findMany: vi.fn() },
  },
}));
vi.mock("../tip-commission.service.js", () => ({ computeTipCommission: vi.fn() }));

import { prisma } from "../../../config/database.js";
import { computeTipCommission } from "../tip-commission.service.js";
import {
  apurarRescisao, divergenciasDoApurado, jaPagoNaListaFechada, localizarGorjetaNaApuracao, observacaoJaPago, semDadosPessoais,
} from "../rescisao-apuracao.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const SAIDA = new Date("2026-09-12T00:00:00Z");

function cenario(status: "OPEN" | "CLOSED", totalAPagar: number, modality = "NAO_CLT") {
  db.employee.findFirst.mockResolvedValue({ id: "e1", modality, terminationDate: SAIDA, vtType: "TRANSPORTE_PUBLICO", vtLegs: [] });
  db.payrollItem.findMany.mockResolvedValue([]);
  db.tipPeriod.findFirst.mockResolvedValue({ id: "per1", competenceYear: 2026, competenceMonth: 9 });
  db.tipVale.findMany.mockResolvedValue([{ codigo: "VALE-1", date: null, type: "ADIANTAMENTO", notes: null, amount: 20 }]);
  vi.mocked(computeTipCommission).mockResolvedValue({
    label: "Gorjeta 26/08–25/09", status,
    participants: [{
      employeeId: "e1", participantId: "tp1", tipoCalculo: "RESCISAO", points: 2, pontosDireito: 2, valorPonto: 93.4,
      rateioAmount: 186.8, valorDireito: null, rescisaoPendente: false, diasSalario: 9, salarioProporcional: 659.97,
      descontos: 20, creditos: 5, totalAPagar,
    }],
  } as never);
}

beforeEach(() => vi.clearAllMocks());

describe("apurarRescisao com a gorjeta do mês fechada", () => {
  test("pago na lista: sugere zero em salário, gorjeta, vales e créditos, e avisa", async () => {
    cenario("CLOSED", 831.77);
    const a = (await apurarRescisao("e1"))!;
    expect(a.jaPagoNaLista).toEqual({ valor: 831.77, competencia: "09/2026" });
    expect(a.sugestao).toMatchObject({ salario: 0, gorjeta: 0, vales: 0, creditos: 0, bruto: 0 });
    expect(a.gorjetaObservacao).toContain("Já pago na lista de pagamento da gorjeta de 09/2026 (fechada)");
    expect(a.gorjetaObservacao).toContain("831,77");
    expect(a.gorjetaObservacao).toContain("Não lance de novo aqui.");
    // Qualquer valor em salário/gorjeta vira divergência e exige justificativa.
    const d = divergenciasDoApurado(a.sugestao, { salario: 659.97, gorjeta: 186.8, vales: 0, vtDesconto: 0 });
    expect(d.map((x) => x.campo)).toEqual(["salario", "gorjeta"]);
  });

  test("fechada mas com total zero (rescisão lançada antes de fechar): segue a apuração normal", async () => {
    cenario("CLOSED", 0);
    const a = (await apurarRescisao("e1"))!;
    expect(a.jaPagoNaLista).toBeNull();
    expect(a.sugestao).toMatchObject({ salario: 659.97, gorjeta: 186.8 });
  });

  test("aberta: não há lista paga ainda", async () => {
    cenario("OPEN", 831.77);
    const a = (await apurarRescisao("e1"))!;
    expect(a.jaPagoNaLista).toBeNull();
    expect(a.sugestao.salario).toBe(659.97);
  });

  test("CLT não entra: salário e gorjeta dele vêm da contabilidade", async () => {
    cenario("CLOSED", 186.8, "CLT");
    const a = (await apurarRescisao("e1"))!;
    expect(a.jaPagoNaLista).toBeNull();
    expect(a.sugestao.salario).toBeNull();
  });

  test("sem ver Funcionários: some o valor (tem salário), fica o aviso", async () => {
    cenario("CLOSED", 831.77);
    const a = semDadosPessoais(await apurarRescisao("e1"))!;
    expect(a.jaPagoNaLista).toEqual({ valor: null, competencia: "09/2026" });
    expect(a.gorjetaObservacao).toBe("Já pago na lista de pagamento da gorjeta de 09/2026 (fechada): salário e gorjeta. Não lance de novo aqui.");
  });
});

describe("localizarGorjetaNaApuracao com a lista fechada já paga", () => {
  const participante = (over: Record<string, unknown>) => db.tipParticipant.findUnique.mockResolvedValue({
    id: "tp1", rescisaoValorFixo: null, rateioAmount: 186.8, totalAPagar: 831.77, employee: { modality: "NAO_CLT" }, ...over,
  });

  test("não aplica nada, com qualquer valor (nem erro de 'reabra a gorjeta')", async () => {
    db.tipPeriod.findFirst.mockResolvedValue({ id: "per1", label: "x", status: "CLOSED" });
    participante({});
    expect(await localizarGorjetaNaApuracao("e1", SAIDA, 0)).toEqual({ alvo: null });
    expect(await localizarGorjetaNaApuracao("e1", SAIDA, 186.8)).toEqual({ alvo: null });
    expect(await localizarGorjetaNaApuracao("e1", SAIDA, 50)).toEqual({ alvo: null });
  });

  test("fechada sem lista paga continua exigindo o mesmo valor fechado", async () => {
    db.tipPeriod.findFirst.mockResolvedValue({ id: "per1", label: "x", status: "CLOSED" });
    participante({ totalAPagar: 0 });
    expect(await localizarGorjetaNaApuracao("e1", SAIDA, 50)).toHaveProperty("erro");
  });
});

describe("regras puras", () => {
  test("jaPagoNaListaFechada: só sem registro, fechada e com total gravado", () => {
    expect(jaPagoNaListaFechada({ status: "CLOSED", semRegistro: true, totalAPagar: 10 })).toBe(true);
    expect(jaPagoNaListaFechada({ status: "OPEN", semRegistro: true, totalAPagar: 10 })).toBe(false);
    expect(jaPagoNaListaFechada({ status: "CLOSED", semRegistro: false, totalAPagar: 10 })).toBe(false);
    expect(jaPagoNaListaFechada({ status: "CLOSED", semRegistro: true, totalAPagar: 0 })).toBe(false);
  });
  test("observacaoJaPago traz a competência e o valor", () => {
    expect(observacaoJaPago({ valor: 1000, competencia: "08/2026" })).toMatch(/08\/2026.*1\.000,00 de salário e gorjeta/);
  });
});
