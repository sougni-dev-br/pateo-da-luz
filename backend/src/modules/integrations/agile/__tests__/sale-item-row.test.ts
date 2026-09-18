import { describe, expect, test } from "vitest";
import { mapSaleItemRow } from "../agile-sync.service.js";
import type { AgileItem } from "../agile-sync.types.js";

function item(over: Partial<AgileItem> = {}): AgileItem {
  return {
    nrseqvenda: "1001",
    nrseqitem: "1",
    dt_movimento: "2026-09-15",
    turno: "JANTAR",
    situacao_da_venda: "RECEBIDA",
    cod_produto: "PZ-001",
    produto: "Pizza Portuguesa",
    grupo_produto: "PIZZAS",
    categoria_produto: "SALGADAS",
    qtd: 2,
    vl_tot: 101.9,
    ...over
  };
}

describe("mapSaleItemRow", () => {
  test("ancora a data as 12:00 UTC, como todo gravador do sistema", () => {
    const r = mapSaleItemRow(item({ dt_movimento: "2026-09-15" }));
    expect(r.movementDate.toISOString()).toBe("2026-09-15T12:00:00.000Z");
  });

  test("meia-noite cairia no dia anterior em Sao Paulo — 12:00 nao cai", () => {
    const r = mapSaleItemRow(item({ dt_movimento: "2026-09-01" }));
    // Mesmo dia-calendario visto de Sao Paulo (UTC-3).
    const emSP = new Date(r.movementDate.getTime() - 3 * 60 * 60 * 1000);
    expect(emSP.getUTCDate()).toBe(1);
    expect(emSP.getUTCMonth() + 1).toBe(9);
  });

  test("competencia vem dos numeros da string, nao do fuso do processo", () => {
    const r = mapSaleItemRow(item({ dt_movimento: "2026-01-31" }));
    expect(r.competenceYear).toBe(2026);
    expect(r.competenceMonth).toBe(1);
  });

  test("copia os campos do PDV sem perder nada", () => {
    const r = mapSaleItemRow(item());
    expect(r).toMatchObject({
      saleId: "1001",
      itemSeq: "1",
      shift: "JANTAR",
      saleStatus: "RECEBIDA",
      productCode: "PZ-001",
      productName: "Pizza Portuguesa",
      productGroup: "PIZZAS",
      productCategory: "SALGADAS",
      quantity: 2,
      totalAmount: 101.9
    });
  });

  test("venda cancelada tambem e mapeada — o status vai na linha, nao filtra na entrada", () => {
    const r = mapSaleItemRow(item({ situacao_da_venda: "CANCELADA" }));
    expect(r.saleStatus).toBe("CANCELADA");
    expect(r.productName).toBe("Pizza Portuguesa");
  });

  test("string vazia e espaco viram null, para nao criar uma chave vazia no agrupamento", () => {
    const r = mapSaleItemRow(item({ cod_produto: "", grupo_produto: "   ", categoria_produto: null }));
    expect(r.productCode).toBeNull();
    expect(r.productGroup).toBeNull();
    expect(r.productCategory).toBeNull();
  });

  test("ausente (undefined) tambem vira null", () => {
    const r = mapSaleItemRow(item({ cod_produto: undefined, grupo_produto: undefined }));
    expect(r.productCode).toBeNull();
    expect(r.productGroup).toBeNull();
  });

  test("apara espaco no nome — senao 'Pizza ' e 'Pizza' viram dois pratos no mix", () => {
    const r = mapSaleItemRow(item({ produto: "  Pizza Portuguesa  " }));
    expect(r.productName).toBe("Pizza Portuguesa");
  });

  test("a chave natural (venda, item) e o que torna o reimport idempotente", () => {
    const a = mapSaleItemRow(item({ nrseqvenda: "7", nrseqitem: "3" }));
    const b = mapSaleItemRow(item({ nrseqvenda: "7", nrseqitem: "3", qtd: 9 }));
    expect(a.saleId).toBe(b.saleId);
    expect(a.itemSeq).toBe(b.itemSeq);
  });
});
