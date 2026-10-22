import { describe, expect, it } from "vitest";
import { buscarLinhas, filtrarLinhas, rotuloDoFinal, tipoDoFinal, transicaoDeSelecao } from "../cartoes-vinculados";

const finais = [
  { id: "f1", label: "Físico", last4Digits: "1111", kind: "PHYSICAL" },
  { id: "f2", label: "Virtual", last4Digits: "2222", kind: "VIRTUAL" }
];
const linhas = [
  { id: "a", cardFinalId: "f1" },
  { id: "b", cardFinalId: "f2" },
  { id: "c", cardFinalId: null },
  { id: "d", cardFinalId: "f2" }
];

describe("filtrarLinhas", () => {
  it("todos devolve tudo", () => {
    expect(filtrarLinhas(linhas, "todos").map((l) => l.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("sem devolve só as sem cartão definido", () => {
    expect(filtrarLinhas(linhas, "sem").map((l) => l.id)).toEqual(["c"]);
  });
  it("um final devolve só as dele", () => {
    expect(filtrarLinhas(linhas, "f2").map((l) => l.id)).toEqual(["b", "d"]);
  });
});

describe("rotulos", () => {
  it("monta o rótulo com o final", () => {
    expect(rotuloDoFinal(finais[0])).toBe("Físico ·· 1111");
  });
  it("traduz o tipo", () => {
    expect(tipoDoFinal("PHYSICAL")).toBe("Físico");
    expect(tipoDoFinal("VIRTUAL")).toBe("Virtual");
  });
});

describe("transicaoDeSelecao", () => {
  it("marca e desmarca um id sem mutar o conjunto original", () => {
    const base = new Set(["a"]);
    const com = transicaoDeSelecao(base, ["b"], true);
    expect([...com]).toEqual(["a", "b"]);
    expect([...base]).toEqual(["a"]);
    expect([...transicaoDeSelecao(com, ["a"], false)]).toEqual(["b"]);
  });
  it("seleciona vários de uma vez (marcar todos os filtrados)", () => {
    expect([...transicaoDeSelecao(new Set(), ["a", "b", "c"], true)]).toEqual(["a", "b", "c"]);
  });
});

describe("buscarLinhas", () => {
  const itens = [
    { cardFinalId: null, description: "Compra de verduras", supplierName: "Hortifruti Exemplo", value: "320.00" },
    { cardFinalId: null, description: "Bebidas", supplierName: null, value: "1250.50" }
  ];
  it("sem texto devolve tudo", () => {
    expect(buscarLinhas(itens, "  ")).toHaveLength(2);
  });
  it("acha por descrição ou fornecedor, sem acento nem caixa", () => {
    expect(buscarLinhas(itens, "VERDURAS")).toHaveLength(1);
    expect(buscarLinhas(itens, "hortifruti")).toHaveLength(1);
  });
  it("acha pelo valor como aparece na tela ou como número", () => {
    expect(buscarLinhas(itens, "1.250,50")).toHaveLength(1);
    expect(buscarLinhas(itens, "320,00")).toHaveLength(1);
    expect(buscarLinhas(itens, "320")).toHaveLength(1);
  });
});
