import { describe, expect, test } from "vitest";
import { WASTE_REASONS, calcularValor, exigeObservacao, resumirDesperdicio, validarLancamento, type LinhaDeDesperdicio } from "../waste.js";

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
