// 13º dos sem registro: monta a lista (prévia) e gera as duas parcelas como PayrollItem.
// Entram (1) quem é sem registro hoje e (2) quem foi registrado no ano: o período sem registro
// dele (até o fim do mês anterior à carteira) é pago aqui; o resto vem do extrato da contabilidade.
// CLT sem período sem registro fica de fora.
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { assertPeriodWritableForDate } from "../cmv-real/cmv-real.service.js";
import { computeTipCommission } from "./tip-commission.service.js";
import { cadastrosVigentes } from "./cadastro-historico.service.js";
import {
  calcularDecimoTerceiroSR, decidirParcela, fimSemRegistro, ROTULO_13_EXTRATO_PARCELA_1, ROTULO_13_PARCELA_1, ROTULO_13_PARCELA_2,
  type Decimo13SR,
} from "./decimo-terceiro-sr.js";
import { travarFolhaDaPessoa } from "./folha-trava.js";
import { FOLHA_CATEGORY, computeStatus } from "./payroll.service.js";

export type LinhaDecimo13 = {
  employeeId: string; nome: string; setor: string | null;
  calculo: Decimo13SR | null; motivoSemCalculo: string | null;
  parcela1Existe: boolean; parcela2Existe: boolean;
  // Registrado depois do início real: só o período sem registro entra aqui (até `semRegistroAte`).
  preRegistro: boolean; semRegistroAte: string | null; registroEm: string | null;
};

const nomeDe = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`.trim();
const diaRef = (ano: number) => new Date(Date.UTC(ano, 11, 20)); // salário e vínculo vigentes em 20/12
const iso = (d: Date) => d.toISOString().slice(0, 10);

// Variáveis por pessoa e competência do ano: gorjeta + hora extra + adicional noturno + DSR.
async function variaveisDoAno(ano: number): Promise<Map<string, Map<number, number>>> {
  const periodos = await prisma.tipPeriod.findMany({ where: { competenceYear: ano }, select: { competenceMonth: true } });
  const porPessoa = new Map<string, Map<number, number>>();
  for (const per of periodos) {
    const comp = await computeTipCommission(ano, per.competenceMonth, { incluirDadosPessoais: true });
    for (const p of comp.participants) {
      if (!p.employeeId) continue;
      const v = (p.rateioAmount ?? 0) + (p.valorHoraExtra ?? 0) + (p.valorAdicionalNoturno ?? 0) + (p.valorDsr ?? 0);
      const meses = porPessoa.get(p.employeeId) ?? new Map<number, number>();
      meses.set(per.competenceMonth, (meses.get(per.competenceMonth) ?? 0) + v);
      porPessoa.set(p.employeeId, meses);
    }
  }
  return porPessoa;
}

// Soma dos meses até o limite (mês do fim do período sem registro; sem limite = ano todo).
function somaAte(meses: Map<number, number> | undefined, ate: Date | null, ano: number): number {
  if (!meses) return 0;
  const ultimoMes = ate && ate.getUTCFullYear() === ano ? ate.getUTCMonth() + 1 : 12;
  let soma = 0;
  for (const [mes, v] of meses) if (mes <= ultimoMes) soma += v;
  return soma;
}

export async function listarDecimoTerceiroSR(ano: number): Promise<LinhaDecimo13[]> {
  // Desligado fica de fora: o 13º proporcional dele é verba da rescisão (opcional, sem registro);
  // gerar aqui pagaria duas vezes. Quem não recebe 13º (chave do cadastro) e cadastro excluído também.
  const emps = await prisma.employee.findMany({
    where: { deletedAt: null, terminationDate: null, recebeDecimoTerceiro: true },
    select: {
      id: true, firstName: true, lastName: true, sector: true, modality: true, baseSalary: true,
      admissionDate: true, admissaoCarteira: true, terminationDate: true,
    },
    orderBy: [{ firstName: "asc" }],
  });
  const fimDe = new Map(emps.map((e) => [e.id, fimSemRegistro(e.admissionDate, e.admissaoCarteira)]));
  // Vigente em 20/12, ou no último dia sem registro de quem foi registrado: o histórico decide salário e vínculo.
  const vigentes = await cadastrosVigentes(
    emps.map((e) => ({ ...e, baseSalary: e.baseSalary == null ? null : Number(e.baseSalary) })),
    (e) => fimDe.get(e.id) ?? diaRef(ano),
  );
  // Inclui os excluídos: o excluído à mão conta como "já existe" (o botão zera e ninguém o recria).
  const existentes = await prisma.payrollItem.findMany({
    where: {
      type: "DECIMO_TERCEIRO", competenceYear: ano, employeeId: { in: emps.map((e) => e.id) },
      periodLabel: { in: [ROTULO_13_PARCELA_1, ROTULO_13_PARCELA_2, ROTULO_13_EXTRATO_PARCELA_1] },
    },
    select: { employeeId: true, periodLabel: true, deletedAt: true, deletedById: true, paymentDate: true },
  });
  const jaTem = new Set(existentes
    .filter((x) => x.periodLabel !== ROTULO_13_EXTRATO_PARCELA_1 && !["criar", "restaurar"].includes(decidirParcela(x)))
    .map((x) => `${x.employeeId}|${x.periodLabel}`));
  // Quem já tem o 13º do extrato da contabilidade (CLT) e não é pré-registro não é gerado aqui:
  // o extrato já o inclui por inteiro e gerar de novo pagaria duas vezes.
  const comExtrato = new Set(existentes.filter((x) => x.periodLabel === ROTULO_13_EXTRATO_PARCELA_1 && !x.deletedAt).map((x) => x.employeeId));
  const variaveis = await variaveisDoAno(ano);
  const linhas: LinhaDecimo13[] = [];
  for (const e of emps) {
    const v = vigentes.get(e.id);
    const fim = fimDe.get(e.id) ?? null;
    const preRegistro = fim != null;
    if (!v || (!preRegistro && v.modality !== "NAO_CLT")) continue;
    const salario = v.baseSalary == null ? null : Number(v.baseSalary);
    let calculo = calcularDecimoTerceiroSR({
      ano, salarioBase: salario, inicio: e.admissionDate, desligamento: e.terminationDate, ate: fim,
      variaveisSoma: somaAte(variaveis.get(e.id), fim, ano),
    });
    // Registrado sem avos sem registro neste ano (carteira logo no começo ou em anos anteriores): nada a mostrar.
    if (preRegistro && !calculo && salario != null && salario > 0) continue;
    let motivoSemCalculo: string | null = null;
    if (!calculo) {
      motivoSemCalculo = !e.admissionDate ? "Sem data de início (admissão) no cadastro."
        : !(salario != null && salario > 0) ? "Sem salário base vigente no cadastro."
        : "Sem avos no ano (menos de 15 dias em cada mês).";
    } else if (!preRegistro && comExtrato.has(e.id)) {
      calculo = null;
      motivoSemCalculo = "Já tem o 13º do extrato da contabilidade: não é gerado aqui (pagaria duas vezes).";
    }
    linhas.push({
      employeeId: e.id, nome: nomeDe(e), setor: e.sector, calculo, motivoSemCalculo,
      parcela1Existe: jaTem.has(`${e.id}|${ROTULO_13_PARCELA_1}`), parcela2Existe: jaTem.has(`${e.id}|${ROTULO_13_PARCELA_2}`),
      preRegistro, semRegistroAte: fim ? iso(fim) : null, registroEm: preRegistro && e.admissaoCarteira ? iso(e.admissaoCarteira) : null,
    });
  }
  return linhas;
}

export type ResultadoGeracao = { ano: number; criadas: number; restauradas: number; semCalculo: number; avisos: string[] };

// Cria as parcelas que ainda não existem. Parcela já lançada (paga ou não) ou excluída à mão fica
// como está: só o excluído sem autor (legado) volta. Nada paga é regravada.
export async function gerarDecimoTerceiroSR(ano: number, userId: string): Promise<ResultadoGeracao> {
  // As parcelas caem em novembro e dezembro: mês de folha fechado não recebe lançamento novo.
  await assertPeriodWritableForDate(new Date(Date.UTC(ano, 10, 1)), "Geração do 13º");
  await assertPeriodWritableForDate(new Date(Date.UTC(ano, 11, 1)), "Geração do 13º");
  const linhas = await listarDecimoTerceiroSR(ano);
  const dre = await prisma.dRECategory.findFirst({ where: { name: FOLHA_CATEGORY }, select: { id: true } });
  const avisos: string[] = [];
  let criadas = 0;
  let restauradas = 0;
  await prisma.$transaction(async (tx) => {
    for (const l of linhas) {
      const c = l.calculo;
      if (!c) continue;
      // Trava a pessoa e relê dentro da transação: dois "Gerar" juntos não se atropelam.
      await travarFolhaDaPessoa(tx, l.employeeId);
      const atuais = await tx.payrollItem.findMany({
        where: { employeeId: l.employeeId, type: "DECIMO_TERCEIRO", competenceYear: ano, periodLabel: { in: [ROTULO_13_PARCELA_1, ROTULO_13_PARCELA_2] } },
        select: { id: true, periodLabel: true, deletedAt: true, deletedById: true, paymentDate: true },
      });
      const parcelas = [
        { rotulo: ROTULO_13_PARCELA_1, valor: c.parcela1, venc: c.vencimento1, mes: 11, n: 1 },
        { rotulo: ROTULO_13_PARCELA_2, valor: c.parcela2, venc: c.vencimento2, mes: 12, n: 2 },
      ];
      for (const p of parcelas) {
        if (p.valor <= 0) continue;
        const atual = atuais.find((x) => x.periodLabel === p.rotulo) ?? null;
        const decisao = decidirParcela(atual);
        if (decisao === "excluida-a-mao") {
          avisos.push(`${l.nome}: ${p.rotulo} foi excluída à mão e não foi recriada; se precisar, restaure pela Folha.`);
          continue;
        }
        if (decisao === "ja-existe" || decisao === "ja-pago") continue;
        const due = new Date(`${p.venc}T00:00:00.000Z`);
        const details = {
          semRegistro: true, decimoTerceiro: true, parcela: p.n, avos: c.avos, desde: c.desde, base: c.base, totalDecimo: c.total, memoria: c.memoria,
          ...(l.preRegistro ? { preRegistro: true, semRegistroAte: l.semRegistroAte, registroEm: l.registroEm } : {}),
        } as Prisma.InputJsonValue;
        const dados = { dueDate: due, amount: p.valor, details, status: computeStatus(due, null), dreCategoryId: dre?.id ?? null };
        if (decisao === "restaurar") {
          // Condicionado ao estado lido: se alguém mexeu no meio, não conta nem grava.
          const r = await tx.payrollItem.updateMany({
            where: { id: atual!.id, deletedAt: { not: null }, deletedById: null, paymentDate: null },
            data: { ...dados, source: "GENERATED", updatedById: userId, deletedAt: null, deletedById: null },
          });
          restauradas += r.count;
          continue;
        }
        const r = await tx.payrollItem.createMany({
          data: [{
            id: crypto.randomUUID(), employeeId: l.employeeId, type: "DECIMO_TERCEIRO", competenceYear: ano, competenceMonth: p.mes,
            periodLabel: p.rotulo, ...dados, source: "GENERATED", createdById: userId,
          }],
          skipDuplicates: true,
        });
        criadas += r.count;
      }
    }
  }, { timeout: 30_000, maxWait: 10_000 });
  const semCalculo = linhas.filter((l) => !l.calculo).length;
  return { ano, criadas, restauradas, semCalculo, avisos };
}
