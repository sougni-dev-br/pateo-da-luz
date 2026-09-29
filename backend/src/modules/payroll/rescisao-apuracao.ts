// Apuração da rescisão pelo que o sistema já sabe: VT pago para depois da saída,
// vales em aberto na gorjeta do mês, salário proporcional e gorjeta até a saída.
//
// Sem registro não passa pela contabilidade: o bruto (salário + gorjeta) e os
// descontos (vales + VT) saem daqui. CLT recebe o bruto da contabilidade — e os
// vales já foram descontados da gorjeta enviada a ela —, então aqui só entra o VT.
import { prisma } from "../../config/database.js";
import { computeTipCommission } from "./tip-commission.service.js";
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
  diasSalario: number;
  salarioProporcional: number;
};

export type ApuracaoRescisao = {
  saida: string;
  semRegistro: boolean;
  vt: VtAposSaida & { observacao: string | null };
  vales: { itens: ValeAberto[]; descontos: number; creditos: number; liquido: number; entraNaRescisao: boolean };
  gorjeta: GorjetaAteSaida | null;
  gorjetaObservacao: string | null;
  sugestao: SugestaoRescisao;
};

// O que preenche a tela, parte por parte. Sem registro: salário, gorjeta e vales vêm
// daqui, cada um no seu campo. CLT: só o VT (bruto e gorjeta vêm da contabilidade).
export type SugestaoRescisao = {
  salario: number | null;
  gorjeta: number | null;
  creditos: number;
  vales: number;
  valesRotulo: string | null;
  vtDesconto: number;
  bruto: number | null;
};

// Junta as partes na sugestão que preenche a tela. Pura, para o teste.
export function montarSugestao(a: Omit<ApuracaoRescisao, "sugestao">): SugestaoRescisao {
  const vtDesconto = a.vt.total;
  if (!a.semRegistro) {
    return { salario: null, gorjeta: null, creditos: 0, vales: 0, valesRotulo: null, vtDesconto, bruto: null };
  }
  const g = a.gorjeta;
  const salario = g ? g.salarioProporcional : null;
  const gorjeta = g && !g.pendente ? g.gorjeta : null;
  // Crédito lançado na aba Vales (ex.: do fundo) soma ao que a pessoa recebe.
  const creditos = a.vales.creditos;
  const vales = a.vales.descontos;
  return {
    salario, gorjeta, creditos, vales,
    valesRotulo: vales > 0 ? a.vales.itens.filter((v) => v.tipo !== "CREDITO").map((v) => v.codigo ?? v.descricao ?? v.tipo).join(", ") : null,
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
  const semRegistro = emp.modality === "NAO_CLT";

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
  const vt = vtAposSaida(
    vtItens.map((i) => ({ periodLabel: i.periodLabel, periodStart: i.periodStart, details: i.details, pago: i.paymentDate != null })),
    saida, legs,
  );
  const vtObservacao = emp.vtType !== "TRANSPORTE_PUBLICO"
    ? "Bilhete mensal ou ajuda de custo: não há dias pagos para calcular; confira à mão."
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
        pontos: p.points, valorPonto: p.valorPonto, gorjeta: p.rateioAmount,
        pendente: p.rescisaoPendente,
        diasSalario: p.diasSalario, salarioProporcional: p.salarioProporcional,
      };
      if (p.rescisaoPendente) gorjetaObservacao = "A gorjeta até a saída está pendente: falta o serviço até a saída (faturamento).";
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
  };
  return { ...base, sugestao: montarSugestao(base) };
}
