import { describe, expect, test } from "vitest";
import { mascararDadosSensiveis } from "../auditoria-mascara.js";

// A auditoria do cadastro gravava CPF, PIS, RG, conta e PIX por extenso. Daqui para frente,
// só os 2 últimos dígitos. Dados fictícios.
describe("mascararDadosSensiveis", () => {
  test("CPF fica •••.•••.•••-NN; PIS, RG, conta, agência e PIX só com os 2 últimos", () => {
    const r = mascararDadosSensiveis({
      id: "e1", firstName: "Fulano", cpf: "52998224725", pis: "12345678944", rg: "12.345.678-9",
      bankAgency: "1234", bankAccount: "000123456", bankAccountDigit: "7", pixKey: "fulano@exemplo.com",
      ctpsNumero: "1234567", tituloEleitor: "123456789012", baseSalary: "2200",
    }) as Record<string, unknown>;
    expect(r).toMatchObject({
      id: "e1", firstName: "Fulano", baseSalary: "2200",
      cpf: "•••.•••.•••-25", pis: "•••••44",
      bankAgency: "•••••34", bankAccount: "•••••56", bankAccountDigit: "•", pixKey: "•••••om",
      ctpsNumero: "•••••67", tituloEleitor: "•••••12",
    });
    expect(r.rg).toBe("•••••89");
    expect(JSON.stringify(r)).not.toMatch(/52998224725|12345678944|000123456|fulano@exemplo/);
  });

  test("não muta o original; null, vazio e objeto sem os campos passam iguais", () => {
    const original = { cpf: "52998224725", pixKey: null, rg: "" };
    const r = mascararDadosSensiveis(original);
    expect(original.cpf).toBe("52998224725");
    expect(r).toEqual({ cpf: "•••.•••.•••-25", pixKey: null, rg: "" });
    expect(mascararDadosSensiveis(null)).toBeNull();
    expect(mascararDadosSensiveis({ reason: "x" })).toEqual({ reason: "x" });
  });
});
