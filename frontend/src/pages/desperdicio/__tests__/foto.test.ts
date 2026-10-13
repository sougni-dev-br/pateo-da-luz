import { describe, expect, test } from "vitest";
import { LADO_MAXIMO_PX, dimensoesReduzidas } from "../foto";

describe("dimensoesReduzidas", () => {
  test("foto de celular em paisagem encolhe mantendo a proporção", () => {
    expect(dimensoesReduzidas(4032, 3024)).toEqual({ largura: LADO_MAXIMO_PX, altura: 960 });
  });

  test("retrato encolhe pelo lado maior", () => {
    expect(dimensoesReduzidas(3024, 4032)).toEqual({ largura: 960, altura: LADO_MAXIMO_PX });
  });

  test("imagem pequena não é ampliada", () => {
    expect(dimensoesReduzidas(800, 600)).toEqual({ largura: 800, altura: 600 });
    expect(dimensoesReduzidas(LADO_MAXIMO_PX, 100)).toEqual({ largura: LADO_MAXIMO_PX, altura: 100 });
  });

  test("imagem muito comprida nunca zera um lado", () => {
    const r = dimensoesReduzidas(10000, 2);
    expect(r.largura).toBe(LADO_MAXIMO_PX);
    expect(r.altura).toBeGreaterThanOrEqual(1);
  });
});
