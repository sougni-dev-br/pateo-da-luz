import { describe, expect, it } from "vitest";
import { gorjetaInformada } from "../gorjeta-informada.js";

// Gorjeta informada à contabilidade: com teto do IR, teto − salário registrado (o total
// registrado fica no teto de isenção); sem teto, a gorjeta do rateio. A pessoa continua
// recebendo a gorjeta real na lista de pagamento — isso não passa por aqui.
describe("gorjetaInformada", () => {
  it("com teto: teto − salário registrado (setembro do Elioenai: 5.000 − 3.672)", () => {
    expect(gorjetaInformada(5000, 3672, 2223.54)).toBe(1328);
  });

  it("junho: salário 3.600 dá 1.400", () => {
    expect(gorjetaInformada(5000, 3600, 1900)).toBe(1400);
  });

  it("arredonda em centavos", () => {
    expect(gorjetaInformada(5000, 3672.333, 10)).toBe(1327.67);
  });

  it("teto menor ou igual ao salário: zero, nunca negativo", () => {
    expect(gorjetaInformada(3000, 3672, 2223.54)).toBe(0);
    expect(gorjetaInformada(3672, 3672, 2223.54)).toBe(0);
  });

  it("sem teto: a gorjeta real (comportamento de antes)", () => {
    expect(gorjetaInformada(null, 3672, 2223.54)).toBe(2223.54);
  });

  it("com teto mas sem salário registrado: a gorjeta real", () => {
    expect(gorjetaInformada(5000, null, 2223.54)).toBe(2223.54);
  });

  it("não depende da gorjeta real quando há teto (mesmo real menor que o informado)", () => {
    expect(gorjetaInformada(5000, 3672, 500)).toBe(1328);
  });
});
