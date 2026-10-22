import { describe, expect, it } from "vitest";
import { diasEntre, pertenceFaixa, resumirVencimento, totalizar } from "../vencimento";

const HOJE = "2026-10-22";

type Parcela = Parameters<typeof resumirVencimento>[0]["installments"][number];

function parcela(dueDate: string | null, extra: Partial<Parcela> = {}): Parcela {
  return { id: "p", dueDate, paidDate: null, amount: "100", installment: 1, rawValue: null, status: "OPEN", ...extra };
}

function compra(installments: Parcela[], extra: Record<string, unknown> = {}) {
  return { status: "ACTIVE", cycleStatus: null, creditCardId: null, reimbursementPayeeId: null, installments, ...extra };
}

describe("diasEntre", () => {
  it("conta dias corridos entre duas datas", () => {
    expect(diasEntre("2026-10-22", "2026-10-25")).toBe(3);
    expect(diasEntre("2026-10-22", "2026-10-20")).toBe(-2);
    expect(diasEntre("2026-10-31", "2026-11-01")).toBe(1);
  });
});

describe("resumirVencimento", () => {
  it("marca como vencida a parcela anterior a hoje, com há N dias", () => {
    const r = resumirVencimento(compra([parcela("2026-10-19T00:00:00.000Z")]), HOJE);
    expect(r.tom).toBe("vencido");
    expect(r.rotulo).toBe("19/10/2026");
    expect(r.prazo).toBe("há 3 dias");
    expect(r.vencidoTotal).toBe(100);
  });

  it("vence hoje e amanhã", () => {
    expect(resumirVencimento(compra([parcela("2026-10-22")]), HOJE)).toMatchObject({ tom: "hoje", prazo: "vence hoje" });
    expect(resumirVencimento(compra([parcela("2026-10-23")]), HOJE)).toMatchObject({ tom: "semana", prazo: "vence amanhã" });
  });

  it("usa o limite de 7 dias para separar semana de futuro", () => {
    expect(resumirVencimento(compra([parcela("2026-10-29")]), HOJE).tom).toBe("semana");
    expect(resumirVencimento(compra([parcela("2026-10-30")]), HOJE)).toMatchObject({ tom: "futuro", prazo: "em 8 dias" });
  });

  it("com várias parcelas, a mais atrasada manda e mostra quantas faltam", () => {
    const r = resumirVencimento(
      compra([
        parcela("2026-09-10", { status: "PAID", paidDate: "2026-09-10" }),
        parcela("2026-10-10"),
        parcela("2026-11-10")
      ]),
      HOJE
    );
    expect(r.tom).toBe("vencido");
    expect(r.data).toBe("2026-10-10");
    expect(r.parcelas).toBe("2 de 3 em aberto");
    expect(r.qtdVencidas).toBe(1);
    expect(r.abertoTotal).toBe(200);
    expect(r.pagoTotal).toBe(100);
  });

  it("compra toda paga mostra a última baixa", () => {
    const r = resumirVencimento(
      compra([
        parcela("2026-09-10", { status: "PAID", paidDate: "2026-09-12T00:00:00.000Z" }),
        parcela("2026-10-10", { status: "PAID_LATE", paidDate: "2026-10-15T00:00:00.000Z", paidAmount: "110" })
      ]),
      HOJE
    );
    expect(r).toMatchObject({ tom: "pago", data: "2026-10-15", prazo: "em 15/10/2026", parcelas: "2 parcelas pagas" });
    expect(r.pagoTotal).toBe(210);
    expect(r.qtdAbertas).toBe(0);
  });

  it("parcela em aberto sem data vira sem vencimento", () => {
    const r = resumirVencimento(compra([parcela(null)]), HOJE);
    expect(r.tom).toBe("sem");
    expect(r.qtdAbertas).toBe(1);
  });

  it("compra cancelada não tem vencimento", () => {
    expect(resumirVencimento(compra([parcela("2026-10-01")], { status: "CANCELLED" }), HOJE)).toMatchObject({ tom: "neutro", rotulo: "Cancelada" });
  });

  it("explica onde mora o vencimento quando não há parcela própria", () => {
    expect(resumirVencimento(compra([], { cycleStatus: "OPEN" }), HOJE).rotulo).toBe("No ciclo do fornecedor");
    expect(resumirVencimento(compra([], { creditCardId: "c1" }), HOJE).rotulo).toBe("Na fatura do cartão");
    expect(resumirVencimento(compra([], { reimbursementPayeeId: "r1" }), HOJE).rotulo).toBe("No reembolso");
    expect(resumirVencimento(compra([]), HOJE)).toMatchObject({ tom: "sem", rotulo: "Sem vencimento" });
  });

  it("ignora parcelas canceladas", () => {
    const r = resumirVencimento(compra([parcela("2026-10-01", { status: "CANCELLED" }), parcela("2026-11-30")]), HOJE);
    expect(r.tom).toBe("futuro");
    expect(r.parcelas).toBeNull();
  });
});

describe("pertenceFaixa e totalizar", () => {
  const vencida = resumirVencimento(compra([parcela("2026-10-01", { amount: "300" })]), HOJE);
  const semana = resumirVencimento(compra([parcela("2026-10-25", { amount: "50" })]), HOJE);
  const paga = resumirVencimento(compra([parcela("2026-10-01", { status: "PAID", paidDate: "2026-10-02", amount: "70" })]), HOJE);

  it("filtra por faixa", () => {
    expect(pertenceFaixa(vencida, "vencidas")).toBe(true);
    expect(pertenceFaixa(semana, "vencidas")).toBe(false);
    expect(pertenceFaixa(semana, "vence7")).toBe(true);
    expect(pertenceFaixa(paga, "pagas")).toBe(true);
    expect(pertenceFaixa(paga, "abertas")).toBe(false);
    expect(pertenceFaixa(vencida, "todas")).toBe(true);
  });

  it("soma os cartões sem contar compras canceladas", () => {
    const t = totalizar([
      { totalAmount: "300", vencimento: vencida },
      { totalAmount: "50", vencimento: semana },
      { totalAmount: "70", vencimento: paga },
      { totalAmount: "999", status: "CANCELLED", vencimento: vencida }
    ]);
    expect(t.quantidade).toBe(3);
    expect(t.total).toBe(420);
    expect(t.vencido).toEqual({ valor: 300, compras: 1 });
    expect(t.vence7).toEqual({ valor: 50, compras: 1 });
    expect(t.aberto).toEqual({ valor: 350, compras: 2 });
    expect(t.pago).toEqual({ valor: 70, compras: 1 });
  });
});
