import { describe, expect, test } from "vitest";
import type { ItemDaConferencia } from "../../../api/client";
import { filtrarConferencia, produtosParecidos, progressoDaConferencia, resumirItens } from "../conferencia-ajuda";

function item(p: Partial<ItemDaConferencia>): ItemDaConferencia {
  return {
    itemId: "i", productId: "p", productCode: null, productName: "X", sectorName: "ESTOQUE", unit: "UN",
    contado: 1, contadoPor: null, contadoEm: null, anterior: 1, anteriorData: null, anteriorCodigo: null,
    compras: 0, disponivel: 1, consumo: 0, custoUnitario: 1, custoFonte: "COMPRAS_DO_PERIODO", custoDetalhe: null, impacto: 10, classe: "COERENTE", motivo: "", conferido: null, recontagemId: null, ...p
  };
}

describe("produtosParecidos", () => {
  // Casos reais de setembro/2026: zerou um, contou o vizinho.
  const todos = [
    item({ itemId: "coca2lz", productName: "COCA COLA 2 L ZERO", contado: 0, classe: "ZERADO_SUSPEITO" }),
    item({ itemId: "coca2l", productName: "COCA COLA 2 L", contado: 1 }),
    item({ itemId: "coca350", productName: "COCA COLA ZERO 350ML", contado: 287 }),
    item({ itemId: "minalbaCg", productName: "MINALBA AGUA 1,5 C/GAS", contado: 0, classe: "ZERADO_SUSPEITO" }),
    item({ itemId: "minalbaSg", productName: "MINALBA AGUA 1,5 SEM GAS", contado: 12 }),
    item({ itemId: "randon", productName: "VINHO TINTO SECO RANDON 4,6 LITROS", contado: 0, classe: "ZERADO_SUSPEITO" }),
    item({ itemId: "felicien", productName: "VINHO TINTO MALBEC SAINT FELICIEN", contado: 7 }),
    item({ itemId: "zerado", productName: "COCA COLA 600ML", contado: 0 })
  ];

  test("acha o vizinho contado com o nome parecido, o mais parecido primeiro", () => {
    expect(produtosParecidos(todos[0], todos).map((i) => i.itemId)).toEqual(["coca2l", "coca350"]);
    expect(produtosParecidos(todos[3], todos).map((i) => i.itemId)).toEqual(["minalbaSg"]);
  });

  test("palavra de categoria nao basta: dois vinhos tintos diferentes nao sao parecidos", () => {
    expect(produtosParecidos(todos[5], todos)).toEqual([]);
  });

  test("tamanho igual nao torna parecido: farinha de trigo 1kg nao e farinha de milho 1kg", () => {
    const trigo = item({ itemId: "t", productName: "FARINHA DE TRIGO 1KG", contado: 0, classe: "ZERADO_SUSPEITO" });
    const milho = item({ itemId: "m", productName: "FARINHA DE MILHO 1KG", contado: 4 });
    expect(produtosParecidos(trigo, [trigo, milho])).toEqual([]);
  });

  test("ignora o que tambem foi zerado", () => {
    expect(produtosParecidos(todos[0], todos).some((i) => i.itemId === "zerado")).toBe(false);
  });
});

describe("filtrarConferencia", () => {
  const itens = [
    item({ itemId: "a", sectorName: "CAMARA FRIA", impacto: 600 }),
    item({ itemId: "b", sectorName: "CAMARA FRIA", impacto: 20 }),
    item({ itemId: "c", sectorName: "BAR", impacto: null }),
    item({ itemId: "d", sectorName: null, impacto: 900 })
  ];

  test("por setor", () => {
    expect(filtrarConferencia(itens, { setor: "CAMARA FRIA", valorMinimo: 0 }).map((i) => i.itemId)).toEqual(["a", "b"]);
  });

  test("valor minimo mantem os sem custo: nao da para saber se pesam", () => {
    expect(filtrarConferencia(itens, { setor: "", valorMinimo: 50 }).map((i) => i.itemId)).toEqual(["a", "c", "d"]);
  });

  test("item sem setor entra como 'Sem setor'", () => {
    expect(filtrarConferencia(itens, { setor: "Sem setor", valorMinimo: 0 }).map((i) => i.itemId)).toEqual(["d"]);
  });
});

describe("progresso e situacao da conferencia", () => {
  const conferido = (motivo: "CORRETO" | "RECONTAR") => ({ motivo, observacao: null, em: null, por: null });
  const itens = [
    item({ itemId: "a", classe: "IMPOSSIVEL", impacto: 100, conferido: conferido("CORRETO") }),
    item({ itemId: "b", classe: "ZERADO_SUSPEITO", impacto: 100, conferido: conferido("RECONTAR") }),
    item({ itemId: "c", classe: "ZERADO_SUSPEITO", impacto: null }),
    item({ itemId: "d", classe: "ZERADO_SUSPEITO", impacto: 10 }),
    item({ itemId: "e", classe: "COERENTE", impacto: 999 })
  ];

  test("so conta o que exige conferencia; recontar nao e conferido", () => {
    expect(progressoDaConferencia(itens, 50)).toEqual({ exigidos: 3, conferidos: 1 });
  });

  test("faltam conferir: exige e ainda nao foi visto", () => {
    expect(filtrarConferencia(itens, { setor: "", valorMinimo: 0, situacao: "faltam", limite: 50 }).map((i) => i.itemId)).toEqual(["b", "c"]);
  });

  test("conferidos", () => {
    expect(filtrarConferencia(itens, { setor: "", valorMinimo: 0, situacao: "conferidos", limite: 50 }).map((i) => i.itemId)).toEqual(["a"]);
  });
});

describe("resumirItens", () => {
  test("conta e soma por classe, todas presentes", () => {
    const r = resumirItens([item({ classe: "IMPOSSIVEL", impacto: 5 }), item({ classe: "IMPOSSIVEL", impacto: null })]);
    expect(r.IMPOSSIVEL).toEqual({ itens: 2, impacto: 5 });
    expect(r.COERENTE).toEqual({ itens: 0, impacto: 0 });
  });
});
