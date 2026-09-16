import { describe, expect, test } from "vitest";

// O restaurante nao fecha o CMV por competencia estrita. A contagem que encerra
// o ciclo cai nos primeiros dias do mes seguinte sempre que o ultimo dia esta
// ocupado — em agosto/2026 houve evento no dia 31, e o ciclo so foi contado em
// 01 e 02/09.
//
// A consolidacao de fim de mes derivava a competencia da DATA da contagem, e
// isso poria o fechamento de agosto na competencia de setembro: agosto ficaria
// sem inventario final e sem CMV, e setembro ganharia um final que nao e dele.
// Passou a derivar do CICLO declarado nas contagens (periodYear/periodMonth),
// que e a mesma regra que o cmv-real ja usa ao gerar snapshot de uma sessao.
//
// Estas funcoes espelham as de inventory.routes.ts. Sao reimplementadas aqui
// porque o router importa o Prisma no topo do modulo e nao carrega em teste
// unitario sem banco — mesmo motivo de quantity-parsing.test.ts.

function dateOnly(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfMonthDate(year: number, month: number) {
  return new Date(year, month, 0);
}

type Sessao = { code: string; referenceDate: Date; periodYear: number | null; periodMonth: number | null };

type Resultado =
  | { ok: true; date: Date; effectiveCountDate: Date }
  | { ok: false; erro: string };

/** Espelha o trecho da rota POST /count-sessions/consolidate-month-end. */
function resolverDatasDaConsolidacao(sessions: Sessao[]): Resultado {
  const latestDate = sessions.reduce<Date>((max, s) => {
    const d = new Date(s.referenceDate);
    return d > max ? d : max;
  }, new Date(sessions[0].referenceDate));
  const date = dateOnly(latestDate);

  const ciclos = new Set(
    sessions
      .filter((s) => s.periodYear != null && s.periodMonth != null)
      .map((s) => `${s.periodYear}-${s.periodMonth}`)
  );
  if (ciclos.size > 1) {
    return { ok: false, erro: `As contagens pertencem a ciclos diferentes (${[...ciclos].join(", ")}). Consolide um ciclo por vez.` };
  }
  const [cicloUnico] = [...ciclos];
  const effectiveCountDate = cicloUnico
    ? endOfMonthDate(Number(cicloUnico.split("-")[0]), Number(cicloUnico.split("-")[1]))
    : date;

  return { ok: true, date, effectiveCountDate };
}

/** A competencia do snapshot sai daqui — ver createInventorySnapshotFromOperationalInventory. */
function competenciaDe(effectiveCountDate: Date) {
  return { ano: effectiveCountDate.getFullYear(), mes: effectiveCountDate.getMonth() + 1 };
}

function sessao(code: string, ref: string, ano: number | null, mes: number | null): Sessao {
  const [y, m, d] = ref.split("-").map(Number);
  return { code, referenceDate: new Date(y, m - 1, d), periodYear: ano, periodMonth: mes };
}

describe("endOfMonthDate", () => {
  test("pega o ultimo dia de meses de 31, 30 e 28 dias", () => {
    expect(endOfMonthDate(2026, 8).getDate()).toBe(31);
    expect(endOfMonthDate(2026, 9).getDate()).toBe(30);
    expect(endOfMonthDate(2026, 2).getDate()).toBe(28);
  });

  test("fevereiro bissexto", () => {
    expect(endOfMonthDate(2028, 2).getDate()).toBe(29);
  });

  test("devolve o mes pedido, nao o seguinte", () => {
    const d = endOfMonthDate(2026, 8);
    expect(d.getMonth() + 1).toBe(8);
    expect(d.getFullYear()).toBe(2026);
  });
});

describe("consolidacao — o caso real de agosto/2026", () => {
  // As 7 contagens que fecham o ciclo de agosto, contadas em 01 e 02/09 porque
  // o dia 31 tinha evento.
  const AGOSTO = [
    sessao("CNT-2026-0090", "2026-09-01", 2026, 8),
    sessao("CNT-2026-0091", "2026-09-01", 2026, 8),
    sessao("CNT-2026-0093", "2026-09-01", 2026, 8),
    sessao("CNT-2026-0094", "2026-09-01", 2026, 8),
    sessao("CNT-2026-0095", "2026-09-02", 2026, 8),
    sessao("CNT-2026-0096", "2026-09-02", 2026, 8),
    sessao("CNT-2026-0097", "2026-09-02", 2026, 8),
  ];

  test("a competencia sai de agosto, mesmo contando em setembro", () => {
    const r = resolverDatasDaConsolidacao(AGOSTO);
    if (!r.ok) throw new Error(r.erro);
    expect(competenciaDe(r.effectiveCountDate)).toEqual({ ano: 2026, mes: 8 });
  });

  test("a data da contagem continua sendo a verdade: 02/09", () => {
    const r = resolverDatasDaConsolidacao(AGOSTO);
    if (!r.ok) throw new Error(r.erro);
    expect(r.date.getDate()).toBe(2);
    expect(r.date.getMonth() + 1).toBe(9);
  });

  test("regressao: derivar da data poria o fechamento de agosto em setembro", () => {
    const r = resolverDatasDaConsolidacao(AGOSTO);
    if (!r.ok) throw new Error(r.erro);
    // O comportamento antigo — competencia = mes da data — dava setembro.
    expect(competenciaDe(r.date)).toEqual({ ano: 2026, mes: 9 });
    // O novo da agosto, que e o ciclo a que as contagens pertencem.
    expect(competenciaDe(r.effectiveCountDate)).toEqual({ ano: 2026, mes: 8 });
  });
});

describe("consolidacao — demais casos", () => {
  test("ciclo e data no mesmo mes continuam iguais ao de antes (julho/2026)", () => {
    // Em julho as contagens foram feitas em 31/07 e nada muda para elas.
    const julho = [
      sessao("CNT-2026-0066", "2026-07-31", 2026, 7),
      sessao("CNT-2026-0068", "2026-07-31", 2026, 7),
    ];
    const r = resolverDatasDaConsolidacao(julho);
    if (!r.ok) throw new Error(r.erro);
    expect(competenciaDe(r.effectiveCountDate)).toEqual({ ano: 2026, mes: 7 });
    expect(r.date.getDate()).toBe(31);
  });

  test("sem ciclo declarado, cai na data — comportamento antigo preservado", () => {
    const semCiclo = [sessao("CNT-X", "2026-09-02", null, null)];
    const r = resolverDatasDaConsolidacao(semCiclo);
    if (!r.ok) throw new Error(r.erro);
    expect(r.effectiveCountDate.getTime()).toBe(r.date.getTime());
    expect(competenciaDe(r.effectiveCountDate)).toEqual({ ano: 2026, mes: 9 });
  });

  test("misturar ciclos e recusado, em vez de escolher um em silencio", () => {
    const misturado = [
      sessao("CNT-A", "2026-09-01", 2026, 8),
      sessao("CNT-B", "2026-09-07", 2026, 9),
    ];
    const r = resolverDatasDaConsolidacao(misturado);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toMatch(/ciclos diferentes/i);
  });

  test("a data usada e a mais recente das contagens", () => {
    const r = resolverDatasDaConsolidacao([
      sessao("CNT-A", "2026-09-01", 2026, 8),
      sessao("CNT-B", "2026-09-02", 2026, 8),
      sessao("CNT-C", "2026-08-30", 2026, 8),
    ]);
    if (!r.ok) throw new Error(r.erro);
    expect(r.date.getDate()).toBe(2);
  });

  test("ciclo que vira o ano", () => {
    const dezembro = [sessao("CNT-Z", "2027-01-02", 2026, 12)];
    const r = resolverDatasDaConsolidacao(dezembro);
    if (!r.ok) throw new Error(r.erro);
    expect(competenciaDe(r.effectiveCountDate)).toEqual({ ano: 2026, mes: 12 });
    expect(r.effectiveCountDate.getDate()).toBe(31);
  });
});
