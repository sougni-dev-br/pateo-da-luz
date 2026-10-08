import { describe, expect, test } from "vitest";
import type { OperationalInventory } from "../../../../api/client";
import { agruparPorMes, proximoPasso, rascunhosVazios, situacao, tituloCurto } from "../lista";

function inv(parcial: Partial<OperationalInventory>): OperationalInventory {
  return {
    id: "i", code: "INV-2026-0001", date: "2026-07-31T00:00:00.000Z", effectiveCountDate: null, startedAt: null, finishedAt: null,
    name: "Inventario 31/07/2026 - Geral", type: "GERAL", status: "RASCUNHO", sectorId: null, sectorName: null,
    responsibleUserId: null, reviewedByUserId: null, approvedByUserId: null, closedByUserId: null, canceledByUserId: null,
    sentToReviewAt: null, reviewedAt: null, approvedAt: null, closedAt: null, canceledAt: null, notes: null,
    rejectionReason: null, cancelReason: null, inventorySnapshotId: null, totalItems: 10, countedItems: 0,
    pendingItems: 10, divergentItems: 0, zeroItems: 0,
    ...parcial
  };
}

describe("tituloCurto", () => {
  test("tira o prefixo repetido 'Inventario <data> -'", () => {
    expect(tituloCurto(inv({ name: "Inventario 13/08/2026 - gerado da contagem CNT-2026-0076" }))).toBe("Gerado da contagem CNT-2026-0076");
  });

  test("final CMV vira o fechamento do mes da data efetiva", () => {
    expect(tituloCurto(inv({
      type: "FINAL_CMV", name: "Inventario Final CMV 31/07/2026 - 7 setor(es) consolidado(s)",
      date: "2026-08-01T00:00:00.000Z", effectiveCountDate: "2026-07-31T00:00:00.000Z"
    }))).toBe("Fechamento de julho de 2026");
  });

  test("nome livre fica como veio", () => {
    expect(tituloCurto(inv({ name: "Conferência da adega" }))).toBe("Conferência da adega");
  });

  test("so o prefixo fica como veio", () => {
    expect(tituloCurto(inv({ name: "Inventario 04/06/2026 - Geral" }))).toBe("Geral");
  });
});

describe("agruparPorMes", () => {
  test("agrupa pela data efetiva, do mes mais recente para o mais antigo", () => {
    const grupos = agruparPorMes([
      inv({ id: "jun", date: "2026-06-29T00:00:00.000Z" }),
      inv({ id: "ago", date: "2026-08-13T00:00:00.000Z" }),
      // Data de referencia em agosto, mas efetiva em julho: vale julho.
      inv({ id: "jul", date: "2026-08-01T00:00:00.000Z", effectiveCountDate: "2026-07-31T00:00:00.000Z" })
    ]);
    expect(grupos.map((g) => g.rotulo)).toEqual(["Agosto de 2026", "Julho de 2026", "Junho de 2026"]);
    expect(grupos[1].inventarios.map((i) => i.id)).toEqual(["jul"]);
  });

  test("mes sem data nao some", () => {
    const grupos = agruparPorMes([inv({ id: "x", date: "" })]);
    expect(grupos[0].inventarios).toHaveLength(1);
  });
});

describe("rascunhosVazios", () => {
  const hoje = new Date("2026-10-07T12:00:00Z");

  test("rascunho sem nenhuma quantidade e com mais de 30 dias", () => {
    const lista = [
      inv({ id: "velho-vazio", date: "2026-06-05T00:00:00.000Z", countedItems: 0 }),
      inv({ id: "velho-com-contagem", date: "2026-06-05T00:00:00.000Z", countedItems: 3 }),
      inv({ id: "novo-vazio", date: "2026-10-01T00:00:00.000Z", countedItems: 0 }),
      inv({ id: "aprovado-vazio", date: "2026-06-05T00:00:00.000Z", countedItems: 0, status: "APROVADO" })
    ];
    expect(rascunhosVazios(lista, hoje).map((i) => i.id)).toEqual(["velho-vazio"]);
  });
});

describe("proximoPasso", () => {
  test("rascunho com itens faltando diz quantos", () => {
    expect(proximoPasso(inv({ status: "RASCUNHO", totalItems: 219, countedItems: 0, pendingItems: 219 }))).toEqual({ texto: "Faltam 219 itens", tom: "atencao" });
  });

  test("rascunho completo esta pronto para revisao", () => {
    expect(proximoPasso(inv({ status: "RASCUNHO", totalItems: 38, countedItems: 38, pendingItems: 0 }))).toEqual({ texto: "Pronto para enviar à revisão", tom: "acao" });
  });

  test("cada status tem o seu passo", () => {
    expect(proximoPasso(inv({ status: "EM_REVISAO" })).texto).toBe("Aguardando aprovação");
    expect(proximoPasso(inv({ status: "REJEITADO" })).texto).toBe("Devolvido: corrigir e reenviar");
    expect(proximoPasso(inv({ status: "APROVADO" })).texto).toBe("Aprovado, falta fechar");
    expect(proximoPasso(inv({ status: "FECHADO" })).texto).toBe("Fechado");
    expect(proximoPasso(inv({ status: "CANCELADO" })).texto).toBe("Cancelado");
  });
});

describe("situacao", () => {
  test("ultimo fechamento e o final CMV aprovado ou fechado mais recente", () => {
    const s = situacao([
      inv({ id: "jun", type: "FINAL_CMV", status: "FECHADO", date: "2026-06-29T00:00:00.000Z" }),
      inv({ id: "jul", type: "FINAL_CMV", status: "APROVADO", date: "2026-07-31T00:00:00.000Z" }),
      inv({ id: "rasc", type: "FINAL_CMV", status: "RASCUNHO", date: "2026-08-31T00:00:00.000Z" }),
      inv({ id: "a", status: "EM_REVISAO" }),
      inv({ id: "b", status: "RASCUNHO" })
    ]);
    expect(s.ultimoFechamento?.id).toBe("jul");
    expect(s.emAndamento).toBe(3);
    expect(s.emRevisao).toBe(1);
  });
});
