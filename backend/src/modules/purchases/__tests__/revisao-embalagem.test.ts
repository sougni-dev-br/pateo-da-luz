import { describe, expect, test } from "vitest";
import { fatorSugeridoPeloPreco, linhasSuspeitas, pareceEmbalagem, precoDeReferencia, precoNaContagem, precoNormal, validarEmbalagem } from "../revisao-embalagem";

// Precos reais da porta-forminha (abr–out/2026): avulso a centavos, pacote de 50 a reais.
const forminha = [
  { id: "a", precoUnitario: 0.0704, revisada: false },
  { id: "b", precoUnitario: 0.0948, revisada: false },
  { id: "c", precoUnitario: 2.29, revisada: false },
  { id: "d", precoUnitario: 0.0488, revisada: false },
  { id: "e", precoUnitario: 2.44, revisada: false },
  { id: "f", precoUnitario: 2.99, revisada: false },
  { id: "g", precoUnitario: 3.0413, revisada: false },
  { id: "h", precoUnitario: 5.1245, revisada: false }
];

describe("revisao de embalagem", () => {
  test("referencia e o menor preco por unidade", () => {
    expect(precoDeReferencia(forminha)).toBe(0.0488);
    expect(precoDeReferencia([])).toBeNull();
  });

  test("so os pacotes da forminha ficam suspeitos", () => {
    expect(linhasSuspeitas(forminha).map((l) => l.id)).toEqual(["c", "e", "f", "g", "h"]);
  });

  test("linha revisada nao reabre, mas continua como referencia", () => {
    const revisadas = forminha.map((l) => ({ ...l, revisada: l.precoUnitario > 1 }));
    expect(linhasSuspeitas(revisadas)).toEqual([]);
  });

  test("variacao normal de preco nao e suspeita", () => {
    expect(pareceEmbalagem(9.9, 7.5)).toBe(false);
    expect(pareceEmbalagem(75, 7.5)).toBe(true);
  });

  test("fator sugerido arredonda para embalagem comum", () => {
    expect(fatorSugeridoPeloPreco(2.44, 0.0488)).toBe(50);
    expect(fatorSugeridoPeloPreco(490.72, 0.1594)).toBe(3079);
    expect(fatorSugeridoPeloPreco(1, null)).toBeNull();
  });
});

describe("validarEmbalagem", () => {
  test("avulso", () => {
    expect(validarEmbalagem({ avulso: true }, "UN")).toEqual({ ok: true, avulso: true });
  });

  test("pacote de 50", () => {
    expect(validarEmbalagem({ unidade: "pct", fator: "50" }, "UN")).toEqual({ ok: true, avulso: false, unidade: "PCT", fator: 50 });
  });

  test("recusa embalagem com o nome da unidade de contagem e fator invalido", () => {
    expect(validarEmbalagem({ unidade: "UN", fator: 50 }, "UN").ok).toBe(false);
    expect(validarEmbalagem({ unidade: "PCT", fator: 1 }, "UN").ok).toBe(false);
    expect(validarEmbalagem({ unidade: "", fator: 50 }, "UN").ok).toBe(false);
  });
});

describe("precoNormal", () => {
  test("forminha: mediana das avulsas, os pacotes nao puxam", () => {
    expect(precoNormal(forminha.map((l) => l.precoUnitario))).toBeCloseTo(0.0704, 4);
  });

  test("produto sem embalagem: mediana de todas", () => {
    expect(precoNormal([7.5, 8, 9])).toBe(8);
    expect(precoNormal([7.5, 8])).toBe(7.75);
  });

  test("sem compra, sem regua", () => {
    expect(precoNormal([])).toBeNull();
    expect(precoNormal([0, -1])).toBeNull();
  });
});

// CHOPP BRAHMA (produção, 19/10/2026): contado em BARRIL, notas em L. 50 L a R$ 10,16 viravam
// "50 barris a R$ 10,16" e o barril de R$ 675 parecia pacote com 66.
describe("revisão de embalagens: unidade da nota que converte sozinha", () => {
  const linha = (quantidade: number, total: number, unidadeDaNota = "L", precoGravado: number | null = null) =>
    precoNaContagem({ total, quantidade, unidadeDaNota, unidadeDeContagem: "BARRIL", precoGravado, conversoes: [] });

  test("50 L por R$ 507,84 são 1 barril a R$ 507,84", () => {
    const r = linha(50, 507.84, "L", 10.1568);
    expect(r.converteSozinho).toBe(true);
    expect(r.quantidadeNaContagem).toBeCloseTo(1, 10);
    expect(r.precoUnitario).toBeCloseTo(507.84, 6);
  });

  test("nota de 15/10 gravada com fator 1 (50 L a R$ 13,51) também vira R$ 675,57 por barril", () => {
    expect(linha(50, 675.57, "L", 13.5114).precoUnitario).toBeCloseTo(675.57, 6);
  });

  test("com a conversão considerada, o CHOPP não tem linha suspeita de pacote", () => {
    const notas = [linha(100, 1015.68), linha(50, 507.84), linha(50, 675.57)].map((n, i) => ({ id: String(i), revisada: false, ...n }));
    expect(linhasSuspeitas(notas)).toEqual([]);
  });

  test("lançamento '1 L' a R$ 675 (barril lançado como L) não é oferecido como pacote", () => {
    const notas = [linha(50, 507.84), linha(1, 675.57)].map((n, i) => ({ id: String(i), revisada: false, ...n }));
    expect(linhasSuspeitas(notas)).toEqual([]);
  });

  test("sem fator conhecido (nota em UN, contagem em KG) mantém o preço gravado", () => {
    const r = precoNaContagem({ total: 100, quantidade: 10, unidadeDaNota: "UN", unidadeDeContagem: "KG", precoGravado: 10, conversoes: [] });
    expect(r).toMatchObject({ converteSozinho: false, precoUnitario: 10 });
  });

  test("conversão cadastrada no produto também vale (PCT = 50 UN)", () => {
    const r = precoNaContagem({ total: 100, quantidade: 1, unidadeDaNota: "PCT", unidadeDeContagem: "UN", precoGravado: null, conversoes: [{ fromUnit: "PCT", toUnit: "UN", factor: 50 }] });
    expect(r.precoUnitario).toBeCloseTo(2, 10);
  });
});
