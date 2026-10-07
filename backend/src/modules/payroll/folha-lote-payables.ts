// Títulos do lote de pagamento da folha dentro do Contas a Pagar (lista e PDF). Mesmo formato
// de linha da folha, com sourceType "FOLHA_LOTE"; o valor é a soma viva dos membros, que
// vêm junto (nome e valor) para a linha expansível. Os SALARIO membros não aparecem soltos
// (a query da folha filtra folhaLoteId IS NULL). O DRE continua lendo cada PayrollItem.
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { LIMITE_POR_ORIGEM } from "../purchases/payables-limite.js";
import { FOLHA_CATEGORY } from "./payroll.service.js";

export type FiltroLotes = {
  startToday: Date;
  status: string | null;
  startDate: Date | null;
  endDate: Date | null;
  noDueDate: boolean;
  // A lista usa o fim exclusivo (meia-noite seguinte); o PDF, o fim incluído (23:59:59.999).
  fimInclusivo?: boolean;
};

const totalMembros = Prisma.sql`(SELECT COALESCE(SUM(m."amount"), 0) FROM "PayrollItem" m WHERE m."folhaLoteId" = fl."id" AND m."deletedAt" IS NULL)`;
const totalPago = Prisma.sql`(SELECT SUM(COALESCE(m."paidAmount", m."amount")) FROM "PayrollItem" m WHERE m."folhaLoteId" = fl."id" AND m."deletedAt" IS NULL AND m."paymentDate" IS NOT NULL)`;
const qtdPessoas = Prisma.sql`(SELECT COUNT(DISTINCT m."employeeId") FROM "PayrollItem" m WHERE m."folhaLoteId" = fl."id" AND m."deletedAt" IS NULL)`;

function statusExpr(startToday: Date) {
  return Prisma.sql`
    CASE
      WHEN fl."status" = 'PAGO' THEN 'PAID'
      WHEN fl."dueDate" < ${startToday} THEN 'OVERDUE'
      ELSE 'OPEN'
    END
  `;
}

function filtroWhere(f: FiltroLotes) {
  const status = !f.status
    ? Prisma.sql`true`
    : f.status === "OPEN"
      ? Prisma.sql`fl."status" = 'ABERTO' AND fl."dueDate" >= ${f.startToday}`
      : f.status === "PAID" || f.status === "PAID_LATE"
        ? Prisma.sql`fl."status" = 'PAGO'`
        : f.status === "OVERDUE"
          ? Prisma.sql`fl."status" = 'ABERTO' AND fl."dueDate" < ${f.startToday}`
          : Prisma.sql`false`;
  // O título do lote sempre tem vencimento: o filtro "sem vencimento" não o traz.
  if (f.noDueDate) return Prisma.sql`false`;
  const desde = f.startDate ? Prisma.sql`fl."dueDate" >= ${f.startDate}` : Prisma.sql`true`;
  const ate = !f.endDate ? Prisma.sql`true` : f.fimInclusivo ? Prisma.sql`fl."dueDate" <= ${f.endDate}` : Prisma.sql`fl."dueDate" < ${f.endDate}`;
  return Prisma.sql`fl."status" IN ('ABERTO', 'PAGO') AND ${desde} AND ${ate} AND ${status}`;
}

export function lotesParaPayables(f: FiltroLotes) {
  return prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      fl."id",
      NULL::text AS "purchaseId",
      fl."dueDate",
      fl."paymentDate" AS "paidDate",
      ${totalMembros}::text AS "amount",
      ${totalPago}::text AS "paidAmount",
      NULL::int AS "installment",
      NULL::int AS "totalInstallments",
      NULL::text AS "paymentMethodId",
      NULL::text AS "paymentMethodName",
      fl."paidPaymentMethodId",
      COALESCE(fl."paidPaymentMethodName", ppm."name") AS "paidPaymentMethodName",
      fl."paymentNotes",
      'FOLHA_LOTE' AS "sourceType",
      ${statusExpr(f.startToday)} AS "status",
      NULL::text AS "rawValue",
      NULL::text AS "supplierId",
      fl."rotulo" AS "supplierName",
      NULL::text AS "purchaseNumber",
      NULL::text AS "invoiceNumber",
      NULL::timestamp AS "purchaseDate",
      -- Lote de CNPJ: a empresa dona do CNPJ (baixa em lote pela empresa de cada título).
      (SELECT co."id" FROM "Company" co WHERE regexp_replace(co."cnpj", '[^0-9]', '', 'g') = fl."grupo" LIMIT 1) AS "companyId",
      CONCAT('Folha · lote · ', ${qtdPessoas}, ' pessoa(s)') AS "notes",
      'Folha · lote' AS "taxDocumentType",
      CONCAT(${qtdPessoas}, ' pessoa(s)') AS "taxDescription",
      fl."rotulo" AS "taxCompanyName",
      NULL::text AS "taxCnpj",
      MAKE_DATE(fl."competenceYear", fl."competenceMonth", 1) AS "taxCompetenceDate",
      ${FOLHA_CATEGORY} AS "taxDreCategoryName",
      fl."grupo" AS "folhaLoteGrupo",
      COALESCE((
        SELECT json_agg(json_build_object(
          'id', m."id", 'employeeId', m."employeeId", 'nome', CONCAT(e."firstName", ' ', e."lastName"),
          'valor', m."amount"::text, 'origem', orig."rotulo", 'pago', m."paymentDate" IS NOT NULL,
          -- O mesmo rótulo de tipo da folha solta: o filtro "Salário CLT" / "Salário (acerto)" acha o título.
          'tipo', CASE WHEN m."details"->>'origem' = 'LISTA_PAGAMENTO' THEN 'Salário (acerto)' ELSE 'Salário' END
        ) ORDER BY e."firstName", e."lastName")
        FROM "PayrollItem" m
        JOIN "Employee" e ON e."id" = m."employeeId"
        LEFT JOIN "FolhaLote" orig ON orig."id" = m."folhaLoteOrigemId"
        WHERE m."folhaLoteId" = fl."id" AND m."deletedAt" IS NULL
      ), '[]'::json) AS "loteMembros"
    FROM "FolhaLote" fl
    LEFT JOIN "PaymentMethod" ppm ON ppm."id" = fl."paidPaymentMethodId"
    WHERE ${filtroWhere(f)}
    ORDER BY fl."dueDate", fl."rotulo"
    LIMIT ${LIMITE_POR_ORIGEM}
  `;
}

export function lotesParaPayablesPdf(f: FiltroLotes) {
  return prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      fl."dueDate",
      fl."paymentDate" AS "paidDate",
      ${totalMembros}::text AS "amount",
      ${totalPago}::text AS "paidAmount",
      NULL::int AS "installment",
      NULL::int AS "totalInstallments",
      COALESCE(fl."paidPaymentMethodName", ppm."name") AS "paymentMethodName",
      fl."paymentNotes",
      ${statusExpr(f.startToday)} AS "status",
      fl."rotulo" AS "supplierName",
      NULL::text AS "purchaseNumber",
      NULL::text AS "invoiceNumber",
      NULL::timestamp AS "purchaseDate",
      CONCAT('Folha · lote · ', ${qtdPessoas}, ' pessoa(s)') AS "notes"
    FROM "FolhaLote" fl
    LEFT JOIN "PaymentMethod" ppm ON ppm."id" = fl."paidPaymentMethodId"
    WHERE ${filtroWhere(f)}
    ORDER BY fl."dueDate", fl."rotulo"
    LIMIT ${LIMITE_POR_ORIGEM}
  `;
}
