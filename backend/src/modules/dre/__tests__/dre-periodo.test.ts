import { describe, expect, it } from "vitest";
import { deslocarMeses, intervaloAnoAnterior, intervaloMesAnterior } from "../dre-periodo.js";

const dia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fimDoDia = (ano: number, mes: number, d: number) => new Date(ano, mes - 1, d, 23, 59, 59, 999);

describe("intervaloMesAnterior", () => {
  it("outubro (31 dias) volta para setembro inteiro, sem engolir 01/10", () => {
    const r = intervaloMesAnterior(new Date(2026, 9, 1), fimDoDia(2026, 10, 31));
    expect(dia(r.from)).toBe("2026-09-01");
    expect(dia(r.to)).toBe("2026-09-30");
    expect(r.to.getHours()).toBe(23);
  });

  it("setembro (30 dias) volta para agosto inteiro, incluindo o dia 31", () => {
    const r = intervaloMesAnterior(new Date(2026, 8, 1), fimDoDia(2026, 9, 30));
    expect(dia(r.from)).toBe("2026-08-01");
    expect(dia(r.to)).toBe("2026-08-31");
  });

  it("março volta para fevereiro (28 dias) e maio para abril (30)", () => {
    expect(dia(intervaloMesAnterior(new Date(2026, 2, 1), fimDoDia(2026, 3, 31)).to)).toBe("2026-02-28");
    expect(dia(intervaloMesAnterior(new Date(2026, 4, 1), fimDoDia(2026, 5, 31)).to)).toBe("2026-04-30");
  });

  it("janeiro volta para dezembro do ano anterior", () => {
    const r = intervaloMesAnterior(new Date(2026, 0, 1), fimDoDia(2026, 1, 31));
    expect(dia(r.from)).toBe("2025-12-01");
    expect(dia(r.to)).toBe("2025-12-31");
  });

  it("intervalo livre no meio do mês mantém os mesmos dias, limitado ao mês de destino", () => {
    const r = intervaloMesAnterior(new Date(2026, 9, 10), fimDoDia(2026, 10, 20));
    expect(dia(r.from)).toBe("2026-09-10");
    expect(dia(r.to)).toBe("2026-09-20");
  });

  it("fevereiro bissexto não escorrega para março", () => {
    expect(dia(deslocarMeses(new Date(2028, 1, 29), 1))).toBe("2028-03-31");
    expect(dia(deslocarMeses(new Date(2028, 2, 31), -1))).toBe("2028-02-29");
  });
});

describe("intervaloAnoAnterior", () => {
  it("29/02 de ano bissexto vai para 28/02 e não para 01/03", () => {
    const r = intervaloAnoAnterior(new Date(2028, 1, 1), fimDoDia(2028, 2, 29));
    expect(dia(r.from)).toBe("2027-02-01");
    expect(dia(r.to)).toBe("2027-02-28");
  });

  it("outubro de 2026 volta para outubro de 2025 inteiro", () => {
    const r = intervaloAnoAnterior(new Date(2026, 9, 1), fimDoDia(2026, 10, 31));
    expect(dia(r.from)).toBe("2025-10-01");
    expect(dia(r.to)).toBe("2025-10-31");
  });
});
