import { describe, expect, it } from "vitest";
import { gorjetaInformada } from "../gorjeta-informada.js";

// Gorjeta informada à contabilidade: com teto do IR, o menor entre a gorjeta real e
// teto − salário registrado (o total registrado fica no teto de isenção, e nunca se
// informa mais gorjeta do que a pessoa teve); sem teto, a gorjeta do rateio. A pessoa
// continua recebendo a gorjeta real na lista de pagamento — isso não passa por aqui.
describe("gorjetaInformada", () => {
  it("com teto: teto − salário registrado (setembro do Teodoro: 5.000 − 3.672; real 2.223,54)", () => {
    expect(gorjetaInformada(5000, 3672, 2223.54)).toBe(1328);
  });

  it("junho: salário 3.600 dá 1.400", () => {
    expect(gorjetaInformada(5000, 3600, 1900)).toBe(1400);
  });

  it("arredonda em centavos", () => {
    expect(gorjetaInformada(5000, 3672.333, 2000)).toBe(1327.67);
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

  // Auditoria 01/10: informava teto − salário mesmo com a gorjeta real menor (ou zero).
  it("nunca informa mais que a gorjeta real: real menor que teto − salário vai a real", () => {
    expect(gorjetaInformada(5000, 3672, 500)).toBe(500);
  });

  it("sem gorjeta real (zero, em teste, fora do rateio) ou negativa: zero", () => {
    expect(gorjetaInformada(5000, 3672, 0)).toBe(0);
    expect(gorjetaInformada(5000, 3672, -120)).toBe(0);
  });
});
