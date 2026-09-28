import { describe, expect, test } from "vitest";
import type { InventoryAgendaItem } from "../../../api/client";
import { acaoDoDiaDaRotina, resumoDaRotina } from "../routine";

function dia(overrides: Partial<InventoryAgendaItem>): InventoryAgendaItem {
  return {
    id: "a1",
    scheduledDate: "2026-09-30T03:00:00.000Z",
    categoryId: null,
    categoryName: "BAR",
    status: "PENDING",
    responsibleUserId: null,
    notes: null,
    startedAt: null,
    submittedAt: null,
    confirmedAt: null,
    activeSectorId: "s-bar",
    activeSectorName: "BAR",
    sessionId: null,
    sessionCode: null,
    sessionStatus: null,
    routineStatus: "HOJE",
    ...overrides
  };
}

describe("acaoDoDiaDaRotina", () => {
  test("dia de hoje com setor: comecar a contagem, em destaque", () => {
    expect(acaoDoDiaDaRotina(dia({}), true)).toEqual({ tipo: "comecar", destaque: true });
  });

  test("dia atrasado tambem fica em destaque; dia previsto nao", () => {
    expect(acaoDoDiaDaRotina(dia({ routineStatus: "ATRASADA" }), true)).toEqual({ tipo: "comecar", destaque: true });
    expect(acaoDoDiaDaRotina(dia({ routineStatus: "PREVISTA" }), true)).toEqual({ tipo: "comecar", destaque: false });
  });

  test("sessao em andamento: continuar a mesma sessao", () => {
    const item = dia({ routineStatus: "EM_ANDAMENTO", sessionId: "cs1", sessionCode: "CNT-2026-0101", sessionStatus: "EM_ANDAMENTO" });
    expect(acaoDoDiaDaRotina(item, true)).toEqual({ tipo: "continuar", sessionId: "cs1" });
  });

  test("dia feito: so abrir a sessao que cumpriu o dia", () => {
    const item = dia({ routineStatus: "FEITA", sessionId: "cs2", sessionCode: "CNT-2026-0102", sessionStatus: "CONCLUIDA" });
    expect(acaoDoDiaDaRotina(item, true)).toEqual({ tipo: "ver", sessionId: "cs2" });
  });

  test("dia sem setor ativo (ex.: Revisao/Pendencias) nao abre contagem", () => {
    expect(acaoDoDiaDaRotina(dia({ activeSectorId: null, activeSectorName: null }), true)).toEqual({ tipo: "sem-setor" });
  });

  test("sem permissao de criar contagem, o dia pendente nao oferece acao", () => {
    expect(acaoDoDiaDaRotina(dia({}), false)).toEqual({ tipo: "nenhuma" });
  });
});

describe("resumoDaRotina", () => {
  test("conta feitos e pendentes da semana, ignorando dias sem setor", () => {
    const itens = [
      dia({ id: "1", routineStatus: "FEITA" }),
      dia({ id: "2", routineStatus: "ATRASADA" }),
      dia({ id: "3", routineStatus: "HOJE" }),
      dia({ id: "4", routineStatus: "PREVISTA" }),
      dia({ id: "5", routineStatus: "EM_ANDAMENTO" }),
      dia({ id: "6", routineStatus: "ATRASADA", activeSectorId: null })
    ];
    expect(resumoDaRotina(itens)).toEqual({ total: 5, feitas: 1, atrasadas: 1 });
  });
});
