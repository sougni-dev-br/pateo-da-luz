// Apuração da rescisão pelo que o sistema já sabe: VT pago para depois da saída,
// vales em aberto na gorjeta do mês, salário proporcional e gorjeta até a saída.
//
// Sem registro não passa pela contabilidade: o bruto (salário + gorjeta) e os
// descontos (vales + VT) saem daqui. CLT recebe o bruto da contabilidade — e os
// vales já foram descontados da gorjeta enviada a ela —, então aqui só entra o VT.
import { prisma } from "../../config/database.js";
import { computeTipCommission } from "./tip-commission.service.js";
import { semRegistroEm } from "./cadastro-historico.service.js";
import { DIA_PRIMEIRA_QUINZENA } from "./tip-rateio.js";
import { costOfCalendarDay, round2, type Leg } from "./vt-calc.js";

const isoDia = (d: Date) => d.toISOString().slice(0, 10);

export type VtLancado = {
  periodLabel: string;
  periodStart: Date | null;
  details: unknown;
  pago: boolean;
};

export type DiaVtDescontado = { data: string; custo: number; lancamento: string; pago: boolean };

export type VtAposSaida = {
  total: number;
  dias: DiaVtDescontado[];
  // Lançamentos sem a lista de dias pagos (antigos, bilhete mensal, ajuda de custo):
  // não dá para saber o que cobriram, então ficam para conferência manual.
  semDetalhe: string[];
};

// Cada quinzena de VT guarda em details.diasPagos os dias do mês que pagou. O que
// cai depois da saída foi pago e não vai ser usado: volta na rescisão.
export function vtAposSaida(itens: VtLancado[], saida: Date, legs: Leg[]): VtAposSaida {
  const limite = Date.UTC(saida.getUTCFullYear(), saida.getUTCMonth(), saida.getUTCDate());
  const dias: DiaVtDescontado[] = [];
  const semDetalhe: string[] = [];
  const vistos = new Set<string>();
  for (const it of itens) {
    const lista = (it.details as { diasPagos?: unknown } | null)?.diasPagos;
    if (!it.periodStart || !Array.isArray(lista)) {
      semDetalhe.push(it.periodLabel);
      continue;
    }
    const ano = it.periodStart.getUTCFullYear();
    const mes = it.periodStart.getUTCMonth();
    for (const d of lista) {
      if (typeof d !== "number") continue;
      const data = new Date(Date.UTC(ano, mes, d));
      if (data.getTime() <= limite) continue;
      const chave = isoDia(data);
      if (vistos.has(chave)) continue; // o mesmo dia em dois lançamentos não desconta duas vezes
      vistos.add(chave);
      const custo = round2(costOfCalendarDay(legs, data));
      if (custo <= 0) continue;
      dias.push({ data: chave, custo, lancamento: it.periodLabel, pago: it.pago });
    }
  }
  dias.sort((a, b) => a.data.localeCompare(b.data));
  return { total: round2(dias.reduce((a, d) => a + d.custo, 0)), dias, semDetalhe };
}

export type ValeAberto = { codigo: string | null; data: string | null; tipo: string; descricao: string | null; valor: number };

export type GorjetaAteSaida = {
  periodo: string;
  status: "OPEN" | "CLOSED";
  pontos: number;
  valorPonto: number;
  gorjeta: number;
  pendente: boolean;
  // null = oculto (sem permissão de ver Funcionários).
  diasSalario: number | null;
  salarioProporcional: number | null;
};

export type ApuracaoRescisao = {
  saida: string;
  semRegistro: boolean;
  vt: VtAposSaida & { observacao: string | null };
  vales: { itens: ValeAberto[]; descontos: number; creditos: number; liquido: number; entraNaRescisao: boolean };
  gorjeta: GorjetaAteSaida | null;
  gorjetaObservacao: string | null;
  // Sem registro com a gorjeta do mês já fechada e paga na lista: salário e gorjeta
  // até a saída já saíram por lá. valor = null quando oculto (sem ver Funcionários).
  jaPagoNaLista: JaPagoNaLista | null;
  // Sem registro que recebe adiantamento e saiu no dia do adiantamento ou depois: o
  // que já recebeu no mês desconta na rescisão. valor = null quando oculto.
  adiantamento: AdiantamentoPago | null;
  // Sem registro que recebe por quinzena e saiu no dia 15 ou depois: a 1ª quinzena já paga
  // desconta na rescisão, como o adiantamento. valor = null quando oculto. Ausente nas
  // apurações gravadas antes desta versão.
  primeiraQuinzena?: AdiantamentoPago | null;
  // Sem registro com horas digitadas na gorjeta do período da saída: a lista não paga
  // (a pessoa sai dela com a rescisão lançada), então entra aqui, nos créditos.
  // Ausente nas apurações gravadas antes desta versão.
  horaExtra?: HoraExtraRescisao | null;
  sugestao: SugestaoRescisao;
  dadosPessoaisOcultos?: boolean;
};

export type JaPagoNaLista = { valor: number | null; competencia: string };
// valor = hora extra + adicional noturno; null quando oculto (deriva do salário).
export type HoraExtraRescisao = { horaExtra: string | null; adicionalNoturno: string | null; valor: number | null };
export type AdiantamentoPago = { valor: number | null; data: string };

// Gorjeta fechada com total a pagar gravado para quem não tem registro: a lista de
// pagamento já levou salário, gorjeta e vales. Lançar de novo na rescisão paga duas vezes.
export function jaPagoNaListaFechada(
  a: { status: string | null; semRegistro: boolean; totalAPagar: number | null | undefined },
): boolean {
  return a.semRegistro && a.status === "CLOSED" && Number(a.totalAPagar ?? 0) > 0.005;
}

export function observacaoJaPago(j: JaPagoNaLista): string {
  const quanto = j.valor == null ? "salário e gorjeta" : `${reaisBr(j.valor)} de salário e gorjeta`;
  return `Já pago na lista de pagamento da gorjeta de ${j.competencia} (fechada): ${quanto}. Não lance de novo aqui.`;
}

// O que preenche a tela, parte por parte. Sem registro: salário, gorjeta e vales vêm
// daqui, cada um no seu campo. CLT: só o VT (bruto e gorjeta vêm da contabilidade).
export type SugestaoRescisao = {
  salario: number | null;
  gorjeta: number | null;
  // Créditos da aba Vales + a hora extra e o noturno (a parte dela em horaExtra).
  creditos: number;
  horaExtra: number;
  // Vales da aba Vales + o adiantamento salarial e a 1ª quinzena já pagos (a parte de cada
  // um em adiantamento e primeiraQuinzena).
  vales: number;
  valesRotulo: string | null;
  adiantamento: number;
  primeiraQuinzena: number;
  vtDesconto: number;
  bruto: number | null;
};

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// "VALE-2026-00012, Adiantamento salarial 20/09": o que compõe o desconto de vales.
export function rotuloVales(
  itens: ValeAberto[], adiantamento: AdiantamentoPago | null, primeiraQuinzena: AdiantamentoPago | null = null,
): string | null {
  const partes = itens.filter((v) => v.tipo !== "CREDITO").map((v) => v.codigo ?? v.descricao ?? v.tipo);
  if (adiantamento && (adiantamento.valor ?? 0) > 0) partes.push(`Adiantamento salarial ${ddmm(adiantamento.data)}`);
  if (primeiraQuinzena && (primeiraQuinzena.valor ?? 0) > 0) partes.push(`1ª quinzena ${ddmm(primeiraQuinzena.data)}`);
  return partes.length > 0 ? partes.join(", ") : null;
}

// Junta as partes na sugestão que preenche a tela. Pura, para o teste.
export function montarSugestao(a: Omit<ApuracaoRescisao, "sugestao">): SugestaoRescisao {
  const vtDesconto = a.vt.total;
  if (!a.semRegistro) {
    return { salario: null, gorjeta: null, creditos: 0, horaExtra: 0, vales: 0, valesRotulo: null, adiantamento: 0, primeiraQuinzena: 0, vtDesconto, bruto: null };
  }
  // Já pago na lista fechada: salário, gorjeta, vales e créditos já entraram nela. O
  // apurado vira zero, e qualquer valor lançado aqui cai na divergência com justificativa.
  if (a.jaPagoNaLista) {
    return { salario: 0, gorjeta: 0, creditos: 0, horaExtra: 0, vales: 0, valesRotulo: null, adiantamento: 0, primeiraQuinzena: 0, vtDesconto, bruto: 0 };
  }
  const g = a.gorjeta;
  const salario = g ? g.salarioProporcional : null;
  const gorjeta = g && !g.pendente ? g.gorjeta : null;
  // Crédito lançado na aba Vales (ex.: do fundo) e a hora extra/noturno do período somam
  // ao que a pessoa recebe. Vão juntos em "créditos", que entra no bruto da rescisão.
  const horaExtra = round2(a.horaExtra?.valor ?? 0);
  const creditos = round2(a.vales.creditos + horaExtra);
  // O adiantamento salarial e a 1ª quinzena já pagos no mês entram no desconto, junto dos vales.
  const adiantamento = round2(a.adiantamento?.valor ?? 0);
  const primeiraQuinzena = round2(a.primeiraQuinzena?.valor ?? 0);
  const vales = round2(a.vales.descontos + adiantamento + primeiraQuinzena);
  return {
    salario, gorjeta, creditos, horaExtra, vales,
    valesRotulo: vales > 0 ? rotuloVales(a.vales.itens, a.adiantamento, a.primeiraQuinzena ?? null) : null,
    adiantamento,
    primeiraQuinzena,
    vtDesconto,
    bruto: salario != null && gorjeta != null ? round2(salario + gorjeta + creditos) : null,
  };
}

// O que foi lançado, na mesma forma. Salário e gorjeta só existem para sem registro.
export type ValoresRescisao = { salario: number | null; gorjeta: number | null; vales: number; vtDesconto: number };
export type Divergencia = { campo: keyof ValoresRescisao; rotulo: string; apurado: number; lancado: number; diferenca: number };

const ROTULOS: Record<keyof ValoresRescisao, string> = {
  salario: "Salário proporcional", gorjeta: "Gorjeta até a saída", vales: "Vales", vtDesconto: "VT a descontar",
};
export const JUSTIFICATIVA_MINIMA = 10;

// Onde o que foi lançado difere do que o sistema apurou, campo a campo. O que o
// sistema não apurou (bruto e gorjeta de CLT, gorjeta pendente) não conta.
export function divergenciasDoApurado(sugestao: SugestaoRescisao | null, lancado: ValoresRescisao): Divergencia[] {
  if (!sugestao) return [];
  const apurado: Record<keyof ValoresRescisao, number | null> = {
    salario: sugestao.salario, gorjeta: sugestao.gorjeta,
    vales: sugestao.salario != null ? sugestao.vales : null,
    vtDesconto: sugestao.vtDesconto,
  };
  return (Object.keys(apurado) as Array<keyof ValoresRescisao>)
    .filter((c) => apurado[c] != null && lancado[c] != null && Math.abs(round2(lancado[c]!) - round2(apurado[c]!)) >= 0.01)
    .map((c) => ({
      campo: c, rotulo: ROTULOS[c], apurado: round2(apurado[c]!), lancado: round2(lancado[c]!),
      diferenca: round2(lancado[c]! - apurado[c]!),
    }));
}

export async function apurarRescisao(employeeId: string): Promise<ApuracaoRescisao | null> {
  const emp = await prisma.employee.findFirst({
    where: { id: employeeId, deletedAt: null },
    select: {
      id: true, modality: true, terminationDate: true, vtType: true,
      vtLegs: { include: { fare: true }, orderBy: [{ direction: "asc" }, { sortOrder: "asc" }] },
    },
  });
  if (!emp?.terminationDate) return null;
  const saida = emp.terminationDate;
  // Vínculo vigente na saída (quem virou CLT depois de sair sem registro continua sem registro aqui).
  const semRegistro = await semRegistroEm(emp.id, emp.modality, saida);

  // VT: só quinzenas que cobrem algo depois da saída (início até o fim do mês seguinte).
  const vtItens = await prisma.payrollItem.findMany({
    where: {
      employeeId, type: "VALE_TRANSPORTE", deletedAt: null, status: { not: "CANCELED" },
      periodEnd: { gt: saida },
    },
    select: { periodLabel: true, periodStart: true, details: true, paymentDate: true },
    orderBy: { periodStart: "asc" },
  });
  const legs: Leg[] = emp.vtLegs.map((l) => ({
    direction: l.direction, sortOrder: l.sortOrder,
    fare: {
      id: l.fare.id, name: l.fare.name, amount: round2(Number(l.fare.amount)),
      sundayAmount: l.fare.sundayAmount == null ? null : round2(Number(l.fare.sundayAmount)),
    },
  }));
  // Bilhete mensal fica com a pessoa: a parte do mês depois da saída não se desconta (regra do Eli, 01/10/2026).
  const bilheteMensal = emp.vtType === "BILHETE_MENSAL";
  const vt = bilheteMensal
    ? { total: 0, dias: [], semDetalhe: [] }
    : vtAposSaida(
      vtItens.map((i) => ({ periodLabel: i.periodLabel, periodStart: i.periodStart, details: i.details, pago: i.paymentDate != null })),
      saida, legs,
    );
  const vtObservacao = bilheteMensal
    ? "Bilhete mensal: fica com a pessoa, não se desconta na rescisão."
    : emp.vtType !== "TRANSPORTE_PUBLICO"
    ? "Ajuda de custo: não há dias pagos para calcular; confira à mão."
    : vtItens.length === 0 ? "Nenhuma quinzena de VT lançada cobrindo dias depois da saída."
      : legs.length === 0 ? "Sem trajeto cadastrado: não dá para saber o custo de cada dia."
        : null;

  // Gorjeta e vales: o período da gorjeta que contém a saída.
  const periodo = await prisma.tipPeriod.findFirst({
    where: { periodStart: { lte: saida }, periodEnd: { gte: saida } },
    select: { id: true, competenceYear: true, competenceMonth: true },
  });
  let gorjeta: GorjetaAteSaida | null = null;
  let gorjetaObservacao: string | null = null;
  let valesItens: ValeAberto[] = [];
  let descontos = 0;
  let creditos = 0;
  let jaPagoNaLista: JaPagoNaLista | null = null;
  let adiantamento: AdiantamentoPago | null = null;
  let primeiraQuinzena: AdiantamentoPago | null = null;
  let horaExtra: HoraExtraRescisao | null = null;
  if (!periodo) {
    gorjetaObservacao = "Não há período de gorjeta aberto que contenha a data de saída.";
  } else {
    const comp = await computeTipCommission(periodo.competenceYear, periodo.competenceMonth, { incluirDadosPessoais: true });
    const p = comp.participants.find((x) => x.employeeId === employeeId);
    if (!p) {
      gorjetaObservacao = `Não está na gorjeta de ${comp.label}.`;
    } else {
      gorjeta = {
        periodo: comp.label,
        status: comp.status === "CLOSED" ? "CLOSED" : "OPEN",
        // Já quitada (a rescisão gravou a gorjeta paga): o apurado continua sendo o
        // direito, não o valor pago — senão a comparação com o lançado some.
        pontos: p.tipoCalculo === "RESCISAO_QUITADA" ? p.pontosDireito : p.points,
        valorPonto: p.valorPonto,
        gorjeta: p.tipoCalculo === "RESCISAO_QUITADA" ? p.valorDireito ?? p.rateioAmount : p.rateioAmount,
        pendente: p.rescisaoPendente,
        diasSalario: p.diasSalario, salarioProporcional: p.salarioProporcional,
      };
      if (p.rescisaoPendente) gorjetaObservacao = "A gorjeta até a saída está pendente: falta o serviço até a saída (faturamento).";
      if (jaPagoNaListaFechada({ status: comp.status, semRegistro, totalAPagar: p.totalAPagar })) {
        jaPagoNaLista = {
          valor: round2(p.totalAPagar),
          competencia: `${String(periodo.competenceMonth).padStart(2, "0")}/${periodo.competenceYear}`,
        };
        gorjetaObservacao = observacaoJaPago(jaPagoNaLista);
      }
      // O cálculo da gorjeta já decide se houve adiantamento (sem registro, cadastro,
      // saída no dia do adiantamento ou depois, no mês do salário do período).
      if (semRegistro && (p.adiantamentoSalarial ?? 0) > 0 && !jaPagoNaLista) {
        const { competenceYear: ano, competenceMonth: mes } = periodo;
        const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
        adiantamento = { valor: p.adiantamentoSalarial, data: isoDia(new Date(Date.UTC(ano, mes - 1, Math.min(comp.adiantamento.dia, ultimo)))) };
      }
      // 1ª quinzena: o cálculo da gorjeta já decide se saiu (sem registro, por quinzena no
      // cadastro vigente, no vínculo no dia 15 do mês do salário do período).
      if (semRegistro && (p.primeiraQuinzena ?? 0) > 0 && !jaPagoNaLista) {
        const { competenceYear: ano, competenceMonth: mes } = periodo;
        primeiraQuinzena = { valor: p.primeiraQuinzena, data: isoDia(new Date(Date.UTC(ano, mes - 1, DIA_PRIMEIRA_QUINZENA))) };
      }
      // Hora extra e noturno do período da saída (o cálculo da gorjeta já aplicou a regra).
      const valorHoraExtra = round2((p.valorHoraExtra ?? 0) + (p.valorAdicionalNoturno ?? 0));
      if (semRegistro && valorHoraExtra > 0 && !jaPagoNaLista) {
        horaExtra = { horaExtra: p.horaExtra ?? null, adicionalNoturno: p.adicionalNoturno ?? null, valor: valorHoraExtra };
      }
      descontos = p.descontos;
      creditos = p.creditos;
      if (p.participantId) {
        const vales = await prisma.tipVale.findMany({
          where: { participantId: p.participantId, canceledAt: null },
          select: { codigo: true, date: true, type: true, notes: true, amount: true },
          orderBy: { date: "asc" },
        });
        valesItens = vales.map((v) => ({
          codigo: v.codigo, data: v.date ? isoDia(v.date) : null, tipo: v.type, descricao: v.notes, valor: round2(Number(v.amount)),
        }));
      }
    }
  }

  const base = {
    saida: isoDia(saida),
    semRegistro,
    vt: { ...vt, observacao: vtObservacao },
    vales: {
      itens: valesItens, descontos, creditos, liquido: round2(descontos - creditos),
      entraNaRescisao: semRegistro,
    },
    gorjeta,
    gorjetaObservacao,
    jaPagoNaLista,
    adiantamento,
    primeiraQuinzena,
    horaExtra,
  };
  return { ...base, sugestao: montarSugestao(base) };
}

// ─── A gorjeta da rescisão é a da apuração ────────────────────────────────────
// Sem registro: a gorjeta paga na rescisão vira a "gorjeta paga" do participante no
// período da saída. Lá ela vale pontos pelo valor do ponto do mês: abaixo do direito,
// a sobra fica livre para distribuir; acima, vira extra automático e sai do saldo.
// Guardamos na rescisão o que havia antes, para desfazer se ela for excluída.
export type GorjetaNaApuracao = { participantId: string; periodo: string; anterior: number | null; aplicada: number };

export async function localizarGorjetaNaApuracao(
  employeeId: string, saida: Date | null, gorjeta: number | null,
): Promise<{ erro: string } | { alvo: Omit<GorjetaNaApuracao, "aplicada"> | null }> {
  if (gorjeta == null || !saida) return { alvo: null };
  const periodo = await prisma.tipPeriod.findFirst({
    where: { periodStart: { lte: saida }, periodEnd: { gte: saida } },
    select: { id: true, label: true, status: true },
  });
  if (!periodo) return { alvo: null };
  const p = await prisma.tipParticipant.findUnique({
    where: { periodId_employeeId: { periodId: periodo.id, employeeId } },
    select: { id: true, rescisaoValorFixo: true, rateioAmount: true, totalAPagar: true, employee: { select: { modality: true } } },
  });
  if (!p) return { alvo: null };
  const anterior = p.rescisaoValorFixo == null ? null : round2(Number(p.rescisaoValorFixo));
  // Já pago na lista fechada: a apuração não muda. O que for lançado aqui além do zero
  // apurado já passou pela divergência com justificativa.
  const semRegistro = await semRegistroEm(employeeId, p.employee.modality, saida);
  if (jaPagoNaListaFechada({ status: periodo.status, semRegistro, totalAPagar: Number(p.totalAPagar ?? 0) })) {
    return { alvo: null };
  }
  if (periodo.status === "CLOSED") {
    // Fechada, a gorjeta não muda mais: só aceita o mesmo valor que foi fechado.
    if (Math.abs(round2(Number(p.rateioAmount ?? 0)) - round2(gorjeta)) < 0.01) return { alvo: null };
    return { erro: `A gorjeta de ${periodo.label} já está fechada com ${reaisBr(Number(p.rateioAmount ?? 0))} para esta pessoa. Reabra a gorjeta para lançar outro valor.` };
  }
  return { alvo: { participantId: p.id, periodo: periodo.label, anterior } };
}

const reaisBr = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function ocultarJaPago(j: JaPagoNaLista) {
  const oculto: JaPagoNaLista = { ...j, valor: null };
  return { jaPagoNaLista: oculto, gorjetaObservacao: observacaoJaPago(oculto) };
}

// Sem a permissão de ver Funcionários: sai o salário (e o que o revela) e a descrição
// dos vales; ficam gorjeta, VT e os totais.
export function semDadosPessoais(a: ApuracaoRescisao | null): ApuracaoRescisao | null {
  if (!a) return a;
  return {
    ...a,
    gorjeta: a.gorjeta ? { ...a.gorjeta, salarioProporcional: null, diasSalario: null } : null,
    vales: { ...a.vales, itens: a.vales.itens.map((v) => ({ ...v, descricao: null })) },
    // O adiantamento é % do salário e a 1ª quinzena é metade dele: saem do desconto
    // sugerido e da apuração. A hora extra (salário ÷ 220) também: sai dos créditos.
    sugestao: {
      ...a.sugestao, salario: null, bruto: null, adiantamento: 0, primeiraQuinzena: 0,
      vales: round2(a.sugestao.vales - a.sugestao.adiantamento - (a.sugestao.primeiraQuinzena ?? 0)),
      valesRotulo: a.sugestao.adiantamento > 0 || (a.sugestao.primeiraQuinzena ?? 0) > 0
        ? rotuloVales(a.vales.itens, null) : a.sugestao.valesRotulo,
      creditos: round2(a.sugestao.creditos - (a.sugestao.horaExtra ?? 0)), horaExtra: 0,
    },
    adiantamento: a.adiantamento ? { ...a.adiantamento, valor: null } : null,
    primeiraQuinzena: a.primeiraQuinzena ? { ...a.primeiraQuinzena, valor: null } : a.primeiraQuinzena,
    horaExtra: a.horaExtra ? { ...a.horaExtra, valor: null } : a.horaExtra,
    // O total pago na lista inclui o salário: some o valor, fica o aviso.
    ...(a.jaPagoNaLista ? ocultarJaPago(a.jaPagoNaLista) : {}),
    dadosPessoaisOcultos: true,
  };
}
