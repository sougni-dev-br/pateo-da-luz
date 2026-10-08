import { describe, expect, test } from "vitest";
import { fatorSugeridoPeloPreco, linhasSuspeitas, pareceEmbalagem, precoDeReferencia, validarEmbalagem } from "../revisao-embalagem";

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
