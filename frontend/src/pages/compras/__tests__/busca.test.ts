import { describe, expect, it } from "vitest";
import { combinaBusca, combinaForma, parseValor } from "../busca";

type Compra = Parameters<typeof combinaBusca>[0];

const compra = {
  invoiceNumber: "9013",
  purchaseNumber: null,
  purchaseOrderNumber: "PC-77",
  rawSupplierCode: "001212",
  paymentMethod: "BOLETO",
  supplier: { name: "Condomínio do Shopping", document: "11.384.227/0001-02", externalCode: "C1" },
  items: [{ rawProductCode: "001212", rawProductName: "Condomínio" }],
  totalAmount: "13092.94",
  installments: [{ paymentMethodName: "Boleto 30 dias", amount: "6546.47" }, { paymentMethodName: "Boleto 30 dias", amount: "6546.47" }]
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

describe("parseValor", () => {
  it.each([
    ["13092,94", 13092.94],
    ["13.092,94", 13092.94],
    ["13092.94", 13092.94],
    ["1.234", 1234],
    ["1.234.567,89", 1234567.89],
    ["509", 509],
    ["509,", 509],
    ["R$509,00", 509],
    ["r$ 509,00", 509]
  ])("%s vira %s", (entrada, esperado) => {
    expect(parseValor(entrada)).toBe(esperado);
  });

  it.each(["abc", "12a", "1,2,3", "", "r$"])("%j não é valor", (entrada) => {
    expect(parseValor(entrada)).toBeNull();
  });
});

describe("combinaBusca por valor", () => {
  it("acha o total da compra em qualquer formato digitado", () => {
    for (const termo of ["13092,94", "13.092,94", "13092.94", "R$ 13.092,94", "r$13092,94"]) {
      expect(combinaBusca(compra, termo), termo).toBe(true);
    }
  });

  it("acha o valor de uma parcela", () => {
    expect(combinaBusca(compra, "6546,47")).toBe(true);
    expect(combinaBusca(compra, "6.546,47")).toBe(true);
  });

  it("trecho de valor com vírgula ou 4+ dígitos casa; número curto só casa se for exato", () => {
    expect(combinaBusca(compra, "13092,9")).toBe(true);
    expect(combinaBusca(compra, "1309")).toBe(true);
    expect(combinaBusca(compra, "130")).toBe(false);
    expect(combinaBusca(compra, "13092,95")).toBe(false);
  });

  it("valor exato inteiro casa com total redondo", () => {
    const redonda = { ...compra, totalAmount: "509.00", installments: [] } as unknown as Compra;
    expect(combinaBusca(redonda, "509")).toBe(true);
    expect(combinaBusca(redonda, "509,00")).toBe(true);
    expect(combinaBusca(redonda, "510")).toBe(false);
  });

  it("combina valor com texto: todas as palavras ainda são exigidas", () => {
    expect(combinaBusca(compra, "shopping 13092,94")).toBe(true);
    expect(combinaBusca(compra, "shopping 99999,00")).toBe(false);
  });

  it("busca só com R$ não filtra nada", () => {
    expect(combinaBusca(compra, "R$")).toBe(true);
  });
});
