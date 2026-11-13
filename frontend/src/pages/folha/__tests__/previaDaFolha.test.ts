import { describe, expect, it } from "vitest";
import { ehDeSemRegistro, itensDaPreviaDaFolha } from "../semRegistro";

const item = (type: string, over: { exists?: boolean; semRegistro?: boolean } = {}) =>
  ({ type, exists: over.exists ?? false, details: over.semRegistro ? { semRegistro: true } : null });

describe("itensDaPreviaDaFolha — o botão promete o que o servidor cria", () => {
  it("fica só com adiantamento e salário de quem tem registro; VT não entra", () => {
    const { daFolha } = itensDaPreviaDaFolha([item("ADIANTAMENTO"), item("SALARIO"), item("VALE_TRANSPORTE")]);
    expect(daFolha.map((i) => i.type)).toEqual(["ADIANTAMENTO", "SALARIO"]);
  });
  it("sem registro sai da prévia e é contado à parte (só o que ainda não existe)", () => {
    const r = itensDaPreviaDaFolha([item("ADIANTAMENTO"), item("ADIANTAMENTO", { semRegistro: true }), item("ADIANTAMENTO", { semRegistro: true, exists: true })]);
    expect(r.daFolha).toHaveLength(1);
    expect(r.semRegistroFora).toBe(1);
  });
  it("ehDeSemRegistro lê a marca dos detalhes", () => {
    expect(ehDeSemRegistro({ details: { semRegistro: true } })).toBe(true);
    expect(ehDeSemRegistro({ details: { semRegistro: false } })).toBe(false);
    expect(ehDeSemRegistro({ details: null })).toBe(false);
    expect(ehDeSemRegistro({})).toBe(false);
  });
});
