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

/** O que o razão tem de uma plataforma de delivery no mês. */
export type FaturamentoDoCanal = {
  /** Id normalizado: IFOOD, NOVENTA_NOVE ou KEETA. */
  id: string;
  /** Dias distintos com lançamento no mês. */
  dias: number;
  lancamentos: number;
  bruto: number;
  liquido: number;
};

const DIA_EM_MS = 86_400_000;

/**
 * Quantos dias do mês já podem ter faturamento: mês encerrado = todos; mês em
 * andamento = até ONTEM (o dia de hoje ainda não fechou); mês futuro = nenhum.
 */
export function diasEsperadosDoMes(year: number, month: number, hoje: Date): number {
  const inicio = Date.UTC(year, month - 1, 1);
  const diasDoMes = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const fimDoMes = inicio + diasDoMes * DIA_EM_MS;
  const hojeUtc = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate());
  if (hojeUtc >= fimDoMes) return diasDoMes;
  if (hojeUtc <= inicio) return 0;
  return Math.round((hojeUtc - inicio) / DIA_EM_MS);
}

const dinheiro = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Faturamento de CADA plataforma de delivery: todas pedem conferência, todo mês.
 *
 * A regra anterior só acusava o mês ZERADO. Plataforma com o mês inteiro lançado
 * (Keeta, 99 Food) nunca aparecia, e nada afirmava que o valor bate com o relatório
 * da plataforma — o repasse da 99 que nunca entrou em julho e a fatura da Keeta que
 * cai noutra competência passaram assim. Agora cada plataforma gera uma pendência que
 * diz o que o sistema tem (valor e dias) e só sai com a conferência registrada, ou,
 * se a loja não operou, com a explicação.
 */
export function avaliarCanaisDeDelivery(
  faturamentos: FaturamentoDoCanal[],
  contexto: { diasEsperados: number }
): PendenciaDoMes[] {
  const porCanal = new Map(faturamentos.map((f) => [f.id, f]));
  return CANAIS_DE_DELIVERY.map((canal) => {
    const key = chaveDoCanal(canal.id);
    const f = porCanal.get(canal.id);
    if (!f || f.lancamentos === 0) {
      return {
        key,
        label: `Delivery ${canal.rotulo}: nenhum faturamento no mês — importe os pedidos/repasses e registre a conferência (se a loja não operou, diga isso na conferência)`
      };
    }
    const valores = `${dinheiro(f.bruto)} bruto e ${dinheiro(f.liquido)} líquido`;
    const faltam = contexto.diasEsperados - f.dias;
    if (faltam > 0) {
      return {
        key,
        label: `Delivery ${canal.rotulo}: faturamento em ${f.dias} de ${contexto.diasEsperados} dias (${valores}) — faltam ${faltam} dia(s); complete a importação e registre a conferência`
      };
    }
    return {
      key,
      label: `Delivery ${canal.rotulo}: ${valores} em ${f.dias}/${contexto.diasEsperados} dias — confira com o relatório da plataforma e registre a conferência`
    };
  });
}
