/**
 * Contagens concluídas que ainda esperam virar inventário (o número do menu de Contagem de Estoque).
 * Contagem importada da planilha fica de fora: ela já nasce com o inventário dela e o sistema nunca oferece
 * "Gerar inventário" para ela, então jamais sairia da conta.
 */
export function contarContagensPendentes(
  sessoes: Array<{ status: string; generatedInventoryId: string | null; source: string | null; linkedSnapshotId: string | null }>
): number {
  return sessoes.filter((s) =>
    s.status === "CONCLUIDA"
    && !s.generatedInventoryId
    && s.source !== "IMPORTACAO_PLANILHA"
    && !s.linkedSnapshotId
  ).length;
}
