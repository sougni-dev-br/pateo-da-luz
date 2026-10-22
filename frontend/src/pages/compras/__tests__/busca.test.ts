import { describe, expect, it } from "vitest";
import { combinaBusca, combinaForma } from "../busca";

type Compra = Parameters<typeof combinaBusca>[0];

const compra = {
  invoiceNumber: "9013",
  purchaseNumber: null,
  purchaseOrderNumber: "PC-77",
  rawSupplierCode: "001212",
  paymentMethod: "BOLETO",
  supplier: { name: "Condomínio do Shopping", document: "11.384.227/0001-02", externalCode: "C1" },
  items: [{ rawProductCode: "001212", rawProductName: "Condomínio" }],
  installments: [{ paymentMethodName: "Boleto 30 dias" }]
} as unknown as Compra;

describe("combinaBusca", () => {
  it("encontra por NF, pedido, fornecedor, CNPJ e produto, sem acento nem caixa", () => {
    for (const termo of ["9013", "pc-77", "condominio", "0001-02", "shopping"]) {
      expect(combinaBusca(compra, termo)).toBe(true);
    }
  });

  it("exige todas as palavras, em qualquer ordem", () => {
    expect(combinaBusca(compra, "shopping 9013")).toBe(true);
    expect(combinaBusca(compra, "shopping 9999")).toBe(false);
  });

  it("busca vazia deixa tudo passar", () => {
    expect(combinaBusca(compra, "   ")).toBe(true);
  });
});

describe("combinaForma", () => {
  it("casa por trecho, na forma da compra ou da parcela", () => {
    expect(combinaForma(compra, "bolet")).toBe(true);
    expect(combinaForma(compra, "30 dias")).toBe(true);
    expect(combinaForma(compra, "pix")).toBe(false);
    expect(combinaForma(compra, "")).toBe(true);
  });
});
