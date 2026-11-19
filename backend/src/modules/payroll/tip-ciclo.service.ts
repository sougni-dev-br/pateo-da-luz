// Fechar e reabrir o período da gorjeta.

import crypto from "node:crypto";
import { prisma } from "../../config/database.js";
import { round2 } from "./vt-calc.js";
import { motivoParaNaoRetirar, saldoReserva, travarFundo } from "./tip-historico.service.js";
import { registrarFechamento, registrarReabertura } from "./tip-fechamento.service.js";
import { parseHoras } from "./hora-extra.js";
import { computeTipCommission } from "./tip-commission.service.js";

// ─── Fechar: recalcula, grava os valores e trava ─────────────────────────────
// Grava também as ocorrências e o serviço da rescisão que vieram da Escala e do
// faturamento, para o período fechado não mudar se essas fontes mudarem depois.
export async function closeTipPeriod(year: number, month: number, usuario: { id: string; name: string }) {
  const userId = usuario.id;
  // Com os dados pessoais: o retrato do fechamento guarda o adiantamento salarial.
  // Nada deste cálculo volta ao navegador (a resposta é recalculada no fim).
  const comp = await computeTipCommission(year, month, { incluirDadosPessoais: true });
  if (!comp.periodId) throw new Error("Período não encontrado.");
  if (!comp.check.ok) {
    throw new Error(comp.pendencias[0] ?? "As cotas fixas passam do líquido do período.");
  }

  await prisma.$transaction(async (tx) => {
    for (const p of comp.participants) {
      if (!p.participantId) continue;
      await tx.tipParticipant.update({
        where: { id: p.participantId },
        data: {
          points: p.kind === "PONTOS" ? p.points : null,
          rateioAmount: p.rateioAmount,
          valesTotal: p.valesTotal,
          netCommission: p.netCommission,
          salarioProporcional: p.salarioProporcional,
          totalAPagar: p.totalAPagar,
          faltas: p.faltas,
          atestados: p.atestados,
          ferias: p.ferias,
          // As horas que vieram do Ponto (nada digitado) ficam gravadas: o fechado mostra de onde saiu o valor.
          ...(p.horaExtra == null && p.horaExtraPonto && parseHoras(p.horaExtraPonto)! > 0 ? { horaExtra: p.horaExtraPonto } : {}),
          ...(p.adicionalNoturno == null && p.adicionalNoturnoPonto && parseHoras(p.adicionalNoturnoPonto)! > 0 ? { adicionalNoturno: p.adicionalNoturnoPonto } : {}),
          rescisaoServicoBruto: p.rescisaoServicoBruto,
          functionName: p.functionName,
        },
      });
    }
    // Fundo de reserva: o que o fechamento guarda. Refazer um fechamento troca os lançamentos dele.
    await travarFundo(tx);
    const anteriores = await tx.tipReserveMovement.findMany({
      where: { periodId: comp.periodId!, type: { in: ["FECHAMENTO_RESERVA", "FECHAMENTO_SALDO"] } }, select: { amount: true },
    });
    // Só o destino FUNDO manda o saldo para o fundo; LIVRE o deixa no período.
    const saldoAoFundo = comp.saldoAoFundo;
    const retirada = round2(anteriores.reduce((a, m) => a + Number(m.amount), 0) - comp.composicao.reserva.valor - saldoAoFundo);
    const bloqueio = motivoParaNaoRetirar(await saldoReserva(tx), retirada, `${String(month).padStart(2, "0")}/${year}`);
    if (bloqueio) throw new Error(bloqueio);
    await tx.tipReserveMovement.deleteMany({ where: { periodId: comp.periodId!, type: { in: ["FECHAMENTO_RESERVA", "FECHAMENTO_SALDO"] } } });
    const dataFechamento = new Date(comp.periodEnd);
    const rotulo = `${String(month).padStart(2, "0")}/${year}`;
    if (comp.composicao.reserva.valor > 0) {
      await tx.tipReserveMovement.create({
        data: {
          id: crypto.randomUUID(), date: dataFechamento, type: "FECHAMENTO_RESERVA", amount: comp.composicao.reserva.valor,
          periodId: comp.periodId!, notes: `Reserva de ${rotulo}: ${comp.reservaPontos} pontos × ${comp.pointValue.toFixed(2)}`, createdById: userId,
        },
      });
    }
    if (saldoAoFundo > 0.005) {
      await tx.tipReserveMovement.create({
        data: {
          id: crypto.randomUUID(), date: dataFechamento, type: "FECHAMENTO_SALDO", amount: comp.saldo,
          periodId: comp.periodId!, notes: `Saldo não distribuído de ${rotulo}`, createdById: userId,
        },
      });
    }
    await tx.tipPeriod.update({
      where: { id: comp.periodId! },
      data: {
        netPool: comp.netPool, pointValue: comp.pointValue, saldoRetido: Math.max(0, comp.saldo),
        status: "CLOSED", closedAt: new Date(), updatedById: userId,
      },
    });
    // Registro permanente deste fechamento (retrato + hash), na mesma transação.
    const lancadas = await tx.tipReserveMovement.findMany({
      where: { periodId: comp.periodId!, type: { in: ["FECHAMENTO_RESERVA", "FECHAMENTO_SALDO"] } },
      select: { type: true, amount: true, notes: true },
    });
    await registrarFechamento(tx, comp, usuario, await saldoReserva(tx),
      lancadas.map((l) => ({ type: l.type, amount: Number(l.amount), notes: l.notes })));
  });

  return computeTipCommission(year, month);
}

// ─── Reabrir: destrava um período fechado para correções ─────────────────────
export async function reopenTipPeriod(year: number, month: number, usuario: { id: string; name: string }, motivo: string) {
  const userId = usuario.id;
  const texto = motivo.trim();
  if (texto.length < 10) throw new Error("Informe o motivo da reabertura (pelo menos 10 caracteres). Ele fica gravado no registro do fechamento.");
  const period = await prisma.tipPeriod.findUnique({
    where: { competenceYear_competenceMonth: { competenceYear: year, competenceMonth: month } },
  });
  if (!period) throw new Error("Período não encontrado.");
  if (period.status !== "CLOSED") throw new Error("O período não está fechado.");
  // Reabrir desmarca o envio e o OK (abaixo). Com títulos da folha ainda em aberto é permitido
  // (decisão do dono, 08/10/2026: corrigir a apuração depois de liberar acontece): ao fechar de
  // novo, os acertos são relançados e o total dos títulos acompanha. Com título já PAGO, não:
  // mudaria salário já pago — estorne a baixa antes.
  const pagos = await prisma.folhaLote.count({ where: { competenceYear: year, competenceMonth: month, status: "PAGO" } });
  if (pagos > 0) {
    throw new Error("Há título da folha desta competência já pago: reabrir mudaria salário já pago. Estorne a baixa no Contas a Pagar antes de reabrir (ou use 'Trocar extrato' se só o extrato mudou).");
  }

  await prisma.$transaction(async (tx) => {
    await travarFundo(tx);
    const guardado = await tx.tipReserveMovement.findMany({
      where: { periodId: period.id, type: { in: ["FECHAMENTO_RESERVA", "FECHAMENTO_SALDO"] } }, select: { amount: true },
    });
    const retirada = round2(guardado.reduce((a, m) => a + Number(m.amount), 0));
    const bloqueio = motivoParaNaoRetirar(await saldoReserva(tx), retirada, `${String(month).padStart(2, "0")}/${year}`);
    if (bloqueio) throw new Error(bloqueio);
    await tx.tipReserveMovement.deleteMany({ where: { periodId: period.id, type: { in: ["FECHAMENTO_RESERVA", "FECHAMENTO_SALDO"] } } });
    await registrarReabertura(tx, period.id, usuario, texto);
    // Reabrir pode mudar valores já enviados: as etapas marcadas (envio, OK, folha
    // paga) são desmarcadas e a conferência tem de ser refeita.
    const etapas = await tx.tipPeriodEtapa.findMany({ where: { periodId: period.id }, orderBy: { em: "asc" } });
    const ultima = new Map<string, string>();
    for (const e of etapas) ultima.set(e.etapa, e.acao);
    for (const [etapa, acao] of ultima) {
      if (acao !== "MARCOU") continue;
      await tx.tipPeriodEtapa.create({
        data: {
          id: crypto.randomUUID(), periodId: period.id, etapa, acao: "DESMARCOU",
          obs: `Período reaberto: ${texto}`.slice(0, 300), porId: usuario.id, por: usuario.name,
        },
      });
    }
    await tx.tipPeriod.update({
      where: { competenceYear_competenceMonth: { competenceYear: year, competenceMonth: month } },
      data: { status: "OPEN", closedAt: null, updatedById: userId },
    });
  });

  return computeTipCommission(year, month);
}

