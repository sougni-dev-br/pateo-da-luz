import { describe, expect, test } from "vitest";
import { COLORS, MARCAS, MARCAS_PINCEL, MARCA_POR_TIPO, ehDiaNaoTrabalhado, editavelNaEscala } from "../marcas";

// Afastamento não remunerado: marca própria da Escala (AF), com cor que não se confunde
// com folga, falta, atestado nem férias. Não é turno nem folga.
describe("marca de afastamento não remunerado", () => {
  test("letra AF, nome completo e cor própria", () => {
    const m = MARCA_POR_TIPO.get("AFASTAMENTO");
    expect(m).toMatchObject({ letra: "AF", nome: "Afastamento não remunerado" });
    const outras = MARCAS.filter((x) => x.tipo !== "AFASTAMENTO").map((x) => x.cor);
    expect(outras).not.toContain(m!.cor);
    expect([COLORS.ferias, COLORS.domingo, COLORS.feriado]).not.toContain(m!.cor);
  });

  test("só a Folha lança: fica fora do pincel e a célula não se edita na escala", () => {
    expect(MARCAS_PINCEL.map((m) => m.tipo)).not.toContain("AFASTAMENTO");
    expect(MARCAS_PINCEL.map((m) => m.tipo)).toContain("FOLGA");
    expect(editavelNaEscala("AFASTAMENTO")).toBe(false);
    expect(editavelNaEscala("FALTA")).toBe(true);
    expect(editavelNaEscala(undefined)).toBe(true);
  });

  test("não conta como dia trabalhado", () => {
    expect(ehDiaNaoTrabalhado("AFASTAMENTO")).toBe(true);
    expect(ehDiaNaoTrabalhado("FALTA")).toBe(true);
    expect(ehDiaNaoTrabalhado("TURNO")).toBe(false);
    expect(ehDiaNaoTrabalhado(undefined)).toBe(false);
  });
});
