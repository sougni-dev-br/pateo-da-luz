import ExcelJS from "exceljs";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const banco = vi.hoisted(() => ({
  lojas: [] as Array<{ id: string; nickname: string; externalId: string }>,
  linhas: [] as Array<Record<string, unknown>>,
  idsOcupados: [] as Array<{ id: string }>,
  repasses: [] as Array<{ externalId: string }>,
  travados: new Set<string>(),
  travadoAte: null as string | null
}));

class TravaDePeriodo extends Error {}

vi.mock("../../../../../config/database.js", () => ({
  prisma: {
    deliveryStore: { findMany: async () => banco.lojas },
    revenueEntry: {
      // lerExistentes filtra por competência (OR); idsExistentesDe filtra por id.
      findMany: async (args: { where: { id?: unknown } }) => (args.where.id ? banco.idsOcupados : banco.linhas)
    },
    ifoodSettlement: { findMany: async () => banco.repasses }
  }
}));
vi.mock("../../../../cmv-real/cmv-real.service.js", () => ({
  assertPeriodWritableForDate: async (data: Date) => {
    if (banco.travados.has(data.toISOString().slice(0, 7))) throw new TravaDePeriodo("travado");
    if (banco.travadoAte && data.toISOString().slice(0, 10) <= banco.travadoAte) throw new TravaDePeriodo("travado");
  }
}));
vi.mock("../../../../cmv-real/period-locked-error.js", () => ({ isPeriodLockedError: (e: unknown) => e instanceof TravaDePeriodo }));
vi.mock("../../../../security/security-utils.js", () => ({ auditLog: vi.fn() }));

const { preverImportacaoIfood } = await import("../ifood-conciliacao-import.service.js");

const COLUNAS = [
  "competencia", "fato_gerador", "tipo_lancamento", "descricao_lancamento", "valor", "pedido_associado_ifood",
  "data_repasse_esperada", "valor_transacao", "loja_id", "loja_id_curto", "data_apuracao_inicio", "data_apuracao_fim",
  "valor_cesta_final"
];

async function xlsx(linhas: Array<Array<string | number>>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("0").addRows([COLUNAS, ...linhas]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Um pedido de R$ 100 com comissão de 16, numa semana. */
function pedido(inicio: string, fim: string, comp = "2026-10"): Array<Array<string | number>> {
  const base = [comp, "Venda"];
  const meio = ["p1", "2026-11-25", 0, "uuid-a", "111", inicio, fim, 100];
  return [
    [...base, "Cobrança", "Comissão do iFood", -16, ...meio],
    [...base, "Entrada Financeira", "Entrada Financeira", 84, ...meio]
  ];
}

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-09T15:00:00Z")); });
afterAll(() => vi.useRealTimers());

beforeEach(() => {
  banco.lojas = [{ id: "loja-1", nickname: "Loja Teste", externalId: "uuid-a" }];
  banco.linhas = [];
  banco.idsOcupados = [];
  banco.repasses = [];
  banco.travados = new Set();
  banco.travadoAte = null;
});

describe("preverImportacaoIfood", () => {
  test("loja cadastrada sem linha no mês vira CRIAR e traz o repasse da semana inteira como novo", async () => {
    const r = await preverImportacaoIfood(await xlsx(pedido("2026-10-05", "2026-10-11")), "c.xlsx");
    expect(r.erros).toEqual([]);
    expect(r.totais).toMatchObject({ criar: 1, alterar: 0, semLoja: 0, conflito: 0 });
    expect(r.plano[0]).toMatchObject({ acao: "CRIAR", nomeDaLoja: "Loja Teste", repassesNovos: 1 });
  });

  test("loja do arquivo que não está cadastrada não é gravada e gera aviso", async () => {
    banco.lojas = [];
    const r = await preverImportacaoIfood(await xlsx(pedido("2026-10-05", "2026-10-11")), "c.xlsx");
    expect(r.totais.semLoja).toBe(1);
    expect(r.plano[0]!.repassesNovos).toBe(0);
    expect(r.avisos.join(" ")).toMatch(/não está cadastrada/);
  });

  test("id da linha já ocupado (cancelada ou editada à mão) vira CONFLITO e alerta", async () => {
    banco.idsOcupados = [{ id: "ifood-import-202610-111" }];
    const r = await preverImportacaoIfood(await xlsx(pedido("2026-10-05", "2026-10-11")), "c.xlsx");
    expect(r.plano[0]!.acao).toBe("CONFLITO");
    expect(r.totais.conflito).toBe(1);
    expect(r.plano[0]!.repassesNovos).toBe(0);
    expect(r.alertas.join(" ")).toMatch(/mesmo identificador/);
  });

  test("linha de iFood no mês que não é de nenhuma loja do arquivo bloqueia o CRIAR (evita receita em dobro)", async () => {
    banco.linhas = [{
      id: "ifood-diaria-20261005", description: "Delivery iFood - 05/10", status: "ACTIVE", date: new Date("2026-10-05"),
      competenceYear: 2026, competenceMonth: 10, tickets: 3, grossAmount: 100, netAmount: 80
    }];
    const r = await preverImportacaoIfood(await xlsx(pedido("2026-10-05", "2026-10-11")), "c.xlsx");
    expect(r.plano[0]!.acao).toBe("CONFLITO");
    expect(r.alertas.join(" ")).toMatch(/em dobro/);
  });

  test("semana de repasse que cruza a virada do mês não é gravada e avisa", async () => {
    const r = await preverImportacaoIfood(await xlsx(pedido("2026-10-26", "2026-11-01")), "c.xlsx");
    expect(r.plano[0]!.repassesNovos).toBe(0);
    expect(r.avisos.join(" ")).toMatch(/cruzam a virada do mês/);
  });

  test("semana ainda em curso não é gravada (o valor é provisório)", async () => {
    const r = await preverImportacaoIfood(await xlsx(pedido("2026-11-02", "2026-11-08", "2026-11")), "c.xlsx");
    expect(r.plano[0]!.repassesNovos).toBe(1);
    const emCurso = await preverImportacaoIfood(await xlsx(pedido("2026-11-09", "2026-11-15", "2026-11")), "c.xlsx");
    expect(emCurso.plano[0]!.repassesNovos).toBe(0);
    expect(emCurso.avisos.join(" ")).toMatch(/ainda em curso/);
  });

  test("repasse que já existe não é contado como novo", async () => {
    banco.repasses = [{ externalId: "portal-111-20261005" }];
    const r = await preverImportacaoIfood(await xlsx(pedido("2026-10-05", "2026-10-11")), "c.xlsx");
    expect(r.plano[0]!.repassesNovos).toBe(0);
  });

  test("queda do valor numa alteração gera alerta e traz o valor anterior", async () => {
    banco.linhas = [{
      id: "ifood-import-202610-111", description: "Delivery iFood - Loja Teste (consolidado do mes)", status: "ACTIVE",
      date: new Date("2026-10-22"), competenceYear: 2026, competenceMonth: 10, tickets: 5, grossAmount: 1000, netAmount: 900
    }];
    const r = await preverImportacaoIfood(await xlsx(pedido("2026-10-05", "2026-10-11")), "c.xlsx");
    expect(r.plano[0]).toMatchObject({ acao: "ALTERAR", anterior: { pedidos: 5, bruto: 1000, liquido: 900 } });
    expect(r.alertas.join(" ")).toMatch(/reduz o valor já gravado/);
  });

  test("linha legada (id fora do padrão) é achada pelo nome da loja e vira ALTERAR, não CRIAR", async () => {
    banco.linhas = [{
      id: "cuid-antigo", description: "Delivery iFood - Loja Teste (consolidado do mes)", status: "ACTIVE",
      date: new Date("2026-10-31"), competenceYear: 2026, competenceMonth: 10, tickets: 1, grossAmount: 10, netAmount: 5
    }];
    const r = await preverImportacaoIfood(await xlsx(pedido("2026-10-05", "2026-10-11")), "c.xlsx");
    expect(r.plano[0]).toMatchObject({ acao: "ALTERAR", existenteId: "cuid-antigo", id: "cuid-antigo" });
  });

  test("mês igual ao já gravado vira IGUAL e não pede nada", async () => {
    banco.linhas = [{
      id: "ifood-import-202610-111", description: "Delivery iFood - Loja Teste (consolidado do mes)", status: "ACTIVE",
      date: new Date("2026-10-31"), competenceYear: 2026, competenceMonth: 10, tickets: 1, grossAmount: 100, netAmount: 84
    }];
    banco.repasses = [{ externalId: "portal-111-20261005" }];
    const r = await preverImportacaoIfood(await xlsx(pedido("2026-10-05", "2026-10-11")), "c.xlsx");
    expect(r.plano[0]!.acao).toBe("IGUAL");
    expect(r.totais.igual).toBe(1);
    expect(r.alertas).toEqual([]);
  });

  test("mês travado não conta como gravável, nem para IGUAL alterado, e zera os repasses", async () => {
    banco.travados = new Set(["2026-10"]);
    const r = await preverImportacaoIfood(await xlsx(pedido("2026-10-05", "2026-10-11")), "c.xlsx");
    expect(r.mesesTravados).toEqual(["2026-10"]);
    expect(r.totais).toMatchObject({ travado: 1, criar: 0 });
    expect(r.plano[0]!.repassesNovos).toBe(0);
  });

  test("a data ANTIGA da linha alterada também é conferida contra a trava de período", async () => {
    // Só até 25/10 está fechado: a data nova (31/10) está livre, a antiga (22/10) não.
    banco.travadoAte = "2026-10-25";
    banco.linhas = [{
      id: "ifood-import-202610-111", description: "x (consolidado do mes)", status: "ACTIVE",
      date: new Date("2026-10-22"), competenceYear: 2026, competenceMonth: 10, tickets: 1, grossAmount: 10, netAmount: 5
    }];
    const r = await preverImportacaoIfood(await xlsx(pedido("2026-10-05", "2026-10-11")), "c.xlsx");
    expect(r.mesesTravados).toEqual(["2026-10"]);
  });

  test("linha de OUTRA loja cadastrada no mês (id legado, nome conhecido) não bloqueia nem trava esta loja", async () => {
    banco.lojas = [
      { id: "loja-1", nickname: "Loja Teste", externalId: "uuid-a" },
      { id: "loja-2", nickname: "Outra Loja", externalId: "uuid-b" }
    ];
    banco.travadoAte = "2026-10-25";
    banco.linhas = [{
      id: "cuid-legado-b", description: "Delivery iFood - Outra Loja (consolidado do mes)", status: "ACTIVE",
      date: new Date("2026-10-22"), competenceYear: 2026, competenceMonth: 10, tickets: 9, grossAmount: 900, netAmount: 700
    }];
    const r = await preverImportacaoIfood(await xlsx(pedido("2026-10-05", "2026-10-11")), "c.xlsx");
    expect(r.plano[0]!.acao).toBe("CRIAR");
    expect(r.alertas).toEqual([]);
    expect(r.mesesTravados).toEqual([]);
  });

  test("erro aponta a linha que o Excel mostra, mesmo com linha em branco no meio", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("0");
    ws.getRow(1).values = COLUNAS;
    ws.getRow(4).values = ["2026-13", "Venda", "Cobrança", "x", -1, "p1", "", "", "uuid-a", "111", "", "", 1];
    const bytes = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await preverImportacaoIfood(bytes, "c.xlsx");
    expect(r.erros[0]).toMatch(/Linha 4 da planilha/);
  });

  test("loja cadastrada só pelo identificador curto também é reconhecida", async () => {
    banco.lojas = [{ id: "loja-1", nickname: "Loja Teste", externalId: "111" }];
    const r = await preverImportacaoIfood(await xlsx(pedido("2026-10-05", "2026-10-11")), "c.xlsx");
    expect(r.totais.criar).toBe(1);
  });

  test("recusa extensão que não é xlsx e arquivo xlsx corrompido", async () => {
    await expect(preverImportacaoIfood(Buffer.from("x"), "c.pdf")).rejects.toThrow(/xlsx/);
    await expect(preverImportacaoIfood(Buffer.from("isto nao e um zip"), "c.xlsx")).rejects.toThrow();
  });
});
