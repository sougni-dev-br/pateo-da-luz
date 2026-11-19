// Atualizar do cadastro: quem participa da gorjeta, quem fica só pelo salário e os pontos-base.

import crypto from "node:crypto";
import { prisma } from "../../config/database.js";
import { emTesteNaGorjeta } from "./tip-rateio.js";
import { diaDeReferencia } from "./cadastro-historico.js";
import { cadastrosVigentes } from "./cadastro-historico.service.js";

// Pontos-base do cadastro: os da função mais o ponto extra (±) da pessoa.
export function pontosBaseDoCadastro(emp: { pontosExtra: unknown; tipFunction: { points: unknown } | null }): number {
  const funcao = emp.tipFunction ? Number(emp.tipFunction.points) : 0;
  const extra = emp.pontosExtra == null ? 0 : Number(emp.pontosExtra);
  return Math.max(0, Math.round((funcao + extra) * 100) / 100);
}

// Mês civil do salário de quem não tem registro: a competência 09 paga 01 a 30/09
// (o mesmo intervalo de regras.mesSalario no cálculo).
export function mesDoSalario(year: number, month: number): { start: Date; end: Date } {
  return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 0)) };
}

type CandidatoSoSalario = {
  id: string; firstName?: string; lastName?: string; displayName?: string | null; modality: unknown; terminationDate: Date | null; admissionDate?: Date | null; isActive?: boolean;
  tipFunction: { name: string } | null;
};

// Vínculo no mês do salário (o mesmo filtro da consulta de quem não participa): admitido
// até o último dia, não desligado antes do primeiro, e ativo ou com data de saída.
function vinculadoNoMes(c: CandidatoSoSalario, mes: { start: Date; end: Date }): boolean {
  if (c.admissionDate && c.admissionDate > mes.end) return false;
  if (c.terminationDate && c.terminationDate < mes.start) return false;
  return c.isActive !== false || c.terminationDate != null;
}

// Sem registro que não participa da gorjeta e tem vínculo no mês do salário: entra no
// período só para receber o salário na lista de pagamento (foraDaGorjeta). Também quem
// participa mas está em teste (sem a entrada na gorjeta neste ciclo): vem em emTeste.
async function semRegistroSoSalario(
  year: number, month: number, emTeste: CandidatoSoSalario[] = [],
): Promise<CandidatoSoSalario[]> {
  const mes = mesDoSalario(year, month);
  const candidatos: CandidatoSoSalario[] = await prisma.employee.findMany({
    where: {
      participaGorjeta: false, deletedAt: null,
      // Vínculo no mês: admitido até o último dia e não desligado antes do primeiro.
      AND: [
        { OR: [{ admissionDate: null }, { admissionDate: { lte: mes.end } }] },
        { OR: [{ terminationDate: null }, { terminationDate: { gte: mes.start } }] },
        // Inativo sem data de saída não é vínculo: não ganha salário do mês inteiro.
        { OR: [{ isActive: true }, { terminationDate: { not: null } }] },
      ],
    },
    select: { id: true, firstName: true, lastName: true, displayName: true, modality: true, terminationDate: true, tipFunction: { select: { name: true } } },
  });
  candidatos.push(...emTeste.filter((c) => vinculadoNoMes(c, mes)));
  // Vínculo vigente no mês (como o cálculo faz): quem virou CLT depois ainda era sem registro.
  const vigentes = await cadastrosVigentes(
    candidatos.map((c) => ({ id: c.id, modality: c.modality as string, terminationDate: c.terminationDate })),
    (c) => diaDeReferencia(year, month, c.terminationDate),
  );
  return candidatos.filter((c) => vigentes.get(c.id)?.modality === "NAO_CLT");
}

// Lê o que o "Atualizar do cadastro" decide: quem participa (e quem está em teste), quem fica
// só pelo salário e o que já está no período. Compartilhado com a prévia, que não grava.
export async function carregarParaSync(periodId: string) {
  const periodo = await prisma.tipPeriod.findUniqueOrThrow({
    where: { id: periodId }, select: { periodStart: true, periodEnd: true, competenceYear: true, competenceMonth: true },
  });
  const participam = await prisma.employee.findMany({
    where: {
      participaGorjeta: true, deletedAt: null,
      // Quem saiu antes do período começar já recebeu no período dele.
      OR: [{ terminationDate: null }, { terminationDate: { gte: periodo.periodStart } }],
    },
    select: {
      id: true, firstName: true, lastName: true, displayName: true, tipoGorjeta: true, pontosExtra: true, cotaFixaGorjeta: true, tipFunction: { select: { points: true, name: true } },
      participaGorjeta: true, inicioGorjeta: true, modality: true, admissionDate: true, terminationDate: true, isActive: true,
    },
  });
  // Em teste (sem a entrada na gorjeta neste ciclo): sem registro fica só pelo salário;
  // CLT não entra no rateio.
  const estaEmTeste = (e: (typeof participam)[number]) =>
    emTesteNaGorjeta({ participaGorjeta: true, inicioGorjeta: e.inicioGorjeta ?? null }, periodo.periodEnd);
  const elegiveis = participam.filter((e) => !estaEmTeste(e));
  const emTeste = participam.filter(estaEmTeste);
  const soSalario = await semRegistroSoSalario(periodo.competenceYear, periodo.competenceMonth, emTeste);
  const existing = await prisma.tipParticipant.findMany({
    where: { periodId },
    select: { id: true, employeeId: true, kind: true, basePoints: true, functionName: true, foraDaGorjeta: true, _count: { select: { vales: true } } },
  });
  return { periodo, elegiveis, emTeste, soSalario, existing };
}

// Traz para o período quem participa da gorjeta no cadastro e ainda não está nele
// (inclusive desligados, que recebem pela rescisão). Também atualiza os pontos-base
// de quem já está, porque a base vem sempre do cadastro — o ajuste do mês é que se
// edita no período. Não remove quem participa.
//
// Sem registro que não participa entra como "fora da gorjeta" (só salário). Se passar a
// participar, vira participante normal com os pontos da função; se deixar de participar,
// vira fora da gorjeta. Quem estava só pelo salário e deixou de ter direito (virou CLT,
// saiu antes do mês) sai do período — a não ser que tenha vale lançado.
export async function syncParticipantsFromCadastro(periodId: string): Promise<{ added: number; elegiveis: number; atualizados: number; removidos: number }> {
  const { periodo, elegiveis, emTeste, soSalario, existing } = await carregarParaSync(periodId);
  const byEmp = new Map(existing.map((e) => [e.employeeId, e]));
  const toAdd = elegiveis.filter((e) => !byEmp.has(e.id));
  const soSalarioNovos = soSalario.filter((e) => !byEmp.has(e.id));
  if (toAdd.length > 0 || soSalarioNovos.length > 0) {
    await prisma.tipParticipant.createMany({
      data: [
        ...toAdd.map((e) => ({
          id: crypto.randomUUID(),
          periodId,
          employeeId: e.id,
          kind: e.tipoGorjeta,
          basePoints: e.tipoGorjeta === "PONTOS" ? pontosBaseDoCadastro(e) : null,
          functionName: e.tipFunction?.name ?? null,
          fixedAmount: e.tipoGorjeta === "FIXO" ? (e.cotaFixaGorjeta ?? 0) : null,
        })),
        ...soSalarioNovos.map((e) => ({
          id: crypto.randomUUID(),
          periodId,
          employeeId: e.id,
          kind: "PONTOS" as const,
          basePoints: 0,
          functionName: e.tipFunction?.name ?? null,
          foraDaGorjeta: true,
        })),
      ],
      skipDuplicates: true,
    });
  }
  let atualizados = 0;
  for (const e of elegiveis) {
    const atual = byEmp.get(e.id);
    if (!atual) continue;
    const funcao = e.tipFunction?.name ?? null;
    // Passou a participar: sai do "só salário" com os pontos (ou a cota) do cadastro.
    if (atual.foraDaGorjeta) {
      await prisma.tipParticipant.update({
        where: { id: atual.id },
        data: {
          foraDaGorjeta: false, kind: e.tipoGorjeta, functionName: funcao,
          basePoints: e.tipoGorjeta === "PONTOS" ? pontosBaseDoCadastro(e) : null,
          fixedAmount: e.tipoGorjeta === "FIXO" ? (e.cotaFixaGorjeta ?? 0) : null,
        },
      });
      atualizados += 1;
      continue;
    }
    if (e.tipoGorjeta !== "PONTOS") continue;
    const base = pontosBaseDoCadastro(e);
    if (Number(atual.basePoints ?? -1) !== base || atual.functionName !== funcao) {
      await prisma.tipParticipant.update({ where: { id: atual.id }, data: { basePoints: base, functionName: funcao } });
      atualizados += 1;
    }
  }
  // Deixou de participar (ou voltou para teste), sem registro no mês: fica só pelo salário.
  // CLT em teste que estava no rateio sai dele (vira "só salário" e é removido abaixo).
  const soSalarioIds = new Set(soSalario.map((e) => e.id));
  const cltEmTeste = emTeste.filter((e) => !soSalarioIds.has(e.id));
  const foraAgora = new Set<string>();
  for (const e of [...soSalario, ...cltEmTeste]) {
    const atual = byEmp.get(e.id);
    if (!atual || atual.foraDaGorjeta) continue;
    // Já saiu neste ciclo: a gorjeta dele é da rescisão. Limpar o "Participa" do cadastro (ou
    // desmarcar depois da saída) não pode rebaixá-lo para só salário num ciclo reaberto.
    if (e.terminationDate && e.terminationDate <= periodo.periodEnd) continue;
    await prisma.tipParticipant.update({ where: { id: atual.id }, data: { foraDaGorjeta: true } });
    foraAgora.add(atual.id);
    atualizados += 1;
  }
  // Estava só pelo salário e não tem mais direito a nada aqui: sai, se não tiver vale.
  const continua = new Set([...elegiveis.map((e) => e.id), ...soSalario.map((e) => e.id)]);
  const semDireito = existing.filter((x) => (x.foraDaGorjeta || foraAgora.has(x.id)) && !continua.has(x.employeeId) && x._count.vales === 0);
  if (semDireito.length > 0) {
    await prisma.tipParticipant.deleteMany({ where: { id: { in: semDireito.map((x) => x.id) }, foraDaGorjeta: true } });
  }
  return { added: toAdd.length + soSalarioNovos.length, elegiveis: elegiveis.length + soSalario.length, atualizados, removidos: semDireito.length };
}
