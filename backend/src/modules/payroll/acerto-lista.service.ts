// Lança no Contas a Pagar o acerto do mês (lista de pagamento) de cada sem registro da apuração
// da gorjeta: um SALARIO "Acerto (lista de pagamento)" por pessoa e competência. Idempotente:
// lançar de novo atualiza o que não foi pago e mudou; pago nunca muda; excluído à mão não volta;
// ajustado à mão (details.editadoAMao) não é sobrescrito. Cada gravação dentro da trava da pessoa.
// Regras em acerto-lista.ts. Chamado ao fechar a gorjeta e pelo botão da aba da lista.
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { assertPeriodWritableForDate } from "../cmv-real/cmv-real.service.js";
import { auditLog } from "../security/security-utils.js";
import {
  ROTULO_ACERTO, type ParticipanteDaLista, type SalarioExistente, avisoAcertoSemLista, competenciaTexto, composicaoDoAcerto,
  decidirAcerto, recebeAcerto, vencimentoDoAcerto,
} from "./acerto-lista.js";
import { aposSaida, diaIso } from "./folha-duplicidade.js";
import { travarFolhaDaPessoa } from "./folha-trava.js";
import { FOLHA_CATEGORY, computeStatus } from "./payroll.service.js";
import { computeTipCommission } from "./tip-commission.service.js";

export type ResultadoAcertos = {
  competencia: string;
  criados: Array<{ employeeId: string; nome: string; valor: number; vencimento: string }>;
  atualizados: Array<{ employeeId: string; nome: string; antes: number; depois: number }>;
  semMudanca: number;
  // Com valores (só para quem vê Funcionários) e sem eles.
  avisos: string[];
  avisosSemValor: string[];
};

type Gravacao = { p: ParticipanteDaLista; valor: number; vencimento: Date; composicao: ReturnType<typeof composicaoDoAcerto> };

const dataBr = (d: Date) => diaIso(d)!.split("-").reverse().join("/");

export async function lancarAcertosDaLista(ano: number, mes: number, usuario: { id: string; name: string }): Promise<ResultadoAcertos> {
  const mmaaaa = competenciaTexto(ano, mes);
  const comp = await computeTipCommission(ano, mes, { incluirDadosPessoais: true });
  if (!comp.periodId) throw new Error(`Não há apuração da gorjeta de ${mmaaaa}: abra o período antes de lançar os acertos.`);
  const resultado: ResultadoAcertos = { competencia: mmaaaa, criados: [], atualizados: [], semMudanca: 0, avisos: [], avisosSemValor: [] };
  const avisar = (aviso: string, semValor = aviso) => { resultado.avisos.push(aviso); resultado.avisosSemValor.push(semValor); };

  const participantes = comp.participants as unknown as ParticipanteDaLista[];
  const alvo = participantes.filter(recebeAcerto);
  const ids = [...new Set(participantes.filter((p) => p.semRegistro).map((p) => p.employeeId))];
  if (ids.length === 0) return resultado;
  const [salarios, saidas] = await Promise.all([
    prisma.payrollItem.findMany({
      where: { type: "SALARIO", competenceYear: ano, competenceMonth: mes, employeeId: { in: ids } },
      select: {
        id: true, employeeId: true, periodLabel: true, amount: true, paymentDate: true, paidAmount: true,
        deletedAt: true, deletedById: true, status: true, dueDate: true, details: true,
      },
    }),
    prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, terminationDate: true } }),
  ]);
  const doFuncionario = (id: string) => salarios.filter((s) => s.employeeId === id) as unknown as SalarioExistente[];
  const saidaDe = new Map(saidas.map((e) => [e.id, e.terminationDate]));

  const gravar: Gravacao[] = [];
  for (const p of alvo) {
    const saida = saidaDe.get(p.employeeId) ?? null;
    if (aposSaida({ employeeId: p.employeeId, type: "SALARIO", competenceYear: ano, competenceMonth: mes }, saida)) {
      avisar(`${p.employeeName}: saiu em ${dataBr(saida!)}; acerto de ${mmaaaa} não lançado.`);
      continue;
    }
    const novo = {
      valor: p.totalAPagar, vencimento: vencimentoDoAcerto(ano, mes, p.pagamentoQuinzenal),
      composicao: composicaoDoAcerto(p, comp.code ?? null),
    };
    const d = decidirAcerto(p.employeeName, ano, mes, novo, doFuncionario(p.employeeId));
    if (d.acao === "MANTER") { resultado.semMudanca += 1; continue; }
    if (d.acao === "PULAR") { avisar(d.aviso, d.avisoSemValor); continue; }
    gravar.push({ p, ...novo });
  }

  // Acerto lançado de quem saiu da lista (sem nada a receber agora): avisa, não apaga.
  const naLista = new Set(alvo.map((p) => p.employeeId));
  for (const p of participantes.filter((x) => x.semRegistro && !naLista.has(x.employeeId))) {
    const lancado = doFuncionario(p.employeeId).find((s) => s.periodLabel === ROTULO_ACERTO && s.deletedAt == null && s.status !== "CANCELED");
    if (lancado) avisar(avisoAcertoSemLista(p.employeeName, ano, mes, lancado.paymentDate != null));
  }
  if (gravar.length === 0) return resultado;

  // O DRE posiciona a folha pela competência: mês travado (fechamento/CMV) não recebe acerto.
  await assertPeriodWritableForDate(new Date(Date.UTC(ano, mes - 1, 1)), "Lançamento dos acertos da lista de pagamento");
  const dre = await prisma.dRECategory.findFirst({ where: { name: FOLHA_CATEGORY }, select: { id: true } });
  if (!dre) avisar(`Categoria de DRE "${FOLHA_CATEGORY}" não encontrada — os acertos ficam sem categoria no DRE.`);

  for (const g of gravar) await gravarAcerto(g, ano, mes, dre?.id ?? null, usuario, resultado, avisar);
  return resultado;
}

const CAMPOS_SALARIO = {
  id: true, employeeId: true, periodLabel: true, amount: true, paymentDate: true, paidAmount: true,
  deletedAt: true, deletedById: true, status: true, dueDate: true, details: true, updatedAt: true,
} as const;

type Gravado =
  | { tipo: "CRIAR" | "RESTAURAR" | "ATUALIZAR"; id: string; antes?: number }
  | { tipo: "MANTER"; aviso?: string; avisoSemValor?: string }
  | { tipo: "PULAR"; aviso: string; avisoSemValor: string };

// Grava um acerto dentro da trava da folha da pessoa, decidindo de novo sobre a releitura:
// entre a leitura em lote e aqui o título pode ter sido pago, editado ou excluído.
// O UPDATE só pega se continua sem baixa e sem mudança (updatedAt) desde a releitura.
async function gravarAcerto(
  g: Gravacao, ano: number, mes: number, dreCategoryId: string | null, usuario: { id: string; name: string }, resultado: ResultadoAcertos,
  avisar: (aviso: string, semValor?: string) => void,
) {
  const mmaaaa = competenciaTexto(ano, mes);
  const comum = {
    amount: g.valor, dueDate: g.vencimento, status: computeStatus(g.vencimento, null), dreCategoryId,
    details: g.composicao as Prisma.InputJsonValue, source: "GENERATED" as const,
  };
  const r: Gravado = await prisma.$transaction(async (tx) => {
    await travarFolhaDaPessoa(tx, g.p.employeeId);
    const atuais = await tx.payrollItem.findMany({
      where: { type: "SALARIO", competenceYear: ano, competenceMonth: mes, employeeId: g.p.employeeId },
      select: CAMPOS_SALARIO,
    });
    const doFuncionario = atuais.filter((s) => s.employeeId === g.p.employeeId);
    const d = decidirAcerto(g.p.employeeName, ano, mes, { valor: g.valor, vencimento: g.vencimento, composicao: g.composicao },
      doFuncionario as unknown as SalarioExistente[]);
    if (d.acao === "MANTER") return { tipo: "MANTER" };
    if (d.acao === "PULAR") return { tipo: "PULAR", aviso: d.aviso, avisoSemValor: d.avisoSemValor };
    if (d.acao === "CRIAR") {
      const id = crypto.randomUUID();
      await tx.payrollItem.create({
        data: {
          id, employeeId: g.p.employeeId, type: "SALARIO", competenceYear: ano, competenceMonth: mes, periodLabel: ROTULO_ACERTO,
          ...comum, createdById: usuario.id,
        },
      });
      return { tipo: "CRIAR", id };
    }
    // RESTAURAR: excluído antigo, sem autor — volta (a chave única não inclui deletedAt).
    const linha = doFuncionario.find((s) => s.id === d.id);
    const { count } = await tx.payrollItem.updateMany({
      where: { id: d.id, paymentDate: null, updatedAt: linha?.updatedAt },
      data: { ...comum, updatedById: usuario.id, ...(d.acao === "RESTAURAR" ? { deletedAt: null, deletedById: null } : {}) },
    });
    if (count === 0) {
      const texto = `${g.p.employeeName}: o acerto de ${mmaaaa} mudou ou foi pago durante o lançamento; não atualizado. Lance de novo para conferir.`;
      return { tipo: "MANTER", aviso: texto, avisoSemValor: texto };
    }
    return { tipo: d.acao, id: d.id, antes: d.antes };
  });

  if (r.tipo === "MANTER") {
    resultado.semMudanca += 1;
    if (r.aviso) avisar(r.aviso, r.avisoSemValor);
    return;
  }
  if (r.tipo === "PULAR") { avisar(r.aviso, r.avisoSemValor); return; }
  if (r.tipo === "ATUALIZAR") resultado.atualizados.push({ employeeId: g.p.employeeId, nome: g.p.employeeName, antes: r.antes ?? 0, depois: g.valor });
  else resultado.criados.push({ employeeId: g.p.employeeId, nome: g.p.employeeName, valor: g.valor, vencimento: diaIso(g.vencimento)! });
  await auditLog({
    userId: usuario.id, action: r.tipo === "ATUALIZAR" ? "ACERTO_LISTA_ATUALIZADO" : "ACERTO_LISTA_LANCADO", entity: "PayrollItem", entityId: r.id,
    previousValue: r.antes == null ? null : { amount: r.antes },
    newValue: { amount: g.valor, competencia: mmaaaa, vencimento: diaIso(g.vencimento) },
  });
}
