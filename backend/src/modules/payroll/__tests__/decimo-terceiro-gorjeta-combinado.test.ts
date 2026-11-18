import { describe, expect, test } from "vitest";
import {
  DESCRICAO_COMBINADO_E_GORJETA, lerMediaValor13, mediaDeclaradaMensal, variaveisDaDiferencaDaGorjeta,
} from "../decimo-terceiro-gorjeta-combinado.js";
import { lerTextoExtrato } from "../rh-extract.service.js";

// Valores FICTÍCIOS (repo público). O extrato do 13º da contabilidade traz a gorjeta DECLARADA dentro da rubrica
// "MEDIA VALOR 13o ADIANTADO" (valor da 1ª parcela e avos); a diferença para a gorjeta integral é o que se soma.
describe("lerMediaValor13", () => {
  test("lê o valor e os avos da rubrica", () => {
    expect(lerMediaValor13("13 13 SALARIO ADIANTADO P\t1.500,00\t12,00\n834 MEDIA VALOR 13o ADIANTADO P\t609,20\t12,00\nND: 1")).toEqual({ valor: 609.2, avos: 12 });
  });
  test("avos quebrados e valor com milhar", () => {
    expect(lerMediaValor13("834 MEDIA VALOR 13o ADIANTADO P 1.049,46 2,00")).toEqual({ valor: 1049.46, avos: 2 });
  });
  test("sem a rubrica: null (não confunde com MEDIA HORAS)", () => {
    expect(lerMediaValor13("833 MEDIA HORAS 13o ADIANTADO P\t100,00\t12,00")).toBeNull();
  });
});

describe("mediaDeclaradaMensal", () => {
  test("1ª parcela = média ÷ 12 × avos ÷ 2 → média mensal = valor × 24 ÷ avos", () => {
    expect(mediaDeclaradaMensal({ valor: 600, avos: 12 })).toBe(1200);
    expect(mediaDeclaradaMensal({ valor: 100, avos: 2 })).toBe(1200);
  });
  test("avos zero ou inválidos: zero", () => {
    expect(mediaDeclaradaMensal({ valor: 100, avos: 0 })).toBe(0);
  });
});

describe("variaveisDaDiferencaDaGorjeta", () => {
  test("cada mês apurado = gorjeta integral − declarada; mês apurado sem gorjeta conta como zero", () => {
    const r = variaveisDaDiferencaDaGorjeta(new Map([[8, 2000], [9, 1500]]), 1200, new Set([8, 9, 10]));
    expect([...r]).toEqual([[8, 800], [9, 300], [10, -1200]]);
  });
  test("mês fora dos apurados não entra", () => {
    expect(variaveisDaDiferencaDaGorjeta(new Map([[1, 999]]), 100, new Set([8])).has(1)).toBe(false);
  });
  test("a descrição do que é somado cita a gorjeta integral", () => {
    expect(DESCRICAO_COMBINADO_E_GORJETA).toContain("gorjeta integral");
  });
});

describe("extrato do 13º lido pelo parser", () => {
  const texto = [
    "Página: 1/1", "Emissão: 12/11/2026", "EXTRATO MENSAL", "11/2026", "Cálculo: 13o Adiantamento", "00.000.000/0001-00", "EMPRESA EXEMPLO COMERCIO LTDA",
    "20 ANA CLARA EXEMPLO\tEmpr.: 01/03/2020\tAdm:\t000.000.001-91\tTrabalhando CPF:\tSituação:",
    "13 13 SALARIO ADIANTADO P\t1.500,00\t12,00", "834 MEDIA VALOR 13o ADIANTADO P\t600,00\t12,00",
    "ND: 1 Proventos: 2.100,00 Líquido:\tDescontos: 0,00 Informativa: 1 Informativa Dedutora: 0 2.100,00",
    "NF: 1 Base INSS: 0,00",
    "21 BRUNO EXEMPLO\tEmpr.: 01/03/2020\tAdm:\t000.000.002-72\tTrabalhando CPF:\tSituação:",
    "13 13 SALARIO ADIANTADO P\t900,00\t12,00",
    "ND: 1 Proventos: 900,00 Líquido:\tDescontos: 0,00 Informativa: 1 Informativa Dedutora: 0 900,00",
    "NF: 1 Base INSS: 0,00",
  ].join("\n");

  test("a média de valores da pessoa vem junto, e fica null para quem não tem", () => {
    const r = lerTextoExtrato(texto);
    expect(r.funcionarios.map((f) => [f.cpfNorm, f.liquido, f.mediaValor13 ?? null])).toEqual([
      ["00000000191", 2100, { valor: 600, avos: 12 }],
      ["00000000272", 900, null],
    ]);
  });

  test("a folha mensal não ganha o campo (comportamento antigo intacto)", () => {
    const mensal = texto.replace("Cálculo: 13o Adiantamento", "Cálculo: Folha Mensal");
    expect(lerTextoExtrato(mensal).funcionarios.every((f) => !("mediaValor13" in f))).toBe(true);
  });
});
