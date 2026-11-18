import { describe, expect, test } from "vitest";
import {
  competenciaDoMes, composicaoAPagar, mesDoFiltro, lacunasPorEmpresa, lacunasPorImposto, linkContasAPagar, mesAnterior, mesDaData, montarGrade, prazoDaGuia, rotuloMes, ultimoDiaDoMes,
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

describe("mês do filtro de competência", () => {
  test.each([["", "vazio"], ["2026-09", "valido"], ["2000-01", "valido"], ["20266-02", "invalido"], ["202-09", "invalido"], ["2026-13", "invalido"], ["2026-00", "invalido"], ["abc", "invalido"]])(
    "%j é %s", (valor, esperado) => { expect(mesDoFiltro(valor)).toBe(esperado); },
  );
});

describe("falta de guia de uma empresa", () => {
  const meses = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  const hoje = "2026-11-18"; // o último mês esperado é outubro
  const g = (mes: string, grupo: string, empresaId: string | null, extra: object = {}) => ({
    mes, grupo, empresaId, empresa: empresaId === "A" ? "Empresa A" : empresaId === "B" ? "Empresa B" : null, qtd: 1, ...extra,
  });
  const mensais = (grupo: string, empresaId: string, lista: string[]) => lista.map((m) => g(m, grupo, empresaId));

  test("uma empresa sem a guia do mês que a outra lançou é acusada (a grade global mostra '1' e não acusa)", () => {
    const cob = [
      ...mensais("FGTS", "A", ["2026-05", "2026-07", "2026-08", "2026-09", "2026-10"]),
      ...mensais("FGTS", "B", ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]),
    ];
    expect(lacunasPorEmpresa(cob, meses, hoje)).toEqual([{ grupo: "FGTS", empresaId: "A", empresa: "Empresa A", meses: ["2026-06"] }]);
  });

  test("mês em que ninguém tem a guia não é por empresa: quem acusa é a grade global", () => {
    const cob = [...mensais("FGTS", "A", ["2026-05", "2026-07", "2026-08"]), ...mensais("FGTS", "B", ["2026-05", "2026-07", "2026-08"])];
    expect(lacunasPorEmpresa(cob, meses, hoje)).toEqual([]);
  });

  test("guia sem empresa no mês (legado) impede acusar: pode ser da empresa que 'falta'", () => {
    const cob = [
      ...mensais("FGTS", "A", ["2026-05", "2026-07", "2026-08", "2026-09"]),
      ...mensais("FGTS", "B", ["2026-05", "2026-07", "2026-08", "2026-09"]),
      g("2026-06", "FGTS", null),
    ];
    expect(lacunasPorEmpresa(cob, meses, hoje)).toEqual([]);
  });

  test("empresa com poucos meses de guia (menos de 3) não é cobrada", () => {
    const cob = [...mensais("FGTS", "A", ["2026-06", "2026-07"]), ...mensais("FGTS", "B", ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"])];
    expect(lacunasPorEmpresa(cob, meses, hoje)).toEqual([]);
  });

  test("só a partir do primeiro mês da empresa: antes disso ela ainda não existia no imposto", () => {
    const cob = [...mensais("FGTS", "A", ["2026-08", "2026-09", "2026-10"]), ...mensais("FGTS", "B", meses)];
    expect(lacunasPorEmpresa(cob, meses, hoje)).toEqual([]);
  });

  test("empresa que parou de lançar (nenhuma guia nos 3 últimos meses esperados) é tratada como encerrada", () => {
    // última guia da A em maio; hoje é novembro: junho a setembro não são falta dela (CNPJ antigo)
    const cob = [...mensais("FGTS", "A", ["2026-03", "2026-04", "2026-05"]), ...mensais("FGTS", "B", ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"])];
    expect(lacunasPorEmpresa(cob, ["2026-03", "2026-04", "2026-05", ...meses.slice(1)], hoje)).toEqual([]);
    // mas quem lançou até agosto ainda é cobrada em setembro
    const ativa = [...mensais("FGTS", "A", ["2026-05", "2026-06", "2026-08"]), ...mensais("FGTS", "B", ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"])];
    expect(lacunasPorEmpresa(ativa, meses, hoje).map((x) => [x.empresa, x.meses])).toEqual([["Empresa A", ["2026-07", "2026-09"]]]);
  });

  test("o mês corrente (novembro) nunca é cobrado", () => {
    const cob = [...mensais("FGTS", "A", ["2026-08", "2026-09", "2026-10"]), ...mensais("FGTS", "B", ["2026-08", "2026-09", "2026-10", "2026-11"])];
    expect(lacunasPorEmpresa(cob, [...meses, "2026-11"], hoje)).toEqual([]);
  });

  test("INSS e IRRF / DARF contam como um imposto só (o DARF é um documento): guia em qualquer das duas vale", () => {
    const cob = [
      ...mensais("INSS", "A", ["2026-07", "2026-08", "2026-09"]), g("2026-10", "IRRF / DARF", "A"),
      ...mensais("INSS", "B", ["2026-07", "2026-08", "2026-09", "2026-10"]),
    ];
    expect(lacunasPorEmpresa(cob, meses, hoje)).toEqual([]);
    // mês em que só uma terceira empresa lançou (sem as duas): as duas são acusadas, juntas num imposto "DARF"
    const jun = [
      ...mensais("INSS", "A", ["2026-05", "2026-07", "2026-08"]), ...mensais("INSS", "B", ["2026-05", "2026-07", "2026-08"]),
      g("2026-06", "IRRF / DARF", "C", { empresa: "Empresa C" }),
    ];
    const r = lacunasPorEmpresa(jun, meses, hoje);
    expect(r.map((x) => [x.grupo, x.empresa, x.meses])).toEqual([["DARF", "Empresa A", ["2026-06"]], ["DARF", "Empresa B", ["2026-06"]]]);
  });

  test("parcelamento, IPTU, taxas e 'Sem categoria' não entram", () => {
    for (const grupo of ["Parcelamentos Tributarios", "IPTU", "Taxas Municipais", "Sem categoria"]) {
      const cob = [...mensais(grupo, "A", ["2026-05", "2026-07", "2026-08"]), ...mensais(grupo, "B", ["2026-05", "2026-06", "2026-07", "2026-08"])];
      expect(lacunasPorEmpresa(cob, meses, hoje)).toEqual([]);
    }
  });

  test("sem dados devolve vazio", () => {
    expect(lacunasPorEmpresa([], meses, hoje)).toEqual([]);
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

  test("DARF: mês sem IRRF não é lacuna quando a guia está lançada em INSS (e vice-versa)", () => {
    const g = montarGrade([
      ...["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].map((m) => linha(m, "INSS", { qtd: 2 })),
      linha("2026-05", "IRRF / DARF"), linha("2026-06", "IRRF / DARF"), linha("2026-07", "IRRF / DARF"),
    ], meses, hoje);
    const irrf = g.find((x) => x.grupo === "IRRF / DARF")!;
    expect(irrf.celulas.filter((c) => c.lacuna).map((c) => c.mes)).toEqual([]);
    // mês sem nenhuma das duas: continua lacuna nas duas linhas
    const sem = montarGrade([
      ...["2026-05", "2026-06", "2026-07"].map((m) => linha(m, "INSS")),
      ...["2026-05", "2026-06", "2026-07"].map((m) => linha(m, "IRRF / DARF")),
    ], meses, hoje);
    expect(sem.find((x) => x.grupo === "INSS")!.celulas.filter((c) => c.lacuna).map((c) => c.mes)).toEqual(["2026-08", "2026-09"]);
    expect(sem.find((x) => x.grupo === "IRRF / DARF")!.celulas.filter((c) => c.lacuna).map((c) => c.mes)).toEqual(["2026-08", "2026-09"]);
  });

  test.each(["Parcelamentos Tributarios", "Parcelamentos Tributários", "IPTU", "Taxas Municipais"])("%s termina ou é anual: não gera 'falta lançar'", (grupo) => {
    const g = montarGrade(["2026-05", "2026-06", "2026-07"].map((m) => linha(m, grupo)), meses, hoje);
    expect(g[0].mensal).toBe(false);
    expect(g[0].celulas.some((c) => c.lacuna)).toBe(false);
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

describe("linkContasAPagar", () => {
  test("filtra pelo número do documento e pelo mês do vencimento, abrindo em Todos", () => {
    const url = linkContasAPagar({ id: "g1", documentNumber: "07.20.26290.7165263-2", documentType: "Simples Nacional / DAS", dueDate: "2026-10-20T00:00:00.000Z" });
    const p = new URL(url, "https://x.test").searchParams;
    expect(url.startsWith("/financeiro/contas-a-pagar?")).toBe(true);
    expect(p.get("busca")).toBe("07.20.26290.7165263-2");
    expect(p.get("aba")).toBe("todos");
    expect(p.get("de")).toBe("2026-10-01");
    expect(p.get("ate")).toBe("2026-10-31");
  });

  test("leva o id da guia e pede para abrir a baixa, marcando a origem para o caminho de volta", () => {
    const p = new URL(linkContasAPagar({ id: "g1", documentNumber: null, documentType: "FGTS", dueDate: "2026-10-20" }), "https://x.test").searchParams;
    expect(p.get("titulo")).toBe("g1");
    expect(p.get("abrir")).toBe("baixa");
    expect(p.get("origem")).toBe("impostos");
  });

  test("sem número do documento, busca pelo tipo", () => {
    const url = linkContasAPagar({ id: "g2", documentNumber: null, documentType: "FGTS", dueDate: "2026-02-10T00:00:00.000Z" });
    const p = new URL(url, "https://x.test").searchParams;
    expect(p.get("busca")).toBe("FGTS");
    expect(p.get("ate")).toBe("2026-02-28");
  });
});
