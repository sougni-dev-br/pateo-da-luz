import { describe, expect, test } from "vitest";
import { detalhesNaLista } from "../payroll.routes.js";

// Auditoria 01/10: a lista da Folha, sem a permissão de ver Funcionários, filtrava só os
// detalhes da rescisão. O SALARIO (salário combinado) e o ADIANTAMENTO guardam o
// combinado, o adiantamento, a gorjeta integral, o complemento, a composição e o líquido
// do extrato — que revelam o salário. Agora também saem por lista branca.
describe("detalhesNaLista — salário e adiantamento sem ver Funcionários", () => {
  const salario = {
    calculo: "MENSAL", empresa: "PATEO", liquido: 3030, gorjeta: 500, adiantamento: 1468.8,
    liquidoExtrato: 3030, combinado: 5200, gorjetaIntegral: 2223.54, complemento: 2924.74,
    composicao: "(R$ 5.200,00 − ...)", origemValor: "SALARIO_COMBINADO",
  };

  test("SALARIO: sai tudo que revela salário; ficam o cálculo, a empresa e a origem", () => {
    const d = detalhesNaLista("SALARIO", salario, false) as Record<string, unknown>;
    expect(d).toEqual({ calculo: "MENSAL", empresa: "PATEO", origemValor: "SALARIO_COMBINADO" });
    for (const k of ["combinado", "adiantamento", "gorjetaIntegral", "complemento", "composicao", "liquidoExtrato", "liquido", "gorjeta"]) {
      expect(d).not.toHaveProperty(k);
    }
  });

  test("SALARIO pendente da gorjeta: a marca fica", () => {
    expect(detalhesNaLista("SALARIO", { liquidoExtrato: 3030, combinado: 5200, pendenteGorjeta: true }, false)).toEqual({ pendenteGorjeta: true });
  });

  test("ADIANTAMENTO tirado da folha: sai o bruto, fica a origem e a observação", () => {
    const d = detalhesNaLista("ADIANTAMENTO", { calculo: "ADIANTAMENTO", origem: "FOLHA_DO_MES", empresa: "PATEO", adiantamentoBruto: 1468.8, observacao: "x" }, false);
    expect(d).toEqual({ calculo: "ADIANTAMENTO", origem: "FOLHA_DO_MES", empresa: "PATEO", observacao: "x" });
  });

  test("lançamento manual de complemento: a marca (motivo, autor) fica", () => {
    const complemento = { motivo: "pagamento a mais combinado", por: "u1", porNome: "Eli", em: "2026-10-01" };
    const d = detalhesNaLista("SALARIO", { lancamentoManual: true, complemento, duplicaDe: ["p1"] }, false);
    expect(d).toEqual({ lancamentoManual: true, complemento, duplicaDe: ["p1"] });
  });

  test("com a permissão: tudo, como está", () => {
    expect(detalhesNaLista("SALARIO", salario, true)).toBe(salario);
  });

  test("acerto da lista de pagamento (sem registro): a composição sai, a origem fica", () => {
    const acerto = {
      origem: "LISTA_PAGAMENTO", semRegistro: true, apuracao: "GOR-2026-0009", pagamentoQuinzenal: true,
      salario: 2000, diasSalario: 30, adiantamento: 0, primeiraQuinzena: 1000, gorjeta: 500, vales: 50, creditos: 10,
      gorjetaLiquida: 460, horaExtra: 30, adicionalNoturno: 5, totalAPagar: 1495,
    };
    expect(detalhesNaLista("SALARIO", acerto, false)).toEqual({ origem: "LISTA_PAGAMENTO", semRegistro: true });
    expect(detalhesNaLista("SALARIO", acerto, true)).toBe(acerto);
  });

  test("1ª quinzena do sem registro: as marcas ficam, o salário base sai", () => {
    expect(detalhesNaLista("ADIANTAMENTO", { base: 2000, semRegistro: true, primeiraQuinzena: true }, false))
      .toEqual({ semRegistro: true, primeiraQuinzena: true });
  });

  test("VT continua como está (o trajeto aparece na tela)", () => {
    const vt = { trajeto: "sem trajeto cadastrado", diasPagos: [1, 2] };
    expect(detalhesNaLista("VALE_TRANSPORTE", vt, false)).toBe(vt);
  });
});
