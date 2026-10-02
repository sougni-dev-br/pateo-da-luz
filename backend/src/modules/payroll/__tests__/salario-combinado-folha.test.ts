import { describe, expect, test } from "vitest";
import {
  composicaoParaTela, gorjetaDaPessoa, mesclarDetalhes, salarioDaFolha, valorIntegralCombinado,
} from "../salario-combinado-folha.js";
import { montarFolhaLiquidos } from "../tip-conferencia.js";

// Regra do dono: quem tem salário combinado recebe no dia 5 o valor INTEGRAL,
// (combinado − adiantamento) + gorjeta calculada na íntegra — não só o líquido do extrato.
describe("valorIntegralCombinado", () => {
  test("caso do Teodoro em setembro: 5.200 − 1.468,80 + 2.223,54 = 5.954,74", () => {
    expect(valorIntegralCombinado({ combinado: 5200, adiantamento: 1468.8, gorjeta: 2223.54 })).toBe(5954.74);
  });

  test("arredonda a centavos", () => {
    expect(valorIntegralCombinado({ combinado: 1000.1, adiantamento: 0.2, gorjeta: 0.3 })).toBe(1000.2);
  });

  test("a folha de líquidos usa a mesma conta", () => {
    const [linha] = montarFolhaLiquidos(
      [{ employeeId: "e1", nome: "E", semRegistro: false, noPeriodo: true, pagoNaRescisao: false, gorjetaLiquida: 2223.54, totalAPagar: 0, cnpjEmpresa: null, pix: null }],
      [{ empresa: "X", cnpj: "1", linhas: [{ employeeId: "e1", nome: "E", liquido: 3030, gorjeta: 100, adiantamento: 1468.8, situacao: null, vinculo: "CPF" }] }],
      new Map([["e1", 5200]]),
    );
    expect(linha.valor).toBe(valorIntegralCombinado({ combinado: 5200, adiantamento: 1468.8, gorjeta: 2223.54 }));
  });
});

describe("salarioDaFolha", () => {
  test("sem salário combinado: o líquido do extrato, sem nada a mais", () => {
    const r = salarioDaFolha({ liquidoExtrato: 3030, adiantamento: 1468.8, combinado: null, gorjeta: { noPeriodo: true, gorjetaLiquida: 10 } });
    expect(r).toEqual({ valor: 3030, detalhes: { liquidoExtrato: 3030 }, pendenteGorjeta: false, aviso: null });
  });

  test("com combinado e gorjeta apurada: valor integral e a composição guardada", () => {
    const r = salarioDaFolha({ liquidoExtrato: 3030, adiantamento: 1468.8, combinado: 5200, gorjeta: { noPeriodo: true, gorjetaLiquida: 2223.54 } });
    expect(r.valor).toBe(5954.74);
    expect(r.pendenteGorjeta).toBe(false);
    expect(r.detalhes).toEqual({
      liquidoExtrato: 3030, combinado: 5200, adiantamento: 1468.8, gorjetaIntegral: 2223.54, complemento: 2924.74,
      origemValor: "SALARIO_COMBINADO",
      composicao: "(R$ 5.200,00 − adiantamento R$ 1.468,80) + gorjeta R$ 2.223,54 = R$ 5.954,74 "
        + "(líquido do extrato R$ 3.030,00 + diferença do salário combinado R$ 2.924,74)",
    });
  });

  test("na apuração mas fora do período: gorjeta zero (igual à folha de líquidos)", () => {
    const r = salarioDaFolha({ liquidoExtrato: 3030, adiantamento: 1000, combinado: 5200, gorjeta: { noPeriodo: false, gorjetaLiquida: 999 } });
    expect(r.valor).toBe(4200);
    expect(r.detalhes.gorjetaIntegral).toBe(0);
  });

  test("adiantamento não lido no extrato: considerado zero, com aviso", () => {
    const r = salarioDaFolha({ liquidoExtrato: 3030, adiantamento: null, combinado: 5200, gorjeta: { noPeriodo: true, gorjetaLiquida: 100 } });
    expect(r.valor).toBe(5300);
    expect(r.aviso).toBe("adiantamento não lido no extrato: considerado zero");
  });

  test("sem a gorjeta da competência: o líquido do extrato, marcado como pendente", () => {
    const r = salarioDaFolha({ liquidoExtrato: 3030, adiantamento: 1468.8, combinado: 5200, gorjeta: null });
    expect(r.valor).toBe(3030);
    expect(r.pendenteGorjeta).toBe(true);
    expect(r.detalhes).toEqual({ liquidoExtrato: 3030, combinado: 5200, adiantamento: 1468.8, pendenteGorjeta: true });
  });
});

describe("mesclarDetalhes", () => {
  test("tira a composição antiga do combinado e mantém o resto do extrato", () => {
    const antigos = { calculo: "MENSAL", liquido: 3030, empresa: "X", origemValor: "SALARIO_COMBINADO", combinado: 5200, complemento: 1, composicao: "a", gorjetaIntegral: 2 };
    expect(mesclarDetalhes(antigos, { liquidoExtrato: 3030 })).toEqual({ calculo: "MENSAL", liquido: 3030, empresa: "X", liquidoExtrato: 3030 });
  });

  test("pendente que passa a calculado perde a marca de pendente", () => {
    const r = mesclarDetalhes({ liquido: 1, pendenteGorjeta: true }, { liquidoExtrato: 1, origemValor: "SALARIO_COMBINADO" });
    expect(r).not.toHaveProperty("pendenteGorjeta");
  });

  test("detalhes que não são objeto viram objeto", () => {
    expect(mesclarDetalhes(null, { liquidoExtrato: 1 })).toEqual({ liquidoExtrato: 1 });
  });
});

describe("composicaoParaTela", () => {
  test("salário combinado: líquido do extrato + diferença = total", () => {
    expect(composicaoParaTela({ origemValor: "SALARIO_COMBINADO", liquidoExtrato: 3030, complemento: 2924.74, combinado: 5200, adiantamento: 1468.8, gorjetaIntegral: 2223.54 }, 5954.74))
      .toEqual({ tipo: "SALARIO_COMBINADO", liquidoExtrato: 3030, complemento: 2924.74, total: 5954.74, combinado: 5200, adiantamento: 1468.8, gorjetaIntegral: 2223.54 });
  });

  test("pendente da gorjeta", () => {
    expect(composicaoParaTela({ pendenteGorjeta: true, liquidoExtrato: 3030, combinado: 5200 }, 3030))
      .toEqual({ tipo: "PENDENTE_GORJETA", liquidoExtrato: 3030, complemento: 0, total: 3030, combinado: 5200, adiantamento: null, gorjetaIntegral: null });
  });

  test("lançamento comum: nada", () => {
    expect(composicaoParaTela({ liquido: 3030 }, 3030)).toBeNull();
    expect(composicaoParaTela(null, 3030)).toBeNull();
  });
});

// Auditoria 01/10: a gorjeta paga no termo de rescisão (pagoNaRescisao) era somada de novo
// no salário combinado; e quem estava fora da apuração ficava pendente para sempre.
describe("salário combinado: gorjeta paga na rescisão e pessoa fora da apuração", () => {
  test("pagoNaRescisao: gorjeta zero no salário combinado (combinado − adiantamento)", () => {
    const r = salarioDaFolha({ liquidoExtrato: 3030, adiantamento: 1468.8, combinado: 5200, gorjeta: { noPeriodo: true, gorjetaLiquida: 2223.54, pagoNaRescisao: true } });
    expect(r.valor).toBe(3731.2);
    expect(r.detalhes.gorjetaIntegral).toBe(0);
    expect(r.pendenteGorjeta).toBe(false);
  });

  test("folha de líquidos: pagoNaRescisao também não soma a gorjeta", () => {
    const [linha] = montarFolhaLiquidos(
      [{ employeeId: "e1", nome: "E", semRegistro: false, noPeriodo: true, pagoNaRescisao: true, gorjetaLiquida: 2223.54, totalAPagar: 0, cnpjEmpresa: null, pix: null }],
      [{ empresa: "X", cnpj: "1", linhas: [{ employeeId: "e1", nome: "E", liquido: 3030, gorjeta: 100, adiantamento: 1468.8, situacao: null, vinculo: "CPF" }] }],
      new Map([["e1", 5200]]),
    );
    expect(linha.valor).toBe(3731.2);
  });

  test("gorjetaDaPessoa: sem apuração = pendente (null); apuração sem a pessoa = gorjeta zero", () => {
    expect(gorjetaDaPessoa(null, "e1")).toBeNull();
    expect(gorjetaDaPessoa(undefined, "e1")).toBeNull();
    expect(gorjetaDaPessoa(new Map(), "e1")).toEqual({ noPeriodo: false, gorjetaLiquida: 0 });
    const mapa = new Map([["e1", { noPeriodo: true, gorjetaLiquida: 10 }]]);
    expect(gorjetaDaPessoa(mapa, "e1")).toEqual({ noPeriodo: true, gorjetaLiquida: 10 });
  });
});
