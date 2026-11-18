// Desligado que ainda está com "Participa da gorjeta" marcado no cadastro. Depois que o ciclo
// da saída foi fechado ele já recebeu tudo o que tinha direito, então a marca pode ser
// limpa. Antes disso não: o ciclo ainda precisa dele (rescisão), e para quem não tem registro
// a atualização do período o trataria como "só salário" e tiraria a gorjeta.
export type DesligadoComParticipa = { employeeId: string; nome: string; terminationDate: Date };
export type PeriodoDeGorjeta = { periodStart: Date; periodEnd: Date; status: "OPEN" | "CLOSED" };

// Pode limpar quando o ciclo da saída existe e está fechado (ou a saída é de antes do primeiro
// ciclo do sistema). Sem ciclo cobrindo a data (ciclo ainda não criado) não limpa: quando ele
// for criado ainda vai precisar da pessoa para a rescisão.
export function podeLimparParticipa(saida: Date, periodos: readonly PeriodoDeGorjeta[]): boolean {
  if (periodos.length === 0) return true;
  const cobrindo = periodos.filter((p) => saida >= p.periodStart && saida <= p.periodEnd);
  if (cobrindo.length > 0) return cobrindo.every((p) => p.status === "CLOSED");
  const primeiro = Math.min(...periodos.map((p) => p.periodStart.getTime()));
  return saida.getTime() < primeiro;
}

export function desligadosParaLimpar(
  candidatos: readonly DesligadoComParticipa[], periodos: readonly PeriodoDeGorjeta[],
): DesligadoComParticipa[] {
  return candidatos.filter((c) => podeLimparParticipa(c.terminationDate, periodos));
}

const dataBr = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");
export const motivoDaLimpeza = (saida: Date) => `Desligado em ${dataBr(saida)}: saiu da gorjeta depois do fechamento do ciclo da saída.`;
