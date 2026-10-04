import { describe, expect, test } from "vitest";
import { apagaEm, empresaParaEnvio, valorBr, valorNoCampo } from "../fichaFormato";

describe("valor em reais digitado pelo RH", () => {
  test("entende o jeito brasileiro de escrever", () => {
    expect(valorBr("1.500")).toBe(1500);
    expect(valorBr("1.500,50")).toBe(1500.5);
    expect(valorBr("2.800,00")).toBe(2800);
    expect(valorBr("R$ 12.345,67")).toBe(12345.67);
    expect(valorBr("1500,5")).toBe(1500.5);
    expect(valorBr("1500")).toBe(1500);
    expect(valorBr("1500.50")).toBe(1500.5);
    expect(valorBr(2500)).toBe(2500);
  });

  test("vazio é nada; o que não dá para entender não vira número", () => {
    expect(valorBr("")).toBeNull();
    expect(valorBr(null)).toBeNull();
    expect(valorBr("1.50.0")).toBeUndefined();
    expect(valorBr("mil")).toBeUndefined();
    expect(valorBr("1,500,00")).toBeUndefined();
  });

  test("número gravado aparece no formato brasileiro no campo", () => {
    expect(valorNoCampo(1500)).toBe("1.500,00");
    expect(valorNoCampo("1.5")).toBe("1.5");
    expect(valorNoCampo(null)).toBe("");
  });

  test("envio converte salário e VT, e recusa valor sem sentido com mensagem", () => {
    expect(empresaParaEnvio({ salario: "1.500", valorVt: "250,00", funcao: "Copeira" })).toEqual({ salario: 1500, valorVt: 250, funcao: "Copeira" });
    expect(() => empresaParaEnvio({ salario: "1.50.0" })).toThrow("Salário");
    expect(() => empresaParaEnvio({ salario: 1500, valorVt: "x" })).toThrow("VT");
  });
});

describe("quando a ficha é apagada (LGPD)", () => {
  const agora = new Date("2026-10-04T12:00:00Z").getTime();
  test("cancelada: 90 dias depois do cancelamento", () => {
    expect(apagaEm({ status: "CANCELADA", expiraEm: "2026-09-01T00:00:00Z", canceladaEm: "2026-10-01T15:00:00Z" }, agora)?.toISOString()).toBe("2026-12-30T15:00:00.000Z");
  });
  test("link vencido: 90 dias depois do vencimento; no prazo, enviada ao RH ou concluída: nunca", () => {
    expect(apagaEm({ status: "ENVIADA", expiraEm: "2026-10-01T00:00:00Z", canceladaEm: null }, agora)?.toISOString()).toBe("2026-12-30T00:00:00.000Z");
    expect(apagaEm({ status: "PREENCHENDO", expiraEm: "2026-10-10T00:00:00Z", canceladaEm: null }, agora)).toBeNull();
    expect(apagaEm({ status: "FINALIZADA", expiraEm: "2026-01-01T00:00:00Z", canceladaEm: null }, agora)).toBeNull();
    expect(apagaEm({ status: "CONCLUIDA", expiraEm: "2026-01-01T00:00:00Z", canceladaEm: null }, agora)).toBeNull();
  });
});
