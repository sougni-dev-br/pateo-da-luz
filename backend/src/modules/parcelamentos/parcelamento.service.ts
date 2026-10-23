// Parcelamento em lote: o plano guarda o acordo e cada parcela é uma Purchase comum de 1 item
// e 1 PaymentInstallment, com competência no mês do vencimento. Baixa e estorno seguem as
// rotas de Contas a Pagar; aqui só se cria, lista, cancela o saldo aberto e renegocia.
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { parseDate } from "../../shared/utils/parse-date.js";
import { assertPeriodWritableForDate } from "../cmv-real/cmv-real.service.js";
import { getNextPurchaseNumber } from "../cards/cards.service.js";
import { montarParcelas, type ParcelaCalculada, type ParcelaInformada } from "./parcelamento-calc.js";
import { motivoProdutoInvalido } from "./parcelamento-produto.js";
import { resumirParcelas, situacaoDaParcela, type ParcelaLinha } from "./parcelamento-regras.js";

export class ParcelamentoError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "ParcelamentoError";
  }
}

export type NovoParcelamento = {
  supplierId: string;
  companyId: string;
  productId: string;
  description: string;
  total: number;
  quantidade: number;
  primeiroVencimento?: string;
  informadas?: ParcelaInformada[];
  paymentMethodId?: string | null;
  notes?: string | null;
};

type Db = Prisma.TransactionClient;

function dataDaParcela(p: ParcelaCalculada): Date {
  const d = parseDate(p.vencimento);
  if (!d) throw new ParcelamentoError(`Vencimento inválido: ${p.vencimento}.`);
  return d;
}

function mesAno(d: Date) {
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

// Tudo ou nada: se qualquer mês de competência estiver travado, nada é gravado.
async function exigirPeriodosAbertos(datas: Date[], contexto: string) {
  const travados: string[] = [];
  const vistos = new Set<string>();
  for (const d of datas) {
    const chave = mesAno(d);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    try {
      await assertPeriodWritableForDate(d, contexto);
    } catch (error) {
      travados.push(`${chave}: ${error instanceof Error ? error.message : "período fechado"}`);
    }
  }
  if (travados.length) throw new ParcelamentoError(travados.join(" | "));
}

const MAX_DESCRICAO = 120;
const MAX_OBSERVACOES = 500;
const JANELA_DUPLICIDADE_MIN = 10;
const ANOS_PARA_TRAS = 5;
const ANOS_PARA_FRENTE = 15;

// Evita erro de digitação no ano (ex.: 2062) gerar centenas de compras fora de época.
function exigirVencimentosPlausiveis(datas: Date[], hoje = new Date()) {
  const minimo = new Date(hoje.getFullYear() - ANOS_PARA_TRAS, 0, 1).getTime();
  const maximo = new Date(hoje.getFullYear() + ANOS_PARA_FRENTE, 11, 31).getTime();
  const fora = datas.find((d) => d.getTime() < minimo || d.getTime() > maximo);
  if (fora) throw new ParcelamentoError(`Vencimento ${fora.toLocaleDateString("pt-BR")} fora do intervalo aceito. Confira o ano.`);
}

function validarEntrada(e: NovoParcelamento) {
  if (!e.supplierId || !e.companyId || !e.productId) throw new ParcelamentoError("Informe fornecedor, empresa e produto.");
  if (!e.description?.trim()) throw new ParcelamentoError("Informe a descrição do parcelamento.");
  if (e.description.trim().length > MAX_DESCRICAO) throw new ParcelamentoError(`A descrição aceita até ${MAX_DESCRICAO} caracteres.`);
  if ((e.notes ?? "").length > MAX_OBSERVACOES) throw new ParcelamentoError(`As observações aceitam até ${MAX_OBSERVACOES} caracteres.`);
}

function montar(e: NovoParcelamento): ParcelaCalculada[] {
  try {
    return montarParcelas({ total: e.total, quantidade: e.quantidade, primeiroVencimento: e.primeiroVencimento, informadas: e.informadas });
  } catch (error) {
    throw new ParcelamentoError(error instanceof Error ? error.message : "Parcelas inválidas.");
  }
}

async function gravarPlano(tx: Db, e: NovoParcelamento, parcelas: ParcelaCalculada[], userId: string, renegotiatedFromId: string | null) {
  const [supplier, company, product, method] = await Promise.all([
    tx.supplier.findUnique({ where: { id: e.supplierId }, select: { id: true } }),
    tx.company.findFirst({ where: { id: e.companyId, isActive: true }, select: { id: true } }),
    tx.product.findUnique({ where: { id: e.productId }, select: { id: true, name: true, unit: true, unitMeasureId: true, isActive: true, controlsStock: true, dreCategoryId: true, dreCategory: { select: { dreGroup: true } } } }),
    e.paymentMethodId ? tx.paymentMethod.findUnique({ where: { id: e.paymentMethodId }, select: { id: true, name: true } }) : Promise.resolve(null)
  ]);
  if (!supplier) throw new ParcelamentoError("Fornecedor não encontrado.", 404);
  if (!company) throw new ParcelamentoError("Empresa não encontrada ou inativa.");
  if (!product) throw new ParcelamentoError("Produto não encontrado.", 404);
  if (e.paymentMethodId && !method) throw new ParcelamentoError("Forma de pagamento não encontrada.");
  const motivoProduto = motivoProdutoInvalido({
    isActive: product.isActive, controlsStock: product.controlsStock, dreCategoryId: product.dreCategoryId, dreGroup: product.dreCategory?.dreGroup ?? null
  });
  if (motivoProduto) throw new ParcelamentoError(motivoProduto);

  const total = parcelas.reduce((s, p) => s + Math.round(p.valor * 100), 0) / 100;
  const plano = await tx.installmentPlan.create({
    data: {
      supplierId: e.supplierId,
      companyId: e.companyId,
      productId: e.productId,
      description: e.description.trim(),
      totalAmount: new Prisma.Decimal(total),
      installmentCount: parcelas.length,
      renegotiatedFromId,
      notes: e.notes?.trim() || null,
      createdByUserId: userId
    }
  });

  const compras: Array<{ purchaseId: string; numero: number }> = [];
  for (const parcela of parcelas) {
    const vencimento = dataDaParcela(parcela);
    const purchaseNumber = await getNextPurchaseNumber(tx, vencimento.getFullYear());
    const valor = new Prisma.Decimal(parcela.valor);
    const rotulo = `${parcela.numero}/${parcelas.length}`;
    const compra = await tx.purchase.create({
      data: {
        purchaseDate: vencimento,
        competenceMonth: vencimento.getMonth() + 1,
        competenceYear: vencimento.getFullYear(),
        supplierId: e.supplierId,
        companyId: e.companyId,
        noInvoiceReason: `Parcelamento: ${e.description.trim()} (${rotulo})`,
        paymentMethod: method?.name ?? null,
        paymentMethodId: method?.id ?? null,
        totalAmount: valor,
        sourceFile: `parcelamento:${plano.id}`,
        installmentPlanId: plano.id,
        planInstallmentNumber: parcela.numero,
        rawRow: { origem: "parcelamento", planId: plano.id, parcela: rotulo } as Prisma.InputJsonValue
      }
    });
    await tx.$executeRaw`
      UPDATE "Purchase" SET "purchaseNumber" = ${purchaseNumber}, "workflowStatus" = 'confirmed' WHERE "id" = ${compra.id}
    `;
    await tx.purchaseItem.create({
      data: {
        purchaseId: compra.id,
        productId: product.id,
        rawProductName: product.name,
        unit: product.unit,
        unitMeasureId: product.unitMeasureId,
        quantity: new Prisma.Decimal(1),
        unitPrice: valor,
        totalPrice: valor
      }
    });
    await tx.paymentInstallment.create({
      data: {
        purchaseId: compra.id,
        dueDate: vencimento,
        amount: valor,
        installment: 1,
        paymentMethodId: method?.id ?? null,
        paymentMethodName: method?.name ?? null,
        status: "OPEN",
        rawValue: parcela.vencimento,
        sourceType: "DIRECT"
      }
    });
    compras.push({ purchaseId: compra.id, numero: parcela.numero });
  }
  await tx.auditLog.create({
    data: {
      id: crypto.randomUUID(),
      userId,
      action: "CREATE_INSTALLMENT_PLAN",
      entity: "InstallmentPlan",
      entityId: plano.id,
      newValue: { ...e, total, parcelas, renegotiatedFromId } as unknown as Prisma.InputJsonValue
    }
  });
  return { planId: plano.id, compras };
}

export async function criarParcelamento(entrada: NovoParcelamento, userId: string) {
  validarEntrada(entrada);
  const parcelas = montar(entrada);
  exigirVencimentosPlausiveis(parcelas.map(dataDaParcela));
  await exigirPeriodosAbertos(parcelas.map(dataDaParcela), "Cadastro de parcelamento");
  return prisma.$transaction(async (tx) => {
    // Trava por fornecedor: dois cliques ou duas abas seguidos esperam um pelo outro e o segundo vê o primeiro.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`parcelamento:${entrada.supplierId}`}))`;
    const desde = new Date(Date.now() - JANELA_DUPLICIDADE_MIN * 60_000);
    const repetido = await tx.installmentPlan.findFirst({
      where: {
        supplierId: entrada.supplierId, status: "ACTIVE", createdAt: { gte: desde },
        description: { equals: entrada.description.trim(), mode: "insensitive" },
        totalAmount: new Prisma.Decimal(parcelas.reduce((s, p) => s + Math.round(p.valor * 100), 0) / 100)
      },
      select: { id: true }
    });
    if (repetido) throw new ParcelamentoError("Já existe um parcelamento igual criado há poucos minutos. Confira a lista antes de criar de novo.", 409);
    return gravarPlano(tx, entrada, parcelas, userId, null);
  }, { timeout: 60_000, maxWait: 15_000 });
}

type LinhaParcela = ParcelaLinha & {
  purchaseId: string;
  installmentId: string | null;
  numero: number | null;
  paidDate: Date | null;
};

async function lerParcelas(planId: string): Promise<LinhaParcela[]> {
  const linhas = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT p."id" AS "purchaseId", p."planInstallmentNumber" AS "numero", p."status" AS "purchaseStatus",
           pi."id" AS "installmentId", pi."status" AS "status", pi."amount"::text AS "amount",
           pi."paidAmount"::text AS "paidAmount", pi."dueDate", pi."paidDate"
    FROM "Purchase" p
    LEFT JOIN "PaymentInstallment" pi ON pi."purchaseId" = p."id"
    WHERE p."installmentPlanId" = ${planId}
    ORDER BY p."planInstallmentNumber", pi."installment"
  `;
  return linhas.map((l) => ({
    purchaseId: String(l.purchaseId),
    installmentId: l.installmentId ? String(l.installmentId) : null,
    numero: l.numero === null ? null : Number(l.numero),
    status: String(l.status ?? "OPEN"),
    purchaseStatus: String(l.purchaseStatus),
    amount: Number(l.amount ?? 0),
    paidAmount: l.paidAmount === null || l.paidAmount === undefined ? null : Number(l.paidAmount),
    dueDate: l.dueDate ? new Date(l.dueDate as string | Date) : null,
    paidDate: l.paidDate ? new Date(l.paidDate as string | Date) : null
  }));
}

export async function listarParcelamentos(hoje = new Date()) {
  const planos = await prisma.installmentPlan.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { supplier: { select: { name: true } } }
  });
  return Promise.all(planos.map(async (plano) => ({
    id: plano.id,
    description: plano.description,
    supplierName: plano.supplier.name,
    status: plano.status,
    totalAmount: Number(plano.totalAmount),
    installmentCount: plano.installmentCount,
    createdAt: plano.createdAt,
    resumo: resumirParcelas(await lerParcelas(plano.id), hoje)
  })));
}

export async function detalharParcelamento(planId: string, hoje = new Date()) {
  const plano = await prisma.installmentPlan.findUnique({ where: { id: planId }, include: { supplier: { select: { name: true } } } });
  if (!plano) throw new ParcelamentoError("Parcelamento não encontrado.", 404);
  const parcelas = await lerParcelas(planId);
  return {
    id: plano.id,
    description: plano.description,
    supplierId: plano.supplierId,
    supplierName: plano.supplier.name,
    companyId: plano.companyId,
    productId: plano.productId,
    status: plano.status,
    totalAmount: Number(plano.totalAmount),
    installmentCount: plano.installmentCount,
    renegotiatedFromId: plano.renegotiatedFromId,
    notes: plano.notes,
    resumo: resumirParcelas(parcelas, hoje),
    parcelas: parcelas.map((p) => ({ ...p, situacao: situacaoDaParcela(p) }))
  };
}

// Cancela só as parcelas abertas; pagas ficam intactas (estorno só pela rota de reverse).
async function cancelarAbertas(tx: Db, abertas: LinhaParcela[], userId: string, motivo: string) {
  for (const p of abertas) {
    await tx.$executeRaw`
      UPDATE "PaymentInstallment" SET "status" = 'CANCELLED'
      WHERE "purchaseId" = ${p.purchaseId} AND "status" NOT IN ('PAID', 'PAID_LATE', 'CANCELLED')
    `;
    await tx.$executeRaw`
      UPDATE "Purchase"
      SET "status" = 'CANCELLED', "cancelledAt" = CURRENT_TIMESTAMP, "cancellationReason" = ${motivo},
          "cancelledByUserId" = ${userId}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${p.purchaseId}
        AND NOT EXISTS (SELECT 1 FROM "PaymentInstallment" x WHERE x."purchaseId" = ${p.purchaseId} AND x."status" IN ('PAID', 'PAID_LATE'))
    `;
  }
}

// Relê dentro da transação, travando as parcelas: uma baixa feita depois da tela aberta
// não pode ser cancelada junto. Se algo mudou, nada é gravado.
async function exigirAindaAbertas(tx: Db, planId: string, abertas: LinhaParcela[]) {
  const atuais = await tx.$queryRaw<Array<{ purchaseId: string; status: string }>>`
    SELECT p."id" AS "purchaseId", pi."status" AS "status"
    FROM "Purchase" p JOIN "PaymentInstallment" pi ON pi."purchaseId" = p."id"
    WHERE p."installmentPlanId" = ${planId} AND p."status" <> 'CANCELLED'
    FOR UPDATE OF pi
  `;
  const aindaAbertas = new Set(atuais.filter((a) => !["PAID", "PAID_LATE", "CANCELLED"].includes(a.status)).map((a) => a.purchaseId));
  if (abertas.some((p) => !aindaAbertas.has(p.purchaseId))) {
    throw new ParcelamentoError("Uma parcela foi baixada ou alterada agora há pouco. Recarregue e tente de novo.", 409);
  }
}

export type Renegociacao = {
  quantidade: number;
  primeiroVencimento?: string;
  informadas?: ParcelaInformada[];
  total?: number;
  motivo: string;
  notes?: string | null;
};

export async function renegociarParcelamento(planId: string, r: Renegociacao, userId: string) {
  if (!r.motivo?.trim()) throw new ParcelamentoError("Informe o motivo da renegociação.");
  const plano = await prisma.installmentPlan.findUnique({ where: { id: planId } });
  if (!plano) throw new ParcelamentoError("Parcelamento não encontrado.", 404);
  if (plano.status !== "ACTIVE") throw new ParcelamentoError("Só parcelamento ativo pode ser renegociado.", 409);

  const abertas = (await lerParcelas(planId)).filter((p) => situacaoDaParcela(p) === "ABERTA");
  if (!abertas.length) throw new ParcelamentoError("Não há parcelas em aberto para renegociar.", 409);
  const saldo = abertas.reduce((s, p) => s + Math.round(p.amount * 100), 0) / 100;

  const comForma = await prisma.purchase.findFirst({
    where: { installmentPlanId: planId, paymentMethodId: { not: null } },
    select: { paymentMethodId: true },
    orderBy: { planInstallmentNumber: "asc" }
  });
  const entrada: NovoParcelamento = {
    paymentMethodId: comForma?.paymentMethodId ?? null,
    supplierId: plano.supplierId,
    companyId: plano.companyId,
    productId: plano.productId,
    description: plano.description,
    total: r.total ?? saldo,
    quantidade: r.quantidade,
    primeiroVencimento: r.primeiroVencimento,
    informadas: r.informadas,
    notes: r.notes ?? `Renegociação do saldo de ${saldo.toFixed(2)}. Motivo: ${r.motivo.trim()}`
  };
  const novas = montar(entrada);
  exigirVencimentosPlausiveis(novas.map(dataDaParcela));
  const competenciasAntigas = abertas.flatMap((p) => (p.dueDate ? [p.dueDate] : []));
  await exigirPeriodosAbertos([...competenciasAntigas, ...novas.map(dataDaParcela)], "Renegociação de parcelamento");

  return prisma.$transaction(async (tx) => {
    await exigirAindaAbertas(tx, planId, abertas);
    await cancelarAbertas(tx, abertas, userId, `Renegociação: ${r.motivo.trim()}`);
    const novo = await gravarPlano(tx, entrada, novas, userId, planId);
    await tx.installmentPlan.update({ where: { id: planId }, data: { status: "RENEGOTIATED" } });
    await tx.auditLog.create({
      data: {
        id: crypto.randomUUID(),
        userId,
        action: "RENEGOTIATE_INSTALLMENT_PLAN",
        entity: "InstallmentPlan",
        entityId: planId,
        newValue: { novoPlanoId: novo.planId, saldoAnterior: saldo, motivo: r.motivo, comprasCanceladas: abertas.map((p) => p.purchaseId) } as Prisma.InputJsonValue
      }
    });
    return { ...novo, saldoAnterior: saldo, parcelasCanceladas: abertas.length };
  }, { timeout: 60_000, maxWait: 15_000 });
}

// Cancela o saldo aberto sem criar outro plano (ex.: lançado por engano).
export async function cancelarParcelamento(planId: string, motivo: string, userId: string) {
  if (!motivo?.trim()) throw new ParcelamentoError("Informe o motivo do cancelamento.");
  const plano = await prisma.installmentPlan.findUnique({ where: { id: planId } });
  if (!plano) throw new ParcelamentoError("Parcelamento não encontrado.", 404);
  if (plano.status !== "ACTIVE") throw new ParcelamentoError("Só parcelamento ativo pode ser cancelado.", 409);
  const parcelas = await lerParcelas(planId);
  const abertas = parcelas.filter((p) => situacaoDaParcela(p) === "ABERTA");
  const pagas = parcelas.filter((p) => situacaoDaParcela(p) === "PAGA").length;
  await exigirPeriodosAbertos(abertas.flatMap((p) => (p.dueDate ? [p.dueDate] : [])), "Cancelamento de parcelamento");
  await prisma.$transaction(async (tx) => {
    await exigirAindaAbertas(tx, planId, abertas);
    await cancelarAbertas(tx, abertas, userId, `Parcelamento cancelado: ${motivo.trim()}`);
    await tx.installmentPlan.update({ where: { id: planId }, data: { status: "CANCELLED" } });
    await tx.auditLog.create({
      data: {
        id: crypto.randomUUID(), userId, action: "CANCEL_INSTALLMENT_PLAN", entity: "InstallmentPlan", entityId: planId,
        newValue: { motivo, parcelasCanceladas: abertas.length, parcelasPagasMantidas: pagas, comprasCanceladas: abertas.map((p) => p.purchaseId) } as Prisma.InputJsonValue
      }
    });
  });
  return { parcelasCanceladas: abertas.length, parcelasPagasMantidas: pagas };
}
