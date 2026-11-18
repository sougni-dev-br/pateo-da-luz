// Quem aparece na Equipe da gorjeta: o cadastro de funcionários manda. Desligado que saiu
// antes do início do ciclo já recebeu no ciclo dele e não entra mais no período, mesmo que
// o cadastro ainda tenha "participa da gorjeta" marcado. Quem saiu dentro do ciclo continua
// (recebe pela rescisão). O seletor da tela traz de volta os desligados antigos.
type Membro = { isActive: boolean; terminationDate?: string | null };

export function saiuAntesDoCiclo(m: Membro, inicioDoCicloIso: string | null | undefined): boolean {
  if (m.isActive) return false;
  if (!m.terminationDate) return true;
  if (!inicioDoCicloIso) return false;
  return m.terminationDate.slice(0, 10) < inicioDoCicloIso;
}

export function aparecemNaEquipe<T extends Membro>(
  equipe: readonly T[], inicioDoCicloIso: string | null | undefined, mostrarDesligados: boolean,
): T[] {
  return equipe.filter((m) => mostrarDesligados || !saiuAntesDoCiclo(m, inicioDoCicloIso));
}
