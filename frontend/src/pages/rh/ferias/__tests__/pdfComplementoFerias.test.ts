import { describe, expect, test } from "vitest";
import type { PreviaFeriasCombinado } from "../../../../api/client";
import { linhasDaConta, nomeDoArquivoComplemento } from "../pdfComplementoFerias";

const previa = (o: Partial<PreviaFeriasCombinado> = {}): PreviaFeriasCombinado => ({
  payrollItemId: "pi1", employeeId: "e1", nome: "Ana Paula Exemplo", combinado: 6000, mediaGorjeta: 1500, mesesContados: 11,
  mesesAusentes: [], remuneracao: 10000, liquidoRecibo: 5000, complemento: 5000, valorAntes: 5000, valorDepois: 10000,
  formula: null, meses: [], avisos: [], ...o,
});

describe("linhasDaConta", () => {
  test("segue a ordem do modal e marca as somas parciais", () => {
    const l = linhasDaConta(previa());
    expect(l.map((x) => x.rotulo)).toEqual([
      "Salário combinado vigente", "Média da gorjeta (11 meses contados de 12)", "Remuneração mensal",
      "Remuneração devida nas férias (já com o 1/3)", "Líquido do recibo da contabilidade (já descontados IR e INSS)", "Complemento a pagar",
    ]);
    expect(l.filter((x) => x.soma).map((x) => x.rotulo)).toEqual(["Remuneração mensal", "Remuneração devida nas férias (já com o 1/3)", "Complemento a pagar"]);
    expect(l[4].valor.startsWith("- ")).toBe(true);
  });

  test("sem combinado vigente não inventa a remuneração mensal", () => {
    const l = linhasDaConta(previa({ combinado: null }));
    expect(l[0].valor).toBe("Sem combinado vigente");
    expect(l.some((x) => x.rotulo === "Remuneração mensal")).toBe(false);
  });

  test("um mês contado fica no singular", () => {
    expect(linhasDaConta(previa({ mesesContados: 1 }))[1].rotulo).toContain("1 mês contado");
  });
});

describe("nomeDoArquivoComplemento", () => {
  test("tira acento e símbolos do nome", () => {
    expect(nomeDoArquivoComplemento("Eli Sílva  da Luz!")).toBe("complemento-ferias-eli-silva-da-luz.pdf");
  });
  test("nome vazio cai num nome genérico", () => {
    expect(nomeDoArquivoComplemento("  ")).toBe("complemento-ferias-pessoa.pdf");
  });
});
