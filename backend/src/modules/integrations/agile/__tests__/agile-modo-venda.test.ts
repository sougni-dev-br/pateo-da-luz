import { describe, expect, test } from "vitest";
import { agruparPorDia, ehVendaDeMesa } from "../agile-sync.service.js";
import { agileSyncPayloadSchema, type AgileSyncPayload } from "../agile-sync.types.js";

describe("ehVendaDeMesa", () => {
  test.each([["mesa"], ["MESA"], ["Mesa"], ["  mesa  "], [undefined], [null], [""], ["   "]])(
    "%j conta como mesa (Salao)",
    (modo) => {
      expect(ehVendaDeMesa(modo as string | null | undefined)).toBe(true);
    }
  );

  test.each([["viagem"], ["Delivery"], ["balcão"], ["BALCAO"], ["retirada"]])("%j NAO e mesa", (modo) => {
    expect(ehVendaDeMesa(modo)).toBe(false);
  });
});

function payload(over: Partial<AgileSyncPayload> = {}): AgileSyncPayload {
  return agileSyncPayloadSchema.parse({
    periodoInicio: "2026-10-12",
    periodoFim: "2026-10-12",
    vendas: [],
    pagamentos: [],
    itens: [],
    ...over
  });
}

const venda = (nr: string, modo?: string, dia = "2026-10-12") => ({
  nrseqvenda: nr, dt_movimento: dia, turno: "Almoço", situacao_da_venda: "RECEBIDA",
  qtd_pessoas: 2, vl_total: 100, vl_servico_inf: 10, ...(modo === undefined ? {} : { modo_venda: modo })
});
const pagamento = (nr: string, modo?: string) => ({
  nrseqvenda: nr, nrseqpgto: `${nr}-1`, dt_movimento: "2026-10-12", turno: "Almoço",
  situacao_da_venda: "RECEBIDA", meio_pagamento: "PIX", vl_recebido: 100, ...(modo === undefined ? {} : { modo_venda: modo })
});

describe("schema aceita modo_venda", () => {
  test("campo ausente vira mesa; presente e preservado", () => {
    const p = payload({ vendas: [venda("1"), venda("2", "viagem")] });
    expect(p.vendas.map((v) => v.modo_venda)).toEqual(["mesa", "viagem"]);
  });

  test("vale tambem para pagamentos e itens", () => {
    const p = payload({
      pagamentos: [pagamento("1", "viagem")],
      itens: [{ nrseqvenda: "1", nrseqitem: "1", dt_movimento: "2026-10-12", turno: "Almoço", situacao_da_venda: "RECEBIDA", produto: "Pizza", modo_venda: "viagem" }]
    });
    expect(p.pagamentos[0].modo_venda).toBe("viagem");
    expect(p.itens[0].modo_venda).toBe("viagem");
  });
});

describe("agruparPorDia: so mesa entra no Salao", () => {
  test("venda de viagem fica fora do agregado e do dia", () => {
    const { dias, naoMesa } = agruparPorDia(payload({ vendas: [venda("1", "mesa"), venda("2", "viagem")] }));
    expect([...dias.get("2026-10-12")!.vendasRecebidas.keys()]).toEqual(["1"]);
    expect(naoMesa.vendas).toBe(1);
    expect(naoMesa.modos).toEqual({ viagem: 1 });
  });

  test("dia que so teve viagem nao vira dia de Salao zerado", () => {
    const { dias, naoMesa } = agruparPorDia(payload({ vendas: [venda("9", "delivery")] }));
    expect(dias.size).toBe(0);
    expect(naoMesa.vendas).toBe(1);
  });

  test("pagamento de venda fora do Salao e descartado, mesmo sem modo proprio", () => {
    const { dias, naoMesa } = agruparPorDia(
      payload({ vendas: [venda("1", "mesa"), venda("2", "viagem")], pagamentos: [pagamento("1"), pagamento("2")] })
    );
    expect(dias.get("2026-10-12")!.pagamentos.map((p) => p.nrseqvenda)).toEqual(["1"]);
    expect(naoMesa.pagamentos).toBe(1);
  });

  test("a comparacao ignora caixa e acento", () => {
    const { naoMesa } = agruparPorDia(payload({ vendas: [venda("1", "MESA"), venda("2", "Balcão"), venda("3", "BALCAO")] }));
    expect(naoMesa.vendas).toBe(2);
    expect(naoMesa.modos).toEqual({ balcao: 2 });
  });

  test("so mesa: nada e excluido", () => {
    const { naoMesa } = agruparPorDia(payload({ vendas: [venda("1"), venda("2", "mesa")] }));
    expect(naoMesa).toEqual({ vendas: 0, pagamentos: 0, itens: 0, modos: {} });
  });
});
