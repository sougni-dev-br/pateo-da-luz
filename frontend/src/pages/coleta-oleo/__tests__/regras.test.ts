import { describe, expect, it } from "vitest";
import { diasEntre, haQuantoTempo, numeroDoCampo, precoPorLitro, situacaoDoPix } from "../regras";

describe("diasEntre e haQuantoTempo", () => {
  it("conta dias inteiros, inclusive na virada de mês e de horário de verão", () => {
    expect(diasEntre("2026-10-23", "2026-10-23")).toBe(0);
    expect(diasEntre("2026-10-30", "2026-11-02")).toBe(3);
    expect(diasEntre("2026-10-23", "2026-10-20")).toBe(-3);
  });

  it("fala em hoje, ontem e dias", () => {
    expect(haQuantoTempo(0)).toBe("hoje");
    expect(haQuantoTempo(-1)).toBe("hoje");
    expect(haQuantoTempo(1)).toBe("ontem");
    expect(haQuantoTempo(5)).toBe("há 5 dias");
  });
});

describe("campos numéricos", () => {
  it("lê vírgula e ponto, recusa lixo", () => {
    expect(numeroDoCampo("70,5")).toBe(70.5);
    expect(numeroDoCampo(" 140 ")).toBe(140);
    expect(numeroDoCampo("abc")).toBeNull();
    expect(numeroDoCampo("")).toBeNull();
  });

  it("calcula R$/L e some quando falta dado ou o volume é zero", () => {
    expect(precoPorLitro("70", "140,00")).toBe(2);
    expect(precoPorLitro("0", "140")).toBeNull();
    expect(precoPorLitro("70", "")).toBeNull();
  });
});

describe("situacaoDoPix", () => {
  it("pendente do mesmo dia é só pendente; de dias atrás é atraso", () => {
    expect(situacaoDoPix("PENDING", "2026-10-23", "2026-10-23")).toEqual({ tone: "warning", label: "PIX pendente" });
    expect(situacaoDoPix("PENDING", "2026-10-22", "2026-10-23")).toEqual({ tone: "danger", label: "PIX atrasado · 1 dia" });
    expect(situacaoDoPix("PENDING", "2026-10-20", "2026-10-23").label).toBe("PIX atrasado · 3 dias");
  });

  it("recebida em parte aparece como parcial, sem virar atraso", () => {
    expect(situacaoDoPix("PARTIAL", "2026-10-01", "2026-10-23")).toEqual({ tone: "info", label: "Recebido em parte" });
  });

  it("recebida e cancelada ignoram a data", () => {
    expect(situacaoDoPix("RECEIVED", "2026-01-01", "2026-10-23").tone).toBe("success");
    expect(situacaoDoPix("CANCELLED", "2026-01-01", "2026-10-23").tone).toBe("neutral");
  });
});
