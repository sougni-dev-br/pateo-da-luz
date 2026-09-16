// O ciclo operacional como entidade.
//
// O restaurante nao fecha o CMV por competencia estrita: o ciclo termina no dia
// em que se conta o estoque, e esse dia cai no mes seguinte sempre que o ultimo
// dia do mes esta ocupado. Agosto/2026 fechou em 02/09 porque o dia 31 tinha
// evento; maio/2026 fechou em 01/06, mesma coisa.
//
// Ate aqui o ciclo era implicito — um par de campos (periodYear/periodMonth) nas
// contagens. Sem comeco e fim declarados nao da para somar "as compras do
// ciclo", so as da competencia, e por isso nenhum relatorio conseguia oferecer
// as duas visoes.
//
// Esta camada e so a fundacao: deriva os ciclos do historico que ja existe e os
// grava. Nenhum relatorio muda por causa dela.

/** Resumo de um ciclo como ele aparece nas contagens. */
export type ResumoDeCiclo = {
  competenceYear: number;
  competenceMonth: number;
  /** Data da ultima contagem nao cancelada do ciclo — e o dia em que ele fecha. */
  ultimaContagem: Date;
};

export type CicloDerivado = {
  competenceYear: number;
  competenceMonth: number;
  startDate: Date;
  endDate: Date;
};

function apenasData(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function diaSeguinte(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
}

function primeiroDiaDoMes(ano: number, mes: number) {
  return new Date(ano, mes - 1, 1);
}

function ordemDaCompetencia(c: { competenceYear: number; competenceMonth: number }) {
  return c.competenceYear * 12 + c.competenceMonth;
}

/**
 * Encadeia os ciclos: cada um termina no dia da contagem que o fechou e comeca
 * no dia seguinte ao fim do anterior. Assim nao ha buraco nem sobreposicao entre
 * dois ciclos, que e o que permite somar compras por ciclo sem contar duas vezes.
 *
 * O primeiro ciclo da serie nao tem anterior: comeca no primeiro dia do proprio
 * mes de competencia.
 *
 * Um ciclo cuja ultima contagem seja anterior ao inicio herdado (historico
 * baguncado) recebe endDate = startDate, em vez de um intervalo negativo.
 */
export function derivarCiclos(resumos: ResumoDeCiclo[]): CicloDerivado[] {
  const ordenados = [...resumos].sort((a, b) => ordemDaCompetencia(a) - ordemDaCompetencia(b));

  const ciclos: CicloDerivado[] = [];
  let fimAnterior: Date | null = null;

  for (const resumo of ordenados) {
    const startDate: Date = fimAnterior
      ? diaSeguinte(fimAnterior)
      : primeiroDiaDoMes(resumo.competenceYear, resumo.competenceMonth);
    const fimCandidato = apenasData(resumo.ultimaContagem);
    const endDate: Date = fimCandidato < startDate ? startDate : fimCandidato;

    ciclos.push({
      competenceYear: resumo.competenceYear,
      competenceMonth: resumo.competenceMonth,
      startDate,
      endDate,
    });
    fimAnterior = endDate;
  }

  return ciclos;
}

/** Quantos dias o ciclo durou, contando as duas pontas. */
export function duracaoEmDias(ciclo: CicloDerivado): number {
  const ms = ciclo.endDate.getTime() - ciclo.startDate.getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** O ciclo a que uma data pertence, ou null se estiver fora de todos. */
export function cicloDaData(ciclos: CicloDerivado[], data: Date): CicloDerivado | null {
  const d = apenasData(data);
  return ciclos.find((c) => d >= c.startDate && d <= c.endDate) ?? null;
}

/**
 * True quando o ciclo terminou fora do proprio mes de competencia — a virada que
 * motivou tudo isto. Serve para a tela explicar por que agosto fecha em 02/09.
 */
export function fechouForaDoMes(ciclo: CicloDerivado): boolean {
  return (
    ciclo.endDate.getFullYear() !== ciclo.competenceYear ||
    ciclo.endDate.getMonth() + 1 !== ciclo.competenceMonth
  );
}
