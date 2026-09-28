import type { InventoryAgendaItem, InventoryRoutineStatus } from "../../api/client";

// Rotina do estoquista: o que cada dia da agenda oferece. O status vem da
// sessao de contagem ligada ao dia (calculado no backend).

export type AcaoDoDiaDaRotina =
  | { tipo: "comecar"; destaque: boolean }
  | { tipo: "continuar"; sessionId: string }
  | { tipo: "ver"; sessionId: string }
  | { tipo: "sem-setor" }
  | { tipo: "nenhuma" };

export function acaoDoDiaDaRotina(item: InventoryAgendaItem, podeCriarContagem: boolean): AcaoDoDiaDaRotina {
  if (item.sessionId && item.routineStatus === "FEITA") return { tipo: "ver", sessionId: item.sessionId };
  if (item.sessionId && item.routineStatus === "EM_ANDAMENTO") return { tipo: "continuar", sessionId: item.sessionId };
  if (!item.activeSectorId) return { tipo: "sem-setor" };
  if (!podeCriarContagem) return { tipo: "nenhuma" };
  return { tipo: "comecar", destaque: item.routineStatus === "HOJE" || item.routineStatus === "ATRASADA" };
}

export function resumoDaRotina(itens: InventoryAgendaItem[]) {
  const contaveis = itens.filter((item) => item.activeSectorId);
  return {
    total: contaveis.length,
    feitas: contaveis.filter((item) => item.routineStatus === "FEITA").length,
    atrasadas: contaveis.filter((item) => item.routineStatus === "ATRASADA").length
  };
}

export const rotuloDoStatusDaRotina: Record<InventoryRoutineStatus, { label: string; tone: "success" | "info" | "danger" | "warning" | "neutral" }> = {
  FEITA: { label: "Feita", tone: "success" },
  EM_ANDAMENTO: { label: "Em andamento", tone: "info" },
  ATRASADA: { label: "Atrasada", tone: "danger" },
  HOJE: { label: "Hoje", tone: "warning" },
  PREVISTA: { label: "Prevista", tone: "neutral" }
};
