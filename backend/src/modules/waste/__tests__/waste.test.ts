import { describe, expect, test } from "vitest";
import { WASTE_REASONS, calcularValor, converterQuantidade, exigeObservacao, resumirDesperdicio, validarLancamento, type LinhaDeDesperdicio } from "../waste.js";

const HOJE = "2026-10-14";

describe("validarLancamento", () => {
  const base = { productId: "p1", quantity: "2,5", reason: "EXPIRED", occurredOn: "2026-10-13", notes: "" };

  test("aceita vírgula decimal e normaliza a observação vazia", () => {
    const r = validarLancamento(base, HOJE);
    expect(r).toMatchObject({ ok: true, valor: { productId: "p1", quantity: 2.5, reason: "EXPIRED", notes: null } });
  });

  test.each([["0"], ["-1"], ["abc"], [""], ["1e9"], ["0,00001"], ["1,23456"], ["1.500"], ["12.345"]])("rejeita quantidade %s", (quantity) => {
    const r = validarLancamento({ ...base, quantity }, HOJE);
    expect(r.ok).toBe(false);
  });

  test("'1.500' é ambíguo (mil e quinhentos ou um e meio?): pede vírgula em vez de adivinhar", () => {
    expect(validarLancamento({ ...base, quantity: "1.500" }, HOJE)).toMatchObject({ ok: false, erro: expect.stringMatching(/vírgula/i) });
    // Ponto com 1, 2 ou 4 casas continua sendo decimal; vírgula com 3 casas também.
    expect(validarLancamento({ ...base, quantity: "2.5" }, HOJE)).toMatchObject({ ok: true, valor: { quantity: 2.5 } });
    expect(validarLancamento({ ...base, quantity: "1,500" }, HOJE)).toMatchObject({ ok: true, valor: { quantity: 1.5 } });
  });

  test("rejeita motivo desconhecido", () => {
    const r = validarLancamento({ ...base, reason: "ROUBO" }, HOJE);
    expect(r).toMatchObject({ ok: false, erro: expect.stringMatching(/motivo/i) });
  });

  test("OUTRO exige observação; os demais não", () => {
    expect(exigeObservacao("OTHER")).toBe(true);
    expect(exigeObservacao("EXPIRED")).toBe(false);
    expect(validarLancamento({ ...base, reason: "OTHER" }, HOJE)).toMatchObject({ ok: false, erro: expect.stringMatching(/observa/i) });
    expect(validarLancamento({ ...base, reason: "OTHER", notes: "caiu no chão" }, HOJE).ok).toBe(true);
  });

  test("rejeita data futura, inexistente e muito antiga", () => {
    expect(validarLancamento({ ...base, occurredOn: "2026-10-15" }, HOJE).ok).toBe(false);
    expect(validarLancamento({ ...base, occurredOn: "2026-02-31" }, HOJE).ok).toBe(false);
    expect(validarLancamento({ ...base, occurredOn: "2026-07-01" }, HOJE).ok).toBe(false);
    expect(validarLancamento({ ...base, occurredOn: HOJE }, HOJE).ok).toBe(true);
  });

  test("rejeita produto vazio", () => {
    expect(validarLancamento({ ...base, productId: " " }, HOJE).ok).toBe(false);
  });

  test("aceita prato pronto no lugar do insumo", () => {
    const r = validarLancamento({ ...base, productId: undefined, dishId: "d1" }, HOJE);
    expect(r).toMatchObject({ ok: true, valor: { productId: null, dishId: "d1", quantity: 2.5 } });
  });

  test("exige insumo ou prato, nunca os dois nem nenhum", () => {
    expect(validarLancamento({ ...base, productId: "p1", dishId: "d1" }, HOJE)).toMatchObject({ ok: false, erro: expect.stringMatching(/produto ou o prato/i) });
    expect(validarLancamento({ ...base, productId: "", dishId: "" }, HOJE)).toMatchObject({ ok: false, erro: expect.stringMatching(/produto ou o prato/i) });
  });
});

describe("calcularValor", () => {
  test("arredonda em centavos", () => {
    expect(calcularValor(3, 1.115)).toBe(3.35);
  });
  test("custo absurdo (dado ruim de compra) não vira valor que estoura o banco", () => {
    expect(calcularValor(1, 2_000_000)).toBeNull();
    expect(calcularValor(1_000_000, 900_000)).toBeNull();
  });
  test("custo e quantidade altos mas plausíveis continuam valendo", () => {
    expect(calcularValor(500, 1200)).toBe(600000);
  });
  test("sem custo não inventa valor", () => {
    expect(calcularValor(3, null)).toBeNull();
    expect(calcularValor(3, 0)).toBeNull();
  });
});

describe("resumirDesperdicio", () => {
  const linhas: LinhaDeDesperdicio[] = [
    { itemId: "a", itemName: "Salmão", sector: "Câmara fria", reason: "EXPIRED", totalCost: 100, cancelled: false },
    { itemId: "a", itemName: "Salmão", sector: "Câmara fria", reason: "SPOILED", totalCost: 50, cancelled: false },
    { itemId: "b", itemName: "Arroz", sector: "Seco", reason: "EXPIRED", totalCost: null, cancelled: false },
    { itemId: "b", itemName: "Arroz", sector: "Seco", reason: "EXPIRED", totalCost: 999, cancelled: true },
  ];

  test("ignora cancelados e soma por motivo, setor e produto", () => {
    const r = resumirDesperdicio(linhas);
    expect(r.total).toEqual({ lancamentos: 3, valor: 150, semCusto: 1 });
    expect(r.porMotivo.find((m) => m.chave === "EXPIRED")).toMatchObject({ lancamentos: 2, valor: 100 });
    expect(r.porSetor[0]).toMatchObject({ chave: "Câmara fria", valor: 150 });
    expect(r.porProduto[0]).toMatchObject({ chave: "a", nome: "Salmão", valor: 150 });
  });

  test("cada grupo diz quantos lançamentos ficaram sem custo", () => {
    const r = resumirDesperdicio(linhas);
    expect(r.porProduto.find((g) => g.chave === "b")).toMatchObject({ lancamentos: 1, valor: 0, semCusto: 1 });
    expect(r.porProduto.find((g) => g.chave === "a")).toMatchObject({ semCusto: 0 });
  });

  test("ordena do maior valor para o menor", () => {
    const r = resumirDesperdicio(linhas);
    expect(r.porMotivo.map((m) => m.valor)).toEqual([...r.porMotivo.map((m) => m.valor)].sort((x, y) => y - x));
  });

  test("lista vazia devolve zeros", () => {
    expect(resumirDesperdicio([]).total).toEqual({ lancamentos: 0, valor: 0, semCusto: 0 });
  });
});

test("todo motivo tem rótulo", () => {
  for (const m of WASTE_REASONS) expect(m.label.length).toBeGreaterThan(2);
});

describe("converterQuantidade: o que se digita (g, ml, kg...) vira a unidade do estoque", () => {
  // Arroz "PACOTE 5KG" estocado em UN: 1 UN = 5 KG (lido do nome) = 5000 G.
  const arroz = [
    { fromUnit: "KG", toUnit: "UN", factor: 0.2, inferida: true },
    { fromUnit: "G", toUnit: "UN", factor: 0.0002, inferida: true },
  ];

  test("500 g de um pacote de 5 kg são 0,1 UN", () => {
    expect(converterQuantidade(500, "G", "UN", arroz)).toEqual({ ok: true, quantidade: 0.1, fator: 0.0002, usouPesoInformado: false });
  });

  test("a própria unidade do estoque não converte nada", () => {
    expect(converterQuantidade(2, "UN", "UN", arroz)).toEqual({ ok: true, quantidade: 2, fator: 1, usouPesoInformado: false });
    expect(converterQuantidade(2, null, "UN", arroz)).toEqual({ ok: true, quantidade: 2, fator: 1, usouPesoInformado: false });
  });

  test("aceita as grafias que o sistema já trata como a mesma unidade (gr, kgs, und)", () => {
    expect(converterQuantidade(1, "kgs", "UN", arroz)).toMatchObject({ ok: true, quantidade: 0.2 });
    expect(converterQuantidade(3, "und", "UN", arroz)).toMatchObject({ ok: true, quantidade: 3 });
  });

  test("massa e volume convertem entre si por física, sem cadastro", () => {
    expect(converterQuantidade(250, "G", "KG", [])).toEqual({ ok: true, quantidade: 0.25, fator: 0.001, usouPesoInformado: false });
    expect(converterQuantidade(1.5, "L", "ML", [])).toEqual({ ok: true, quantidade: 1500, fator: 1000, usouPesoInformado: false });
  });

  test("unidade sem conversão é recusada com a explicação, em vez de gravar número errado", () => {
    const r = converterQuantidade(500, "G", "UN", []);
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.erro).toMatch(/G.*UN/);
    expect(r.ok === false && r.erro).toMatch(/quanto pesa ou mede 1 UN/i);
  });

  describe("peso informado na hora (1 UN = 500 G)", () => {
    test("converte o que o cadastro não sabia: 250 g de um item de 500 g são 0,5 UN", () => {
      expect(converterQuantidade(250, "G", "UN", [], { quantity: 500, unit: "G" })).toEqual({ ok: true, quantidade: 0.5, fator: 0.002, usouPesoInformado: true });
    });

    test("o peso pode vir em outra unidade da mesma medida (1 UN = 0,5 KG, lançado em g)", () => {
      expect(converterQuantidade(250, "G", "UN", [], { quantity: 0.5, unit: "KG" })).toMatchObject({ ok: true, quantidade: 0.5, usouPesoInformado: true });
    });

    test("serve para embalagem que não é UN (1 PCT = 2 KG)", () => {
      expect(converterQuantidade(500, "G", "PCT", [], { quantity: 2, unit: "KG" })).toMatchObject({ ok: true, quantidade: 0.25, usouPesoInformado: true });
    });

    test("o que já está cadastrado manda: o peso informado é ignorado", () => {
      const cadastrado = [{ fromUnit: "UN", toUnit: "G", factor: 1200 }];
      expect(converterQuantidade(300, "G", "UN", cadastrado, { quantity: 10, unit: "G" })).toMatchObject({ ok: true, quantidade: 0.25, usouPesoInformado: false });
    });

    test("peso em g não serve para quem lança em ml (medidas diferentes) e a mensagem diz o que informar", () => {
      const r = converterQuantidade(100, "ML", "UN", [], { quantity: 500, unit: "G" });
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.erro).toMatch(/não é da mesma medida/);
      expect(r.ok === false && r.erro).toMatch(/ml ou l/);
    });

    test("sem peso informado nem cadastro continua recusando", () => {
      expect(converterQuantidade(100, "G", "UN", [], null).ok).toBe(false);
    });
  });

  test("g para ml não converte (grandezas diferentes)", () => {
    expect(converterQuantidade(100, "ML", "KG", []).ok).toBe(false);
  });

  test("1 g de uma embalagem de 25 kg ainda é um número gravável (6 casas)", () => {
    const grande = [{ fromUnit: "G", toUnit: "UN", factor: 1 / 25000 }];
    const r = converterQuantidade(1, "G", "UN", grande);
    expect(r).toMatchObject({ ok: true, quantidade: 0.00004 });
  });

  test("quantidade tão pequena que arredondaria para zero é recusada", () => {
    const enorme = [{ fromUnit: "G", toUnit: "UN", factor: 1e-9 }];
    expect(converterQuantidade(1, "G", "UN", enorme)).toMatchObject({ ok: false, erro: expect.stringMatching(/pequena/i) });
  });

  test("arredonda em 6 casas sem dízima", () => {
    const terco = [{ fromUnit: "G", toUnit: "UN", factor: 1 / 3 }];
    expect(converterQuantidade(1, "G", "UN", terco)).toMatchObject({ ok: true, quantidade: 0.333333 });
  });
});

describe("validarLancamento: unidade informada", () => {
  const base = { productId: "p1", quantity: "500", reason: "EXPIRED", occurredOn: "2026-10-13", notes: "" };
  const HOJE = "2026-10-14";

  test("sem unidade, vale a do estoque (unit nulo)", () => {
    expect(validarLancamento(base, HOJE)).toMatchObject({ ok: true, valor: { unit: null } });
  });

  test("guarda a unidade informada normalizada", () => {
    expect(validarLancamento({ ...base, unit: " gr " }, HOJE)).toMatchObject({ ok: true, valor: { unit: "G" } });
  });

  test("recusa unidade absurda (texto longo ou com símbolos)", () => {
    expect(validarLancamento({ ...base, unit: "x".repeat(20) }, HOJE).ok).toBe(false);
    expect(validarLancamento({ ...base, unit: "<b>g</b>" }, HOJE).ok).toBe(false);
  });
});

describe("validarLancamento: peso informado (perUnit)", () => {
  const base = { productId: "p1", quantity: "250", unit: "G", reason: "EXPIRED", occurredOn: "2026-10-13", notes: "" };

  test("aceita 1 unidade = 500 g, com vírgula e grafias da casa", () => {
    expect(validarLancamento({ ...base, perUnit: { quantity: "0,5", unit: "kgs" } }, HOJE)).toMatchObject({ ok: true, valor: { perUnit: { quantity: 0.5, unit: "KG" } } });
  });

  test("sem peso informado o campo vem nulo", () => {
    expect(validarLancamento(base, HOJE)).toMatchObject({ ok: true, valor: { perUnit: null } });
  });

  test.each([
    [{ quantity: "0", unit: "G" }],
    [{ quantity: "abc", unit: "G" }],
    [{ quantity: "500", unit: "UN" }],
    [{ quantity: "500", unit: "" }],
    [{ quantity: "1.500", unit: "G" }],
    [{ quantity: "2000000", unit: "G" }],
    ["500g"],
    [["500", "G"]],
  ])("recusa peso informado inválido %j", (perUnit) => {
    expect(validarLancamento({ ...base, perUnit }, HOJE).ok).toBe(false);
  });
});
