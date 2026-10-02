import { describe, expect, test } from "vitest";
import { type LinhaFolha, aplicarAcertosAjustados, textoContaBancaria } from "../tip-conferencia.js";

// Dados fictícios.
const linha = (o: Partial<LinhaFolha> = {}): LinhaFolha => ({
  employeeId: "a", nome: "Fulana de Tal", grupo: "Sem registro", origem: "SEM_REGISTRO", valor: 3616.76,
  composicao: "salário + gorjeta − vales", pix: null, pixTipo: null, contaBancaria: null, aviso: null, ...o,
});

describe("conta bancária no texto da folha", () => {
  test("banco, agência e conta com dígito e tipo", () => {
    expect(textoContaBancaria({ bankName: "Banco Fictício", bankAgency: "0123", bankAccount: "45678", bankAccountDigit: "9", bankAccountType: "CONTA_CORRENTE" }))
      .toBe("Banco Fictício · Ag. 0123 · C/C 45678-9");
    expect(textoContaBancaria({ bankName: "Banco Fictício", bankAgency: null, bankAccount: "111", bankAccountDigit: null, bankAccountType: "POUPANCA" }))
      .toBe("Banco Fictício · Poupança 111");
  });

  test("sem banco e sem conta não há conta", () => {
    expect(textoContaBancaria({ bankName: null, bankAgency: null, bankAccount: null, bankAccountDigit: null, bankAccountType: "CONTA_CORRENTE" })).toBeNull();
    expect(textoContaBancaria({ bankName: "  ", bankAgency: "1", bankAccount: " ", bankAccountDigit: null, bankAccountType: "CONTA_CORRENTE" })).toBeNull();
  });
});

describe("acerto ajustado à mão no Contas a Pagar", () => {
  test("o sem registro paga o valor do acerto, com aviso", () => {
    const [l] = aplicarAcertosAjustados([linha()], new Map([["a", 1883.46]]));
    expect(l.valor).toBe(1883.46);
    expect(l.composicao).toBe("acerto ajustado à mão no Contas a Pagar");
    expect(l.aviso).toMatch(/ajustado à mão.*3\.616,76/);
  });

  test("CLT e quem não tem ajuste ficam como estão", () => {
    const clt = linha({ employeeId: "a", origem: "EXTRATO", grupo: "Empresa", valor: 2000 });
    const outro = linha({ employeeId: "b" });
    expect(aplicarAcertosAjustados([clt, outro], new Map([["a", 1]]))).toEqual([clt, outro]);
  });
});
