import { beforeEach, describe, expect, test, vi } from "vitest";

// ── Mock do banco, hoistado antes dos imports ────────────────────────────────

vi.mock("../../../config/database.js", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

import { prisma } from "../../../config/database.js";
import { getCmvPeriod } from "../cmv-real.service.js";

// ── Banco falso: abril/2026 como esta em producao ────────────────────────────

const SNAPSHOT_INICIAL = "397319a1-inicial";
const SNAPSHOT_FINAL = "f277ea08-final";

/** Os valores que o CmvPeriod congelou no fechamento de 11/09/2026. */
const CONGELADO = {
  estoqueInicialTotal: 130462.37,
  comprasTotal: 171254.31,
  estoqueFinalTotal: 73682.14,
  cmvReal: 228034.54,
  faturamentoTotal: 378943.14,
};

/** O que a base devolve hoje para a mesma janela. */
const BASE_DE_HOJE = {
  estoqueInicial: 112083.07,
  estoqueFinal: 47425.99,
  comprasTotal: 171254.31,
  comprasCount: 108,
  receitaBruta: 397988.39,
  receitaServico: 20587.65,
  receitaLiquida: 377400.74,
  diasComFaturamento: 28,
};

/** Contabil: o que caiu no grupo CMV_COMPRAS, somando exatamente comprasTotal. */
const CATEGORIAS = [
  { categoryName: "Custo de Alimentos", totalAmount: 147407.86, itemsCount: 641 },
  { categoryName: "Embalagens", totalAmount: 12782.63, itemsCount: 31 },
  { categoryName: "Bebidas", totalAmount: 11045.66, itemsCount: 54 },
  { categoryName: "Descartáveis / Delivery", totalAmount: 18.16, itemsCount: 1 },
];

/** So a visao gerencial puxa Material de Limpeza para dentro do CMV. */
const CATEGORIA_SO_GERENCIAL = { categoryName: "Material de Limpeza", totalAmount: 500, itemsCount: 4 };

const FORNECEDORES = [
  { supplierId: "s1", supplierName: "DISTRIBUIDORA X", supplierDocument: "00.000.000/0001-00", totalAmount: 90000, purchasesCount: 40 },
];

const CANAIS = [
  { channel: "Salão", grossAmount: 228240.69, netAmount: 207653.04, count: 28 },
  { channel: "Delivery", grossAmount: 169747.7, netAmount: 169747.7, count: 84 },
];

type CenarioDoBanco = {
  status: "CLOSED" | "OPEN";
  congelado: typeof CONGELADO;
  snapshots: Record<string, { totalValue: number; countDate: Date; status: string } | undefined>;
};

function cenarioPadrao(over: Partial<CenarioDoBanco> = {}): CenarioDoBanco {
  return {
    status: "CLOSED",
    congelado: CONGELADO,
    snapshots: {
      [SNAPSHOT_INICIAL]: { totalValue: BASE_DE_HOJE.estoqueInicial, countDate: new Date("2026-04-02T00:00:00Z"), status: "ACTIVE" },
      [SNAPSHOT_FINAL]: { totalValue: BASE_DE_HOJE.estoqueFinal, countDate: new Date("2026-04-30T00:00:00Z"), status: "ACTIVE" },
    },
    ...over,
  };
}

/** Prisma.sql interpolado vem como objeto; achata tudo em texto para rotear. */
function textoDe(valor: unknown): string {
  if (valor && typeof valor === "object" && Array.isArray((valor as { strings?: unknown }).strings)) {
    const sql = valor as { strings: string[]; values: unknown[] };
    return sql.strings.map((parte, i) => parte + (i < sql.values.length ? textoDe(sql.values[i]) : "")).join("");
  }
  return String(valor ?? "");
}

function instalarBanco(cenario: CenarioDoBanco) {
  vi.mocked(prisma.$queryRaw).mockImplementation(((strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = [...strings, ...values.map(textoDe)].join(" ");
    const gerencial = sql.includes("Material de Limpeza");

    if (sql.includes(`FROM "CmvPeriod"`)) {
      return Promise.resolve([{
        id: "periodo-abril",
        code: "CMV-2026-0001",
        name: "CMV 02/04/2026 a 30/04/2026",
        dataInicial: new Date("2026-04-02T00:00:00Z"),
        dataFinal: new Date("2026-04-30T00:00:00Z"),
        estoqueInicialSnapshotId: SNAPSHOT_INICIAL,
        estoqueFinalSnapshotId: SNAPSHOT_FINAL,
        estoqueInicialSessionId: null,
        estoqueFinalSessionId: null,
        ...cenario.congelado,
        cmvPercentual: 0.6017,
        margemBruta: 150908.6,
        status: cenario.status,
        fechadoPor: "usr-1",
        fechadoEm: cenario.status === "CLOSED" ? new Date("2026-09-11T23:44:14Z") : null,
        reabertoPor: null,
        reabertoEm: null,
        motivoReabertura: null,
        observacoes: null,
        createdAt: new Date("2026-06-04T00:00:00Z"),
        updatedAt: new Date("2026-09-11T23:44:14Z"),
        fechadoPorNome: "Eli",
        reabertoPorNome: null,
        estoqueInicialSnapshotData: new Date("2026-04-02T00:00:00Z"),
        estoqueFinalSnapshotData: new Date("2026-04-30T00:00:00Z"),
        estoqueInicialSessionCode: null,
        estoqueFinalSessionCode: null,
      }]);
    }

    if (sql.includes(`FROM "InventorySnapshot"`)) {
      const id = values.map(textoDe).find((v) => v in cenario.snapshots);
      const snapshot = id ? cenario.snapshots[id] : undefined;
      if (!snapshot) return Promise.resolve([]);
      return Promise.resolve([{ id, type: "INVENTARIO_INICIAL", originalFileName: null, ...snapshot }]);
    }

    if (sql.includes("IfoodCredential") || sql.includes("NoventaNoveCredential")) return Promise.resolve([]);

    if (sql.includes(`GROUP BY "channel"`)) return Promise.resolve(CANAIS);

    if (sql.includes(`FROM "RevenueEntry"`)) {
      return Promise.resolve([{
        grossAmount: BASE_DE_HOJE.receitaBruta,
        serviceAmount: BASE_DE_HOJE.receitaServico,
        netAmount: BASE_DE_HOJE.receitaLiquida,
        daysCount: BASE_DE_HOJE.diasComFaturamento,
      }]);
    }

    if (sql.includes(`AS "categoryName"`)) {
      // A visao gerencial puxa uma categoria a mais que a contabil.
      return Promise.resolve(gerencial ? [...CATEGORIAS, CATEGORIA_SO_GERENCIAL] : CATEGORIAS);
    }

    if (sql.includes(`AS "supplierId"`)) return Promise.resolve(FORNECEDORES);

    if (sql.includes(`FROM "Purchase"`)) {
      return Promise.resolve([{
        totalAmount: gerencial ? BASE_DE_HOJE.comprasTotal + CATEGORIA_SO_GERENCIAL.totalAmount : BASE_DE_HOJE.comprasTotal,
        purchasesCount: gerencial ? BASE_DE_HOJE.comprasCount + 4 : BASE_DE_HOJE.comprasCount,
      }]);
    }

    throw new Error(`Query nao prevista no teste: ${sql.slice(0, 120)}`);
  }) as never);
}

beforeEach(() => {
  vi.mocked(prisma.$queryRaw).mockReset();
});

describe("periodo FECHADO: a composicao volta a ser calculada", () => {
  test("nao devolve mais as tres composicoes vazias", async () => {
    instalarBanco(cenarioPadrao());
    const detalhe = await getCmvPeriod("periodo-abril");

    expect(detalhe.purchaseByCategory).toHaveLength(4);
    expect(detalhe.purchaseBySupplier).toHaveLength(1);
    expect(detalhe.revenueByChannel).toHaveLength(2);
  });

  test("nao devolve mais contagens zeradas ao lado de R$ 171 mil em compras", async () => {
    instalarBanco(cenarioPadrao());
    const detalhe = await getCmvPeriod("periodo-abril");

    expect(detalhe.purchasesCount).toBe(108);
    expect(detalhe.revenueDaysCount).toBe(28);
  });

  test("as categorias exibidas somam o total de compras exibido", async () => {
    instalarBanco(cenarioPadrao());
    const detalhe = await getCmvPeriod("periodo-abril");

    const soma = detalhe.purchaseByCategory.reduce((total, linha) => total + linha.totalAmount, 0);
    expect(soma).toBeCloseTo(detalhe.purchasesGrossTotal, 2);
  });

  test("os cinco totais da equacao continuam sendo os congelados", async () => {
    instalarBanco(cenarioPadrao());
    const detalhe = await getCmvPeriod("periodo-abril");

    // Este e' o ponto que nao pode regredir: fechamento que se recalcula sozinho
    // deixa de ser fechamento.
    expect(detalhe.estoqueInicialTotal).toBe(CONGELADO.estoqueInicialTotal);
    expect(detalhe.estoqueFinalTotal).toBe(CONGELADO.estoqueFinalTotal);
    expect(detalhe.cmvReal).toBe(CONGELADO.cmvReal);
    expect(detalhe.faturamentoTotal).toBe(CONGELADO.faturamentoTotal);
    expect(detalhe.comprasTotal).toBe(CONGELADO.comprasTotal);
  });

  test("as duas visoes vem da mesma base, entao a diferenca entre elas e' so de criterio", async () => {
    instalarBanco(cenarioPadrao());
    const detalhe = await getCmvPeriod("periodo-abril");

    // Antes, views vinha zerada em periodo fechado (a tela mostrava R$ 0,00).
    expect(detalhe.views.accounting.comprasTotal).toBeCloseTo(171254.31, 2);
    // So o Material de Limpeza separa a contabil da gerencial.
    expect(detalhe.views.managerial.comprasTotal - detalhe.views.accounting.comprasTotal).toBeCloseTo(500, 2);
  });
});

describe("periodo FECHADO: aviso quando o congelado nao bate mais", () => {
  test("abril acusa a divergencia, com os campos que se moveram", async () => {
    instalarBanco(cenarioPadrao());
    const detalhe = await getCmvPeriod("periodo-abril");

    const aviso = detalhe.warnings.find((w) => w.code === "CLOSED_TOTALS_DIVERGED")!;
    expect(aviso).toBeDefined();
    expect(aviso.severity).toBe("warning");
    expect(detalhe.warnings[0].code).toBe("CLOSED_TOTALS_DIVERGED");

    const campos = (aviso.detail as { campos: Array<{ campo: string }> }).campos.map((c) => c.campo);
    expect(campos).toContain("estoqueInicialTotal");
    expect(campos).toContain("estoqueFinalTotal");
    expect(campos).toContain("faturamentoTotal");
    expect(campos).not.toContain("comprasTotal");
  });

  test("periodo cujo congelado ainda bate com a base nao dispara aviso", async () => {
    instalarBanco(cenarioPadrao({
      congelado: {
        estoqueInicialTotal: BASE_DE_HOJE.estoqueInicial,
        comprasTotal: BASE_DE_HOJE.comprasTotal,
        estoqueFinalTotal: BASE_DE_HOJE.estoqueFinal,
        cmvReal: BASE_DE_HOJE.estoqueInicial + BASE_DE_HOJE.comprasTotal - BASE_DE_HOJE.estoqueFinal,
        faturamentoTotal: BASE_DE_HOJE.receitaLiquida,
      }
    }));
    const detalhe = await getCmvPeriod("periodo-abril");

    expect(detalhe.warnings.find((w) => w.code === "CLOSED_TOTALS_DIVERGED")).toBeUndefined();
    // E a composicao continua vindo normalmente.
    expect(detalhe.purchaseByCategory).toHaveLength(4);
  });
});

describe("periodo FECHADO: inventario que sumiu nao derruba a tela", () => {
  test("responde com os totais congelados e diz por que a composicao faltou", async () => {
    instalarBanco(cenarioPadrao({
      snapshots: { [SNAPSHOT_FINAL]: { totalValue: BASE_DE_HOJE.estoqueFinal, countDate: new Date("2026-04-30T00:00:00Z"), status: "ACTIVE" } }
    }));

    const detalhe = await getCmvPeriod("periodo-abril");

    expect(detalhe.cmvReal).toBe(CONGELADO.cmvReal);
    expect(detalhe.purchaseByCategory).toEqual([]);
    const aviso = detalhe.warnings.find((w) => w.code === "CLOSED_DETAIL_UNAVAILABLE")!;
    expect(aviso).toBeDefined();
    expect(aviso.message).toMatch(/nao foi possivel recalcular/i);
  });

  test("inventario cancelado tambem avisa em vez de estourar 500", async () => {
    instalarBanco(cenarioPadrao({
      snapshots: {
        [SNAPSHOT_INICIAL]: { totalValue: BASE_DE_HOJE.estoqueInicial, countDate: new Date("2026-04-02T00:00:00Z"), status: "CANCELLED" },
        [SNAPSHOT_FINAL]: { totalValue: BASE_DE_HOJE.estoqueFinal, countDate: new Date("2026-04-30T00:00:00Z"), status: "ACTIVE" },
      }
    }));

    await expect(getCmvPeriod("periodo-abril")).resolves.toMatchObject({
      warnings: [expect.objectContaining({ code: "CLOSED_DETAIL_UNAVAILABLE" })]
    });
  });
});

describe("periodo ABERTO nao muda de comportamento", () => {
  test("continua recalculando os totais do topo, nao os congelados", async () => {
    instalarBanco(cenarioPadrao({ status: "OPEN" }));
    const detalhe = await getCmvPeriod("periodo-abril");

    expect(detalhe.estoqueInicialTotal).toBeCloseTo(BASE_DE_HOJE.estoqueInicial, 2);
    expect(detalhe.faturamentoTotal).toBeCloseTo(BASE_DE_HOJE.receitaLiquida, 2);
    expect(detalhe.warnings.find((w) => w.code === "CLOSED_TOTALS_DIVERGED")).toBeUndefined();
  });
});
