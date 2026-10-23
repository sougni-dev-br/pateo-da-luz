import { describe, expect, test } from "vitest";
import type { ReceivableView } from "../../../api/client";
import {
  diaDoInstante, agruparPorMes, agruparPorUrgencia, aplicarDia, aplicarFoco, aplicarOrigem, contagemPorOrigem, diasDaAgenda,
  filtrarPorBusca, periodoDoPreset, podeCancelar, rotuloDoMes, rotuloPrazo, situacaoDe, taxaEfetiva, temRecebimento, tituloDaConta
} from "../regras";

const HOJE = "2026-10-23";

function conta(id: string, over: Partial<ReceivableView> = {}): ReceivableView {
  return {
    id, companyId: null, companyName: null, sourceType: "KEETA_SETTLEMENT", sourceRef: null, ifoodSettlementId: null,
    customerName: null, customerDocument: null, description: `Conta ${id}`, competenceYear: 2026, competenceMonth: 10,
    expectedDate: HOJE, receivedDate: null, grossAmount: 1000, fees: 100, netAmount: 900, paidAmount: null, remainingAmount: 900,
    paymentMethod: null, bankAccountId: null, installmentNumber: null, totalInstallments: null, parentReceivableId: null,
    status: "OPEN", notes: null, cancelledAt: null, cancellationReason: null, daysUntilExpected: 0, isLate: false,
    createdAt: "2026-10-01T00:00:00.000Z", ...over
  };
}

describe("situação e permissões de ação", () => {
  test("atrasada vale para aberta e parcial, e a situação visual segue o servidor", () => {
    expect(situacaoDe({ status: "OPEN", isLate: true })).toBe("late");
    expect(situacaoDe({ status: "PARTIALLY_RECEIVED", isLate: true })).toBe("late");
    expect(situacaoDe({ status: "PARTIALLY_RECEIVED", isLate: false })).toBe("PARTIALLY_RECEIVED");
    expect(situacaoDe({ status: "RECEIVED", isLate: false })).toBe("RECEIVED");
  });

  test("só conta aberta pode ser cancelada; recebimento exige estorno antes", () => {
    expect(podeCancelar({ status: "OPEN" })).toBe(true);
    expect(podeCancelar({ status: "PARTIALLY_RECEIVED" })).toBe(false);
    expect(podeCancelar({ status: "RECEIVED" })).toBe(false);
    expect(temRecebimento({ status: "PARTIALLY_RECEIVED", paidAmount: 10 })).toBe(true);
    expect(temRecebimento({ status: "CANCELLED", paidAmount: 10 })).toBe(false);
    expect(temRecebimento({ status: "OPEN", paidAmount: null })).toBe(false);
  });

  test("taxa efetiva é a retenção sobre o bruto, com uma casa", () => {
    expect(taxaEfetiva({ grossAmount: 1000, fees: 123 })).toBe(12.3);
    expect(taxaEfetiva({ grossAmount: 0, fees: 0 })).toBeNull();
  });

  test("prazo em palavras fala em 'previsto', não em 'vence'", () => {
    expect(rotuloPrazo({ expectedDate: HOJE }, HOJE)).toBe("previsto para hoje");
    expect(rotuloPrazo({ expectedDate: "2026-10-24" }, HOJE)).toBe("previsto para amanhã");
    expect(rotuloPrazo({ expectedDate: "2026-10-20" }, HOJE)).toBe("atrasada há 3 dias");
    expect(rotuloPrazo({ expectedDate: "2026-10-30" }, HOJE)).toBe("em 7 dias");
  });
});

describe("dia do instante", () => {
  test("usa o dia de São Paulo, não o do UTC", () => {
    expect(diaDoInstante("2026-10-24T01:30:00.000Z")).toBe("23/10/2026");
  });
});

describe("título legível", () => {
  test("repasses de plataforma perdem as datas em ISO e a seta", () => {
    expect(tituloDaConta("Repasse iFood 2026-10-12 → 2026-10-18 · Loja Centro")).toBe("Repasse iFood 12/10 a 18/10 · Loja Centro");
    expect(tituloDaConta("Fatura Keeta 2026-09-28 → 2026-10-04")).toBe("Fatura Keeta 28/09 a 04/10");
    expect(tituloDaConta("Evento de formatura — 2ª parcela")).toBe("Evento de formatura — 2ª parcela");
    expect(tituloDaConta("Contrato 2026-10-12 assinado")).toBe("Contrato 2026-10-12 assinado");
  });
});

describe("filtros", () => {
  const lista = [
    conta("atrasada", { expectedDate: "2026-10-20" }),
    conta("hoje", { expectedDate: HOJE }),
    conta("em5", { expectedDate: "2026-10-28" }),
    conta("em20", { expectedDate: "2026-11-12" }),
    conta("em60", { expectedDate: "2026-12-22" })
  ];

  test("os focos usam as mesmas janelas cumulativas do resumo do servidor", () => {
    const ids = (f: Parameters<typeof aplicarFoco>[1]) => aplicarFoco(lista, f, HOJE).map((c) => c.id);
    expect(ids("atrasadas")).toEqual(["atrasada"]);
    expect(ids("hoje")).toEqual(["hoje"]);
    expect(ids("proximos7")).toEqual(["hoje", "em5"]);
    expect(ids("proximos30")).toEqual(["hoje", "em5", "em20"]);
    expect(ids(null)).toHaveLength(5);
  });

  test("filtra por plataforma e por dia da agenda", () => {
    const mista = [conta("a", { sourceType: "IFOOD_SETTLEMENT" }), conta("b", { sourceType: "KEETA_SETTLEMENT", expectedDate: "2026-10-25" })];
    expect(aplicarOrigem(mista, "IFOOD_SETTLEMENT").map((c) => c.id)).toEqual(["a"]);
    expect(aplicarOrigem(mista, "all")).toHaveLength(2);
    expect(aplicarDia(mista, "2026-10-25").map((c) => c.id)).toEqual(["b"]);
    expect(contagemPorOrigem(mista)).toMatchObject({ IFOOD_SETTLEMENT: 1, KEETA_SETTLEMENT: 1, EVENT: 0 });
  });

  test("busca ignora acento e maiúsculas e acha por cliente, referência e valor", () => {
    const l = [
      conta("1", { description: "Evento de Formatura", customerName: "Colégio São José", netAmount: 1250, remainingAmount: 1250 }),
      conta("2", { description: "Fatura semanal", sourceRef: "FAT-998", netAmount: 80.5, remainingAmount: 80.5 })
    ];
    expect(filtrarPorBusca(l, "colegio sao jose").map((c) => c.id)).toEqual(["1"]);
    expect(filtrarPorBusca(l, "fat-998").map((c) => c.id)).toEqual(["2"]);
    expect(filtrarPorBusca(l, "1.250,00").map((c) => c.id)).toEqual(["1"]);
    expect(filtrarPorBusca(l, "80,5").map((c) => c.id)).toEqual(["2"]);
    expect(filtrarPorBusca(l, "1.250").map((c) => c.id)).toEqual(["1"]);
    expect(filtrarPorBusca(l, "keeta")).toHaveLength(2);
    expect(filtrarPorBusca(l, "   ")).toHaveLength(2);
  });
});

describe("grupos", () => {
  test("pendentes por urgência, a mais antiga primeiro, com total do saldo", () => {
    const grupos = agruparPorUrgencia([
      conta("b", { expectedDate: "2026-10-19", remainingAmount: 100 }),
      conta("a", { expectedDate: "2026-10-18", remainingAmount: 50.1 }),
      conta("c", { expectedDate: HOJE, remainingAmount: 10 }),
      conta("d", { expectedDate: "2026-12-01", remainingAmount: 7 })
    ], HOJE);
    expect(grupos.map((g) => g.chave)).toEqual(["atrasadas", "hoje", "depois"]);
    expect(grupos[0].contas.map((c) => c.id)).toEqual(["a", "b"]);
    expect(grupos[0].total).toBe(150.1);
  });

  test("histórico por mês, o mais recente primeiro; recebida conta no mês do recebimento", () => {
    const grupos = agruparPorMes([
      conta("r1", { status: "RECEIVED", expectedDate: "2026-09-30", receivedDate: "2026-10-02", paidAmount: 300, netAmount: 300 }),
      conta("r2", { status: "RECEIVED", expectedDate: "2026-09-10", receivedDate: "2026-09-12", paidAmount: 200, netAmount: 200 }),
      conta("c1", { status: "CANCELLED", expectedDate: "2026-10-05", netAmount: 999 })
    ]);
    expect(grupos.map((g) => g.rotulo)).toEqual(["outubro de 2026", "setembro de 2026"]);
    expect(grupos[0].contas.map((c) => c.id).sort()).toEqual(["c1", "r1"]);
    expect(grupos[0].total).toBe(300); // cancelada não soma
    expect(rotuloDoMes("2026-03")).toBe("março de 2026");
  });
});

describe("agenda e período", () => {
  test("agenda tem 14 dias a partir de hoje, soma o saldo e separa por plataforma", () => {
    const agenda = diasDaAgenda([
      conta("a", { expectedDate: "2026-10-25", sourceType: "IFOOD_SETTLEMENT", remainingAmount: 100 }),
      conta("b", { expectedDate: "2026-10-25", sourceType: "KEETA_SETTLEMENT", remainingAmount: 40.5 }),
      conta("fora", { expectedDate: "2026-11-30", remainingAmount: 9 }),
      conta("atrasada", { expectedDate: "2026-10-20", remainingAmount: 9 })
    ], HOJE);
    expect(agenda).toHaveLength(14);
    expect(agenda[0].chave).toBe(HOJE);
    expect(agenda[13].chave).toBe("2026-11-05");
    const dia25 = agenda.find((d) => d.chave === "2026-10-25")!;
    expect(dia25).toMatchObject({ qtd: 2, total: 140.5 });
    expect(dia25.porOrigem).toEqual([{ origem: "IFOOD_SETTLEMENT", total: 100 }, { origem: "KEETA_SETTLEMENT", total: 40.5 }]);
    expect(agenda.reduce((s, d) => s + d.qtd, 0)).toBe(2);
  });

  test("presets de período", () => {
    expect(periodoDoPreset("mes", HOJE)).toEqual({ startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(periodoDoPreset("mes-passado", HOJE)).toEqual({ startDate: "2026-09-01", endDate: "2026-09-30" });
    expect(periodoDoPreset("30dias", HOJE)).toEqual({ startDate: "2026-09-24", endDate: HOJE });
    expect(periodoDoPreset("ano", HOJE)).toEqual({ startDate: "2026-01-01", endDate: "2026-12-31" });
    expect(periodoDoPreset("tudo", HOJE)).toEqual({ startDate: "", endDate: "" });
    expect(periodoDoPreset("mes-passado", "2026-01-15")).toEqual({ startDate: "2025-12-01", endDate: "2025-12-31" });
  });
});
