import { describe, expect, test } from "vitest";
import {
  ACOES_DO_FECHAMENTO,
  entidadeDoMes,
  montarHistoricoDoMes,
  montarVisaoDosMeses,
  type LinhaDeAuditoria,
  type LinhaDeMes
} from "../historico-do-mes.js";

const linha = (parcial: Partial<LinhaDeAuditoria> & { action: string }): LinhaDeAuditoria => ({
  id: "a1",
  createdAt: new Date("2026-10-20T15:00:00.000Z"),
  userName: "Eli",
  newValue: null,
  ...parcial
});

describe("entidadeDoMes", () => {
  test("usa o mesmo formato que as rotas gravam: ano-mês sem zero à esquerda", () => {
    // monthly-closure.routes grava `${year}-${month}` — "2026-9", não "2026-09".
    expect(entidadeDoMes(2026, 9)).toBe("2026-9");
    expect(entidadeDoMes(2026, 12)).toBe("2026-12");
  });
});

describe("montarHistoricoDoMes", () => {
  test("justificar traz a chave e o motivo", () => {
    const [e] = montarHistoricoDoMes([
      linha({ action: "JUSTIFY_MONTHLY_CLOSURE_BLOCK", newValue: { blockKey: "card:c1", reason: "Cartão não usado." } })
    ]);
    expect(e.acao).toBe("JUSTIFICOU");
    expect(e.blockKey).toBe("card:c1");
    expect(e.texto).toBe("Cartão não usado.");
    expect(e.porNome).toBe("Eli");
    expect(e.em).toBe("2026-10-20T15:00:00.000Z");
  });

  test("remover justificativa traz a chave, sem texto", () => {
    const [e] = montarHistoricoDoMes([
      linha({ action: "REMOVE_MONTHLY_CLOSURE_JUSTIFICATION", newValue: { blockKey: "block:taxes" } })
    ]);
    expect(e.acao).toBe("REMOVEU_JUSTIFICATIVA");
    expect(e.blockKey).toBe("block:taxes");
    expect(e.texto).toBeNull();
  });

  test("travar e reabrir; reabrir traz o motivo", () => {
    const r = montarHistoricoDoMes([
      linha({ id: "1", action: "LOCK_MONTHLY_CLOSURE", newValue: { pendingCount: 0, cmvAttributed: 1000 } }),
      linha({ id: "2", action: "UNLOCK_MONTHLY_CLOSURE", newValue: { reason: "Nota de combustível." } })
    ]);
    expect(r.map((e) => e.acao)).toEqual(["TRAVOU", "REABRIU"]);
    expect(r[0].texto).toBeNull();
    expect(r[1].texto).toBe("Nota de combustível.");
  });

  test("ação que não é do fechamento é ignorada", () => {
    expect(montarHistoricoDoMes([linha({ action: "UPDATE_CREDIT_CARD" })])).toEqual([]);
  });

  test("newValue ausente, nulo ou de formato estranho não quebra", () => {
    const r = montarHistoricoDoMes([
      linha({ id: "1", action: "JUSTIFY_MONTHLY_CLOSURE_BLOCK", newValue: null }),
      linha({ id: "2", action: "JUSTIFY_MONTHLY_CLOSURE_BLOCK", newValue: "texto solto" }),
      linha({ id: "3", action: "JUSTIFY_MONTHLY_CLOSURE_BLOCK", newValue: [1, 2] })
    ]);
    expect(r).toHaveLength(3);
    expect(r.every((e) => e.blockKey === null && e.texto === null)).toBe(true);
  });

  test("usuário que não existe mais vira nulo", () => {
    const [e] = montarHistoricoDoMes([linha({ action: "LOCK_MONTHLY_CLOSURE", userName: null })]);
    expect(e.porNome).toBeNull();
  });

  test("mantém a ordem recebida (a consulta já ordena)", () => {
    const r = montarHistoricoDoMes([
      linha({ id: "novo", action: "LOCK_MONTHLY_CLOSURE" }),
      linha({ id: "velho", action: "UNLOCK_MONTHLY_CLOSURE" })
    ]);
    expect(r.map((e) => e.id)).toEqual(["novo", "velho"]);
  });

  test("a lista de ações aceitas cobre as quatro do fechamento", () => {
    expect([...ACOES_DO_FECHAMENTO].sort()).toEqual([
      "JUSTIFY_MONTHLY_CLOSURE_BLOCK",
      "LOCK_MONTHLY_CLOSURE",
      "REMOVE_MONTHLY_CLOSURE_JUSTIFICATION",
      "UNLOCK_MONTHLY_CLOSURE"
    ]);
  });
});

describe("montarVisaoDosMeses", () => {
  const mes = (parcial: Partial<LinhaDeMes>): LinhaDeMes => ({
    competenceYear: 2026,
    competenceMonth: 9,
    status: "OPEN",
    closedAt: null,
    closedByName: null,
    reopenedAt: null,
    reopenedByName: null,
    reopenReason: null,
    justificativas: 0,
    revenueGrossValue: 0,
    cmvAttributedValue: null,
    ...parcial
  });

  test("mês aberto não traz data de travamento", () => {
    const [m] = montarVisaoDosMeses([mes({})]);
    expect(m.travado).toBe(false);
    expect(m.travadoEm).toBeNull();
  });

  test("mês travado traz quando e por quem", () => {
    const [m] = montarVisaoDosMeses([
      mes({ status: "CLOSED", closedAt: new Date("2026-10-15T12:00:00.000Z"), closedByName: "Ana", justificativas: 3 })
    ]);
    expect(m.travado).toBe(true);
    expect(m.travadoEm).toBe("2026-10-15T12:00:00.000Z");
    expect(m.travadoPor).toBe("Ana");
    expect(m.justificativas).toBe(3);
  });

  test("reabertura guarda quando, por quem e o motivo", () => {
    const [m] = montarVisaoDosMeses([
      mes({ reopenedAt: new Date("2026-10-16T12:00:00.000Z"), reopenedByName: "Eli", reopenReason: "Nota atrasada" })
    ]);
    expect(m.reabertoEm).toBe("2026-10-16T12:00:00.000Z");
    expect(m.reabertoPor).toBe("Eli");
    expect(m.motivoDaReabertura).toBe("Nota atrasada");
  });

  test("decimais do banco viram número; nulo continua nulo", () => {
    const [m] = montarVisaoDosMeses([mes({ revenueGrossValue: "216400.50", cmvAttributedValue: null })]);
    expect(m.faturamentoBruto).toBe(216400.5);
    expect(m.cmvAtribuido).toBeNull();
  });

  test("contagem em bigint também vira número", () => {
    const [m] = montarVisaoDosMeses([mes({ justificativas: BigInt(2) })]);
    expect(m.justificativas).toBe(2);
  });
});
