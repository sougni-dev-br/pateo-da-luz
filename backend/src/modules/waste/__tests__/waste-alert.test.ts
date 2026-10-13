import { describe, expect, test } from "vitest";
import { decidirAlerta, mensagemDoAlerta } from "../waste-alert.js";

const base = { limite: 500, totalDoDia: 600, diaDoLancamento: "2026-10-14", hoje: "2026-10-14", ultimoAlerta: null as string | null };

describe("decidirAlerta", () => {
  test("avisa quando o total do dia chega ao limite", () => {
    expect(decidirAlerta(base)).toBe(true);
    expect(decidirAlerta({ ...base, totalDoDia: 500 })).toBe(true);
  });

  test("não avisa abaixo do limite", () => {
    expect(decidirAlerta({ ...base, totalDoDia: 499.99 })).toBe(false);
  });

  test("sem limite configurado (ou zerado) nunca avisa", () => {
    expect(decidirAlerta({ ...base, limite: null })).toBe(false);
    expect(decidirAlerta({ ...base, limite: 0 })).toBe(false);
  });

  test("um aviso por dia: depois do primeiro, o mesmo dia não repete", () => {
    expect(decidirAlerta({ ...base, ultimoAlerta: "2026-10-14" })).toBe(false);
    expect(decidirAlerta({ ...base, ultimoAlerta: "2026-10-13" })).toBe(true);
  });

  test("lançamento de dia que já passou não dispara aviso", () => {
    expect(decidirAlerta({ ...base, diaDoLancamento: "2026-10-12" })).toBe(false);
  });
});

describe("mensagemDoAlerta", () => {
  test("diz quanto, o limite, o principal motivo e onde ver", () => {
    const texto = mensagemDoAlerta({ total: 1234.5, limite: 1000, lancamentos: 7, principalMotivo: "Vencido" });
    expect(texto).toMatch(/R\$\s?1\.234,50/);
    expect(texto).toMatch(/R\$\s?1\.000,00/);
    expect(texto).toContain("7 lançamentos");
    expect(texto).toContain("principalmente vencido");
    expect(texto).toMatch(/Estoque/);
  });

  test("um lançamento no singular e sem motivo quando não há", () => {
    const texto = mensagemDoAlerta({ total: 600, limite: 500, lancamentos: 1, principalMotivo: null });
    expect(texto).toContain("1 lançamento");
    expect(texto).not.toContain("1 lançamentos");
    expect(texto).not.toMatch(/principalmente/i);
  });
});
