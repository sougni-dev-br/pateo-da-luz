import { describe, expect, test, vi } from "vitest";
import { agruparPorDia, mapSaleItemRow, mapSaleRow, persistSales } from "../agile-sync.service.js";
import { agileSyncPayloadSchema, type AgileSyncPayload } from "../agile-sync.types.js";

const vendaBase = {
  nrseqvenda: "1001", dt_movimento: "2026-10-05", turno: "Jantar", situacao_da_venda: "RECEBIDA",
  qtd_pessoas: 3, vl_total: 250.5
};
const itemBase = {
  nrseqvenda: "1001", nrseqitem: "1", dt_movimento: "2026-10-05", turno: "Jantar",
  situacao_da_venda: "RECEBIDA", produto: "Pizza", qtd: 1, vl_tot: 50
};

function payload(over: Record<string, unknown> = {}): AgileSyncPayload {
  return agileSyncPayloadSchema.parse({
    periodoInicio: "2026-10-05", periodoFim: "2026-10-05", vendas: [], pagamentos: [], itens: [], ...over
  });
}

describe("schema: campos novos sao opcionais (agente antigo continua valido)", () => {
  test("venda e item sem os campos novos", () => {
    const p = payload({ vendas: [vendaBase], itens: [itemBase] });
    expect(p.vendas[0].hora).toBeUndefined();
    expect(p.itens[0].func_lancou).toBeUndefined();
  });

  test("aceita hora, quem cancelou, motivo e quem lancou o item", () => {
    const p = payload({
      vendas: [{ ...vendaBase, hora: "20:15", func_cancelou: "Ana", motivo_cancelamento: "Erro" }],
      itens: [{ ...itemBase, func_lancou: "Bruno" }]
    });
    expect(p.vendas[0]).toMatchObject({ hora: "20:15", func_cancelou: "Ana", motivo_cancelamento: "Erro" });
    expect(p.itens[0].func_lancou).toBe("Bruno");
  });

  test("null nos campos novos tambem vale", () => {
    expect(() => payload({ vendas: [{ ...vendaBase, hora: null, func_cancelou: null, motivo_cancelamento: null }] })).not.toThrow();
  });
});

describe("texto livre do PDV e truncado, nunca recusado", () => {
  test("nome, motivo e hora gigantes nao derrubam o sync: viram o tamanho maximo", () => {
    const p = payload({
      vendas: [{ ...vendaBase, hora: "x".repeat(50), func_cancelou: "n".repeat(500), motivo_cancelamento: "m".repeat(5000) }],
      itens: [{ ...itemBase, func_lancou: "f".repeat(500) }]
    });
    expect(p.vendas[0].hora).toHaveLength(8);
    expect(p.vendas[0].func_cancelou).toHaveLength(120);
    expect(p.vendas[0].motivo_cancelamento).toHaveLength(500);
    expect(p.itens[0].func_lancou).toHaveLength(120);
  });

  test("null continua null e ausente continua ausente", () => {
    const p = payload({ vendas: [{ ...vendaBase, func_cancelou: null }], itens: [itemBase] });
    expect(p.vendas[0].func_cancelou).toBeNull();
    expect(p.itens[0].func_lancou).toBeUndefined();
  });
});

describe("mapSaleRow", () => {
  const venda = (over = {}) => payload({ vendas: [{ ...vendaBase, ...over }] }).vendas[0];

  test("data ancorada as 12:00 UTC e competencia dos numeros da string", () => {
    const r = mapSaleRow(venda({ dt_movimento: "2026-01-31" }));
    expect(r.movementDate.toISOString()).toBe("2026-01-31T12:00:00.000Z");
    expect([r.competenceYear, r.competenceMonth]).toEqual([2026, 1]);
  });

  test("copia valor, pessoas, turno e status", () => {
    expect(mapSaleRow(venda({ situacao_da_venda: "CANCELADA" }))).toMatchObject({
      saleId: "1001", shift: "Jantar", saleStatus: "CANCELADA", people: 3, totalAmount: 250.5
    });
  });

  test.each([["20:15", "20:15"], ["9:05", "09:05"], ["20:15:30", "20:15"], ["", null], ["abc", null], [null, null], [undefined, null]])(
    "hora %j vira %j", (entrada, esperado) => {
      expect(mapSaleRow(venda({ hora: entrada })).saleHour).toBe(esperado);
    }
  );

  test("nomes: tira espacos sobrando e transforma vazio em null", () => {
    const r = mapSaleRow(venda({ func_cancelou: "  Ana   Maria ", motivo_cancelamento: "   " }));
    expect(r.cancelledBy).toBe("Ana Maria");
    expect(r.cancelReason).toBeNull();
  });
});

describe("mapSaleItemRow guarda quem lancou", () => {
  const item = (over = {}) => payload({ itens: [{ ...itemBase, ...over }] }).itens[0];
  test("com nome, sem nome e so espacos", () => {
    expect(mapSaleItemRow(item({ func_lancou: " Bruno " })).launchedBy).toBe("Bruno");
    expect(mapSaleItemRow(item()).launchedBy).toBeNull();
    expect(mapSaleItemRow(item({ func_lancou: "  " })).launchedBy).toBeNull();
  });
});

describe("agruparPorDia.vendasMesa", () => {
  test("todas as vendas de mesa, inclusive cancelada, sem duplicata e sem outro modo", () => {
    const { vendasMesa } = agruparPorDia(payload({
      vendas: [
        vendaBase,
        { ...vendaBase, nrseqvenda: "1002", situacao_da_venda: "CANCELADA" },
        { ...vendaBase, nrseqvenda: "1002", situacao_da_venda: "CANCELADA" },
        { ...vendaBase, nrseqvenda: "1003", modo_venda: "viagem" }
      ]
    }));
    expect(vendasMesa.map((v) => v.nrseqvenda)).toEqual(["1001", "1002"]);
  });
});

describe("persistSales", () => {
  function fakeTx() {
    return { agileSale: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn().mockResolvedValue({ count: 0 }) } };
  }
  const vendas = (n: number) => payload({
    vendas: Array.from({ length: n }, (_, i) => ({ ...vendaBase, nrseqvenda: String(i + 1) }))
  }).vendas;

  test("sem vendas nao vai ao banco", async () => {
    const tx = fakeTx();
    expect(await persistSales(tx as never, [])).toBe(0);
    expect(tx.agileSale.deleteMany).not.toHaveBeenCalled();
  });

  test("apaga as vendas que vai regravar e depois grava (reimport converge)", async () => {
    const tx = fakeTx();
    tx.agileSale.createMany.mockResolvedValue({ count: 2 });
    const n = await persistSales(tx as never, vendas(2));
    expect(n).toBe(2);
    expect(tx.agileSale.deleteMany).toHaveBeenCalledWith({ where: { saleId: { in: ["1", "2"] } } });
    expect(tx.agileSale.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
    expect(tx.agileSale.createMany.mock.calls[0][0].data).toHaveLength(2);
  });

  test("em lotes de 500", async () => {
    const tx = fakeTx();
    tx.agileSale.createMany.mockResolvedValue({ count: 500 });
    await persistSales(tx as never, vendas(1200));
    expect(tx.agileSale.deleteMany).toHaveBeenCalledTimes(3);
    expect(tx.agileSale.createMany).toHaveBeenCalledTimes(3);
  });
});
