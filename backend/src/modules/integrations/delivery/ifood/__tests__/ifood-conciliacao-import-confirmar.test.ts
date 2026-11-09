import ExcelJS from "exceljs";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

type Linha = Record<string, unknown>;

const estado = vi.hoisted(() => ({
  lojas: [] as Array<{ id: string; nickname: string; externalId: string }>,
  linhas: [] as Linha[],
  idsOcupados: [] as Array<{ id: string }>,
  repasses: [] as Array<{ externalId: string }>,
  travados: new Set<string>(),
  updateManyCount: 1,
  falharNoRepasse: false
}));

const chamadas = vi.hoisted(() => ({
  ordem: [] as string[],
  create: vi.fn(),
  updateMany: vi.fn(),
  settlementCreate: vi.fn(),
  auditLog: vi.fn(),
  transaction: vi.fn(),
  foraDaTransacao: vi.fn()
}));

class TravaDePeriodo extends Error {}

const tx = {
  $executeRaw: async () => { chamadas.ordem.push("lock"); return 1; },
  deliveryStore: { findMany: async () => { chamadas.ordem.push("lerLojas"); return estado.lojas; } },
  revenueEntry: {
    findMany: async (args: { where: { id?: unknown } }) => (args.where.id ? estado.idsOcupados : estado.linhas),
    findUnique: async () => ({ grossAmount: 10, netAmount: 5, tickets: 1 }),
    updateMany: async (args: unknown) => { chamadas.updateMany(args); return { count: estado.updateManyCount }; },
    create: async (args: { data: Linha }) => {
      chamadas.create(args);
      estado.linhas.push({
        id: args.data.id, description: args.data.description, status: "ACTIVE", date: args.data.date,
        competenceYear: args.data.competenceYear, competenceMonth: args.data.competenceMonth,
        tickets: args.data.tickets, grossAmount: args.data.grossAmount, netAmount: args.data.netAmount
      });
    }
  },
  ifoodSettlement: {
    findMany: async () => estado.repasses,
    create: async (args: { data: { externalId: string } }) => {
      if (estado.falharNoRepasse) throw new Error("violação de unicidade");
      chamadas.settlementCreate(args);
      estado.repasses.push({ externalId: args.data.externalId });
    }
  }
};

vi.mock("../../../../../config/database.js", () => {
  const fora = () => { chamadas.foraDaTransacao(); throw new Error("uso do prisma fora da transação"); };
  return {
    prisma: {
      $transaction: async (fn: (t: typeof tx) => unknown, opts: unknown) => { chamadas.transaction(opts); return fn(tx); },
      deliveryStore: { findMany: fora },
      revenueEntry: { findMany: fora, findUnique: fora, updateMany: fora, create: fora },
      ifoodSettlement: { findMany: fora, create: fora }
    }
  };
});
vi.mock("../../../../cmv-real/cmv-real.service.js", () => ({
  assertPeriodWritableForDate: async (data: Date) => {
    if (estado.travados.has(data.toISOString().slice(0, 7))) throw new TravaDePeriodo("travado");
  }
}));
vi.mock("../../../../cmv-real/period-locked-error.js", () => ({ isPeriodLockedError: (e: unknown) => e instanceof TravaDePeriodo }));
vi.mock("../../../../security/security-utils.js", () => ({ auditLog: (...a: unknown[]) => chamadas.auditLog(...a) }));

const { confirmarImportacaoIfood } = await import("../ifood-conciliacao-import.service.js");

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

/** Um pedido de R$ 100 com comissão de 16: bruto 100, líquido 84, um pedido, uma semana de repasse. */
const arquivoSimples = () => xlsx([
  ["2026-10", "Venda", "Cobrança", "Comissão do iFood", -16, "p1", "2026-11-25", 0, "uuid-a", "111", "2026-10-05", "2026-10-11", 100],
  ["2026-10", "Venda", "Entrada Financeira", "Entrada Financeira", 84, "p1", "2026-11-25", 0, "uuid-a", "111", "2026-10-05", "2026-10-11", 100]
]);

const contexto = { userId: "u1", ipAddress: "127.0.0.1", userAgent: "teste" };

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-09T15:00:00Z")); });
afterAll(() => vi.useRealTimers());

beforeEach(() => {
  estado.lojas = [{ id: "loja-1", nickname: "Loja Teste", externalId: "uuid-a" }];
  estado.linhas = [];
  estado.idsOcupados = [];
  estado.repasses = [];
  estado.travados = new Set();
  estado.updateManyCount = 1;
  estado.falharNoRepasse = false;
  chamadas.ordem.length = 0;
  Object.values(chamadas).forEach((c) => { if (typeof c === "function") (c as ReturnType<typeof vi.fn>).mockClear(); });
  chamadas.auditLog.mockResolvedValue(undefined);
});

describe("confirmarImportacaoIfood", () => {
  test("grava tudo dentro de uma transação com timeout, e o lock vem antes de qualquer leitura", async () => {
    await confirmarImportacaoIfood(await arquivoSimples(), "c.xlsx", contexto);
    expect(chamadas.transaction).toHaveBeenCalledWith({ timeout: 90_000 });
    expect(chamadas.foraDaTransacao).not.toHaveBeenCalled();
    expect(chamadas.ordem[0]).toBe("lock");
    expect(chamadas.ordem.indexOf("lock")).toBeLessThan(chamadas.ordem.indexOf("lerLojas"));
  });

  test("CRIAR grava a linha mensal com os valores certos e o repasse como provisório", async () => {
    const r = await confirmarImportacaoIfood(await arquivoSimples(), "c.xlsx", contexto);
    expect(r).toMatchObject({ gravados: 1, repassesGravados: 1, gravadas: ["Loja Teste 10/2026"] });
    expect(chamadas.create).toHaveBeenCalledTimes(1);
    const dado = (chamadas.create.mock.calls[0]![0] as { data: Linha }).data;
    expect(dado).toMatchObject({
      id: "ifood-import-202610-111", channel: "Delivery", sourcePlatform: "iFood", status: "ACTIVE",
      description: "Delivery iFood - Loja Teste (consolidado do mes)", competenceYear: 2026, competenceMonth: 10,
      grossAmount: 100, netAmount: 84, platformFees: 16, discounts: 0, tickets: 1, ticketAverage: 100
    });
    expect((dado.date as Date).toISOString().slice(0, 10)).toBe("2026-10-31");
    const repasse = (chamadas.settlementCreate.mock.calls[0]![0] as { data: Linha }).data;
    expect(repasse).toMatchObject({ externalId: "portal-111-20261005", status: "EM_ABERTO", paidAt: null, netAmount: 0 });
    expect(repasse.rawPayload).toMatchObject({ statusConfirmado: false });
  });

  test("reimportar o mesmo arquivo não grava nem duplica nada (idempotência)", async () => {
    await confirmarImportacaoIfood(await arquivoSimples(), "c.xlsx", contexto);
    chamadas.create.mockClear();
    chamadas.settlementCreate.mockClear();
    const de_novo = await confirmarImportacaoIfood(await arquivoSimples(), "c.xlsx", contexto);
    expect(de_novo).toMatchObject({ gravados: 0, repassesGravados: 0 });
    expect(de_novo.totais.igual).toBe(1);
    expect(chamadas.create).not.toHaveBeenCalled();
    expect(chamadas.updateMany).not.toHaveBeenCalled();
    expect(chamadas.settlementCreate).not.toHaveBeenCalled();
  });

  test("ALTERAR atualiza a linha existente só se ainda estiver ativa, sem criar outra, e audita o valor anterior", async () => {
    estado.linhas = [{
      id: "ifood-import-202610-111", description: "Delivery iFood - Loja Teste (consolidado do mes)", status: "ACTIVE",
      date: new Date("2026-10-22"), competenceYear: 2026, competenceMonth: 10, tickets: 1, grossAmount: 10, netAmount: 5
    }];
    const r = await confirmarImportacaoIfood(await arquivoSimples(), "c.xlsx", contexto);
    expect(r.gravados).toBe(1);
    expect(chamadas.create).not.toHaveBeenCalled();
    expect(chamadas.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "ifood-import-202610-111", status: "ACTIVE" } }));
    const auditoria = chamadas.auditLog.mock.calls[0]![0] as { action: string; previousValue: { anteriores: unknown[] } };
    expect(auditoria.action).toBe("REVENUE_IMPORT_IFOOD");
    expect(auditoria.previousValue.anteriores).toEqual([{ id: "ifood-import-202610-111", gross: 10, net: 5, orders: 1 }]);
  });

  test("ALTERAR que perdeu a corrida (linha deixou de estar ativa) não conta nem cria repasse", async () => {
    estado.linhas = [{
      id: "ifood-import-202610-111", description: "Delivery iFood - Loja Teste (consolidado do mes)", status: "ACTIVE",
      date: new Date("2026-10-22"), competenceYear: 2026, competenceMonth: 10, tickets: 1, grossAmount: 10, netAmount: 5
    }];
    estado.updateManyCount = 0;
    const r = await confirmarImportacaoIfood(await arquivoSimples(), "c.xlsx", contexto);
    expect(r).toMatchObject({ gravados: 0, repassesGravados: 0 });
    expect(chamadas.settlementCreate).not.toHaveBeenCalled();
  });

  test("mês travado não grava nada", async () => {
    estado.travados = new Set(["2026-10"]);
    const r = await confirmarImportacaoIfood(await arquivoSimples(), "c.xlsx", contexto);
    expect(r).toMatchObject({ gravados: 0, repassesGravados: 0, mesesTravados: ["2026-10"] });
    expect(chamadas.create).not.toHaveBeenCalled();
    expect(chamadas.settlementCreate).not.toHaveBeenCalled();
  });

  test("loja não cadastrada não grava nada", async () => {
    estado.lojas = [];
    const r = await confirmarImportacaoIfood(await arquivoSimples(), "c.xlsx", contexto);
    expect(r.gravados).toBe(0);
    expect(chamadas.create).not.toHaveBeenCalled();
  });

  test("id já ocupado por linha cancelada é conflito: não reativa nem sobrescreve", async () => {
    estado.idsOcupados = [{ id: "ifood-import-202610-111" }];
    const r = await confirmarImportacaoIfood(await arquivoSimples(), "c.xlsx", { ...contexto, confirmouAlertas: true });
    expect(r.gravados).toBe(0);
    expect(r.totais.conflito).toBe(1);
    expect(chamadas.create).not.toHaveBeenCalled();
    expect(chamadas.updateMany).not.toHaveBeenCalled();
  });

  test("com alertas na prévia, só grava se quem importa confirmou os alertas", async () => {
    estado.linhas = [{
      id: "ifood-import-202610-111", description: "Delivery iFood - Loja Teste (consolidado do mes)", status: "ACTIVE",
      date: new Date("2026-10-22"), competenceYear: 2026, competenceMonth: 10, tickets: 50, grossAmount: 5000, netAmount: 4000
    }];
    await expect(confirmarImportacaoIfood(await arquivoSimples(), "c.xlsx", contexto)).rejects.toThrow(/alertas/);
    expect(chamadas.updateMany).not.toHaveBeenCalled();
    const r = await confirmarImportacaoIfood(await arquivoSimples(), "c.xlsx", { ...contexto, confirmouAlertas: true });
    expect(r.gravados).toBe(1);
  });

  test("falha ao gravar um repasse propaga o erro e não audita gravação que não houve", async () => {
    estado.falharNoRepasse = true;
    await expect(confirmarImportacaoIfood(await arquivoSimples(), "c.xlsx", contexto)).rejects.toThrow(/unicidade/);
    expect(chamadas.auditLog).not.toHaveBeenCalled();
  });

  test("falha na auditoria depois do commit não derruba a resposta", async () => {
    chamadas.auditLog.mockRejectedValue(new Error("auditoria fora do ar"));
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await confirmarImportacaoIfood(await arquivoSimples(), "c.xlsx", contexto);
    expect(r.gravados).toBe(1);
    erro.mockRestore();
  });

  test("arquivo com erro de leitura não abre transação", async () => {
    const ruim = await xlsx([["2026-13", "Venda", "Cobrança", "x", -1, "p1", "", "", "uuid-a", "111", "", "", 1]]);
    await expect(confirmarImportacaoIfood(ruim, "c.xlsx", contexto)).rejects.toThrow(/erro/i);
    expect(chamadas.transaction).not.toHaveBeenCalled();
  });
});
