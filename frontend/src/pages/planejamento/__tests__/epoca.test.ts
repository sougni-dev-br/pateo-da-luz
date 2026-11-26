import { describe, expect, it } from "vitest";
import { avisoDeMudanca, textoDaEpoca } from "../comentarios/epoca";
import { comentarioFicticio, comparativoFicticio } from "./fixturesComentarios";

// Números fictícios.
const comEpoca = (variacao: number | null, valorBase: number | null = 341000, valorComparado: number | null = 216000) =>
  comentarioFicticio({ epoca: { valorBase, valorComparado, variacao } });

describe("textoDaEpoca", () => {
  it("variação com a mesma regra de arredondamento da tela e os valores em mil", () => {
    expect(textoDaEpoca(comEpoca(-0.3666), false)).toBe("escrito quando estava −36,7% (R$ 216 mil contra R$ 341 mil)");
  });

  it("ocultar valores tira o dinheiro, mas mantém a variação", () => {
    expect(textoDaEpoca(comEpoca(-0.3666), true)).toBe("escrito quando estava −36,7%");
  });

  it("clientes aparecem mesmo com valores ocultos", () => {
    const c = comentarioFicticio({ metrica: "CLIENTES", epoca: { valorBase: 1500, valorComparado: 1200, variacao: -0.2 } });
    expect(textoDaEpoca(c, true)).toBe("escrito quando estava −20,0% (1.200 clientes contra 1.500 clientes)");
  });

  it("ponto sem número não mostra nada", () => {
    expect(textoDaEpoca(comEpoca(null, null, null), false)).toBeNull();
  });
});

describe("avisoDeMudanca", () => {
  // No comparativo fictício, a variação de clientes é +10% em todo ponto.
  const dados = comparativoFicticio();
  const comEpoca = (variacao: number | null) => comentarioFicticio({ metrica: "CLIENTES", epoca: { valorBase: 1000, valorComparado: 1000, variacao } });

  it("avisa quando a variação de hoje se afastou", () => {
    expect(avisoDeMudanca(comEpoca(-0.3666), dados)).toBe("o número mudou desde então: hoje +10,0%");
  });

  it("não avisa quando é o mesmo número (arredondado) ou quase", () => {
    expect(avisoDeMudanca(comEpoca(0.1), dados)).toBeNull();
    expect(avisoDeMudanca(comEpoca(0.104), dados)).toBeNull();
  });

  it("não avisa se o comentário foi escrito noutra comparação (outro ano-base) ou sem número", () => {
    expect(avisoDeMudanca(comentarioFicticio({ anoBase: 2024, epoca: { valorBase: 1, valorComparado: 1, variacao: -0.5 } }), dados)).toBeNull();
    expect(avisoDeMudanca(comEpoca(null), dados)).toBeNull();
  });
});
