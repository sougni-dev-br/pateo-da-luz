import { describe, expect, test } from "vitest";
import type { LinhaHistorico } from "../cadastro-historico.js";
import { diferencaDoCombinado, inicioDoCombinado } from "../decimo-terceiro-combinado.js";
import {
  calcularDecimoTerceiroSR, familia13, ROTULO_13_COMBINADO_PARCELA_1, ROTULO_13_COMBINADO_PARCELA_2, ROTULO_13_EXTRATO_PARCELA_1,
  ROTULO_13_PARCELA_1,
} from "../decimo-terceiro-sr.js";
import { mesmoPagamento } from "../folha-duplicidade.js";

// 13º da diferença do salário combinado. Dados FICTÍCIOS: o repositório é público.
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const linha = (campo: string, valorAnterior: string | null, valorNovo: string | null, vigencia: string, criado = vigencia): LinhaHistorico =>
  ({ campo, valorAnterior, valorNovo, vigenteDesde: d(vigencia), createdAt: d(criado) });

describe("diferencaDoCombinado", () => {
  test("combinado acima do registrado: a diferença", () => {
    expect(diferencaDoCombinado(3000, 4528)).toBe(1528);
    expect(diferencaDoCombinado("3836.87", "5364.87")).toBe(1528);
  });
  test("sem combinado, sem base ou combinado que não passa do registrado: nada a pagar", () => {
    expect(diferencaDoCombinado(3000, null)).toBeNull();
    expect(diferencaDoCombinado(null, 4000)).toBeNull();
    expect(diferencaDoCombinado(3000, 3000)).toBeNull();
    expect(diferencaDoCombinado(3000, 2500)).toBeNull();
  });
});

describe("inicioDoCombinado", () => {
  test("a vigência de quando o combinado nasceu do zero", () => {
    const linhas = [linha("salarioCombinado", null, "4500.00", "2026-03-01"), linha("salarioCombinado", "4500.00", "4650.00", "2026-11-01")];
    expect(inicioDoCombinado(linhas)).toEqual(d("2026-03-01"));
  });
  test("reajuste não muda o início; outros campos são ignorados", () => {
    const linhas = [linha("baseSalary", null, "3000.00", "2026-01-01"), linha("salarioCombinado", "4500.00", "4650.00", "2026-11-01")];
    expect(inicioDoCombinado(linhas)).toBeNull();
  });
  test("combinado tirado e dado de novo: vale o último começo", () => {
    const linhas = [
      linha("salarioCombinado", null, "4500.00", "2026-03-01"), linha("salarioCombinado", "4500.00", null, "2026-05-01"),
      linha("salarioCombinado", null, "4500.00", "2026-07-01"),
    ];
    expect(inicioDoCombinado(linhas)).toEqual(d("2026-07-01"));
  });
  test("sem histórico: null (o chamador usa a admissão)", () => {
    expect(inicioDoCombinado([])).toBeNull();
  });
});

describe("13º da diferença: mesma regra dos sem registro, sem média", () => {
  const diferenca = { ano: 2026, salarioBase: 1528, desligamento: null as Date | null };
  test("combinado desde março: 10 avos, 1ª com os 9 avos até novembro, 2ª fecha o total", () => {
    const c = calcularDecimoTerceiroSR({ ...diferenca, inicio: d("2026-03-01") })!;
    expect(c.avos).toBe(10);
    expect(c.avosParcela1).toBe(9);
    expect(c.mediaParcela1).toBe(0);
    expect(c.parcela1).toBe(573);
    expect(c.total).toBe(1273.33);
    expect(c.parcela2).toBe(700.33);
    expect(c.parcela1 + c.parcela2).toBeCloseTo(c.total, 2);
  });
  test("combinado desde antes do ano: ano inteiro, 1ª é metade da diferença", () => {
    const c = calcularDecimoTerceiroSR({ ...diferenca, inicio: d("2025-03-01") })!;
    expect(c.avos).toBe(12);
    expect(c.parcela1).toBe(764);
    expect(c.total).toBe(1528);
    expect(c.parcela2).toBe(764);
  });
  test("combinado a partir da segunda quinzena do mês não conta o avo daquele mês", () => {
    expect(calcularDecimoTerceiroSR({ ...diferenca, inicio: d("2026-03-20") })!.avos).toBe(9);
  });
});

describe("rótulos do combinado convivem com o extrato", () => {
  const base = { employeeId: "e1", type: "DECIMO_TERCEIRO", competenceYear: 2026, competenceMonth: 11 };
  test("familia13 reconhece a origem COMBINADO", () => {
    expect(familia13(ROTULO_13_COMBINADO_PARCELA_1)).toEqual({ parcela: 1, origem: "COMBINADO" });
    expect(familia13(ROTULO_13_COMBINADO_PARCELA_2)).toEqual({ parcela: 2, origem: "COMBINADO" });
  });
  test("extrato e diferença do combinado da mesma parcela são pagamentos diferentes", () => {
    expect(mesmoPagamento({ ...base, id: "a", periodLabel: ROTULO_13_EXTRATO_PARCELA_1 }, { ...base, id: "b", periodLabel: ROTULO_13_COMBINADO_PARCELA_1 })).toBe(false);
  });
  test("combinado e sem registro também convivem; dois combinados da mesma parcela são duplicidade", () => {
    expect(mesmoPagamento({ ...base, id: "a", periodLabel: ROTULO_13_PARCELA_1 }, { ...base, id: "b", periodLabel: ROTULO_13_COMBINADO_PARCELA_1 })).toBe(false);
    expect(mesmoPagamento({ ...base, id: "a", periodLabel: ROTULO_13_COMBINADO_PARCELA_1 }, { ...base, id: "b", periodLabel: "13º - 1ª parcela (combinado) à mão" })).toBe(true);
  });
});
