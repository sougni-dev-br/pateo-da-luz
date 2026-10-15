import { describe, expect, it } from "vitest";
import { conversoesASairem, prepararConversoesEnviadas } from "../product-conversoes.js";

describe("prepararConversoesEnviadas", () => {
  it("grava na forma canonica e aceita fator pt-BR", () => {
    const r = prepararConversoesEnviadas([{ fromUnit: "caixa", toUnit: "und", factor: "1.200,5" }]);
    expect(r).toEqual({
      ok: true,
      conversoes: [{ fromUnit: "CX", toUnit: "UN", factor: 1200.5, averagePackageWeight: null, notes: null, isActive: true }]
    });
  });

  it("ignora linha vazia que o formulario manda", () => {
    expect(prepararConversoesEnviadas([{ fromUnit: "", toUnit: "UN", factor: "" }])).toEqual({ ok: true, conversoes: [] });
  });

  it("recusa origem igual ao destino, inclusive por sinonimo", () => {
    const r = prepararConversoesEnviadas([{ fromUnit: "UND", toUnit: "UN", factor: 10 }]);
    expect(r.ok).toBe(false);
  });

  it("recusa duplicata que so difere na grafia", () => {
    const r = prepararConversoesEnviadas([
      { fromUnit: "CX", toUnit: "UN", factor: 12 },
      { fromUnit: "CAIXA", toUnit: "UNIDADE", factor: 12 }
    ]);
    expect(r).toMatchObject({ ok: false, erro: expect.stringContaining("duas vezes") });
  });

  it("recusa par inverso contraditorio e aceita o coerente", () => {
    expect(
      prepararConversoesEnviadas([
        { fromUnit: "CX", toUnit: "UN", factor: 12 },
        { fromUnit: "UN", toUnit: "CX", factor: 12 }
      ])
    ).toMatchObject({ ok: false, erro: expect.stringContaining("contradizem") });
    expect(
      prepararConversoesEnviadas([
        { fromUnit: "CX", toUnit: "UN", factor: 4 },
        { fromUnit: "UN", toUnit: "CX", factor: 0.25 }
      ]).ok
    ).toBe(true);
  });

  it("recusa fator fora da faixa da coluna", () => {
    expect(prepararConversoesEnviadas([{ fromUnit: "CX", toUnit: "UN", factor: 0 }]).ok).toBe(false);
    expect(prepararConversoesEnviadas([{ fromUnit: "CX", toUnit: "UN", factor: 2_000_000 }]).ok).toBe(false);
  });
});

describe("conversoesASairem", () => {
  const gravadas = [
    { id: "ficha", fromUnit: "UN", toUnit: "G" }, // criada pela ficha tecnica com o formulario aberto
    { id: "revisao", fromUnit: "PCT", toUnit: "UN" }, // criada pela revisao de embalagens
    { id: "tirada", fromUnit: "FD", toUnit: "UN" },
    { id: "grafia", fromUnit: "CAIXA", toUnit: "UND" }
  ];
  const enviadas = [{ fromUnit: "CX", toUnit: "UN", factor: 12, averagePackageWeight: null, notes: null, isActive: true }];

  it("preserva o que o formulario nao carregou e apaga so o que o operador tirou", () => {
    const saem = conversoesASairem({
      gravadas,
      enviadas,
      carregadas: [{ fromUnit: "FD", toUnit: "UN" }, { fromUnit: "CAIXA", toUnit: "UND" }]
    });
    expect(saem.sort()).toEqual(["grafia", "tirada"]);
  });

  it("sem lista carregada nao apaga nada alem da grafia antiga", () => {
    expect(conversoesASairem({ gravadas, enviadas, carregadas: null })).toEqual(["grafia"]);
  });

  it("tira a inversa de uma conversao enviada", () => {
    expect(
      conversoesASairem({
        gravadas: [{ id: "inversa", fromUnit: "UN", toUnit: "CX" }],
        enviadas,
        carregadas: null
      })
    ).toEqual(["inversa"]);
  });
});
