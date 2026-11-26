import { beforeEach, describe, expect, test, vi } from "vitest";

const queryRaw = vi.fn();
const pedidoFindUnique = vi.fn();
const metaFindMany = vi.fn();
vi.mock("../../../config/database.js", () => ({
  prisma: {
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
    purchaseOrder: { findUnique: (...a: unknown[]) => pedidoFindUnique(...a) },
    cmvMeta: { findMany: (...a: unknown[]) => metaFindMany(...a) },
  },
}));
vi.mock("../../cmv-real/cmv-real.service.js", () => ({ getCmvPeriod: vi.fn() }));
vi.mock("../../cmv-real/cmv-purchase-base.service.js", () => ({
  cmvPurchasePredicate: () => ({}),
  getCmvPurchaseTotalsByPurchaseDateRange: vi.fn().mockResolvedValue({ total: 20000, count: 4 }),
}));
// Dia 10 de um mês de 30 dias: faturamento de 100 mil projeta 300 mil.
vi.mock("../../payroll/extras-comum.js", () => ({ hojeEmSaoPaulo: () => "2026-11-10" }));
const faturamento = vi.fn();
vi.mock("../cmv-metas.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../cmv-metas.service.js")>()),
  faturamentoLiquido: (...a: unknown[]) => faturamento(...a),
}));

import { impactoDoPedido, PedidoNaoEncontradoError } from "../cmv-metas-pedido.service.js";

const metaGeral = { id: "g", escopo: "GERAL", sectorId: null, alvoPercentual: 30, alertaPercentual: 27, vigenciaInicio: new Date("2026-01-01T00:00:00Z"), vigenciaFim: null, observacao: null };

beforeEach(() => {
  vi.clearAllMocks();
  pedidoFindUnique.mockResolvedValue({ status: "EM_REVISAO" });
  metaFindMany.mockResolvedValue([metaGeral]);
  faturamento.mockResolvedValue(100000);
  queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join(" ");
    if (sql.includes("FILTER")) return [{ total: 12000, totalCmv: 10000, semPreco: 1 }]; // este pedido
    return [{ total: 5000 }]; // outros pedidos em andamento
  });
});

describe("impactoDoPedido", () => {
  test("pedido inexistente vira erro próprio (a rota responde 404)", async () => {
    pedidoFindUnique.mockResolvedValue(null);
    await expect(impactoDoPedido("x")).rejects.toBeInstanceOf(PedidoNaoEncontradoError);
  });

  test("pedido já enviado ou recebido não recebe aviso: não há mais decisão", async () => {
    for (const status of ["ENVIADO", "RECEBIDO", "CANCELADO"]) {
      pedidoFindUnique.mockResolvedValue({ status });
      expect((await impactoDoPedido("p")).situacao).toBe("SEM_DECISAO");
    }
  });

  test("sem meta geral vigente, avisa que não há meta (não inventa semáforo)", async () => {
    metaFindMany.mockResolvedValue([]);
    const r = await impactoDoPedido("p");
    expect(r.situacao).toBe("SEM_META");
  });

  test("soma só a parte de CMV do pedido e não o conta duas vezes", async () => {
    const r = await impactoDoPedido("p");
    if (r.situacao !== "AVALIADO") throw new Error("esperava AVALIADO");
    // teto = 300.000 × 30% = 90.000
    expect(r.antes.tetoDeCompras).toBe(90000);
    // antes: compras 20.000 + outros pedidos 5.000 (o próprio pedido fica de fora)
    expect(r.antes.comprasComprometidas).toBe(25000);
    // depois: + 10.000 (só itens de CMV; os 2.000 restantes não entram)
    expect(r.depois.comprasComprometidas).toBe(35000);
    expect(r.depois.margemParaComprar).toBe(55000);
    expect(r.pedido).toEqual({ total: 12000, totalCmv: 10000, itensSemPreco: 1 });
    expect(r.statusDepois).toBe("VERDE");
  });

  test("o pedido que faz estourar o teto sai vermelho, e o antes continua como estava", async () => {
    queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join(" ");
      if (sql.includes("FILTER")) return [{ total: 70000, totalCmv: 70000, semPreco: 0 }];
      return [{ total: 5000 }];
    });
    const r = await impactoDoPedido("p");
    if (r.situacao !== "AVALIADO") throw new Error("esperava AVALIADO");
    expect(r.statusAntes).toBe("VERDE");
    expect(r.statusDepois).toBe("VERMELHO");
    expect(r.depois.margemParaComprar).toBe(-5000);
  });
});
