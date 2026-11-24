import { describe, expect, test } from "vitest";
import {
  brDay, daysSince, describeDaysSince, describeTitle, exportFileName, pageRangeLabel, parcelDateText, parcelStateLabel, parcelStateTone,
  purchaseStatusLabel, purchaseStatusTone, resolvePeriod, splitByParcel, titleStateLabel, titleStateTone
} from "../supplier-history";

describe("resolvePeriod", () => {
  const today = new Date(2026, 10, 24); // 24/11/2026

  test("mês atual vai do dia 1 ao último dia", () => {
    expect(resolvePeriod("month", today)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
  });

  test("mês anterior cruza a virada do ano", () => {
    expect(resolvePeriod("prevMonth", today)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(resolvePeriod("prevMonth", new Date(2027, 0, 10))).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  test("fevereiro respeita o ano bissexto", () => {
    expect(resolvePeriod("month", new Date(2028, 1, 5)).to).toBe("2028-02-29");
    expect(resolvePeriod("month", new Date(2027, 1, 5)).to).toBe("2027-02-28");
  });

  test("ano atual e sem datas para 'todo o histórico' e 'personalizado'", () => {
    expect(resolvePeriod("year", today)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(resolvePeriod("all", today)).toEqual({ from: "", to: "" });
    expect(resolvePeriod("custom", today)).toEqual({ from: "", to: "" });
  });
});

describe("daysSince", () => {
  const today = new Date(2026, 10, 24);

  test("conta dias corridos e descreve em português", () => {
    expect(daysSince("2026-11-23T00:00:00.000Z", today)).toBe(1);
    expect(daysSince("2026-09-10T00:00:00.000Z", today)).toBe(75);
    expect(describeDaysSince(0)).toBe("hoje");
    expect(describeDaysSince(1)).toBe("ontem");
    expect(describeDaysSince(75)).toBe("há 75 dias");
  });

  test("sem data, não inventa número", () => {
    expect(daysSince(null, today)).toBeNull();
    expect(describeDaysSince(null)).toBe("");
  });

  test("data no futuro não vira dias negativos", () => {
    expect(daysSince("2026-12-01T00:00:00.000Z", today)).toBe(0);
  });
});

describe("título da compra", () => {
  const base = { state: "OPEN" as const, installments: 1, paidInstallments: 0, nextDueDate: null, paidDate: null, viaCycle: false };

  test("rótulos e tons por situação", () => {
    expect(titleStateLabel({ state: "PAID" })).toBe("Baixado");
    expect(titleStateLabel({ state: "OVERDUE" })).toBe("Vencido");
    expect(titleStateLabel({ state: "OPEN" })).toBe("Em aberto");
    expect(titleStateLabel({ state: "NONE" })).toBe("Sem título");
    expect(titleStateTone({ state: "PAID" })).toBe("success");
    expect(titleStateTone({ state: "OVERDUE" })).toBe("danger");
  });

  test("datas ISO viram dd/mm/aaaa sem deslocar o dia", () => {
    expect(brDay("2026-07-17")).toBe("17/07/2026");
    expect(brDay(null)).toBe("");
  });

  test("detalhe: aberto mostra o vencimento; vencido, quando venceu; baixado, quando pagou", () => {
    expect(describeTitle({ ...base, nextDueDate: "2026-12-05" })).toBe("vence 05/12/2026");
    expect(describeTitle({ ...base, state: "OVERDUE", nextDueDate: "2026-07-17" })).toBe("venceu 17/07/2026");
    expect(describeTitle({ ...base, state: "PAID", paidDate: "2026-11-12" })).toBe("baixado em 12/11/2026");
  });

  test("detalhe: parcelas, parciais e origem no ciclo", () => {
    expect(describeTitle({ ...base, installments: 2, nextDueDate: "2026-12-05" })).toBe("vence 05/12/2026 · 2 parcelas");
    expect(describeTitle({ ...base, installments: 3, paidInstallments: 1, nextDueDate: "2026-12-05" })).toBe("vence 05/12/2026 · 1/3 pagas");
    expect(describeTitle({ ...base, state: "NONE", installments: 0, viaCycle: true })).toBe("Ciclo ainda não fechado");
    expect(describeTitle({ ...base, state: "PAID", installments: 2, paidInstallments: 2, paidDate: "2026-11-12", viaCycle: true })).toBe("Ciclo · baixado em 12/11/2026 · 2 parcelas");
    expect(describeTitle({ ...base, state: "NONE", installments: 0 })).toBe("");
  });
});

describe("exportFileName", () => {
  test("sem acento, sem espaço e com a data de hoje", () => {
    expect(exportFileName("CASTELÃO Distribuidora, de Frios!", "pdf", new Date(2026, 10, 24))).toBe("Historico_CASTELAO_Distribuidora_de_Frios_2026-11-24.pdf");
    expect(exportFileName("???", "xlsx", new Date(2026, 0, 5))).toBe("Historico_fornecedor_2026-01-05.xlsx");
  });
});

describe("parcelas", () => {
  test("rótulo, tom e data de cada situação", () => {
    expect(parcelStateLabel({ state: "PAID" })).toBe("Baixada");
    expect(parcelStateLabel({ state: "OVERDUE" })).toBe("Vencida");
    expect(parcelStateLabel({ state: "OPEN" })).toBe("Em aberto");
    expect(parcelStateTone({ state: "OVERDUE" })).toBe("danger");
    expect(parcelDateText({ state: "OPEN", dueDate: "2026-12-05", paidDate: null })).toBe("vence 05/12/2026");
    expect(parcelDateText({ state: "OVERDUE", dueDate: "2026-07-17", paidDate: null })).toBe("venceu 17/07/2026");
    expect(parcelDateText({ state: "PAID", dueDate: "2026-07-17", paidDate: "2026-07-15" })).toBe("baixada em 15/07/2026");
    expect(parcelDateText({ state: "OPEN", dueDate: null, paidDate: null })).toBe("sem vencimento");
  });

  describe("splitByParcel", () => {
    const parcelas = [{ number: 1 }, { number: 2 }, { number: 3 }];
    const compra = (over: { status?: string; viaCycle?: boolean; parcels?: Array<{ number: number }> }) => ({
      id: "c1", status: over.status ?? "ACTIVE", title: { viaCycle: over.viaCycle ?? false, parcels: over.parcels ?? parcelas }
    });

    test("compra parcelada repete a linha uma vez por parcela, com 1/3, 2/3, 3/3", () => {
      const linhas = splitByParcel(compra({}));
      expect(linhas.map((l) => l.fraction)).toEqual(["1/3", "2/3", "3/3"]);
      expect(linhas.map((l) => l.parcel?.number)).toEqual([1, 2, 3]);
      expect(new Set(linhas.map((l) => l.key)).size).toBe(3);
    });

    test("sem parcela, com uma parcela só, cancelada ou de ciclo: uma linha, a compra inteira", () => {
      for (const c of [compra({ parcels: [] }), compra({ parcels: [{ number: 1 }] }), compra({ status: "CANCELLED" }), compra({ viaCycle: true })]) {
        expect(splitByParcel(c)).toEqual([{ key: "c1", parcel: null, fraction: null }]);
      }
    });
  });
});

describe("status e paginação", () => {
  test("traduz o status da compra", () => {
    expect(purchaseStatusLabel("ACTIVE")).toBe("Ativa");
    expect(purchaseStatusLabel("CANCELLED")).toBe("Cancelada");
    expect(purchaseStatusTone("CANCELLED")).toBe("danger");
    expect(purchaseStatusTone("ACTIVE")).toBe("success");
  });

  test("faixa da página", () => {
    expect(pageRangeLabel(1, 15, 144)).toBe("1–15 de 144");
    expect(pageRangeLabel(10, 15, 144)).toBe("136–144 de 144");
    expect(pageRangeLabel(1, 15, 0)).toBe("0 compras");
  });
});
