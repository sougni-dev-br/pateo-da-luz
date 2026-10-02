// Baixa e estorno de um lançamento da Folha (PayrollItem) — a regra que a baixa individual
// (PATCH /payroll/:id/pay) e a baixa do lote de pagamento (folha-lote.service.ts) usam juntas.
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { assertPeriodWritableForDate } from "../cmv-real/cmv-real.service.js";
import { competenciaDe, pagamentosEmDuplicidade, resumoItem, rotuloTipo } from "./folha-duplicidade.js";
import { CAMPOS_TRAVA, RecusaFolha, dataBr, nomeDe } from "./folha-lancamento.routes.js";
import { mensagemMembroDoLote } from "./folha-lote.js";
import { travarFolhaDaPessoa } from "./folha-trava.js";
import { computeStatus } from "./payroll.service.js";

export type DadosBaixa = {
  paymentDate: Date;
  paidAmount: number;
  paidPaymentMethodId: string | null;
  paidPaymentMethodName: string | null;
  differenceReason: string | null;
  paymentNotes: string | null;
  payingCompanyId: string | null;
  companyBankAccountId: string | null;
};

type CamposLidos = Omit<DadosBaixa, "paidPaymentMethodName"> & { paidPaymentMethodNameInput: string | null };

const MAX_PAYMENT_MULTIPLIER = 10;
const MIN_ABSURD_SURCHARGE = 10_000;
const asText = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return s.length ? s : null; };
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Campos da baixa vindos do corpo da requisição; sem valor pago, vale o do título. */
export function lerCamposDaBaixa(b: Record<string, unknown>, valorDoTitulo: number): CamposLidos {
  return {
    paymentDate: b.paymentDate ? new Date(String(b.paymentDate)) : new Date(),
    paidAmount: numOrNull(b.paidAmount) ?? valorDoTitulo,
    paidPaymentMethodId: asText(b.paidPaymentMethodId),
    paidPaymentMethodNameInput: asText(b.paidPaymentMethodName),
    differenceReason: asText(b.differenceReason),
    paymentNotes: asText(b.paymentNotes ?? b.notes),
    payingCompanyId: asText(b.payingCompanyId),
    companyBankAccountId: asText(b.companyBankAccountId),
  };
}

/**
 * As guardas da baixa (as mesmas de contas a pagar): data e valor, data futura, mês travado,
 * forma de pagamento, valor absurdo, justificativa da diferença e conta da empresa pagadora.
 * Devolve a mensagem de recusa ou os dados prontos para gravar.
 */
export async function validarBaixa(c: CamposLidos, valorDoTitulo: number, contexto: string): Promise<{ erro: string } | { dados: DadosBaixa }> {
  if (isNaN(c.paymentDate.getTime()) || c.paidAmount <= 0) return { erro: "Data e valor pago (> 0) são obrigatórios." };
  // Data futura joga a despesa para um mês que ainda não aconteceu.
  const soData = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (soData(c.paymentDate).getTime() > soData(new Date()).getTime()) return { erro: "Data do pagamento não pode ser futura." };
  // O paymentDate posiciona a despesa no mês do DRE: mês com CMV fechado não recebe baixa.
  try {
    await assertPeriodWritableForDate(c.paymentDate, contexto);
  } catch (error) {
    return { erro: error instanceof Error ? error.message : "Período fechado." };
  }
  if (!c.paidPaymentMethodId && !c.paidPaymentMethodNameInput) return { erro: "Forma de pagamento é obrigatória." };
  // Erro de digitação com ordem de grandeza a mais (R$ 1.200 virando 12.000): só barra o que é
  // absurdo em proporção E em valor, para não atrapalhar acerto legítimo em título pequeno.
  if (valorDoTitulo > 0 && c.paidAmount > valorDoTitulo * MAX_PAYMENT_MULTIPLIER && c.paidAmount - valorDoTitulo > MIN_ABSURD_SURCHARGE) {
    return { erro: `Valor pago (${c.paidAmount.toFixed(2)}) é mais de ${MAX_PAYMENT_MULTIPLIER}x o título (${valorDoTitulo.toFixed(2)}). Confira antes de baixar.` };
  }
  const difference = Number((c.paidAmount - valorDoTitulo).toFixed(2));
  if (Math.abs(difference) > 0.009 && !c.differenceReason) {
    return { erro: "Justificativa obrigatória quando o valor pago difere do valor do título." };
  }
  // Conta bancária tem que pertencer à empresa pagadora e estar ativa.
  if (c.payingCompanyId && c.companyBankAccountId) {
    const owned = await prisma.companyBankAccount.findFirst({ where: { id: c.companyBankAccountId, companyId: c.payingCompanyId, isActive: true } });
    if (!owned) return { erro: "Conta bancária não pertence à empresa selecionada ou está inativa." };
  }
  const method = c.paidPaymentMethodId ? await prisma.paymentMethod.findUnique({ where: { id: c.paidPaymentMethodId } }) : null;
  const { paidPaymentMethodNameInput, ...resto } = c;
  return { dados: { ...resto, paidPaymentMethodName: method?.name ?? paidPaymentMethodNameInput } };
}

type ItemDaBaixa = Prisma.PayrollItemGetPayload<{ select: typeof CAMPOS_TRAVA }>;

/**
 * Grava a baixa de um item dentro da transação e da trava da pessoa: relê o item, recusa o já
 * baixado e o pagamento em duplicidade (o mesmo pagamento já pago em OUTRO item) — este só
 * passa com a confirmação explícita. Recusa com RecusaFolha (status + corpo da resposta).
 */
export async function gravarBaixaDoItem(
  tx: Prisma.TransactionClient, existing: ItemDaBaixa, dados: DadosBaixa, userId: string, confirmaDuplicidade: boolean,
  // null = baixa individual (o item não pode estar em lote); o id do lote = baixa pelo lote.
  loteId: string | null = null,
) {
  await travarFolhaDaPessoa(tx, existing.employeeId);
  const atual = await tx.payrollItem.findFirst({ where: { id: existing.id, deletedAt: null }, select: { paymentDate: true, status: true, folhaLoteId: true } });
  if (!atual) throw new RecusaFolha(404, { message: "Lançamento não encontrado." });
  if (atual.paymentDate || atual.status === "PAID") {
    throw new RecusaFolha(400, { message: "Lançamento já baixado. Estorne o pagamento antes de lançar uma nova baixa." });
  }
  // Liberar pode ter posto o item num lote depois da leitura da rota: membro de lote só se
  // paga pelo lote (e o lote, só os seus).
  if ((atual.folhaLoteId ?? null) !== loteId) await recusarPorLoteMudado(tx, atual.folhaLoteId ?? null);
  const outrosPagos = await tx.payrollItem.findMany({
    where: {
      employeeId: existing.employeeId, type: existing.type, competenceYear: existing.competenceYear, competenceMonth: existing.competenceMonth,
      deletedAt: null, paymentDate: { not: null }, id: { not: existing.id },
    },
    select: CAMPOS_TRAVA,
  });
  const duplicados = pagamentosEmDuplicidade(existing, outrosPagos);
  if (duplicados.length > 0 && !confirmaDuplicidade) {
    const emp = await tx.employee.findFirst({ where: { id: existing.employeeId }, select: { firstName: true, lastName: true } });
    const pessoa = nomeDe(emp);
    const p = duplicados[0];
    const valor = Number(p.paidAmount ?? p.amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    throw new RecusaFolha(409, {
      code: "BAIXA_DUPLICADA",
      message: `Já foi pago ${rotuloTipo(existing.type).toLowerCase()} ${competenciaDe(existing)} de ${pessoa} em ${dataBr(p.paymentDate)} (${valor}). Baixar mesmo assim?`,
      pessoa,
      item: resumoItem(existing),
      jaPagos: duplicados.map(resumoItem),
    });
  }
  // Gravação condicionada (id + sem baixa + no mesmo lote de agora): se o item entrou num
  // lote, ou foi baixado, entre a releitura e aqui, nada é gravado (P2025) e a baixa é recusada.
  const updated = await tx.payrollItem.update({
    where: { id: existing.id, paymentDate: null, folhaLoteId: loteId },
    data: {
      paymentDate: dados.paymentDate, paidAmount: dados.paidAmount, status: "PAID",
      paidPaymentMethodId: dados.paidPaymentMethodId, paidPaymentMethodName: dados.paidPaymentMethodName,
      paidByCompanyId: dados.payingCompanyId, companyBankAccountId: dados.companyBankAccountId,
      differenceReason: dados.differenceReason, paymentNotes: dados.paymentNotes,
      updatedById: userId,
    },
  }).catch(async (err: unknown) => {
    if (!registroNaoEncontrado(err)) throw err;
    const depois = await tx.payrollItem.findFirst({ where: { id: existing.id }, select: { folhaLoteId: true } });
    return recusarPorLoteMudado(tx, depois?.folhaLoteId ?? null);
  });
  return { updated, jaPagos: duplicados };
}

/** Prisma: o registro do where (com as condições extras) não existe mais — P2025. */
export function registroNaoEncontrado(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { code?: unknown }).code === "P2025");
}

/** Prisma: violou índice único — P2002. */
export function chaveUnicaViolada(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { code?: unknown }).code === "P2002");
}

/** Recusa a gravação de um item que entrou (ou saiu) de lote no meio do caminho. */
export async function recusarPorLoteMudado(tx: Prisma.TransactionClient, folhaLoteId: string | null): Promise<never> {
  const lote = folhaLoteId ? await tx.folhaLote.findUnique({ where: { id: folhaLoteId }, select: { rotulo: true, status: true } }) : null;
  if (lote && lote.status !== "CANCELADO") throw new RecusaFolha(409, { message: mensagemMembroDoLote(lote.rotulo, lote.status === "PAGO") });
  throw new RecusaFolha(409, { message: "Este lançamento mudou agora (entrou ou saiu de um título da folha, ou foi baixado). Recarregue a tela." });
}

/** O que o estorno grava no item: volta a aberto e o motivo fica em paymentNotes. */
export function dadosDoEstorno(dueDate: Date, reason: string, userId: string) {
  return {
    paymentDate: null, paidAmount: null, status: computeStatus(dueDate, null),
    paidPaymentMethodId: null, paidPaymentMethodName: null, paidByCompanyId: null,
    // paymentNotes guarda o motivo do estorno, como no estorno de conta a pagar.
    companyBankAccountId: null, differenceReason: null, paymentNotes: reason,
    updatedById: userId,
  };
}
