import { describe, expect, test } from "vitest";
import { dicaDoPonto, horaExtraDe, horasDaLinha, noturnoDe } from "../gorjetaUtils";

describe("horas que o Ponto fechado traz para a apuração", () => {
  test("nada digitado: vale o Ponto; digitado vale mais, inclusive 0:00", () => {
    expect(horaExtraDe({ horaExtra: null, horaExtraPonto: "5:00" })).toBe("5:00");
    expect(horaExtraDe({ horaExtra: "", horaExtraPonto: "5:00" })).toBe("5:00");
    expect(horaExtraDe({ horaExtra: "1:00", horaExtraPonto: "5:00" })).toBe("1:00");
    expect(horaExtraDe({ horaExtra: "0:00", horaExtraPonto: "5:00" })).toBe("0:00");
    expect(noturnoDe({ adicionalNoturno: null, adicionalNoturnoPonto: "1:14" })).toBe("1:14");
  });

  test("sem Ponto fechado: só o digitado", () => {
    expect(horaExtraDe({ horaExtra: null })).toBeNull();
    expect(horaExtraDe({ horaExtra: "2:30" })).toBe("2:30");
  });

  test("horasDaLinha e a dica na tela", () => {
    expect(horasDaLinha("", "5:00")).toBe("5:00");
    expect(horasDaLinha("1:00", "5:00")).toBe("1:00");
    expect(horasDaLinha("", null)).toBeNull();
    expect(dicaDoPonto("5:00", "")).toContain("Ponto fechado");
    expect(dicaDoPonto("5:00", "1:00")).toBeUndefined();
    expect(dicaDoPonto(null, "")).toBeUndefined();
  });
});
