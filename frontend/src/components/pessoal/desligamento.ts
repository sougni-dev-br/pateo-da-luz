// Tipos de desligamento: o rótulo canônico vai para terminationReason (com observação
// opcional depois de " — "). Usado no desligamento de Funcionários e no passo 1 de Rescisões.
export const TIPOS_DESLIGAMENTO = [
  "Pedido de demissão",
  "Dispensa sem justa causa",
  "Dispensa com justa causa",
  "Fim de contrato (experiência/prazo)",
  "Acordo (art. 484-A)",
] as const;

/** Junta tipo e observação no formato gravado em terminationReason. */
export function motivoDoDesligamento(tipo: string, observacao: string): string {
  const nota = observacao.trim();
  return nota ? `${tipo} — ${nota}` : tipo;
}

/** Separa o terminationReason gravado em tipo (se for um dos conhecidos) e observação. */
export function lerMotivoDoDesligamento(motivo: string | null | undefined): { tipo: string; observacao: string } {
  const texto = (motivo ?? "").trim();
  const tipo = TIPOS_DESLIGAMENTO.find((t) => texto === t || texto.startsWith(`${t} — `));
  if (!tipo) return { tipo: "", observacao: texto };
  return { tipo, observacao: texto.slice(tipo.length).replace(/^ — /, "") };
}
