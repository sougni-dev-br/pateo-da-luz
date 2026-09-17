import { describe, it, expect } from "vitest";
import { compararVisoes, type CategoriaDeCompra } from "../visoes-do-cmv";

const cat = (nome: string, total: number, itens = 1): CategoriaDeCompra => ({
  categoryName: nome,
  totalAmount: total,
  itemsCount: itens
});

describe("compararVisoes", () => {
  it("aponta as categorias que só a visão gerencial inclui", () => {
    // Junho/2026, os números reais: a gerencial soma limpeza e descartáveis.
    const contabil = [cat("Custo de Alimentos", 161145.21, 645), cat("Bebidas", 9460.92, 43)];
    const gerencial = [
      cat("Custo de Alimentos", 161145.21, 645),
      cat("Bebidas", 9460.92, 43),
      cat("Material de Limpeza", 3227.66, 44),
      cat("Descartáveis", 60.97, 2)
    ];

    const r = compararVisoes(191312.07, 194600.7, 0.9224, 0.9382, contabil, gerencial);

    expect(r.iguais).toBe(false);
    expect(r.diferenca).toBeCloseTo(3288.63, 2);
    expect(r.categorias.map((c) => c.categoryName)).toEqual(["Material de Limpeza", "Descartáveis"]);
    expect(r.naoExplicado).toBeCloseTo(0, 2);
  });

  it("marca como iguais quando as visões coincidem", () => {
    const iguais = [cat("Custo de Alimentos", 1000)];
    const r = compararVisoes(5000, 5000, 0.3, 0.3, iguais, iguais);

    expect(r.iguais).toBe(true);
    expect(r.categorias).toEqual([]);
    expect(r.diferencaEmPontos).toBeCloseTo(0, 6);
  });

  it("ignora diferença de centavo, que é arredondamento e não divergência", () => {
    const r = compararVisoes(
      5000,
      5000.005,
      null,
      null,
      [cat("Bebidas", 100)],
      [cat("Bebidas", 100.004)]
    );

    expect(r.iguais).toBe(true);
    expect(r.categorias).toEqual([]);
  });

  it("não engole uma categoria que existe só do lado contábil", () => {
    // Isso não deveria acontecer: se acontecer, é erro de classificação, e a
    // tela precisa mostrar em vez de esconder.
    const r = compararVisoes(
      5000,
      4800,
      null,
      null,
      [cat("Bebidas", 200)],
      [cat("Custo de Alimentos", 0)]
    );

    expect(r.categorias).toHaveLength(1);
    expect(r.categorias[0].categoryName).toBe("Bebidas");
    expect(r.categorias[0].diferenca).toBeCloseTo(-200, 2);
    expect(r.naoExplicado).toBeCloseTo(0, 2);
  });

  it("acusa o que as categorias não explicam", () => {
    // A diferença entre as visões não vem só das compras: estoque e receita
    // também podem divergir. Se a soma das categorias não fecha, dizer.
    const r = compararVisoes(
      100000,
      105000,
      null,
      null,
      [cat("Bebidas", 1000)],
      [cat("Bebidas", 1000), cat("Material de Limpeza", 2000)]
    );

    expect(r.diferenca).toBeCloseTo(5000, 2);
    expect(r.naoExplicado).toBeCloseTo(3000, 2);
  });

  it("devolve a diferença em pontos percentuais quando há receita nas duas", () => {
    const r = compararVisoes(100, 110, 0.3, 0.33, [], []);
    expect(r.diferencaEmPontos).toBeCloseTo(0.03, 6);
  });

  it("não inventa pontos percentuais quando uma das visões não tem receita", () => {
    const r = compararVisoes(100, 110, null, 0.33, [], []);
    expect(r.diferencaEmPontos).toBeNull();
  });
});
