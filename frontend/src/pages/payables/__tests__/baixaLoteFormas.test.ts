import { describe, expect, test } from "vitest";
import type { Payable } from "../../../api/client";
import { empresaDaBaixaNoLote, formaDaBaixaNoLote, formaPrevistaDoTitulo, payloadDaForma } from "../regras";

// Dados fictícios.
const METODOS = [
  { id: "m-boleto", name: "BOLETO" },
  { id: "m-boleto-2x", name: "BOLETO 2X" },
  { id: "m-pix", name: "PIX" },
];
const FORMAS = [{ id: "m-boleto", label: "BOLETO" }, { id: "m-pix", label: "PIX" }];
const t = (paymentMethodId: string | null, paymentMethodName: string | null = null) =>
  ({ id: "x", paymentMethodId, paymentMethodName }) as unknown as Payable;

describe("forma prevista do título", () => {
  test("casa pelo id da forma de origem", () => {
    expect(formaPrevistaDoTitulo(t("m-pix"), METODOS, FORMAS)).toBe("id:m-pix");
  });
  test("forma parcelada vira a forma base que o select oferece", () => {
    expect(formaPrevistaDoTitulo(t("m-boleto-2x"), METODOS, FORMAS)).toBe("id:m-boleto");
  });
  test("sem id conhecido, cai no nome (inclusive com parcelas)", () => {
    expect(formaPrevistaDoTitulo(t("sumiu", "pix"), METODOS, FORMAS)).toBe("id:m-pix");
    expect(formaPrevistaDoTitulo(t(null, "BOLETO 3X"), METODOS, FORMAS)).toBe("id:m-boleto");
    expect(formaPrevistaDoTitulo(t(null, "PIX / 1x"), METODOS, FORMAS)).toBe("id:m-pix");
  });
  test("folha, extras e lote da folha: PIX, como é paga a folha", () => {
    for (const sourceType of ["PAYROLL", "EXTRA", "FOLHA_LOTE"]) {
      expect(formaPrevistaDoTitulo({ ...t(null), sourceType } as Payable, METODOS, FORMAS)).toBe("id:m-pix");
    }
  });
  test("compra sem forma não vira PIX", () => {
    expect(formaPrevistaDoTitulo({ ...t(null), sourceType: "DIRECT" } as Payable, METODOS, FORMAS)).toBe("");
  });
  test("sem forma ou forma que não existe mais: vazio", () => {
    expect(formaPrevistaDoTitulo(t(null), METODOS, FORMAS)).toBe("");
    expect(formaPrevistaDoTitulo(t(null, "CHEQUE"), METODOS, FORMAS)).toBe("");
  });
});

describe("forma da baixa no lote", () => {
  test("com a opção, usa a prevista; sem prevista, a forma única", () => {
    expect(formaDaBaixaNoLote(true, "id:m-pix", "id:m-boleto")).toBe("id:m-pix");
    expect(formaDaBaixaNoLote(true, "", "id:m-boleto")).toBe("id:m-boleto");
  });
  test("sem a opção, sempre a forma única", () => {
    expect(formaDaBaixaNoLote(false, "id:m-pix", "id:m-boleto")).toBe("id:m-boleto");
  });
});

describe("payload da forma", () => {
  test("id vai como id; nome vai como nome", () => {
    expect(payloadDaForma("id:m-pix")).toEqual({ paidPaymentMethodId: "m-pix", paidPaymentMethodName: null });
    expect(payloadDaForma("name:DINHEIRO")).toEqual({ paidPaymentMethodId: null, paidPaymentMethodName: "DINHEIRO" });
  });
});

describe("empresa pagadora no lote", () => {
  test("com a opção, a empresa do lançamento; sem ela, a empresa única", () => {
    expect(empresaDaBaixaNoLote(true, "emp2", "emp1")).toBe("emp2");
    expect(empresaDaBaixaNoLote(true, null, "emp1")).toBe("emp1");
    expect(empresaDaBaixaNoLote(true, undefined, "")).toBe("");
  });
  test("sem a opção, sempre a empresa única", () => {
    expect(empresaDaBaixaNoLote(false, "emp2", "emp1")).toBe("emp1");
  });
});
