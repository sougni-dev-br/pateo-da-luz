export interface CicloAberto {
  id: string;
  periodStart: Date;
  periodEnd: Date | null;
}

export type EscolhaDoCiclo =
  | { cicloId: string }
  | { criar: { periodStart: Date; periodEnd: Date | null } };

const UM_DIA_MS = 24 * 60 * 60 * 1000;

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
  const data = dataDaCompra.getTime();
  const porInicioDesc = [...ciclos].sort((a, b) => b.periodStart.getTime() - a.periodStart.getTime());

  const cobre = porInicioDesc.find(
    (c) => c.periodStart.getTime() <= data && (c.periodEnd === null || c.periodEnd.getTime() >= data)
  );
  if (cobre) return { cicloId: cobre.id };

  const proximo = porInicioDesc.filter((c) => c.periodStart.getTime() > data).at(-1);
  return {
    criar: {
      periodStart: dataDaCompra,
      periodEnd: proximo ? new Date(proximo.periodStart.getTime() - UM_DIA_MS) : null
    }
  };
}
