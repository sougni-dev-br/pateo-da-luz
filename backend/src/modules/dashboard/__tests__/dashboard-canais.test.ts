import { describe, expect, it } from "vitest";
import type { CoberturaDoCanal } from "../../monthly/revenue-coverage.js";
import { CANAL_OUTROS, montarFaturamentoPorCanal, type SomaPorOrigem } from "../dashboard-canais.js";

const soma = (p: Partial<SomaPorOrigem>): SomaPorOrigem => ({
  channel: "Delivery",
  sourcePlatform: null,
  grossAmount: 0,
  netAmount: 0,
  count: 1,
  ultimoDia: null,
  diaFuturo: null,
  ...p
});

const cobertura = (canal: string, situacao: CoberturaDoCanal["situacao"], diasDesdeUltimo: number | null) =>
  ({ canal, situacao, diasDesdeUltimo }) as CoberturaDoCanal;

describe("montarFaturamentoPorCanal", () => {
  it("agrupa pelas plataformas canônicas, juntando o rótulo da integração e o da planilha", () => {
    const r = montarFaturamentoPorCanal(
      [
        soma({ sourcePlatform: "NOVENTA_NOVE", grossAmount: 100, netAmount: 90, ultimoDia: "2026-10-21" }),
        soma({ sourcePlatform: "99Food", grossAmount: 50, netAmount: 40, ultimoDia: "2026-10-05" }),
        soma({ channel: "Salão", sourcePlatform: "AGILE_PDV", grossAmount: 1000, netAmount: 900, ultimoDia: "2026-10-22" })
      ],
      null
    );
    const noventaNove = r.find((c) => c.canal === "99Food")!;
    expect(noventaNove.grossAmount).toBe(150);
    expect(noventaNove.netAmount).toBe(130);
    expect(noventaNove.count).toBe(2);
    expect(noventaNove.ultimoDia).toBe("2026-10-21");
  });

  it("mostra os quatro canais sempre, mesmo sem lançamento, e Outros só com valor", () => {
    const r = montarFaturamentoPorCanal([], null);
    expect(r.map((c) => c.canal)).toEqual(["Salão", "99Food", "iFood", "Keeta"]);
    expect(r.every((c) => c.netAmount === 0 && c.ultimoDia === null && c.sharePercent === null)).toBe(true);
  });

  it("soma lançamentos sem plataforma em Outros, para o total dos canais fechar com o do card", () => {
    const r = montarFaturamentoPorCanal(
      [soma({ channel: "Eventos / Empreitada", grossAmount: 500, netAmount: 500 }), soma({ channel: "Salão", grossAmount: 500, netAmount: 500 })],
      null
    );
    expect(r.at(-1)!.canal).toBe(CANAL_OUTROS);
    expect(r.reduce((s, c) => s + c.netAmount, 0)).toBe(1000);
    expect(r.find((c) => c.canal === "Salão")!.sharePercent).toBe(50);
  });

  it("guarda o dia futuro do lançamento mensal parcial sem tratá-lo como último dia", () => {
    const r = montarFaturamentoPorCanal(
      [soma({ sourcePlatform: "iFood", grossAmount: 10, netAmount: 5, ultimoDia: null, diaFuturo: "2026-10-31" })],
      null
    );
    const ifood = r.find((c) => c.canal === "iFood")!;
    expect(ifood.ultimoDia).toBeNull();
    expect(ifood.diaFuturo).toBe("2026-10-31");
  });

  it("traz situação e atraso da cobertura só quando há cobertura (mês corrente)", () => {
    const cob = [cobertura("Keeta", "ATRASADO", 4), cobertura("Salão", "EM_DIA", 1)];
    const com = montarFaturamentoPorCanal([], cob);
    expect(com.find((c) => c.canal === "Keeta")).toMatchObject({ situacao: "ATRASADO", diasDesdeUltimo: 4 });
    expect(com.find((c) => c.canal === "99Food")).toMatchObject({ situacao: null, diasDesdeUltimo: null });
    expect(montarFaturamentoPorCanal([], null).every((c) => c.situacao === null)).toBe(true);
  });
});
