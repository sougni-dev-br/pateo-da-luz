// 13º dos sem registro: monta a lista (prévia) e gera as duas parcelas como PayrollItem.
// Entram (1) quem é sem registro hoje e (2) quem foi registrado no ano: o período sem registro
// dele (até o fim do mês anterior à carteira) é pago aqui; o resto vem do extrato da contabilidade.
// CLT sem período sem registro fica de fora.
//
// Regra do valor (a mesma que a contabilidade usa no CLT): ver calcularDecimoTerceiroSR. A 2ª
// parcela é o ACERTO — 13º completo menos o que a 1ª pagou — e só é gerada com a gorjeta de
// novembro fechada. Parcela ainda não paga é atualizada se o cálculo mudou (salário, variáveis);
// a paga fica congelada e a diferença cai na 2ª; o que alguém ajustou à mão não é sobrescrito.
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { assertPeriodWritableForDate } from "../cmv-real/cmv-real.service.js";
import { computeTipCommission } from "./tip-commission.service.js";
import { cadastrosVigentes } from "./cadastro-historico.service.js";
import {
  calcularDecimoTerceiroSR, decidirParcela, fimSemRegistro, primeiraParaAcerto, ROTULO_13_EXTRATO_PARCELA_1, ROTULO_13_PARCELA_1,
  ROTULO_13_PARCELA_2, segundaParcela, type Decimo13SR,
} from "./decimo-terceiro-sr.js";
import { round2 } from "./vt-calc.js";
import { travarFolhaDaPessoa } from "./folha-trava.js";
import { FOLHA_CATEGORY, computeStatus } from "./payroll.service.js";

// Uma parcela na prévia. `existe` = já resolvida (ativa, paga ou excluída à mão): não conta como "a gerar".
export type ParcelaLinha = {
  existe: boolean; paga: boolean;
  lancado: number | null;   // valor do lançamento ativo
  devido: number | null;    // quanto deve ser, pelo cálculo de hoje
  gerar: boolean;           // criar, restaurar ou atualizar agora
};

export type LinhaDecimo13 = {
  employeeId: string; nome: string; setor: string | null;
  calculo: Decimo13SR | null; motivoSemCalculo: string | null;
  p1: ParcelaLinha;
  p2: ParcelaLinha & { excesso: number };
  // Só quando a 2ª já foi paga: o que falta pagar (+) ou foi pago a mais (−) em relação ao calculado hoje.
  acerto: number | null;
  // Registrado depois do início real: só o período sem registro entra aqui (até `semRegistroAte`).
  preRegistro: boolean; semRegistroAte: string | null; registroEm: string | null;
};

export type PreviaDecimo13 = {
  ano: number; linhas: LinhaDecimo13[];
  // A 2ª parcela só pode ser gerada com a gorjeta de novembro fechada (a média precisa dela).
  novembroFechado: boolean;
  avisos: string[];
};

const nomeDe = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`.trim();
const diaRef = (ano: number) => new Date(Date.UTC(ano, 11, 20)); // salário e vínculo vigentes em 20/12
const iso = (d: Date) => d.toISOString().slice(0, 10);
const mmaaaa = (mes: number, ano: number) => `${String(mes).padStart(2, "0")}/${ano}`;
const ROTULOS_SR = [ROTULO_13_PARCELA_1, ROTULO_13_PARCELA_2];

type Variaveis = { porPessoa: Map<string, Map<number, number>>; status: Map<number, string> };

// Variáveis de cada pessoa por mês: gorjeta + hora extra + adicional noturno (o DSR sobre a hora
// extra fica de fora, como na contabilidade). Só os meses 1 a 11 servem ao 13º.
async function variaveisDoAno(ano: number): Promise<Variaveis> {
  const periodos = await prisma.tipPeriod.findMany({ where: { competenceYear: ano }, select: { competenceMonth: true } });
  const porPessoa = new Map<string, Map<number, number>>();
  const status = new Map<number, string>();
  for (const per of periodos) {
    if (per.competenceMonth > 11) continue;
    const comp = await computeTipCommission(ano, per.competenceMonth, { incluirDadosPessoais: true });
    status.set(per.competenceMonth, comp.status ?? "OPEN");
    for (const p of comp.participants) {
      if (!p.employeeId) continue;
      const v = (p.rateioAmount ?? 0) + (p.valorHoraExtra ?? 0) + (p.valorAdicionalNoturno ?? 0);
      const meses = porPessoa.get(p.employeeId) ?? new Map<number, number>();
      meses.set(per.competenceMonth, (meses.get(per.competenceMonth) ?? 0) + v);
      porPessoa.set(p.employeeId, meses);
    }
  }
  return { porPessoa, status };
}

// Avisos sobre a base da média: mês sem apuração de gorjeta ou ainda aberta pesa como zero/provisório.
function avisosDaBase(ano: number, status: Map<number, string>): string[] {
  const abertos: string[] = [];
  const ausentes: string[] = [];
  for (let m = 1; m <= 11; m += 1) {
    const st = status.get(m);
    if (st == null) ausentes.push(mmaaaa(m, ano));
    else if (st !== "CLOSED") abertos.push(mmaaaa(m, ano));
  }
  const avisos: string[] = [];
  if (abertos.length > 0) avisos.push(`Gorjeta ainda não fechada em ${abertos.join(", ")}: a média desses meses pode mudar. Parcela não paga é atualizada quando você gerar de novo.`);
  if (ausentes.length > 0) avisos.push(`Sem apuração de gorjeta em ${ausentes.join(", ")}: esses meses contam como zero na média.`);
  return avisos;
}

type Item = { amount: unknown; paidAmount: unknown; paymentDate: Date | null; deletedAt: Date | null; deletedById: string | null; periodLabel: string; employeeId: string; details?: unknown };

const valorDe = (i: Item | undefined) => (i ? round2(Number(i.amount)) : null);
const resolvida = (i: Item | undefined) => Boolean(i && !["criar", "restaurar"].includes(decidirParcela(i)));

function parcelaLinha(item: Item | undefined, devido: number | null): ParcelaLinha {
  const ativa = item && !item.deletedAt ? item : undefined;
  const mudou = ativa != null && !ativa.paymentDate && devido != null && Math.abs(round2(Number(ativa.amount)) - devido) >= 0.01;
  const gerar = devido != null && devido > 0 && (!resolvida(item) || (decidirParcela(item ?? null) === "ja-existe" && mudou));
  return { existe: resolvida(item), paga: Boolean(ativa?.paymentDate), lancado: valorDe(ativa), devido, gerar };
}

export async function listarDecimoTerceiroSR(ano: number): Promise<PreviaDecimo13> {
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
  const existentes: Item[] = await prisma.payrollItem.findMany({
    where: {
      type: "DECIMO_TERCEIRO", competenceYear: ano, employeeId: { in: emps.map((e) => e.id) },
      periodLabel: { in: [...ROTULOS_SR, ROTULO_13_EXTRATO_PARCELA_1] },
    },
    select: { employeeId: true, periodLabel: true, amount: true, paidAmount: true, paymentDate: true, deletedAt: true, deletedById: true, details: true },
  });
  const itemDe = (id: string, rotulo: string) => existentes.find((x) => x.employeeId === id && x.periodLabel === rotulo);
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
      variaveis: variaveis.porPessoa.get(e.id),
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
    const i1 = itemDe(e.id, ROTULO_13_PARCELA_1);
    const i2 = itemDe(e.id, ROTULO_13_PARCELA_2);
    // A 2ª é o acerto do que a 1ª pagou de fato (paga: o valor pago; senão, o calculado).
    const p2 = calculo ? segundaParcela(calculo.total, primeiraParaAcerto(i1 ?? null, calculo.parcela1)) : null;
    const p2Linha = parcelaLinha(i2, p2?.valor ?? null);
    const pagoNa2 = i2 && !i2.deletedAt && i2.paymentDate ? round2(Number(i2.paidAmount ?? i2.amount)) : null;
    linhas.push({
      employeeId: e.id, nome: nomeDe(e), setor: e.sector, calculo, motivoSemCalculo,
      p1: parcelaLinha(i1, calculo?.parcela1 ?? null),
      p2: { ...p2Linha, excesso: p2?.excesso ?? 0 },
      acerto: calculo && p2 && pagoNa2 != null ? round2(p2.valor - pagoNa2 - p2.excesso) : null,
      preRegistro, semRegistroAte: fim ? iso(fim) : null, registroEm: preRegistro && e.admissaoCarteira ? iso(e.admissaoCarteira) : null,
    });
  }
  const avisos = avisosDaBase(ano, variaveis.status);
  return { ano, linhas, novembroFechado: variaveis.status.get(11) === "CLOSED", avisos };
}

export type ResultadoGeracao = {
  ano: number; parcela: 1 | 2; criadas: number; atualizadas: number; restauradas: number; semCalculo: number; avisos: string[];
};

// Gera a parcela pedida. Parcela já lançada é atualizada se ainda não foi paga, o cálculo mudou e
// ninguém mexeu no valor; paga e excluída à mão ficam como estão; só o excluído sem autor volta.
export async function gerarDecimoTerceiroSR(ano: number, userId: string, parcela: 1 | 2 = 1): Promise<ResultadoGeracao> {
  // As parcelas caem em novembro e dezembro: mês de folha fechado não recebe lançamento novo.
  await assertPeriodWritableForDate(new Date(Date.UTC(ano, 10, 1)), "Geração do 13º");
  await assertPeriodWritableForDate(new Date(Date.UTC(ano, 11, 1)), "Geração do 13º");
  const previa = await listarDecimoTerceiroSR(ano);
  if (parcela === 2 && !previa.novembroFechado) {
    throw new Error(`A gorjeta de ${mmaaaa(11, ano)} ainda não está fechada: a 2ª parcela depende da média até novembro. Feche a apuração e gere de novo.`);
  }
  const dre = await prisma.dRECategory.findFirst({ where: { name: FOLHA_CATEGORY }, select: { id: true } });
  const avisos: string[] = [];
  let criadas = 0;
  let atualizadas = 0;
  let restauradas = 0;
  const rotulo = parcela === 1 ? ROTULO_13_PARCELA_1 : ROTULO_13_PARCELA_2;
  await prisma.$transaction(async (tx) => {
    for (const l of previa.linhas) {
      const c = l.calculo;
      if (!c) continue;
      // Trava a pessoa e relê dentro da transação: dois "Gerar" juntos não se atropelam.
      await travarFolhaDaPessoa(tx, l.employeeId);
      const atuais = await tx.payrollItem.findMany({
        where: { employeeId: l.employeeId, type: "DECIMO_TERCEIRO", competenceYear: ano, periodLabel: { in: ROTULOS_SR } },
        select: { id: true, periodLabel: true, amount: true, paidAmount: true, paymentDate: true, deletedAt: true, deletedById: true, details: true },
      });
      const doRotulo = (r: string) => atuais.find((x) => x.periodLabel === r) ?? null;
      const atual = doRotulo(rotulo);
      // O valor da parcela: a 1ª é o calculado; a 2ª fecha o total com o que a 1ª PAGOU de fato.
      const valor = parcela === 1 ? c.parcela1 : segundaParcela(c.total, primeiraParaAcerto(doRotulo(ROTULO_13_PARCELA_1), c.parcela1)).valor;
      if (valor <= 0) continue;
      const decisao = decidirParcela(atual);
      if (decisao === "excluida-a-mao") {
        avisos.push(`${l.nome}: ${rotulo} foi excluída à mão e não foi recriada; se precisar, restaure pela Folha.`);
        continue;
      }
      if (decisao === "ja-pago") continue;
      const venc = parcela === 1 ? c.vencimento1 : c.vencimento2;
      const due = new Date(`${venc}T00:00:00.000Z`);
      const details = {
        semRegistro: true, decimoTerceiro: true, parcela, avos: c.avos, avosParcela1: c.avosParcela1, desde: c.desde,
        mediaParcela1: c.mediaParcela1, mediaFinal: c.mediaFinal, totalDecimo: c.total, valorCalculado: valor, memoria: c.memoria,
        ...(l.preRegistro ? { preRegistro: true, semRegistroAte: l.semRegistroAte, registroEm: l.registroEm } : {}),
      } as Prisma.InputJsonValue;
      if (decisao === "ja-existe") {
        const lancado = round2(Number(atual!.amount));
        if (Math.abs(lancado - valor) < 0.01) continue;
        // Só atualiza o que ninguém ajustou: o valor lançado ainda é o que este cálculo gerou antes.
        const calculadoAntes = Number((atual!.details as { valorCalculado?: unknown } | null)?.valorCalculado);
        if (!Number.isFinite(calculadoAntes) || Math.abs(calculadoAntes - lancado) >= 0.01) {
          avisos.push(`${l.nome}: ${rotulo} tem o valor ajustado à mão (${lancado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}); o cálculo de hoje dá ${valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}. Não foi alterada.`);
          continue;
        }
        const r = await tx.payrollItem.updateMany({
          where: { id: atual!.id, deletedAt: null, paymentDate: null },
          data: { amount: valor, details, dreCategoryId: dre?.id ?? null, updatedById: userId },
        });
        atualizadas += r.count;
        continue;
      }
      const dados = { dueDate: due, amount: valor, details, status: computeStatus(due, null), dreCategoryId: dre?.id ?? null };
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
          id: crypto.randomUUID(), employeeId: l.employeeId, type: "DECIMO_TERCEIRO", competenceYear: ano, competenceMonth: parcela === 1 ? 11 : 12,
          periodLabel: rotulo, ...dados, source: "GENERATED", createdById: userId,
        }],
        skipDuplicates: true,
      });
      criadas += r.count;
    }
  }, { timeout: 30_000, maxWait: 10_000 });
  const semCalculo = previa.linhas.filter((l) => !l.calculo).length;
  return { ano, parcela, criadas, atualizadas, restauradas, semCalculo, avisos: [...previa.avisos, ...avisos] };
}
