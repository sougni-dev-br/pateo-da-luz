import { describe, expect, test } from "vitest";
import { diasEntre, periodosDeFerias, piorNivel, somarDias, somarMeses, type HistoricoFerias, type Programacao } from "../ferias-calc.js";

const prog = (o: Partial<Programacao> & Pick<Programacao, "aquisitivoInicio">): Programacao => ({
  id: "p1", gozoInicio: null, dias: 30, diasAbono: 0, status: "PROGRAMADA", observacao: null, ...o,
});
const calc = (admissao: string, hoje: string, programacoes: Programacao[] = [], historico: HistoricoFerias[] = []) =>
  periodosDeFerias({ admissao, hoje, programacoes, historico });

describe("datas", () => {
  test("somarMeses não atravessa o fim do mês", () => {
    expect(somarMeses("2024-02-29", 12)).toBe("2025-02-28");
    expect(somarMeses("2025-01-31", 1)).toBe("2025-02-28");
  });
  test("somarDias e diasEntre são inversos", () => {
    expect(somarDias("2026-02-28", 1)).toBe("2026-03-01");
    expect(diasEntre("2026-10-15", "2026-11-14")).toBe(30);
  });
});

describe("limite para gozo bate com o relatório da contabilidade de 15/10/2026", () => {
  test.each([
    ["2025-03-01", "2025-03-01", "2026-02-28", "2027-01-30"],
    ["2025-10-01", "2025-10-01", "2026-09-30", "2027-09-01"],
    ["2025-08-05", "2025-08-05", "2026-08-04", "2027-07-06"],
    ["2025-06-01", "2025-06-01", "2026-05-31", "2027-05-02"],
  ])("admissão %s", (adm, inicio, fim, limite) => {
    const p = calc(adm, "2026-10-15").find((x) => x.aquisitivoInicio === inicio)!;
    expect(p.aquisitivoFim).toBe(fim);
    expect(p.limiteInicioGozo).toBe(limite);
  });
});

describe("situação do período", () => {
  test("período em curso é EM_AQUISICAO e diz quando o direito nasce", () => {
    const p = calc("2026-08-01", "2026-10-15")[0];
    expect(p.situacao).toBe("EM_AQUISICAO");
    expect(p.diasParaCompletar).toBe(diasEntre("2026-10-15", "2027-08-01"));
  });
  test("período completo sem gozo fica DISPONIVEL quando o limite está longe", () => {
    const p = calc("2025-03-01", "2026-10-15").find((x) => x.aquisitivoInicio === "2025-03-01")!;
    expect(p.situacao).toBe("DISPONIVEL");
    expect(p.nivel).toBe("ok");
    expect(p.diasPendentes).toBe(30);
  });
  test("a 90 dias do limite vira atenção; a 30, perigo", () => {
    expect(calc("2025-03-01", "2026-11-01")[0].nivel).toBe("atencao");
    const urgente = calc("2025-03-01", "2027-01-01")[0];
    expect(urgente.nivel).toBe("perigo");
    expect(urgente.situacao).toBe("A_VENCER");
  });
  test("passou do limite sem gozar é VENCIDA", () => {
    const p = calc("2025-03-01", "2027-02-01")[0];
    expect(p.situacao).toBe("VENCIDA");
    expect(p.diasParaLimite).toBeLessThan(0);
  });
  test("programada dentro do prazo quita o alerta", () => {
    const p = calc("2025-03-01", "2026-10-15", [prog({ aquisitivoInicio: "2025-03-01", gozoInicio: "2026-12-01" })])[0];
    expect(p.situacao).toBe("PROGRAMADA");
    expect(p.diasPendentes).toBe(0);
    expect(p.nivel).toBe("ok");
    expect(p.programacoes[0].gozoFim).toBe("2026-12-30");
  });
  test("programada depois do limite continua em perigo", () => {
    const p = calc("2025-03-01", "2026-10-15", [prog({ aquisitivoInicio: "2025-03-01", gozoInicio: "2027-03-01" })])[0];
    expect(p.foraDoPrazo).toBe(true);
    expect(p.nivel).toBe("perigo");
  });
  test("parte menor que começa depois do limite de 30 dias, mas termina no concessivo, está no prazo", () => {
    const noPrazo = calc("2025-03-01", "2026-10-15", [prog({ aquisitivoInicio: "2025-03-01", gozoInicio: "2027-02-15", dias: 10 })])[0];
    expect(noPrazo.foraDoPrazo).toBe(false);
    const estoura = calc("2025-03-01", "2026-10-15", [prog({ aquisitivoInicio: "2025-03-01", gozoInicio: "2027-02-25", dias: 10 })])[0];
    expect(estoura.foraDoPrazo).toBe(true);
  });
  test("fracionada e com abono: sobra o que falta", () => {
    const abonada = calc("2025-03-01", "2026-10-15", [
      prog({ aquisitivoInicio: "2025-03-01", gozoInicio: "2026-12-01", dias: 20, diasAbono: 10 }),
    ])[0];
    expect(abonada.diasPendentes).toBe(0);
    const metade = calc("2025-03-01", "2026-10-15", [prog({ aquisitivoInicio: "2025-03-01", gozoInicio: "2026-12-01", dias: 15 })])[0];
    expect(metade.diasPendentes).toBe(15);
    expect(metade.situacao).toBe("DISPONIVEL");
  });
  test("gozada lançada fecha o período", () => {
    const p = calc("2025-03-01", "2026-10-15", [prog({ aquisitivoInicio: "2025-03-01", gozoInicio: "2026-05-01", status: "GOZADA" })])[0];
    expect(p.situacao).toBe("GOZADA");
  });
  test("data programada que já passou pede confirmação", () => {
    const p = calc("2025-03-01", "2026-10-15", [prog({ aquisitivoInicio: "2025-03-01", gozoInicio: "2026-10-01" })])[0];
    expect(p.programacoes[0].passouDaData).toBe(true);
  });
  test("histórico da ficha de registro fecha o período (com tolerância)", () => {
    const p = calc("2025-03-01", "2026-10-15", [], [{ aquisitivoInicio: "2025-03-05", gozoInicio: "2026-04-01", gozoFim: "2026-04-30" }])[0];
    expect(p.situacao).toBe("GOZADA");
    expect(p.doHistorico).toBe(true);
  });
  test("ficha sem datas de gozo não quita; gozo parcial abate só os dias dela", () => {
    const semDatas = calc("2025-03-01", "2026-10-15", [], [{ aquisitivoInicio: "2025-03-01", gozoInicio: null, gozoFim: null }])[0];
    expect(semDatas.situacao).toBe("DISPONIVEL");
    expect(semDatas.doHistorico).toBe(false);
    const parcial = calc("2025-03-01", "2026-10-15", [], [{ aquisitivoInicio: "2025-03-01", gozoInicio: "2026-04-01", gozoFim: "2026-04-10" }])[0];
    expect(parcial.diasGozados).toBe(10);
    expect(parcial.diasPendentes).toBe(20);
    expect(parcial.doHistorico).toBe(false);
  });
  test("ficha com gozo e abono que somam 30 quita o período", () => {
    const p = calc("2025-03-01", "2026-10-15", [], [{ aquisitivoInicio: "2025-03-01", gozoInicio: "2026-04-01", gozoFim: "2026-04-20", abonoInicio: "2026-04-21", abonoFim: "2026-04-30" }])[0];
    expect(p.doHistorico).toBe(true);
    expect(p.situacao).toBe("GOZADA");
  });
  test("o prazo de quem tem só parte a tirar considera o saldo, não 30 dias", () => {
    // concessivo termina em 2027-02-28; com 10 dias pendentes o último dia para começar é 19/02.
    const p = calc("2025-03-01", "2027-02-10", [prog({ aquisitivoInicio: "2025-03-01", gozoInicio: "2026-05-01", dias: 20, status: "GOZADA" })])[0];
    expect(p.diasPendentes).toBe(10);
    expect(p.limiteInicioGozo).toBe("2027-02-19");
    expect(p.situacao).toBe("A_VENCER");
    expect(p.diasParaLimite).toBe(9);
  });
  test("períodos que terminaram há mais de 12 meses não são cobrados (já resolvidos pela contabilidade)", () => {
    // Admitido em 2019: o relatório da contabilidade de 15/10/2026 começa no período de 05/08/2025.
    const todos = calc("2019-08-05", "2026-10-15");
    expect(todos.map((p) => p.aquisitivoInicio)).toEqual(["2025-08-05", "2026-08-05"]);
    // Admitido em 01/09/2024: o período de 01/09/2024 (fim 31/08/2025) fica de fora; o de 01/09/2025 entra.
    expect(calc("2024-09-01", "2026-10-15").map((p) => p.aquisitivoInicio)).toEqual(["2025-09-01", "2026-09-01"]);
  });
  test("piorNivel pega o mais grave", () => {
    expect(piorNivel(calc("2025-03-01", "2027-02-01"))).toBe("perigo");
    expect(piorNivel([])).toBe("ok");
  });
});
