// Lote de pagamento da folha — leitura e gravação. Regras em folha-lote.ts; a baixa de cada
// membro é a mesma da baixa individual (folha-baixa.ts). Toda escrita de lotes de uma
// competência passa pela trava da competência: liberar, retirar, devolver, pagar e estornar
// ao mesmo tempo não se atropelam.
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { assertPeriodWritableForDate } from "../cmv-real/cmv-real.service.js";
import { auditLog } from "../security/security-utils.js";
import { type DadosBaixa, chaveUnicaViolada, dadosDoEstorno, duplicidadesDoItem, gravarBaixaDoItem, lerCamposDaBaixa, validarBaixa } from "./folha-baixa.js";
import { resumoItem } from "./folha-duplicidade.js";
import { CAMPOS_TRAVA, RecusaFolha, nomeDe } from "./folha-lancamento.routes.js";
import {
  GRUPO_A_PARTE, type PlanoDoLote, STATUS_LOTE, type SalarioAberto, competenciaDoLote, mensagemMembroDoLote, planejarLotes,
  rotuloDoLote, todosPagos, vencimentoDoLote,
} from "./folha-lote.js";
import type { LinhaFolha } from "./tip-conferencia.js";

type Tx = Prisma.TransactionClient;
// ipAddress/userAgent: vindos da rota, vão para a auditoria como nas rotas individuais.
export type Usuario = { id: string; name: string; ipAddress?: string; userAgent?: string };
type Competencia = { ano: number; mes: number };

const round2 = (v: number) => Math.round(v * 100) / 100;
const digitos = (t: string | null | undefined) => (t ?? "").replace(/\D/g, "");
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const ETAPA_FOLHA_PAGA = "FOLHA_PAGA";
const rastro = (u: Usuario) => ({ ipAddress: u.ipAddress, userAgent: u.userAgent });

// Rede de segurança do índice único parcial (um lote ABERTO por competência e grupo): a trava
// da competência já evita a disputa; se ainda assim o banco recusar, é 409 e não 500.
async function semDuplicarAberto<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (chaveUnicaViolada(err)) {
      throw new RecusaFolha(409, { message: "Já existe um título da folha em aberto para esta empresa e competência. Recarregue a tela e pague ou cancele esse título antes." });
    }
    throw err;
  }
}

async function travarCompetencia(tx: Tx, c: Competencia) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`folha-lote:${c.ano}-${c.mes}`}))`;
}

const salarioAbertoDaCompetencia = (c: Competencia) => ({
  type: "SALARIO" as const, competenceYear: c.ano, competenceMonth: c.mes,
  deletedAt: null, status: { not: "CANCELED" as const }, paymentDate: null,
});

/** Mensagem de recusa para quem tenta mexer sozinho num SALARIO que está num lote (null = pode). */
export async function recusaPorLote(folhaLoteId: string | null | undefined): Promise<string | null> {
  if (!folhaLoteId) return null;
  const lote = await prisma.folhaLote.findUnique({ where: { id: folhaLoteId }, select: { rotulo: true, status: true } });
  if (!lote || lote.status === STATUS_LOTE.CANCELADO) return null;
  return mensagemMembroDoLote(lote.rotulo, lote.status === STATUS_LOTE.PAGO);
}

/** Por que a gravação condicionada de um item não pegou: entrou num lote, ou mudou de outro jeito. */
export async function recusaDoItemMudado(itemId: string): Promise<string> {
  const item = await prisma.payrollItem.findFirst({ where: { id: itemId }, select: { folhaLoteId: true } });
  return (await recusaPorLote(item?.folhaLoteId)) ?? "Este lançamento mudou agora (foi baixado ou excluído). Recarregue a tela.";
}

// ─── Resumo dos lotes ─────────────────────────────────────────────────────────

export type ResumoLote = {
  id: string; rotulo: string; grupo: string; dueDate: string; status: string; total: number; pessoas: number;
  paymentDate: string | null; paidPaymentMethodName: string | null;
};

export async function lotesDaCompetencia(ano: number, mes: number, db: Tx | typeof prisma = prisma): Promise<ResumoLote[]> {
  const lotes = await db.folhaLote.findMany({
    where: { competenceYear: ano, competenceMonth: mes, status: { not: STATUS_LOTE.CANCELADO } },
    orderBy: [{ createdAt: "asc" }],
  });
  if (lotes.length === 0) return [];
  const membros = await db.payrollItem.findMany({
    where: { folhaLoteId: { in: lotes.map((l) => l.id) }, deletedAt: null },
    select: { folhaLoteId: true, employeeId: true, amount: true },
  });
  return lotes.map((l) => {
    const meus = membros.filter((m) => m.folhaLoteId === l.id);
    return {
      id: l.id, rotulo: l.rotulo, grupo: l.grupo, dueDate: l.dueDate.toISOString().slice(0, 10), status: l.status,
      total: round2(meus.reduce((a, m) => a + Number(m.amount), 0)), pessoas: new Set(meus.map((m) => m.employeeId)).size,
      paymentDate: l.paymentDate ? l.paymentDate.toISOString().slice(0, 10) : null, paidPaymentMethodName: l.paidPaymentMethodName,
    };
  });
}

// ─── Etapa FOLHA_PAGA automática ──────────────────────────────────────────────

/** SALARIO da competência em aberto fora de lote (soltos no Contas a Pagar). */
export async function contarSalariosSoltos(db: Tx | typeof prisma, c: Competencia): Promise<number> {
  return db.payrollItem.count({ where: { ...salarioAbertoDaCompetencia(c), folhaLoteId: null } });
}

/**
 * Com lotes na competência, a etapa "Folha paga" segue os lotes: todos pagos → marca (por quem
 * baixou); algum voltou a aberto → desmarca. Sem lote vivo não mexe (folha de antes dos lotes).
 */
export async function sincronizarEtapaFolhaPaga(tx: Tx, c: Competencia, usuario: Usuario): Promise<"MARCOU" | "DESMARCOU" | null> {
  const periodo = await tx.tipPeriod.findUnique({
    where: { competenceYear_competenceMonth: { competenceYear: c.ano, competenceMonth: c.mes } }, select: { id: true },
  });
  if (!periodo) return null;
  const lotes = await tx.folhaLote.findMany({ where: { competenceYear: c.ano, competenceMonth: c.mes }, select: { status: true } });
  if (!lotes.some((l) => l.status !== STATUS_LOTE.CANCELADO)) return null;
  // Salário da competência em aberto fora de qualquer título (ex.: complemento lançado depois
  // da liberação): a folha não está paga — fica desmarcada até liberar de novo e pagar.
  const soltos = await contarSalariosSoltos(tx, c);
  const deve = todosPagos(lotes) && soltos === 0;
  const ultimo = await tx.tipPeriodEtapa.findFirst({ where: { periodId: periodo.id, etapa: ETAPA_FOLHA_PAGA }, orderBy: { em: "desc" } });
  const marcada = ultimo?.acao === "MARCOU";
  if (deve === marcada) return null;
  const acao = deve ? "MARCOU" : "DESMARCOU";
  await tx.tipPeriodEtapa.create({
    data: {
      id: crypto.randomUUID(), periodId: periodo.id, etapa: ETAPA_FOLHA_PAGA, acao, porId: usuario.id, por: usuario.name,
      obs: deve ? "Automático: todos os títulos da folha baixados no Contas a Pagar."
        : soltos > 0 ? `Automático: ${soltos} salário(s) da competência em aberto fora dos títulos.` : "Automático: um título da folha voltou a ficar em aberto.",
    },
  });
  return acao;
}

// ─── Liberar para pagamento ───────────────────────────────────────────────────

export type EntradaLiberacao = {
  ano: number; mes: number;
  linhas: Array<Pick<LinhaFolha, "employeeId" | "nome" | "grupo" | "origem" | "valor">>;
  extratos: Array<{ empresa: string; cnpj: string }>;
};

async function planejar(e: EntradaLiberacao, db: Tx | typeof prisma = prisma): Promise<PlanoDoLote> {
  const ids = [...new Set(e.linhas.flatMap((l) => (l.employeeId ? [l.employeeId] : [])))];
  const [empresas, salarios] = await Promise.all([
    db.company.findMany({ select: { cnpj: true, tradeName: true } }),
    ids.length === 0 ? Promise.resolve([]) : db.payrollItem.findMany({
      where: { ...salarioAbertoDaCompetencia(e), employeeId: { in: ids } },
      select: { id: true, employeeId: true, amount: true, folhaLoteId: true },
    }),
  ]);
  const livres: SalarioAberto[] = salarios.filter((s) => !s.folhaLoteId).map((s) => ({ id: s.id, employeeId: s.employeeId, amount: Number(s.amount) }));
  const jaEmLote = new Set(salarios.filter((s) => s.folhaLoteId).map((s) => s.employeeId));
  return planejarLotes(e.ano, e.mes, e.linhas, e.extratos, livres, new Map(empresas.map((c) => [digitos(c.cnpj), c.tradeName])), jaEmLote);
}

/** O que "Liberar para pagamento" vai criar ou acrescentar, sem gravar nada. */
export async function previaDaLiberacao(e: EntradaLiberacao) {
  const [plano, lotes] = await Promise.all([planejar(e), lotesDaCompetencia(e.ano, e.mes)]);
  return { ...plano, lotes, vencimento: vencimentoDoLote(e.ano, e.mes).toISOString().slice(0, 10) };
}

async function loteAberto(tx: Tx, c: Competencia, grupo: string, rotulo: string, usuario: Usuario) {
  const existente = await tx.folhaLote.findFirst({ where: { competenceYear: c.ano, competenceMonth: c.mes, grupo, status: STATUS_LOTE.ABERTO } });
  if (existente) return { lote: existente, criado: false };
  const lote = await tx.folhaLote.create({
    data: {
      id: crypto.randomUUID(), competenceYear: c.ano, competenceMonth: c.mes, grupo, rotulo,
      dueDate: vencimentoDoLote(c.ano, c.mes), status: STATUS_LOTE.ABERTO, createdById: usuario.id, createdByName: usuario.name,
    },
  });
  return { lote, criado: true };
}

export type ResultadoLiberacao = {
  criados: Array<{ id: string; rotulo: string }>;
  acrescentados: number;
  jaLiberada: boolean;
  avisos: string[];
  lotes: ResumoLote[];
};

/**
 * Libera a folha para pagamento: um lote ABERTO por grupo, com os SALARIO em aberto de cada
 * pessoa. Liberar de novo não duplica: acrescenta aos lotes abertos quem ainda não está em lote.
 */
export async function liberarLotes(e: EntradaLiberacao, usuario: Usuario): Promise<ResultadoLiberacao> {
  const mmaaaa = competenciaDoLote(e.ano, e.mes);
  const r = await semDuplicarAberto(() => prisma.$transaction(async (tx) => {
    await travarCompetencia(tx, e);
    const antes = await tx.folhaLote.count({ where: { competenceYear: e.ano, competenceMonth: e.mes, status: { not: STATUS_LOTE.CANCELADO } } });
    const plano = await planejar(e, tx);
    if (plano.grupos.length === 0 && antes === 0) {
      throw new RecusaFolha(409, { message: `Nada a liberar em ${mmaaaa}: ninguém da folha de líquidos tem salário em aberto no Contas a Pagar.`, avisos: plano.avisos });
    }
    const criados: Array<{ id: string; rotulo: string; membros: string[] }> = [];
    const acrescidos: Array<{ id: string; rotulo: string; membros: string[] }> = [];
    let acrescentados = 0;
    for (const g of plano.grupos) {
      const { lote, criado } = await loteAberto(tx, e, g.grupo, g.rotulo, usuario);
      const ids = g.membros.map((m) => m.payrollItemId);
      // Só pega quem continua em aberto e fora de lote (a releitura está dentro da trava).
      const { count } = await tx.payrollItem.updateMany({
        where: { id: { in: ids }, folhaLoteId: null, paymentDate: null, deletedAt: null },
        data: { folhaLoteId: lote.id, folhaLoteOrigemId: null },
      });
      acrescentados += count;
      // Corrida: ninguém do grupo continuava livre. Título criado agora e vazio não fica.
      if (count === 0) {
        if (criado) await tx.folhaLote.delete({ where: { id: lote.id } });
        continue;
      }
      (criado ? criados : acrescidos).push({ id: lote.id, rotulo: lote.rotulo, membros: ids });
    }
    await sincronizarEtapaFolhaPaga(tx, e, usuario);
    return { plano, criados, acrescidos, acrescentados, jaLiberada: antes > 0 };
  }));
  for (const l of [...r.criados, ...r.acrescidos]) {
    await auditLog({
      userId: usuario.id, ...rastro(usuario), action: r.criados.includes(l) ? "FOLHA_LOTE_LIBERADO" : "FOLHA_LOTE_ACRESCIDO", entity: "FolhaLote", entityId: l.id,
      newValue: { rotulo: l.rotulo, competencia: mmaaaa, payrollItemIds: l.membros },
    });
  }
  const avisos = [...r.plano.avisos];
  if (r.jaLiberada) {
    avisos.unshift(r.acrescentados > 0
      ? `A folha de ${mmaaaa} já tinha sido liberada: ${r.acrescentados} lançamento(s) acrescentado(s) aos títulos.`
      : `A folha de ${mmaaaa} já tinha sido liberada: ninguém novo para acrescentar.`);
  }
  return {
    criados: r.criados.map(({ id, rotulo }) => ({ id, rotulo })), acrescentados: r.acrescentados, jaLiberada: r.jaLiberada,
    avisos, lotes: await lotesDaCompetencia(e.ano, e.mes),
  };
}

// ─── Retirar / devolver ───────────────────────────────────────────────────────

async function cancelarSeVazio(tx: Tx, loteId: string, usuario: Usuario): Promise<boolean> {
  const restantes = await tx.payrollItem.count({ where: { folhaLoteId: loteId, deletedAt: null } });
  if (restantes > 0) return false;
  await tx.folhaLote.update({
    where: { id: loteId },
    data: { status: STATUS_LOTE.CANCELADO, cancelReason: "Ficou sem pessoas.", canceledAt: new Date(), updatedById: usuario.id },
  });
  return true;
}

async function loteParaMexer(tx: Tx, loteId: string) {
  const lote = await tx.folhaLote.findUnique({ where: { id: loteId } });
  if (!lote || lote.status === STATUS_LOTE.CANCELADO) throw new RecusaFolha(404, { message: "Título da folha não encontrado." });
  await travarCompetencia(tx, { ano: lote.competenceYear, mes: lote.competenceMonth });
  // Relido dentro da trava: outra ação pode ter acabado de pagar ou cancelar.
  const atual = await tx.folhaLote.findUnique({ where: { id: loteId } });
  if (!atual || atual.status === STATUS_LOTE.CANCELADO) throw new RecusaFolha(404, { message: "Título da folha não encontrado." });
  if (atual.status === STATUS_LOTE.PAGO) throw new RecusaFolha(409, { message: `O título "${atual.rotulo}" já foi pago: estorne a baixa antes.` });
  return atual;
}

async function membroDoLote(tx: Tx, loteId: string, itemId: string) {
  const item = await tx.payrollItem.findFirst({
    where: { id: itemId, folhaLoteId: loteId, deletedAt: null },
    include: { employee: { select: { firstName: true, lastName: true } } },
  });
  if (!item) throw new RecusaFolha(404, { message: "Esta pessoa não está neste título." });
  return item;
}

const nomeDoItem = (i: { employee: { firstName: string; lastName: string } }) => `${i.employee.firstName} ${i.employee.lastName}`.trim();

/** Tira a pessoa do título da empresa e põe na "Folha à parte" da competência (criada na 1ª retirada). */
export async function retirarDoLote(loteId: string, itemId: string, usuario: Usuario) {
  const r = await semDuplicarAberto(() => prisma.$transaction(async (tx) => {
    const lote = await loteParaMexer(tx, loteId);
    if (lote.grupo === GRUPO_A_PARTE) throw new RecusaFolha(409, { message: "Esta pessoa já está na folha à parte: use \"devolver\"." });
    const item = await membroDoLote(tx, loteId, itemId);
    const c = { ano: lote.competenceYear, mes: lote.competenceMonth };
    const { lote: aParte } = await loteAberto(tx, c, GRUPO_A_PARTE, rotuloDoLote(c.ano, c.mes, GRUPO_A_PARTE, null), usuario);
    await tx.payrollItem.update({ where: { id: item.id }, data: { folhaLoteId: aParte.id, folhaLoteOrigemId: lote.id } });
    const cancelado = await cancelarSeVazio(tx, lote.id, usuario);
    return { lote, aParte, item, cancelado };
  }));
  await auditLog({
    userId: usuario.id, ...rastro(usuario), action: "FOLHA_LOTE_RETIRADO", entity: "FolhaLote", entityId: r.lote.id,
    newValue: { rotulo: r.lote.rotulo, payrollItemId: r.item.id, pessoa: nomeDoItem(r.item), paraLote: r.aParte.id, loteCancelado: r.cancelado },
  });
  return { aParte: { id: r.aParte.id, rotulo: r.aParte.rotulo }, loteCancelado: r.cancelado };
}

/** Devolve a pessoa da folha à parte ao título da empresa de origem (recriado se não estiver mais aberto). */
export async function devolverAoLote(loteId: string, itemId: string, usuario: Usuario) {
  const r = await semDuplicarAberto(() => prisma.$transaction(async (tx) => {
    const aParte = await loteParaMexer(tx, loteId);
    if (aParte.grupo !== GRUPO_A_PARTE) throw new RecusaFolha(409, { message: "Só se devolve quem está na folha à parte." });
    const item = await membroDoLote(tx, loteId, itemId);
    const origem = item.folhaLoteOrigemId ? await tx.folhaLote.findUnique({ where: { id: item.folhaLoteOrigemId } }) : null;
    if (!origem) throw new RecusaFolha(409, { message: "Não sei de que título esta pessoa saiu; libere a folha de novo para ela entrar no da empresa." });
    const c = { ano: origem.competenceYear, mes: origem.competenceMonth };
    const destino = origem.status === STATUS_LOTE.ABERTO ? origem : (await loteAberto(tx, c, origem.grupo, origem.rotulo, usuario)).lote;
    await tx.payrollItem.update({ where: { id: item.id }, data: { folhaLoteId: destino.id, folhaLoteOrigemId: null } });
    const cancelado = await cancelarSeVazio(tx, aParte.id, usuario);
    return { aParte, destino, item, cancelado };
  }));
  await auditLog({
    userId: usuario.id, ...rastro(usuario), action: "FOLHA_LOTE_DEVOLVIDO", entity: "FolhaLote", entityId: r.destino.id,
    newValue: { rotulo: r.destino.rotulo, payrollItemId: r.item.id, pessoa: nomeDoItem(r.item), deLote: r.aParte.id, folhaAParteCancelada: r.cancelado },
  });
  return { destino: { id: r.destino.id, rotulo: r.destino.rotulo }, folhaAParteCancelada: r.cancelado };
}

// ─── Baixa e estorno do lote ─────────────────────────────────────────────────

const CAMPOS_MEMBRO = { ...CAMPOS_TRAVA, folhaLoteId: true } as const;

/**
 * Dá baixa no título do lote: cada SALARIO membro recebe a baixa (data, forma, conta) pelo
 * valor dele, numa transação só. As guardas são as da baixa individual; o lote só se paga
 * pelo total (para pagar outro valor, retire a pessoa do lote). Todos os lotes pagos → FOLHA_PAGA.
 */
export async function pagarLote(loteId: string, corpo: Record<string, unknown>, usuario: Usuario) {
  const lote = await prisma.folhaLote.findUnique({ where: { id: loteId } });
  if (!lote || lote.status === STATUS_LOTE.CANCELADO) throw new RecusaFolha(404, { message: "Título da folha não encontrado." });
  if (lote.status === STATUS_LOTE.PAGO) throw new RecusaFolha(400, { message: "Título já baixado. Estorne o pagamento antes de lançar uma nova baixa." });
  const membros = await prisma.payrollItem.findMany({ where: { folhaLoteId: loteId, deletedAt: null }, select: CAMPOS_MEMBRO });
  if (membros.length === 0) throw new RecusaFolha(409, { message: "O título não tem ninguém para pagar." });
  const total = round2(membros.reduce((a, m) => a + Number(m.amount), 0));
  const campos = lerCamposDaBaixa(corpo, total);
  if (Math.abs(campos.paidAmount - total) > 0.009) {
    throw new RecusaFolha(400, { message: `O título da folha é pago pelo total (${brl(total)}). Para pagar outro valor a alguém, retire a pessoa do lote.` });
  }
  const validada = await validarBaixa(campos, total, "Baixa do lote de pagamento da folha");
  if ("erro" in validada) throw new RecusaFolha(400, { message: validada.erro });
  const dados: DadosBaixa = validada.dados;
  // Confirmação de duplicidade por membro: só os ids que a pessoa viu na recusa e confirmou.
  const confirmados = new Set(Array.isArray(corpo.confirmaDuplicidadeIds) ? (corpo.confirmaDuplicidadeIds as unknown[]).map(String) : []);

  const r = await prisma.$transaction(async (tx) => {
    await travarCompetencia(tx, { ano: lote.competenceYear, mes: lote.competenceMonth });
    const { count } = await tx.folhaLote.updateMany({
      where: { id: loteId, status: STATUS_LOTE.ABERTO },
      data: {
        status: STATUS_LOTE.PAGO, paymentDate: dados.paymentDate, paidPaymentMethodId: dados.paidPaymentMethodId,
        paidPaymentMethodName: dados.paidPaymentMethodName, paidByCompanyId: dados.payingCompanyId,
        companyBankAccountId: dados.companyBankAccountId, paymentNotes: dados.paymentNotes, updatedById: usuario.id,
      },
    });
    if (count === 0) throw new RecusaFolha(409, { message: "Este título mudou agora (baixado ou cancelado). Recarregue a tela." });
    // Relidos na trava: o total pago é o dos membros de agora. A ordem por pessoa evita
    // travas cruzadas com outra baixa ao mesmo tempo.
    const atuais = await tx.payrollItem.findMany({ where: { folhaLoteId: loteId, deletedAt: null }, select: CAMPOS_MEMBRO });
    const totalAgora = round2(atuais.reduce((a, m) => a + Number(m.amount), 0));
    if (atuais.length === 0 || Math.abs(totalAgora - total) > 0.009) {
      throw new RecusaFolha(409, { message: "O título mudou enquanto você baixava (alguém entrou, saiu ou mudou de valor). Recarregue a tela e confira o total." });
    }
    const ordenados = [...atuais].sort((a, b) => a.employeeId.localeCompare(b.employeeId));
    await recusarDuplicadosNaoConfirmados(tx, ordenados, confirmados, lote.rotulo);
    const pagos = [];
    for (const m of ordenados) {
      const { updated, jaPagos } = await gravarBaixaDoItem(tx, m, { ...dados, paidAmount: Number(m.amount), differenceReason: null }, usuario.id, confirmados.has(m.id), loteId);
      pagos.push({ antes: m, depois: updated, jaPagos });
    }
    const etapa = await sincronizarEtapaFolhaPaga(tx, { ano: lote.competenceYear, mes: lote.competenceMonth }, usuario);
    return { pagos, etapa };
  });

  for (const p of r.pagos) {
    await auditLog({
      userId: usuario.id, ...rastro(usuario), action: "PAY_PAYROLL_ITEM", entity: "PayrollItem", entityId: p.depois.id,
      previousValue: p.antes, newValue: { ...p.depois, folhaLoteId: loteId, viaLote: lote.rotulo },
    });
  }
  await auditLog({
    userId: usuario.id, ...rastro(usuario), action: "PAY_FOLHA_LOTE", entity: "FolhaLote", entityId: loteId,
    previousValue: { status: lote.status },
    newValue: {
      status: STATUS_LOTE.PAGO, rotulo: lote.rotulo, total, paymentDate: dados.paymentDate.toISOString().slice(0, 10),
      paidPaymentMethodName: dados.paidPaymentMethodName, membros: r.pagos.length, folhaPagaMarcada: r.etapa === "MARCOU",
      duplicidadeConfirmada: r.pagos.filter((p) => p.jaPagos.length > 0).map((p) => p.depois.id),
    },
  });
  return { id: loteId, status: STATUS_LOTE.PAGO, membros: r.pagos.length, folhaPaga: r.etapa === "MARCOU" };
}

type MembroDaBaixa = Prisma.PayrollItemGetPayload<{ select: typeof CAMPOS_MEMBRO }>;

/**
 * Todos os membros com o mesmo pagamento já pago em outro item, de uma vez: a recusa lista
 * cada um (não só o primeiro) e a baixa só passa com a confirmação dos ids listados.
 */
async function recusarDuplicadosNaoConfirmados(tx: Tx, membros: MembroDaBaixa[], confirmados: Set<string>, rotulo: string) {
  const suspeitos = [];
  for (const m of membros) {
    const jaPagos = await duplicidadesDoItem(tx, m);
    if (jaPagos.length > 0 && !confirmados.has(m.id)) suspeitos.push({ m, jaPagos });
  }
  if (suspeitos.length === 0) return;
  const pessoas = await tx.employee.findMany({ where: { id: { in: suspeitos.map((s) => s.m.employeeId) } }, select: { id: true, firstName: true, lastName: true } });
  const nomes = new Map(pessoas.map((p) => [p.id, nomeDe(p)]));
  const lista = suspeitos.map((s) => ({
    item: resumoItem(s.m), pessoa: nomes.get(s.m.employeeId) ?? "", jaPagos: s.jaPagos.map(resumoItem), noLote: [],
  }));
  throw new RecusaFolha(409, {
    code: "BAIXA_DUPLICADA",
    message: `${lista.length} pessoa(s) do título "${rotulo}" já têm este pagamento feito em outro lançamento: ${lista.map((l) => l.pessoa).join(", ")}. Baixar mesmo assim?`,
    pessoa: lista[0].pessoa,
    item: lista[0].item,
    jaPagos: lista[0].jaPagos,
    suspeitos: lista,
  });
}

/** Estorna a baixa do lote: cada membro volta a aberto (motivo obrigatório); a etapa FOLHA_PAGA é desmarcada. */
export async function estornarLote(loteId: string, motivo: string, usuario: Usuario) {
  if (!motivo.trim()) throw new RecusaFolha(400, { message: "Motivo obrigatório para estornar o título." });
  const lote = await prisma.folhaLote.findUnique({ where: { id: loteId } });
  if (!lote || lote.status === STATUS_LOTE.CANCELADO) throw new RecusaFolha(404, { message: "Título da folha não encontrado." });
  if (lote.status !== STATUS_LOTE.PAGO || !lote.paymentDate) throw new RecusaFolha(400, { message: "Este título ainda não foi pago." });
  // Estornar tira a despesa do mês em que foi paga: trava na data do pagamento original.
  try {
    await assertPeriodWritableForDate(lote.paymentDate, "Estorno do lote de pagamento da folha");
  } catch (error) {
    throw new RecusaFolha(400, { message: error instanceof Error ? error.message : "Período fechado." });
  }
  const r = await semDuplicarAberto(() => prisma.$transaction(async (tx) => {
    await travarCompetencia(tx, { ano: lote.competenceYear, mes: lote.competenceMonth });
    // Voltar a ABERTO com outro título aberto do mesmo grupo (liberado depois do pagamento)
    // daria dois abertos da mesma empresa: o índice único recusa. Explica antes.
    const outroAberto = await tx.folhaLote.findFirst({
      where: { competenceYear: lote.competenceYear, competenceMonth: lote.competenceMonth, grupo: lote.grupo, status: STATUS_LOTE.ABERTO, id: { not: loteId } },
    });
    if (outroAberto) {
      throw new RecusaFolha(409, {
        message: `Já existe um título aberto de "${outroAberto.rotulo}" para ${competenciaDoLote(lote.competenceYear, lote.competenceMonth)}: pague ou cancele esse título antes de estornar.`,
      });
    }
    const { count } = await tx.folhaLote.updateMany({
      where: { id: loteId, status: STATUS_LOTE.PAGO },
      data: {
        status: STATUS_LOTE.ABERTO, paymentDate: null, paidPaymentMethodId: null, paidPaymentMethodName: null,
        paidByCompanyId: null, companyBankAccountId: null, paymentNotes: motivo.trim(), updatedById: usuario.id,
      },
    });
    if (count === 0) throw new RecusaFolha(409, { message: "Este título mudou agora. Recarregue a tela." });
    const membros = await tx.payrollItem.findMany({ where: { folhaLoteId: loteId, deletedAt: null, paymentDate: { not: null } }, select: { id: true, dueDate: true } });
    for (const m of membros) await tx.payrollItem.update({ where: { id: m.id }, data: dadosDoEstorno(m.dueDate, motivo.trim(), usuario.id) });
    const etapa = await sincronizarEtapaFolhaPaga(tx, { ano: lote.competenceYear, mes: lote.competenceMonth }, usuario);
    return { membros, etapa };
  }));
  for (const m of r.membros) {
    await auditLog({
      userId: usuario.id, ...rastro(usuario), action: "REVERSE_PAYROLL_ITEM", entity: "PayrollItem", entityId: m.id,
      newValue: { reverseReason: motivo.trim(), viaLote: lote.rotulo, folhaLoteId: loteId },
    });
  }
  await auditLog({
    userId: usuario.id, ...rastro(usuario), action: "REVERSE_FOLHA_LOTE", entity: "FolhaLote", entityId: loteId,
    previousValue: { status: lote.status, paymentDate: lote.paymentDate },
    newValue: { status: STATUS_LOTE.ABERTO, reverseReason: motivo.trim(), membros: r.membros.length, folhaPagaDesmarcada: r.etapa === "DESMARCOU" },
  });
  return { id: loteId, status: STATUS_LOTE.ABERTO, membros: r.membros.length };
}

/** Desfaz a liberação da competência: os títulos em aberto são cancelados e os salários voltam soltos. */
export async function cancelarLiberacao(ano: number, mes: number, motivo: string, usuario: Usuario) {
  if (motivo.trim().length < 3) throw new RecusaFolha(400, { message: "Informe o motivo (mín. 3 letras)." });
  const r = await prisma.$transaction(async (tx) => {
    await travarCompetencia(tx, { ano, mes });
    const lotes = await tx.folhaLote.findMany({ where: { competenceYear: ano, competenceMonth: mes, status: { not: STATUS_LOTE.CANCELADO } } });
    const pago = lotes.find((l) => l.status === STATUS_LOTE.PAGO);
    if (pago) throw new RecusaFolha(409, { message: `O título "${pago.rotulo}" já foi pago: estorne a baixa no Contas a Pagar antes.` });
    if (lotes.length === 0) throw new RecusaFolha(404, { message: "Não há títulos da folha liberados nesta competência." });
    const ids = lotes.map((l) => l.id);
    const soltos = await tx.payrollItem.updateMany({ where: { folhaLoteId: { in: ids } }, data: { folhaLoteId: null, folhaLoteOrigemId: null } });
    await tx.folhaLote.updateMany({
      where: { id: { in: ids } },
      data: { status: STATUS_LOTE.CANCELADO, cancelReason: motivo.trim(), canceledAt: new Date(), updatedById: usuario.id },
    });
    return { lotes, soltos: soltos.count };
  });
  for (const l of r.lotes) {
    await auditLog({ userId: usuario.id, ...rastro(usuario), action: "CANCEL_FOLHA_LOTE", entity: "FolhaLote", entityId: l.id, newValue: { rotulo: l.rotulo, motivo: motivo.trim() } });
  }
  return { cancelados: r.lotes.length, salariosSoltos: r.soltos };
}

/** Há lote vivo (aberto ou pago) na competência? */
export async function temLoteVivo(ano: number, mes: number): Promise<boolean> {
  const n = await prisma.folhaLote.count({ where: { competenceYear: ano, competenceMonth: mes, status: { not: STATUS_LOTE.CANCELADO } } });
  return n > 0;
}
