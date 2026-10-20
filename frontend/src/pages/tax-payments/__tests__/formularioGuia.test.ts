import { describe, expect, test } from "vitest";
import type { TaxPaymentDetail } from "../../../api/client";
import { FORM_VAZIO, formDaGuia, formDuplicado, mesSugerido, payloadDaGuia, validarGuia, type FormGuia } from "../formularioGuia";

const hoje = "2026-10-20";
const completo: FormGuia = {
  ...FORM_VAZIO, documentType: "FGTS", mes: "2026-09", dueDate: "2026-10-07", amount: "1.980,00",
};

describe("validarGuia", () => {
  test("guia completa não tem erro", () => {
    expect(validarGuia(completo, false, hoje)).toEqual({});
  });

  test("exige tipo, competência, vencimento e valor", () => {
    const erros = validarGuia(FORM_VAZIO, false, hoje);
    expect(Object.keys(erros).sort()).toEqual(["amount", "documentType", "dueDate", "mes"]);
    expect(erros.mes).toMatch(/fora do DRE/);
  });

  test("guia cancelada dispensa a competência", () => {
    expect(validarGuia({ ...completo, mes: "", cancelada: true }, true, hoje).mes).toBeUndefined();
  });

  test("já paga exige data, que não pode ser futura", () => {
    expect(validarGuia({ ...completo, jaPaga: true }, false, hoje).paymentDate).toMatch(/Informe/);
    expect(validarGuia({ ...completo, jaPaga: true, paymentDate: "2026-10-21" }, false, hoje).paymentDate).toMatch(/futura/);
    expect(validarGuia({ ...completo, jaPaga: true, paymentDate: "2026-10-10" }, false, hoje)).toEqual({});
  });

  test("na edição o pagamento não é validado (é somente leitura)", () => {
    expect(validarGuia({ ...completo, jaPaga: true, paymentDate: "" }, true, hoje)).toEqual({});
  });
});

describe("payloadDaGuia", () => {
  test("criação: competência no dia 1, valor numérico, sem status", () => {
    const p = payloadDaGuia(completo, false, false) as Record<string, unknown>;
    expect(p.competenceDate).toBe("2026-09-01");
    expect(p.amount).toBe("1980");
    expect(p.status).toBeUndefined();
    expect(p.paymentDate).toBeNull();
  });

  test("criação já paga: valor pago assume o da guia quando não informado", () => {
    const p = payloadDaGuia({ ...completo, jaPaga: true, paymentDate: "2026-10-05" }, false, false) as Record<string, unknown>;
    expect(p.paymentDate).toBe("2026-10-05");
    expect(p.paidAmount).toBe("1980");
  });

  test("edição: só ativa/cancelada, nunca o pagamento", () => {
    const p = payloadDaGuia({ ...completo, jaPaga: true, paymentDate: "2026-10-05" }, true, false) as Record<string, unknown>;
    expect(p.status).toBe("PENDING");
    expect("paymentDate" in p).toBe(false);
    expect("paidAmount" in p).toBe(false);
    expect((payloadDaGuia({ ...completo, cancelada: true }, true, false) as Record<string, unknown>).status).toBe("CANCELED");
  });

  test("categoria: sem escolha vai undefined (servidor sugere); escolhida vazia vai null", () => {
    expect((payloadDaGuia(completo, false, false) as Record<string, unknown>).dreCategoryId).toBeUndefined();
    expect((payloadDaGuia(completo, false, true) as Record<string, unknown>).dreCategoryId).toBeNull();
    expect((payloadDaGuia({ ...completo, dreCategoryId: "c1" }, false, true) as Record<string, unknown>).dreCategoryId).toBe("c1");
  });
});

describe("formDaGuia e duplicar", () => {
  const detalhe = {
    documentType: "GPS / INSS", competenceDate: "2026-09-01T00:00:00.000Z", dueDate: "2026-10-20T00:00:00.000Z", amount: "2100.00",
    companyId: null, cnpj: "00000000000100", legalName: "Empresa Exemplo Ltda", tradeName: null, description: "GPS", dreCategoryId: "c1",
    paymentDate: "2026-10-19T00:00:00.000Z", paidAmount: "2100.00", comments: null, status: "PAID",
  } as unknown as TaxPaymentDetail;

  test("lê a guia para o formulário sem deslocar o dia", () => {
    const f = formDaGuia(detalhe);
    expect(f.mes).toBe("2026-09");
    expect(f.dueDate).toBe("2026-10-20");
    expect(f.amount).toBe("2.100,00");
    expect(f.jaPaga).toBe(true);
  });

  test("duplicar limpa o que muda a cada mês e o pagamento", () => {
    const f = formDuplicado(detalhe);
    expect(f).toMatchObject({ mes: "", dueDate: "", jaPaga: false, paymentDate: "", paidAmount: "", cancelada: false });
    expect(f.documentType).toBe("GPS / INSS");
    expect(f.dreCategoryId).toBe("c1");
  });
});

describe("mesSugerido", () => {
  test("mês anterior ao vencimento, só para tipos que seguem a regra", () => {
    expect(mesSugerido("FGTS", "2026-10-07")).toBe("2026-09");
    expect(mesSugerido("IPTU", "2026-10-07")).toBe("");
    expect(mesSugerido("FGTS", "")).toBe("");
  });
});
