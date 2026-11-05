// 13º dos sem registro: monta a lista (prévia) e gera as duas parcelas como PayrollItem.
// CLT fica de fora: o 13º dele vem do extrato da contabilidade.
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { computeTipCommission } from "./tip-commission.service.js";
import { cadastrosVigentes } from "./cadastro-historico.service.js";
import { calcularDecimoTerceiroSR, ROTULO_13_PARCELA_1, ROTULO_13_PARCELA_2, type Decimo13SR } from "./decimo-terceiro-sr.js";
import { FOLHA_CATEGORY, computeStatus } from "./payroll.service.js";

export type LinhaDecimo13 = {
  employeeId: string; nome: string; setor: string | null;
  calculo: Decimo13SR | null; motivoSemCalculo: string | null;
  parcela1Existe: boolean; parcela2Existe: boolean;
};

const nomeDe = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`.trim();
const diaRef = (ano: number) => new Date(Date.UTC(ano, 11, 20)); // salário e vínculo vigentes em 20/12

// Variáveis do ano por pessoa: gorjeta + hora extra + adicional noturno + DSR de cada período.
async function variaveisDoAno(ano: number): Promise<Map<string, number>> {
  const periodos = await prisma.tipPeriod.findMany({ where: { competenceYear: ano }, select: { competenceMonth: true } });
  const soma = new Map<string, number>();
  for (const per of periodos) {
    const comp = await computeTipCommission(ano, per.competenceMonth, { incluirDadosPessoais: true });
    for (const p of comp.participants) {
      if (!p.employeeId) continue;
      const v = (p.rateioAmount ?? 0) + (p.valorHoraExtra ?? 0) + (p.valorAdicionalNoturno ?? 0) + (p.valorDsr ?? 0);
      soma.set(p.employeeId, (soma.get(p.employeeId) ?? 0) + v);
    }
  }
  return soma;
}

export async function listarDecimoTerceiroSR(ano: number): Promise<LinhaDecimo13[]> {
  // Desligado fica de fora: o 13º proporcional dele é verba da rescisão (opcional, sem registro);
  // gerar aqui pagaria duas vezes.
  const emps = await prisma.employee.findMany({
    where: { terminationDate: null },
    select: { id: true, firstName: true, lastName: true, sector: true, modality: true, baseSalary: true, admissionDate: true, terminationDate: true },
    orderBy: [{ firstName: "asc" }],
  });
  // Vigente em 20/12 (ou na saída, se foi antes): o histórico decide vínculo e salário.
  const vigentes = await cadastrosVigentes(
    emps.map((e) => ({ ...e, baseSalary: e.baseSalary == null ? null : Number(e.baseSalary) })),
    (e) => (e.terminationDate && e.terminationDate < diaRef(ano) ? e.terminationDate : diaRef(ano)),
  );
  const existentes = await prisma.payrollItem.findMany({
    where: { type: "DECIMO_TERCEIRO", competenceYear: ano, deletedAt: null, employeeId: { in: emps.map((e) => e.id) } },
    select: { employeeId: true, periodLabel: true },
  });
  const jaTem = new Set(existentes.map((x) => `${x.employeeId}|${x.periodLabel}`));
  const variaveis = await variaveisDoAno(ano);
  const linhas: LinhaDecimo13[] = [];
  for (const e of emps) {
    const v = vigentes.get(e.id);
    if (!v || v.modality !== "NAO_CLT") continue;
    const salario = v.baseSalary == null ? null : Number(v.baseSalary);
    const calculo = calcularDecimoTerceiroSR({ ano, salarioBase: salario, inicio: e.admissionDate, desligamento: e.terminationDate, variaveisSoma: variaveis.get(e.id) ?? 0 });
    let motivoSemCalculo: string | null = null;
    if (!calculo) {
      motivoSemCalculo = !e.admissionDate ? "Sem data de início (admissão) no cadastro."
        : !(salario != null && salario > 0) ? "Sem salário base vigente no cadastro."
        : "Sem avos no ano (menos de 15 dias em cada mês).";
    }
    linhas.push({
      employeeId: e.id, nome: nomeDe(e), setor: e.sector, calculo, motivoSemCalculo,
      parcela1Existe: jaTem.has(`${e.id}|${ROTULO_13_PARCELA_1}`), parcela2Existe: jaTem.has(`${e.id}|${ROTULO_13_PARCELA_2}`),
    });
  }
  return linhas;
}

// Cria as parcelas que ainda não existem (as já lançadas, pagas ou não, ficam como estão).
export async function gerarDecimoTerceiroSR(ano: number, userId: string) {
  const linhas = await listarDecimoTerceiroSR(ano);
  const dre = await prisma.dRECategory.findFirst({ where: { name: FOLHA_CATEGORY }, select: { id: true } });
  let criadas = 0;
  await prisma.$transaction(async (tx) => {
    for (const l of linhas) {
      const c = l.calculo;
      if (!c) continue;
      const parcelas = [
        { rotulo: ROTULO_13_PARCELA_1, existe: l.parcela1Existe, valor: c.parcela1, venc: c.vencimento1, mes: 11, n: 1 },
        { rotulo: ROTULO_13_PARCELA_2, existe: l.parcela2Existe, valor: c.parcela2, venc: c.vencimento2, mes: 12, n: 2 },
      ];
      for (const p of parcelas) {
        if (p.existe || p.valor <= 0) continue;
        const due = new Date(`${p.venc}T00:00:00.000Z`);
        const details = {
          semRegistro: true, decimoTerceiro: true, parcela: p.n, avos: c.avos, desde: c.desde, base: c.base, totalDecimo: c.total, memoria: c.memoria,
        } as Prisma.InputJsonValue;
        await tx.payrollItem.upsert({
          where: { employeeId_type_competenceYear_competenceMonth_periodLabel: {
            employeeId: l.employeeId, type: "DECIMO_TERCEIRO", competenceYear: ano, competenceMonth: p.mes, periodLabel: p.rotulo } },
          update: { dueDate: due, amount: p.valor, details, status: computeStatus(due, null), dreCategoryId: dre?.id ?? null, source: "GENERATED", updatedById: userId, deletedAt: null, deletedById: null },
          create: {
            id: crypto.randomUUID(), employeeId: l.employeeId, type: "DECIMO_TERCEIRO", competenceYear: ano, competenceMonth: p.mes,
            periodLabel: p.rotulo, dueDate: due, amount: p.valor, details, status: computeStatus(due, null),
            dreCategoryId: dre?.id ?? null, source: "GENERATED", createdById: userId,
          },
        });
        criadas += 1;
      }
    }
  });
  return { ano, criadas, semCalculo: linhas.filter((l) => !l.calculo).map((l) => ({ nome: l.nome, motivo: l.motivoSemCalculo })) };
}
