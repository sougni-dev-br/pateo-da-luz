import { describe, expect, test } from "vitest";
import {
  competenciaDoMes, composicaoAPagar, lacunasPorImposto, mesAnterior, mesDaData, montarGrade, prazoDaGuia, rotuloMes, ultimoDiaDoMes,
  type LinhaCobertura,
} from "../regras";

describe("prazoDaGuia", () => {
  const hoje = "2026-10-20";

  test.each([
    ["2026-10-20T00:00:00.000Z", "vence hoje", "hoje"],
    ["2026-10-21", "vence amanhã", "breve"],
    ["2026-10-25", "vence em 5 dias", "breve"],
    ["2026-11-10", "vence em 21 dias", "folga"],
    ["2026-10-19", "venceu ontem", "atraso"],
    ["2026-10-08", "venceu há 12 dias", "atraso"],
  ])("%s → %s", (venc, texto, tom) => {
    expect(prazoDaGuia(venc, hoje)).toEqual({ texto, tom });
  });

  test("data inválida não inventa prazo", () => {
    expect(prazoDaGuia("xx", hoje)).toBeNull();
  });
});

describe("meses", () => {
  test("rótulo curto", () => {
    expect(rotuloMes("2026-09")).toBe("set/26");
    expect(rotuloMes("2025-01")).toBe("jan/25");
    expect(rotuloMes("")).toBe("—");
  });

  test("competência gravada ↔ campo de mês", () => {
    expect(competenciaDoMes("2026-09")).toBe("2026-09-01");
    expect(competenciaDoMes("")).toBe("");
    expect(mesDaData("2026-09-01T00:00:00.000Z")).toBe("2026-09");
    expect(mesDaData(null)).toBe("");
  });

  test("último dia do mês, inclusive fevereiro bissexto", () => {
    expect(ultimoDiaDoMes("2026-09")).toBe("2026-09-30");
    expect(ultimoDiaDoMes("2028-02")).toBe("2028-02-29");
  });

  test("mês anterior atravessa o ano", () => {
    expect(mesAnterior("2026-01")).toBe("2025-12");
    expect(mesAnterior("2026-10")).toBe("2026-09");
  });
});

describe("composicaoAPagar", () => {
  test("soma as faixas e calcula a fatia de cada uma", () => {
    const c = composicaoAPagar({
      vencido: { qtd: 2, valor: 250 },
      ate7: { qtd: 1, valor: 250 },
      ate30: { qtd: 1, valor: 500 },
      depois: { qtd: 0, valor: 0 },
    });
    expect(c.total).toBe(1000);
    expect(c.qtd).toBe(4);
    expect(c.fatias.map((f) => f.pct)).toEqual([25, 25, 50, 0]);
  });

  test("sem nada a pagar não divide por zero", () => {
    const z = { qtd: 0, valor: 0 };
    const c = composicaoAPagar({ vencido: z, ate7: z, ate30: z, depois: z });
    expect(c.total).toBe(0);
    expect(c.fatias.every((f) => f.pct === 0)).toBe(true);
  });
});

describe("grade de cobertura", () => {
  const meses = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  const hoje = "2026-10-20";
  const linha = (mes: string, grupo: string, extra: Partial<LinhaCobertura> = {}): LinhaCobertura => ({
    mes, grupo, qtd: 1, pagas: 1, vencidas: 0, valor: 100, ...extra,
  });

  test("estado da célula: pago, em aberto, vencido ou vazio", () => {
    const g = montarGrade(
      [linha("2026-05", "FGTS"), linha("2026-06", "FGTS", { pagas: 0 }), linha("2026-07", "FGTS", { pagas: 0, vencidas: 1 })],
      meses, hoje
    );
    expect(g[0].celulas.map((c) => c.estado)).toEqual(["pago", "aberto", "vencido", "vazio", "vazio", "vazio"]);
  });

  test("em imposto mensal, mês sem guia entre o primeiro lançado e o mês anterior ao de hoje é lacuna", () => {
    const g = montarGrade([linha("2026-05", "FGTS"), linha("2026-06", "FGTS"), linha("2026-07", "FGTS")], meses, hoje);
    const lacunas = g[0].celulas.filter((c) => c.lacuna).map((c) => c.mes);
    expect(lacunas).toEqual(["2026-08", "2026-09"]);
  });

  test("o mês corrente nunca é lacuna (a guia dele ainda não saiu)", () => {
    const g = montarGrade([linha("2026-07", "FGTS"), linha("2026-08", "FGTS"), linha("2026-09", "FGTS")], meses, hoje);
    expect(g[0].celulas.find((c) => c.mes === "2026-10")?.lacuna).toBe(false);
  });

  test("imposto que não é mensal (poucos meses) não gera lacuna", () => {
    const g = montarGrade([linha("2026-05", "IPTU"), linha("2026-08", "IPTU")], meses, hoje);
    expect(g[0].mensal).toBe(false);
    expect(g[0].celulas.some((c) => c.lacuna)).toBe(false);
  });

  test("linhas na ordem que o dono pensa: Simples, FGTS, INSS e o resto em ordem alfabética", () => {
    const g = montarGrade(
      [linha("2026-05", "Zeta"), linha("2026-05", "FGTS"), linha("2026-05", "Simples Nacional"), linha("2026-05", "Alfa")],
      meses, hoje
    );
    expect(g.map((l) => l.grupo)).toEqual(["Simples Nacional", "FGTS", "Alfa", "Zeta"]);
  });

  test("lacunas por imposto: cada um com os seus meses em falta", () => {
    const cobertura = [
      ...["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].map((m) => linha(m, "Simples Nacional")),
      ...["2026-05", "2026-06", "2026-07"].map((m) => linha(m, "FGTS")),
    ];
    const g = montarGrade(cobertura, meses, hoje);
    expect(lacunasPorImposto(g)).toEqual([{ grupo: "FGTS", meses: ["2026-08", "2026-09"] }]);
  });

  test("Sem categoria não conta como imposto mensal", () => {
    const g = montarGrade(["2026-05", "2026-06", "2026-07"].map((m) => linha(m, "Sem categoria")), meses, hoje);
    expect(g[0].mensal).toBe(false);
    expect(lacunasPorImposto(g)).toEqual([]);
  });

  test("sem imposto mensal não há o que acusar", () => {
    expect(lacunasPorImposto(montarGrade([], meses, hoje))).toEqual([]);
  });
});
