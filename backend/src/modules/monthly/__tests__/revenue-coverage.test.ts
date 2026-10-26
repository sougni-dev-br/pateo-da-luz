import { describe, expect, test } from "vitest";
import { calcularCobertura, resumoDeAtrasos, type LinhaDeReceita } from "../revenue-coverage.js";

const linha = (date: string, channel: string, sourcePlatform: string | null): LinhaDeReceita => ({
  date,
  channel,
  sourcePlatform
});

const BASE = { from: "2026-10-01", to: "2026-10-05", today: "2026-10-06" };

function canal(resultado: ReturnType<typeof calcularCobertura>, nome: string) {
  const achado = resultado.find((c) => c.canal === nome);
  if (!achado) throw new Error(`canal ${nome} ausente`);
  return achado;
}

describe("calcularCobertura", () => {
  test("sempre devolve os quatro canais, na ordem fixa, mesmo sem nenhuma linha", () => {
    const r = calcularCobertura({ ...BASE, rows: [], ultimoDiaGeral: {} });
    expect(r.map((c) => c.canal)).toEqual(["Salão", "99Food", "iFood", "Keeta"]);
    expect(r.every((c) => c.situacao === "SEM_DADOS")).toBe(true);
    expect(canal(r, "Keeta").diasSemLancamento).toHaveLength(5);
  });

  test("normaliza o rótulo da plataforma: NOVENTA_NOVE e 99Food contam como o mesmo canal", () => {
    const r = calcularCobertura({
      ...BASE,
      rows: [linha("2026-10-01", "Delivery", "NOVENTA_NOVE"), linha("2026-10-02", "Delivery", "99Food")],
      ultimoDiaGeral: {}
    });
    expect(canal(r, "99Food").diasComDado).toBe(2);
  });

  test("lista os dias sem lançamento dentro da janela e não conta dia repetido duas vezes", () => {
    const r = calcularCobertura({
      ...BASE,
      rows: [linha("2026-10-01", "Salão", "AGILE_PDV"), linha("2026-10-01", "Salão", "AGILE_PDV"), linha("2026-10-04", "Salão", "AGILE_PDV")],
      ultimoDiaGeral: {}
    });
    const salao = canal(r, "Salão");
    expect(salao.diasComDado).toBe(2);
    expect(salao.diasSemLancamento).toEqual(["2026-10-02", "2026-10-03", "2026-10-05"]);
  });

  test("não cobra dia que ainda não aconteceu: a janela é cortada em ontem", () => {
    const r = calcularCobertura({ from: "2026-10-01", to: "2026-10-31", today: "2026-10-04", rows: [], ultimoDiaGeral: {} });
    expect(canal(r, "Keeta").diasNoPeriodo).toBe(3);
    expect(canal(r, "Keeta").diasSemLancamento).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });

  test("situação: EM_DIA se o último dia é ontem ou depois; ATRASADO se mais antigo", () => {
    const r = calcularCobertura({
      ...BASE,
      rows: [],
      ultimoDiaGeral: { "Salão": "2026-10-05", "99Food": "2026-10-03", iFood: null }
    });
    expect(canal(r, "Salão").situacao).toBe("EM_DIA");
    expect(canal(r, "99Food").situacao).toBe("ATRASADO");
    expect(canal(r, "99Food").diasDesdeUltimo).toBe(3);
    expect(canal(r, "iFood").situacao).toBe("SEM_DADOS");
  });

  test("99Food tolera 2 dias: a API financeira da 99 libera a fatura do dia com atraso; os demais canais não", () => {
    const r = calcularCobertura({
      ...BASE,
      rows: [],
      ultimoDiaGeral: { "Salão": "2026-10-04", "99Food": "2026-10-04", Keeta: "2026-10-04" }
    });
    expect(canal(r, "99Food").diasDesdeUltimo).toBe(2);
    expect(canal(r, "99Food").situacao).toBe("EM_DIA");
    expect(canal(r, "Salão").situacao).toBe("ATRASADO");
    expect(canal(r, "Keeta").situacao).toBe("ATRASADO");
  });

  test("o último dia vem do histórico inteiro, não só da janela", () => {
    const r = calcularCobertura({ ...BASE, rows: [], ultimoDiaGeral: { Keeta: "2026-09-18" } });
    expect(canal(r, "Keeta").ultimoDia).toBe("2026-09-18");
    expect(canal(r, "Keeta").situacao).toBe("ATRASADO");
  });

  test("origens: separa integração, importação e lançamento manual com dias e último dia", () => {
    const r = calcularCobertura({
      ...BASE,
      rows: [
        linha("2026-10-01", "Salão", "AGILE_PDV"),
        linha("2026-10-02", "Salão", "AGILE_PDV"),
        linha("2026-10-03", "Salão", null)
      ],
      ultimoDiaGeral: {}
    });
    const origens = canal(r, "Salão").origens;
    expect(origens).toEqual([
      { origem: "Integração (Agile PDV)", dias: 2, ultimoDia: "2026-10-02" },
      { origem: "Lançamento manual", dias: 1, ultimoDia: "2026-10-03" }
    ]);
  });

  test("origem: 'iFood' (planilha) é importação; só o rótulo exato 'IFOOD' da integração é integração", () => {
    const r = calcularCobertura({
      ...BASE,
      rows: [linha("2026-10-01", "Delivery", "iFood"), linha("2026-10-02", "Delivery", "IFOOD")],
      ultimoDiaGeral: {}
    });
    expect(canal(r, "iFood").origens).toEqual([
      { origem: "Importação (planilha/portal)", dias: 1, ultimoDia: "2026-10-01" },
      { origem: "Integração (iFood)", dias: 1, ultimoDia: "2026-10-02" }
    ]);
  });

  test("linha de delivery sem plataforma identificada não vira canal, mas é contada à parte", () => {
    const r = calcularCobertura({
      ...BASE,
      rows: [linha("2026-10-01", "Delivery", null)],
      ultimoDiaGeral: {}
    });
    expect(r.map((c) => c.canal)).toEqual(["Salão", "99Food", "iFood", "Keeta"]);
    expect(canal(r, "iFood").diasComDado).toBe(0);
  });
});

describe("lançamento com data futura", () => {
  const MES = { from: "2026-10-01", to: "2026-10-31", today: "2026-10-22" };

  test("importação mensal gravada em 31/10 não deixa o canal 'Em dia'", () => {
    const r = calcularCobertura({ ...MES, rows: [linha("2026-10-31", "Delivery", "iFood")], ultimoDiaGeral: {} });
    const ifood = canal(r, "iFood");
    expect(ifood.situacao).toBe("SEM_DADOS");
    expect(ifood.diasComDado).toBe(0);
    expect(ifood.lancamentosFuturos).toEqual(["2026-10-31"]);
    expect(ifood.origens).toEqual([]);
  });

  test("último dia do histórico no futuro é ignorado e o canal fica atrasado", () => {
    const r = calcularCobertura({ ...MES, rows: [], ultimoDiaGeral: { iFood: "2026-10-31", Keeta: "2026-10-20" } });
    expect(canal(r, "iFood").situacao).toBe("SEM_DADOS");
    expect(canal(r, "Keeta").situacao).toBe("ATRASADO");
    expect(canal(r, "Keeta").diasDesdeUltimo).toBe(2);
  });

  test("lançamento de hoje conta (o dia ainda não é cobrado, mas o dado existe)", () => {
    const r = calcularCobertura({ ...MES, rows: [linha("2026-10-22", "Salão", "AGILE_PDV")], ultimoDiaGeral: { Salão: "2026-10-22" } });
    expect(canal(r, "Salão").situacao).toBe("EM_DIA");
    expect(canal(r, "Salão").lancamentosFuturos).toEqual([]);
  });
});

describe("resumoDeAtrasos", () => {
  const MES = { from: "2026-10-01", to: "2026-10-31", today: "2026-10-22" };
  const dia = (d: string) => `2026-10-${d}`;

  test("devolve null quando todos os canais estão em dia", () => {
    const rows = [
      linha(dia("21"), "Salão", "AGILE_PDV"),
      linha(dia("21"), "Delivery", "NOVENTA_NOVE"),
      linha(dia("21"), "Delivery", "iFood"),
      linha(dia("21"), "Delivery", "Keeta")
    ];
    expect(resumoDeAtrasos(calcularCobertura({ ...MES, rows, ultimoDiaGeral: {} }))).toBeNull();
  });

  test("lista só os canais atrasados, com o tempo de atraso", () => {
    const rows = [
      linha(dia("21"), "Salão", "AGILE_PDV"),
      linha(dia("19"), "Delivery", "NOVENTA_NOVE"),
      linha(dia("18"), "Delivery", "Keeta"),
      linha(dia("31"), "Delivery", "iFood")
    ];
    const r = resumoDeAtrasos(calcularCobertura({ ...MES, rows, ultimoDiaGeral: {} }));
    expect(r?.count).toBe(3);
    expect(r?.description).toContain("99Food (há 3 dias)");
    expect(r?.description).toContain("iFood (sem dados)");
    expect(r?.description).toContain("Keeta (há 4 dias)");
    expect(r?.description).not.toContain("Salão");
  });

  test("canal que lançou no mês mas parou mostra o atraso; sem lançamento no mês, com histórico, avisa isso", () => {
    const r = resumoDeAtrasos(
      calcularCobertura({ ...MES, rows: [], ultimoDiaGeral: { iFood: "2026-09-30", Salão: "2026-10-21", "99Food": "2026-10-21", Keeta: "2026-10-21" } })
    );
    expect(r?.count).toBe(1);
    expect(r?.description).toContain("iFood (sem lançamento no mês)");
  });
});
