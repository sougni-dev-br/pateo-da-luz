export interface CicloAberto {
  id: string;
  periodStart: Date;
  periodEnd: Date | null;
}

export type EscolhaDoCiclo =
  | { cicloId: string }
  | { criar: { periodStart: Date; periodEnd: Date | null } };

export interface NotaEmCiclo {
  purchaseId: string;
  purchaseDate: Date;
  cycleId: string;
  cicloInicio: Date;
  cicloFim: Date | null;
}

const UM_DIA_MS = 24 * 60 * 60 * 1000;

const cobreData = (inicio: Date, fim: Date | null, data: Date) =>
  inicio.getTime() <= data.getTime() && (fim === null || fim.getTime() >= data.getTime());

/**
 * Ciclo (OPEN ou CHECKED) em que entra a compra de um fornecedor de ciclo.
 *
 * Só serve um ciclo cujo período cubra a data da compra. Um ciclo aberto que já venceu
 * não recebe nota nova: até 10/2026 o sistema caía no ciclo aberto mais recente, e um
 * ciclo de julho esquecido aberto recebeu as notas de setembro e outubro da FLD.
 * Sem ciclo para a data, cria-se um a partir dela — terminando na véspera do próximo
 * ciclo aberto, para não sobrepor; sem próximo, fica sem fim.
 */
export function escolherCicloDaCompra(ciclos: CicloAberto[], dataDaCompra: Date): EscolhaDoCiclo {
  const porInicioDesc = [...ciclos].sort((a, b) => b.periodStart.getTime() - a.periodStart.getTime());

  const cobre = porInicioDesc.find((c) => cobreData(c.periodStart, c.periodEnd, dataDaCompra));
  if (cobre) return { cicloId: cobre.id };

  const proximo = porInicioDesc.filter((c) => c.periodStart.getTime() > dataDaCompra.getTime()).at(-1);
  return {
    criar: {
      periodStart: dataDaCompra,
      periodEnd: proximo ? new Date(proximo.periodStart.getTime() - UM_DIA_MS) : null
    }
  };
}

/**
 * Notas que um ciclo recém-criado traz de outros ciclos abertos do fornecedor: as que
 * têm data no período dele e estão num ciclo que não cobre essa data (o ciclo para onde
 * caíram por falta de um melhor). Nota no ciclo certo não sai de lá.
 */
export function notasParaTrazer(notas: NotaEmCiclo[], periodo: { inicio: Date; fim: Date | null }): NotaEmCiclo[] {
  return notas
    .filter((n) => cobreData(periodo.inicio, periodo.fim, n.purchaseDate))
    .filter((n) => !cobreData(n.cicloInicio, n.cicloFim, n.purchaseDate))
    .sort((a, b) => a.purchaseDate.getTime() - b.purchaseDate.getTime());
}
