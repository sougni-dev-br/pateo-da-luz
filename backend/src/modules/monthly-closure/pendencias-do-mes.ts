// Pendências do Fechamento Mensal que dependem só de contagens simples:
// folha lançada, gorjeta fechada e canal de delivery com faturamento.
//
// Separado do service para testar sem banco. Cada regra recebe números já
// medidos e devolve as pendências; a saída para quem tem motivo é a justificativa.

export type PendenciaDoMes = { key: string; label: string };

/** Canais de delivery que o restaurante opera. `id` é o valor normalizado (maiúsculas). */
export const CANAIS_DE_DELIVERY = [
  { id: "IFOOD", rotulo: "iFood" },
  { id: "NOVENTA_NOVE", rotulo: "99 Food" },
  { id: "KEETA", rotulo: "Keeta" }
] as const;

export function chaveDoCanal(canalId: string): string {
  return `delivery:${canalId}`;
}

export function avaliarFolhaLancada(salariosLancados: number): PendenciaDoMes[] {
  if (salariosLancados > 0) return [];
  return [{
    key: "block:payrollNotLaunched",
    label: "Folha do mês não lançada: nenhum salário gerado para a competência — o gasto de pessoal fica fora do DRE"
  }];
}

export function avaliarGorjetaDoMes(apuracoes: { total: number; abertas: number }): PendenciaDoMes[] {
  if (apuracoes.total === 0) {
    return [{
      key: "block:tipsNotClosed",
      label: "Gorjeta: nenhuma apuração criada para o mês — a gorjeta precisa ser apurada e fechada"
    }];
  }
  if (apuracoes.abertas > 0) {
    return [{
      key: "block:tipsNotClosed",
      label: `Gorjeta: ${apuracoes.abertas} apuração(ões) em aberto — feche antes de travar o mês`
    }];
  }
  return [];
}

/**
 * Evento/empreitada não passa pelo Agile: só existe se alguém o lançar em
 * Faturamento > Lançar evento, e pode haver vários no mês. Por isso a pendência NÃO
 * some quando há lançamento: ter um evento lançado não prova que todos foram. Ela
 * só sai quando alguém confere e registra a conferência.
 */
export function avaliarFaturamentoDeEventos(eventos: { lancamentos: number; valor: number }): PendenciaDoMes[] {
  const key = "block:eventRevenue";
  if (eventos.lancamentos === 0) {
    return [{
      key,
      label: "Eventos / empreitada: nenhum faturamento lançado no mês — lance em Faturamento > Lançar evento e registre a conferência (se não houve evento, diga isso na conferência)"
    }];
  }
  const valor = eventos.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return [{
    key,
    label: `Eventos / empreitada: ${eventos.lancamentos} lançamento(s), ${valor} no mês — confira se todos os eventos foram lançados e registre a conferência`
  }];
}

/** `canaisComVenda`: ids normalizados (maiúsculas) que tiveram faturamento no mês. */
export function avaliarCanaisDeDelivery(canaisComVenda: string[]): PendenciaDoMes[] {
  const comVenda = new Set(canaisComVenda);
  return CANAIS_DE_DELIVERY
    .filter((canal) => !comVenda.has(canal.id))
    .map((canal) => ({
      key: chaveDoCanal(canal.id),
      label: `Delivery ${canal.rotulo}: nenhum faturamento no mês — importe os pedidos/repasses (se a loja não operou, justifique)`
    }));
}
