import { describe, expect, test } from "vitest";
import { valoresMudaram } from "../payroll.routes.js";

const base = { bruto: 846.77, salario: 659.97, gorjeta: 186.8, vales: 20, vtDesconto: 0, outroDesconto: 0, liquido: 826.77 };

describe("ajuste da rescisão lançada", () => {
  test("os mesmos valores não contam como ajuste", () => {
    expect(valoresMudaram(base, { ...base })).toBe(false);
  });
  test("um centavo a mais em qualquer parte já é ajuste", () => {
    expect(valoresMudaram(base, { ...base, gorjeta: 186.81, bruto: 846.78, liquido: 826.78 })).toBe(true);
    expect(valoresMudaram(base, { ...base, vtDesconto: 10, liquido: 816.77 })).toBe(true);
  });
  test("lançada antes da separação (sem salário/gorjeta) e agora separada conta como mudança", () => {
    expect(valoresMudaram({ ...base, salario: null, gorjeta: null }, base)).toBe(true);
  });
});

import { lerValoresRescisao, textoLimitado } from "../payroll.routes.js";
import { semDadosPessoais, type ApuracaoRescisao } from "../rescisao-apuracao.js";

describe("leitura dos valores da rescisão (auditoria)", () => {
  test("sem registro exige salário e gorjeta: bruto avulso não passa (fugiria da justificativa)", () => {
    expect(lerValoresRescisao({ grossAmount: 5000 }, true, 0)).toEqual({ erro: "Informe o salário proporcional e a gorjeta da rescisão." });
  });
  test("sem registro: bruto = salário + gorjeta + créditos; vales, VT e outro descontam", () => {
    const r = lerValoresRescisao({ salario: 659.97, gorjeta: 186.8, valesDiscount: 20, vtDiscount: 0 }, true, 0);
    expect(r).toMatchObject({ gross: 846.77, net: 826.77 });
  });
  test("CLT ignora salário/gorjeta/vales do corpo: vale o bruto da contabilidade", () => {
    const r = lerValoresRescisao({ grossAmount: 3095.08, salario: 1, gorjeta: 1, valesDiscount: 50, vtDiscount: 10 }, false, 0);
    expect(r).toMatchObject({ gross: 3095.08, net: 3085.08, componentes: { salario: null, gorjeta: null, vales: 0 } });
  });
  test("número inválido, infinito, negativo ou absurdo é recusado", () => {
    for (const v of ["abc", "Infinity", -1, 1e21]) {
      expect(lerValoresRescisao({ grossAmount: 100, vtDiscount: v }, false, 0)).toHaveProperty("erro");
    }
  });
  test("texto livre: só string, cortado no limite", () => {
    expect(textoLimitado({ a: 1 }, 10)).toBeNull();
    expect(textoLimitado("  ", 10)).toBeNull();
    expect(textoLimitado("abcdefghijklmn", 5)).toBe("abcde");
  });
});

describe("sem permissão de ver Funcionários", () => {
  test("a apuração sai sem salário e sem descrição dos vales", () => {
    const a = {
      saida: "2026-09-12", semRegistro: true,
      vt: { total: 0, dias: [], semDetalhe: [], observacao: null },
      vales: { itens: [{ codigo: "VALE-1", data: null, tipo: "OUTRO", descricao: "pessoal", valor: 20 }], descontos: 20, creditos: 0, liquido: 20, entraNaRescisao: true },
      gorjeta: { periodo: "x", status: "OPEN" as const, pontos: 1, valorPonto: 1, gorjeta: 100, pendente: false, diasSalario: 9, salarioProporcional: 659.97 },
      gorjetaObservacao: null,
      sugestao: { salario: 659.97, gorjeta: 100, creditos: 0, vales: 20, valesRotulo: "VALE-1", vtDesconto: 0, bruto: 759.97 },
    } satisfies ApuracaoRescisao;
    const r = semDadosPessoais(a)!;
    expect(r.sugestao.salario).toBeNull();
    expect(r.sugestao.bruto).toBeNull();
    expect(r.gorjeta?.salarioProporcional).toBeNull();
    expect(r.vales.itens[0].descricao).toBeNull();
    expect(r.sugestao.gorjeta).toBe(100);
  });
});
