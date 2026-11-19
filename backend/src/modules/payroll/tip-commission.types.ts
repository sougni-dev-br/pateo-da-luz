// Tipos de saída da Folha da Gorjeta (o que computeTipCommission devolve).

import type { DestinoSobra, ParticipanteEntrada, TipoCalculo, regraEfetiva } from "./tip-rateio.js";

// ─── Tipos de saída ─────────────────────────────────────────────────────────
export type ReciboGravado = {
  fonte: "TRCT";
  arquivo: string;
  hash: string;
  gorjeta: number;
  liquido: number | null;
  admissao: string | null;
  afastamento: string | null;
  pagamento: string | null;
  importadoEm: string;
  importadoPor: string;
};
export type ComputedVale = { id: string; type: string; amount: number; date: string | null; notes: string | null };
export type Origem = "ESCALA" | "MANUAL" | "PONTO";

export type RescisaoContasPagar = {
  valor: number | null;
  vencimento: string;
  status: "PENDING" | "PAID" | "OVERDUE";
  parcelas: number;
  // A gorjeta paga na apuração veio desta rescisão: só muda por lá.
  gorjetaDefinida: boolean;
  // Lançada pela regra "tudo na rescisão" (sem registro que saiu depois do ciclo, no mês do
  // salário): só ela zera a lista do mês. Ausente nas lançadas antes do marcador.
  tudoNaRescisao?: boolean;
};

export type ComputedParticipant = {
  participantId: string | null;
  employeeId: string;
  employeeName: string;
  // Apelido ("como quero ser chamado"), mostrado embaixo do nome; null se igual ou vazio.
  apelido: string | null;
  companyId: string | null;
  companyName: string | null;
  functionName: string | null;
  isActive: boolean;
  semRegistro: boolean;
  // Sem registro que não participa da gorjeta: está só pelo salário (gorjeta e pontos zero).
  foraDaGorjeta: boolean;
  admissionDate: string | null;
  terminationDate: string | null;
  kind: "FIXO" | "PONTOS";
  basePoints: number;
  pointsAdjustment: number;
  fixedAmount: number | null;
  // O que está na Escala agora, digitado ou não: para quem confere ver a diferença.
  escala: { faltas: number; atestados: number; ferias: number; afastamento: number };
  // Folgas da Escala no período. Só informação: a folga normal já está nos dias padrão
  // e nada disto entra no cálculo. Fechado, vem do retrato (null se o retrato é antigo).
  folgasEscala: FolgasEscala | null;
  // Presença (valor efetivo + de onde veio)
  faltas: number; faltasOrigem: Origem;
  atestados: number; atestadosOrigem: Origem;
  ferias: number; feriasOrigem: Origem;
  // Afastamento não remunerado: dias da Escala no ciclo. Sempre desconta; não se digita.
  afastamento: number; afastamentoOrigem: "ESCALA";
  // Dias de afastamento no mês civil do salário (sem registro). Fechado: o do retrato.
  afastamentoSalario: number;
  outrosDias: number;
  diasPrevistosOverride: number | null;
  diasElegiveis: number;
  diasPrevistos: number;
  diasReferencia: number;
  diasComputados: number;
  // Decisão de quem fecha para esta pessoa (null = regra do período) e o que vale no fim.
  regras: ParticipanteEntrada["regras"];
  regrasEfetivas: ReturnType<typeof regraEfetiva>;
  fatorPresenca: number;
  pontosApurados: number;
  points: number;          // pontos finais
  // Rescisão quitada: direito × o que a gorjeta paga vale em pontos.
  pontosDireito: number;
  pontosDevolvidos: number;
  extraRescisao: number;
  // Quitada: o que o direito valia (a gorjeta que o sistema apuraria sem o valor pago).
  valorDireito: number | null;
  // Gorjeta real digitada no lugar da calculada (null = vale a calculada). Gravada mas
  // sem efeito (virou fixo, saiu, ficou fora do período) também sai null, com aviso.
  gorjetaCalculada: number;
  gorjetaReal: { valor: number; motivo: string | null; por: string | null; em: string | null } | null;
  justificativaExtra: string | null;
  tipoCalculo: TipoCalculo;
  valorPonto: number;
  rescisaoServicoBruto: number | null;
  rescisaoServicoOrigem: "FATURAMENTO" | "MANUAL" | null;
  rescisaoValorFixo: number | null;
  rescisaoPendente: boolean;
  // Gorjeta quitada na rescisão: já foi paga pela contabilidade, não entra na lista a pagar.
  pagoNaRescisao: boolean;
  rescisaoRecibo: ReciboGravado | null;
  // Rescisão lançada em Contas a Pagar para quem saiu no período. O valor só com
  // permissão de Funcionários; saber que existe, sempre.
  rescisaoContasPagar: RescisaoContasPagar | null;
  rateioAmount: number;
  descontos: number;
  creditos: number;
  valesTotal: number;      // descontos − créditos
  netCommission: number;   // rateio − descontos + créditos
  // Gorjeta que vai à contabilidade (envio): com teto do IR (CLT), teto − salário registrado
  // vigentes no mês; sem teto, = netCommission. A pessoa recebe netCommission do mesmo jeito.
  // Com teto e sem a permissão de Funcionários vem null (o valor revelaria o salário): só o indicador.
  gorjetaInformada: number | null;
  gorjetaInformadaPeloTeto: boolean;
  // Teto do IR vigente no mês: só com a permissão de Funcionários.
  tetoIrGorjeta: number | null;
  diasSalarioOverride: number | null;
  diasSalario: number;
  salarioProporcional: number;
  // Sem registro: adiantamento salarial já pago no mês do salário, descontado do total.
  // Deriva do salário: null sem a permissão de Funcionários.
  adiantamentoSalarial: number | null;
  // Sem registro que recebe por quinzena: a 1ª quinzena já paga no dia 15, descontada do
  // total (acerto do dia 30). Metade do salário base: null sem a permissão de Funcionários.
  primeiraQuinzena: number | null;
  // Cadastro vigente no mês: recebe por quinzena (o acerto vence no fim do mês, não no 5º dia útil).
  pagamentoQuinzenal: boolean;
  // Sem registro: hora extra (+50%) e adicional noturno, já somados no total a pagar.
  // CLT = 0 (só informativo, vai à contabilidade). Derivam do salário: null sem a permissão.
  valorHoraExtra: number | null;
  valorAdicionalNoturno: number | null;
  // Sem registro: DSR sobre a hora extra e o noturno, já somado no total. Idem: null sem a permissão.
  valorDsr: number | null;
  totalAPagar: number;
  // Só com permissão de Funcionários (ficha com salário e PIX).
  baseSalary: number | null;
  pixKeyType: string | null;
  pixKey: string | null;
  horaExtra: string | null;
  adicionalNoturno: string | null;
  /** Hora extra e adicional noturno que o Ponto fechado traz (h:mm) quando nada foi digitado; null = sem Ponto fechado ou não se aplica. */
  horaExtraPonto: string | null;
  adicionalNoturnoPonto: string | null;
  justificada: boolean;
  vales: ComputedVale[];
};

export type TipComputation = {
  year: number;
  month: number;
  label: string;
  periodId: string | null;
  code: string | null;
  // Versão vigente do registro de fechamento (null enquanto nunca fechou).
  fechamento: { id: string; code: string; version: number; closedAt: string; closedByName: string } | null;
  status: "OPEN" | "CLOSED" | null;
  periodStart: string;
  periodEnd: string;
  grossPool: number;
  // Serviço arrecadado = faturamento + ajuste manual (serviço fora do sistema).
  servicoFaturamento: number;
  ajusteServico: number;
  ajusteServicoMotivo: string | null;
  deductionPercent: number;
  // Quebra retida além da retenção (% e valor) e o destino dos pontos não distribuídos.
  quebraPercent: number;
  quebraValor: number;
  destinoSobra: DestinoSobra;
  // O que vale de fato: REDISTRIBUIR sem pontos para dividir age como LIVRE.
  destinoEfetivo: DestinoSobra;
  // Parte do saldo que entra no fundo de reserva ao fechar (só no destino FUNDO).
  saldoAoFundo: number;
  netPool: number;
  fixedTotal: number;
  // O que as rescisões levam, em reais e em pontos. Só sai da apuração do mês no
  // modo padrão; com sobraRescisaoParaSaldo o divisor é o total de pontos.
  rescisoes: { valor: number; pontos: number };
  pontosDisponiveis: number;
  pointsPool: number;
  pointsBudget: number;
  totalPoints: number;
  pointsRemaining: number;
  pointValue: number;
  diasPadrao: number;
  descontaFalta: boolean;
  descontaAtestado: boolean;
  descontaFerias: boolean;
  descontaOutros: boolean;
  // Afastamento não remunerado desconta na gorjeta (regra do período; a pessoa pode ter a dela).
  descontaAfastamento: boolean;
  proporcionalEntrada: boolean;
  // Parte de quem saiu depois da saída: true = vai para o livre; false = sobe o ponto de quem fica.
  sobraRescisaoParaSaldo: boolean;
  distribuido: number;
  // De onde sai o distribuído: quem está no mês, quem saiu no período, a reserva e as cotas fixas.
  composicao: {
    mes: { valor: number; pontos: number; pessoas: number };
    rescisoes: { valor: number; pontos: number; pessoas: number; pendentes: number };
    reserva: { valor: number; pontos: number };
    fixos: { valor: number; pessoas: number };
  };
  saldo: number;
  reservaTotal: number;
  // Pontos do período que vão para o fundo de reserva e o saldo acumulado do fundo.
  reservaPontos: number;
  fundoReservaSaldo: number;
  participants: ComputedParticipant[];
  // Regra do adiantamento salarial (Folha → configurações), para explicar a lista.
  adiantamento: { percent: number; dia: number };
  // adiantamentos, horasExtrasSemRegistro (hora extra + noturno da lista) e dsrSemRegistro:
  // null sem a permissão de Funcionários.
  totals: {
    rateio: number; vales: number; netCommission: number; salarios: number; adiantamentos: number | null;
    // 1ª quinzena já paga (sem registro por quinzena): null sem a permissão de Funcionários.
    primeirasQuinzenas: number | null;
    horasExtrasSemRegistro: number | null; dsrSemRegistro: number | null; totalAPagar: number; pagoNaRescisao: number;
  };
  check: { expectedNetPool: number; sumRateios: number; ok: boolean; diff: number };
  pendencias: string[];
  warnings: string[];
  // Os mesmos textos de pendencias/warnings, com as pessoas citadas (para ir até a linha).
  situacao: ItemDeSituacao[];
};

export type ItemDeSituacao = { gravidade: "PENDENCIA" | "AVISO"; texto: string; employeeIds: string[] };

export type FolgasEscala = { total: number; folga: number; feriado: number; bancoHoras: number };
