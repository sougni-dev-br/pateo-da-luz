import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { normalizeText } from "../../shared/utils/normalize-text.js";
import { employeeToSupplierDraft, onlyDigits } from "../suppliers/employee-supplier.js";
import { nextSupplierCode } from "../suppliers/supplier-code.js";
import {
  ReimbursementError,
  decidirSincronizacao,
  ehCategoriaFuncionario,
  mensagemDeBloqueio
} from "./reimbursement-rules.js";

type Tx = Prisma.TransactionClient;

/**
 * "Quem pagou" precisa ser um fornecedor ativo que seja de um funcionario: da categoria
 * Funcionario ou com o CPF de um funcionario ativo. E nunca a propria loja da compra.
 */
export async function validarQuemPagou(tx: Tx, payeeId: string, fornecedorDaCompraId: string) {
  const [payee] = await tx.$queryRaw<Array<{ id: string; name: string; mainCategory: string | null; isActive: boolean; ehFuncionario: boolean }>>`
    SELECT s."id", s."name", s."mainCategory", s."isActive",
           EXISTS (
             SELECT 1 FROM "Employee" e
             WHERE e."isActive" AND e."deletedAt" IS NULL
               AND length(regexp_replace(e."cpf", '[^0-9]', '', 'g')) = 11
               AND regexp_replace(e."cpf", '[^0-9]', '', 'g') = regexp_replace(COALESCE(s."document", ''), '[^0-9]', '', 'g')
           ) AS "ehFuncionario"
    FROM "Supplier" s WHERE s."id" = ${payeeId} LIMIT 1
  `;
  if (!payee || !payee.isActive) throw new ReimbursementError("Quem pagou nao encontrado ou inativo.");
  if (!ehCategoriaFuncionario(payee.mainCategory) && !payee.ehFuncionario) {
    throw new ReimbursementError(`${payee.name} nao e um fornecedor da categoria Funcionario. Cadastre a pessoa em Fornecedores > A partir de funcionario.`);
  }
  if (payee.id === fornecedorDaCompraId) {
    throw new ReimbursementError("O fornecedor da compra e a loja onde foi comprado; quem pagou vai no campo proprio.");
  }
  return payee;
}

/**
 * O fornecedor que representa o funcionario nos reembolsos, achado pelo CPF. Se ainda
 * nao existir, e criado a partir do cadastro do funcionario (nome, CPF, contato e PIX
 * na observacao financeira) — o mesmo que "Fornecedores > A partir de funcionario".
 * Assim a lista de quem pagou tem todos os funcionarios ativos sem cadastro manual.
 */
export async function fornecedorDoFuncionario(tx: Tx, employeeId: string): Promise<string> {
  const employee = await tx.employee.findFirst({
    where: { id: employeeId, isActive: true, deletedAt: null },
    select: {
      id: true, firstName: true, lastName: true, cpf: true, phone: true, email: true, position: true, isActive: true,
      bankName: true, bankAgency: true, bankAccount: true, bankAccountDigit: true, bankAccountType: true,
      pixKeyType: true, pixKey: true
    }
  });
  if (!employee) throw new ReimbursementError("Funcionario nao encontrado ou desligado.");
  const cpf = onlyDigits(employee.cpf);
  if (cpf.length !== 11) throw new ReimbursementError("O funcionario esta sem CPF valido no cadastro. Corrija em Funcionarios antes de lancar o reembolso.");

  const [existente] = await tx.$queryRaw<Array<{ id: string; isActive: boolean }>>`
    SELECT "id", "isActive" FROM "Supplier"
    WHERE regexp_replace(COALESCE("document", ''), '[^0-9]', '', 'g') = ${cpf}
    ORDER BY "isActive" DESC, "createdAt" ASC
    LIMIT 1
  `;
  if (existente) {
    if (!existente.isActive) {
      await tx.$executeRaw`UPDATE "Supplier" SET "isActive" = true, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${existente.id}`;
    }
    return existente.id;
  }

  const draft = employeeToSupplierDraft(employee);
  const id = crypto.randomUUID();
  const externalCode = await nextSupplierCode(tx);
  await tx.$executeRaw`
    INSERT INTO "Supplier" (
      "id", "externalCode", "document", "name", "normalizedName", "phone", "email",
      "mainCategory", "defaultFinancialNotes", "notes", "isActive", "updatedAt"
    ) VALUES (
      ${id}, ${externalCode}, ${draft.document}, ${draft.name}, ${normalizeText(draft.name)}, ${draft.phone || null}, ${draft.email || null},
      ${draft.mainCategory}, ${draft.defaultFinancialNotes || null}, ${draft.notes}, true, CURRENT_TIMESTAMP
    )
  `;
  return id;
}

/**
 * O reembolso aberto da pessoa, travado ate o fim da transacao; cria um se nao houver.
 * Ha no maximo um aberto por pessoa (indice unico parcial).
 *
 * A trava e o que impede uma compra de entrar num reembolso que esta sendo fechado:
 * o fechamento segura a mesma linha, e quando ele termina o SELECT abaixo ja nao a
 * encontra aberta — dai a nova tentativa, que abre o reembolso seguinte.
 */
export async function reembolsoAbertoDe(tx: Tx, payeeId: string, userId: string | null): Promise<string> {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    await tx.$executeRaw`
      INSERT INTO "ReimbursementReport" ("id", "payeeSupplierId", "status", "totalAmount", "createdByUserId", "createdAt", "updatedAt")
      VALUES (${crypto.randomUUID()}, ${payeeId}, 'OPEN', 0, ${userId}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("payeeSupplierId") WHERE "status" = 'OPEN' DO NOTHING
    `;
    const [aberto] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "ReimbursementReport" WHERE "payeeSupplierId" = ${payeeId} AND "status" = 'OPEN' LIMIT 1 FOR UPDATE
    `;
    if (aberto) return aberto.id;
  }
  throw new ReimbursementError("O reembolso desta pessoa esta sendo fechado agora. Tente salvar de novo.", 409);
}

/** Total do reembolso = soma das compras dele. Recalculado, nunca incrementado, para nao acumular erro. */
export async function recalcularTotal(tx: Tx, reportId: string) {
  await tx.$executeRaw`
    UPDATE "ReimbursementReport"
    SET "totalAmount" = (SELECT COALESCE(SUM("amount"), 0) FROM "ReimbursementReportItem" WHERE "reportId" = ${reportId}),
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${reportId}
  `;
}

async function itemDaCompra(tx: Tx, purchaseId: string) {
  const [item] = await tx.$queryRaw<Array<{ id: string; reportId: string; reportStatus: string; payeeId: string; amount: string; purchaseDate: Date }>>`
    SELECT i."id", i."reportId", r."status" AS "reportStatus", r."payeeSupplierId" AS "payeeId",
           i."amount"::text AS "amount", i."purchaseDate"
    FROM "ReimbursementReportItem" i
    JOIN "ReimbursementReport" r ON r."id" = i."reportId"
    WHERE i."purchaseId" = ${purchaseId}
    LIMIT 1
    FOR UPDATE OF r
  `;
  // A trava no reembolso faz o status lido aqui ser o de depois de um fechamento
  // concorrente — nunca se edita item de reembolso que acabou de fechar.
  return item ?? null;
}

async function adicionar(tx: Tx, opts: { purchaseId: string; payeeId: string; amount: number; purchaseDate: Date; userId: string | null }) {
  const reportId = await reembolsoAbertoDe(tx, opts.payeeId, opts.userId);
  await tx.$executeRaw`
    INSERT INTO "ReimbursementReportItem" ("id", "reportId", "purchaseId", "amount", "purchaseDate", "checked", "createdAt", "updatedAt")
    VALUES (${crypto.randomUUID()}, ${reportId}, ${opts.purchaseId}, ${new Prisma.Decimal(opts.amount)}, ${opts.purchaseDate}, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `;
  await recalcularTotal(tx, reportId);
  return reportId;
}

/**
 * Mantem o item do reembolso igual a compra depois de criar ou editar. Lanca
 * ReimbursementError quando o reembolso ja foi fechado e a edicao mexeria nele.
 */
export async function sincronizarCompraNoReembolso(tx: Tx, opts: {
  purchaseId: string;
  payeeId: string | null;
  amount: number;
  purchaseDate: Date;
  userId: string | null;
}) {
  const atual = await itemDaCompra(tx, opts.purchaseId);
  const acao = decidirSincronizacao(
    atual ? { reportStatus: atual.reportStatus, payeeId: atual.payeeId, amount: Number(atual.amount), purchaseDate: new Date(atual.purchaseDate) } : null,
    { payeeId: opts.payeeId, amount: opts.amount, purchaseDate: opts.purchaseDate }
  );

  switch (acao) {
    case "NADA":
      return;
    case "BLOQUEADO":
      throw new ReimbursementError(mensagemDeBloqueio(atual!.reportStatus), 409);
    case "ADICIONAR":
      await adicionar(tx, { ...opts, payeeId: opts.payeeId! });
      return;
    case "ATUALIZAR":
      // Mudou valor ou data: a conferencia anterior nao vale mais.
      await tx.$executeRaw`
        UPDATE "ReimbursementReportItem"
        SET "amount" = ${new Prisma.Decimal(opts.amount)}, "purchaseDate" = ${opts.purchaseDate},
            "checked" = false, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${atual!.id}
      `;
      await recalcularTotal(tx, atual!.reportId);
      return;
    case "REMOVER":
    case "MOVER":
      await tx.$executeRaw`DELETE FROM "ReimbursementReportItem" WHERE "id" = ${atual!.id}`;
      await recalcularTotal(tx, atual!.reportId);
      if (acao === "MOVER") await adicionar(tx, { ...opts, payeeId: opts.payeeId! });
  }
}

/** Cancelamento da compra: sai do reembolso aberto; fechado ou pago bloqueia. */
export async function retirarCompraCancelada(tx: Tx, purchaseId: string) {
  const atual = await itemDaCompra(tx, purchaseId);
  if (!atual) return;
  if (atual.reportStatus !== "OPEN") {
    throw new ReimbursementError(
      atual.reportStatus === "PAID"
        ? "Esta compra esta num reembolso ja pago. Estorne o pagamento e reabra o reembolso antes de cancelar."
        : "Esta compra esta num reembolso ja fechado. Reabra o reembolso antes de cancelar.",
      409
    );
  }
  await tx.$executeRaw`DELETE FROM "ReimbursementReportItem" WHERE "id" = ${atual.id}`;
  await recalcularTotal(tx, atual.reportId);
}

/**
 * Devolve um reembolso fechado para aberto. Se a pessoa ja tem outro reembolso
 * aberto (compras lancadas depois do fechamento), as compras deste vao para la
 * e este fica CANCELLED: so pode haver um aberto por pessoa.
 */
export async function reabrirReembolso(tx: Tx, reportId: string): Promise<string> {
  const [report] = await tx.$queryRaw<Array<{ payeeSupplierId: string }>>`
    SELECT "payeeSupplierId" FROM "ReimbursementReport" WHERE "id" = ${reportId} LIMIT 1
  `;
  const [outroAberto] = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "ReimbursementReport"
    WHERE "payeeSupplierId" = ${report.payeeSupplierId} AND "status" = 'OPEN' AND "id" <> ${reportId}
    LIMIT 1
  `;

  if (outroAberto) {
    await tx.$executeRaw`UPDATE "ReimbursementReportItem" SET "reportId" = ${outroAberto.id}, "updatedAt" = CURRENT_TIMESTAMP WHERE "reportId" = ${reportId}`;
    await tx.$executeRaw`
      UPDATE "ReimbursementReport"
      SET "status" = 'CANCELLED', "generatedPurchaseId" = NULL, "totalAmount" = 0, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${reportId}
    `;
    await recalcularTotal(tx, outroAberto.id);
    return outroAberto.id;
  }

  await tx.$executeRaw`
    UPDATE "ReimbursementReport"
    SET "status" = 'OPEN', "generatedPurchaseId" = NULL, "closedAt" = NULL, "closedByUserId" = NULL,
        "dueDate" = NULL, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${reportId}
  `;
  return reportId;
}

/**
 * A compra cancelada e o agregador de um reembolso (o titulo da pessoa): o reembolso
 * volta a aberto para poder ser fechado de novo, como o ciclo de fornecedor faz.
 * Reembolso PAID nao e tocado — ali o dinheiro ja saiu.
 */
export async function reabrirReembolsoDoAgregador(tx: Tx, purchaseId: string): Promise<number> {
  const fechados = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "ReimbursementReport" WHERE "generatedPurchaseId" = ${purchaseId} AND "status" = 'CLOSED'
  `;
  for (const report of fechados) await reabrirReembolso(tx, report.id);
  return fechados.length;
}
