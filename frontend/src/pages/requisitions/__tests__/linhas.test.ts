import { beforeEach, describe, expect, test } from "vitest";
import { resumirLinhas, situacaoDaLinha, unidadesDaLinha, type LinhaDaRequisicao } from "../linhas";
import { apagarRascunho, lerRascunho, salvarRascunho } from "../rascunho";

const linha = (extra: Partial<LinhaDaRequisicao> = {}): LinhaDaRequisicao => ({
  productId: "p1", productName: "FARINHA", productCode: "10", stockUnit: "KG", conversions: [], unit: "KG", quantity: "2", ...extra
});

describe("situacaoDaLinha", () => {
  test("converte g para a unidade do estoque antes de comparar com o saldo", () => {
    const s = situacaoDaLinha(linha({ unit: "G", quantity: "500" }), 3);
    expect(s).toEqual({ tipo: "OK", emEstoque: 0.5, saldo: 3, ficaCom: 2.5 });
  });

  test("500 kg de um item com 3 kg de saldo falta 497", () => {
    const s = situacaoDaLinha(linha({ quantity: "500" }), 3);
    expect(s).toEqual({ tipo: "FALTA", emEstoque: 500, saldo: 3, falta: 497 });
  });

  test("item sem registro de saldo conta como zero, como o servidor", () => {
    expect(situacaoDaLinha(linha(), undefined)).toMatchObject({ tipo: "FALTA", saldo: 0 });
  });

  test("unidade que o produto não converte fica sem conversão", () => {
    expect(situacaoDaLinha(linha({ unit: "CX" }), 10)).toEqual({ tipo: "SEM_CONVERSAO" });
  });

  test("usa a conversão cadastrada do produto", () => {
    const s = situacaoDaLinha(linha({ stockUnit: "UN", unit: "CX", quantity: "1", conversions: [{ fromUnit: "CX", toUnit: "UN", factor: 12 }] }), 20);
    expect(s).toMatchObject({ tipo: "OK", emEstoque: 12, ficaCom: 8 });
  });

  test("aceita vírgula decimal e ignora quantidade vazia", () => {
    expect(situacaoDaLinha(linha({ quantity: "0,5" }), 1)).toMatchObject({ tipo: "OK", emEstoque: 0.5 });
    expect(situacaoDaLinha(linha({ quantity: "" }), 1)).toEqual({ tipo: "VAZIA" });
  });

  test("produto sem unidade cadastrada vale como digitado", () => {
    expect(situacaoDaLinha(linha({ stockUnit: null, unit: "UN", quantity: "2" }), 5)).toMatchObject({ tipo: "OK", ficaCom: 3 });
  });
});

describe("unidadesDaLinha e resumirLinhas", () => {
  test("a unidade do estoque vem primeiro e g/kg se oferecem juntos", () => {
    const unidades = unidadesDaLinha(linha());
    expect(unidades[0]).toBe("KG");
    expect(unidades).toContain("G");
  });

  test("separa o que falta saldo, o que não converte e o que está sem quantidade", () => {
    const saldos = new Map([["a", 1], ["b", 10]]);
    const r = resumirLinhas([
      linha({ productId: "a", quantity: "5" }),
      linha({ productId: "b", unit: "CX" }),
      linha({ productId: "c", quantity: "" })
    ], saldos);
    expect(r.semSaldo.map((l) => l.productId)).toEqual(["a"]);
    expect(r.semConversao.map((l) => l.productId)).toEqual(["b"]);
    expect(r.semQuantidade).toBe(1);
    expect(r.comQuantidade).toBe(2);
  });
});

describe("rascunho", () => {
  beforeEach(() => localStorage.clear());
  const cabecalho = { date: "2026-10-15", shift: "MORNING", reason: "DAILY_PRODUCTION", reasonNotes: "", sectorId: "", notes: "" };

  test("salva e recupera por usuário", () => {
    salvarRascunho("u1", { cabecalho, linhas: [linha()], deFora: [] });
    expect(lerRascunho("u1")?.linhas).toHaveLength(1);
    expect(lerRascunho("u2")).toBeNull();
  });

  test("sem linhas não deixa rascunho", () => {
    salvarRascunho("u1", { cabecalho, linhas: [linha()], deFora: [] });
    salvarRascunho("u1", { cabecalho, linhas: [], deFora: [] });
    expect(lerRascunho("u1")).toBeNull();
  });

  test("descarta dado corrompido sem quebrar", () => {
    localStorage.setItem("pateo:requisicao-rascunho:v1:u1", "{lixo");
    expect(lerRascunho("u1")).toBeNull();
    apagarRascunho("u1");
  });
});
