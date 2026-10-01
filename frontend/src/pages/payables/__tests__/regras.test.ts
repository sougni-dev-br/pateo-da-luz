import { describe, expect, it } from "vitest";
import type { Payable } from "../../../api/client";
import {
  agruparPorVencimento, basePaymentName, combinaSubtipo, contarFiltrosAtivos, detalhesDoTitulo,
  diasEntre, favorecidoDoTitulo, formatInstallment, grupoDoTitulo, inferTotalInstallments,
  minDateKey, rotuloPeriodo, rotuloPrazo, seloDoTitulo, somarValores, type FiltrosPagar
} from "../regras";

const HOJE = "2026-10-01";

function titulo(over: Partial<Payable> = {}): Payable {
  return {
    id: over.id ?? "t1",
    purchaseId: "c1",
    dueDate: "2026-10-10T00:00:00.000Z",
    paidDate: null,
    amount: "100.00",
    paidAmount: null,
    installment: null,
    paymentMethodId: null,
    paymentMethodName: null,
    status: "OPEN",
    rawValue: null,
    supplierId: "f1",
    supplierName: "Fornecedor A",
    purchaseNumber: null,
    invoiceNumber: null,
    purchaseDate: null,
    notes: null,
    sourceType: "DIRECT",
    ...over
  };
}

const FILTROS_VAZIOS: FiltrosPagar = { filter: "", supplierId: "", paymentMethodId: "", status: "", sourceType: "", origin: "all", noDueDate: false };

describe("combinaSubtipo", () => {
  it("filtra só o tipo da Folha pedido no sub-tipo PAYROLL:<tipo>", () => {
    const vt = titulo({ sourceType: "PAYROLL", taxDocumentType: "Vale-transporte" });
    const salario = titulo({ sourceType: "PAYROLL", taxDocumentType: "Salário" });
    expect(combinaSubtipo(vt, "PAYROLL:Vale-transporte")).toBe(true);
    expect(combinaSubtipo(salario, "PAYROLL:Vale-transporte")).toBe(false);
  });

  it("PAYROLL sem tipo pega toda a Folha e nada de compra", () => {
    expect(combinaSubtipo(titulo({ sourceType: "PAYROLL", taxDocumentType: "Férias" }), "PAYROLL")).toBe(true);
    expect(combinaSubtipo(titulo({ sourceType: "DIRECT" }), "PAYROLL")).toBe(false);
  });
});

describe("parcelas e formas", () => {
  it("infere o total de parcelas pelo nome da forma", () => {
    expect(inferTotalInstallments("BOLETO / 3x")).toBe(3);
    expect(inferTotalInstallments("PIX")).toBe(1);
    expect(inferTotalInstallments(null)).toBe(1);
  });

  it("o denominador nunca fica menor que o numerador", () => {
    expect(formatInstallment(4, 2, null)).toBe("4/4");
    expect(formatInstallment(1, null, "BOLETO 2X")).toBe("1/2");
    expect(formatInstallment(null)).toBe("");
  });

  it("basePaymentName tira o sufixo de parcelas", () => {
    expect(basePaymentName(" boleto 2x ")).toBe("BOLETO");
  });
});

describe("datas", () => {
  it("minDateKey sugere o vencimento quando já passou e hoje quando está por vir", () => {
    expect(minDateKey("2026-09-20", HOJE)).toBe("2026-09-20");
    expect(minDateKey("2026-10-20", HOJE)).toBe(HOJE);
    expect(minDateKey("", HOJE)).toBe(HOJE);
  });

  it("diasEntre atravessa a virada do mês sem fuso", () => {
    expect(diasEntre("2026-09-30", "2026-10-01")).toBe(1);
    expect(diasEntre(HOJE, "2026-09-28")).toBe(-3);
  });

  it("rotuloPrazo fala o prazo em palavras", () => {
    expect(rotuloPrazo("2026-09-28", HOJE)).toBe("venceu há 3 dias");
    expect(rotuloPrazo("2026-09-30", HOJE)).toBe("venceu ontem");
    expect(rotuloPrazo(HOJE, HOJE)).toBe("vence hoje");
    expect(rotuloPrazo("2026-10-02", HOJE)).toBe("vence amanhã");
    expect(rotuloPrazo("2026-10-06", HOJE)).toBe("em 5 dias");
    expect(rotuloPrazo("", HOJE)).toBe("sem vencimento");
  });
});

describe("grupoDoTitulo", () => {
  it("classifica pelo vencimento os títulos em aberto", () => {
    expect(grupoDoTitulo(titulo({ dueDate: "2026-09-10", status: "OVERDUE" }), HOJE)).toBe("vencidos");
    expect(grupoDoTitulo(titulo({ dueDate: HOJE }), HOJE)).toBe("hoje");
    expect(grupoDoTitulo(titulo({ dueDate: "2026-10-08" }), HOJE)).toBe("proximos7");
    expect(grupoDoTitulo(titulo({ dueDate: "2026-10-09" }), HOJE)).toBe("depois");
    expect(grupoDoTitulo(titulo({ dueDate: null }), HOJE)).toBe("semVencimento");
  });

  it("pago e cancelado têm grupo próprio, mesmo vencidos", () => {
    expect(grupoDoTitulo(titulo({ dueDate: "2026-09-01", status: "PAID_LATE" }), HOJE)).toBe("pagos");
    expect(grupoDoTitulo(titulo({ dueDate: "2026-09-01", status: "CANCELLED" }), HOJE)).toBe("cancelados");
  });
});

describe("agruparPorVencimento", () => {
  it("ordena os grupos do mais urgente ao baixado e soma cada um", () => {
    const rows = [
      titulo({ id: "a", dueDate: "2026-11-01", amount: "10" }),
      titulo({ id: "b", dueDate: "2026-09-01", amount: "20.10", status: "OVERDUE" }),
      titulo({ id: "c", dueDate: "2026-08-01", amount: "5.20", status: "OVERDUE" }),
      titulo({ id: "d", status: "PAID", paidDate: "2026-09-02", amount: "7" }),
      titulo({ id: "e", status: "PAID", paidDate: "2026-09-20", amount: "3" })
    ];
    const grupos = agruparPorVencimento(rows, HOJE);
    expect(grupos.map((g) => g.chave)).toEqual(["vencidos", "depois", "pagos"]);
    expect(grupos[0].titulos.map((t) => t.id)).toEqual(["c", "b"]);
    expect(grupos[0].total).toBe(25.3);
    // Baixados: o pagamento mais recente primeiro.
    expect(grupos[2].titulos.map((t) => t.id)).toEqual(["e", "d"]);
  });

  it("não devolve grupo vazio nem mexe na lista recebida", () => {
    const rows = [titulo({ id: "z", dueDate: HOJE })];
    const copia = [...rows];
    expect(agruparPorVencimento([], HOJE)).toEqual([]);
    agruparPorVencimento(rows, HOJE);
    expect(rows).toEqual(copia);
  });
});

describe("somarValores", () => {
  it("ignora valor nulo ou inválido e arredonda centavos", () => {
    expect(somarValores([titulo({ amount: "0.1" }), titulo({ amount: "0.2" }), titulo({ amount: null }), titulo({ amount: "abc" })])).toBe(0.3);
  });
});

describe("apresentação da linha", () => {
  it("imposto mostra a guia como favorecido e a empresa no detalhe", () => {
    const guia = titulo({ sourceType: "TAX_PAYMENT", supplierName: "x", taxDocumentType: "DARF", taxCompanyName: "Pateo", taxCompetenceDate: "2026-09-01" });
    expect(favorecidoDoTitulo(guia)).toBe("DARF");
    expect(detalhesDoTitulo(guia)).toEqual(["Pateo", "Comp. 09/2026"]);
    expect(seloDoTitulo(guia)).toEqual({ rotulo: "Imposto", tom: "imposto" });
  });

  it("compra lista NF, pedido, parcela e forma; sem NF avisa", () => {
    const comNf = titulo({ invoiceNumber: "123", purchaseNumber: "CMP-1", installment: 1, totalInstallments: 2, paymentMethodName: "BOLETO" });
    expect(detalhesDoTitulo(comNf)).toEqual(["NF 123", "Ped. CMP-1", "Parc. 1/2", "BOLETO"]);
    expect(detalhesDoTitulo(titulo())[0]).toBe("Sem NF");
    expect(seloDoTitulo(titulo())).toBeNull();
  });

  it("folha não diz 'Sem NF' e o selo traz o tipo", () => {
    const vt = titulo({ sourceType: "PAYROLL", taxDocumentType: "Vale-transporte", taxDescription: "1ª quinzena" });
    expect(detalhesDoTitulo(vt)).toEqual(["1ª quinzena"]);
    expect(seloDoTitulo(vt)?.rotulo).toBe("Folha · Vale-transporte");
  });
});

describe("contarFiltrosAtivos", () => {
  it("conta os filtros do painel e o atalho Sem vencimento", () => {
    expect(contarFiltrosAtivos(FILTROS_VAZIOS, null)).toBe(0);
    expect(contarFiltrosAtivos({ ...FILTROS_VAZIOS, supplierId: "f1", origin: "taxes" }, null)).toBe(2);
    expect(contarFiltrosAtivos(FILTROS_VAZIOS, "noduedate")).toBe(1);
    expect(contarFiltrosAtivos(FILTROS_VAZIOS, "boleto")).toBe(0);
  });
});

describe("rotuloPeriodo", () => {
  it("traduz o preset e cai num rótulo genérico", () => {
    expect(rotuloPeriodo("currentMonth")).toBe("Mês atual");
    expect(rotuloPeriodo("???")).toBe("Período");
  });
});
