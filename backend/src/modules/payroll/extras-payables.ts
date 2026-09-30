// Pagamentos de extras dentro do Contas a Pagar (lista e PDF). Mesmo formato de
// linha da folha, com sourceType "EXTRA"; a categoria do DRE é só informativa
// aqui — o DRE lê o custo pela data de cada diária.
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";

export type FiltroPayables = {
  startToday: Date;
  status: string | null;
  startDate: Date | null;
  endDate: Date | null;
  noDueDate: boolean;
};

// O Contas a Pagar monta as datas no fuso do SERVIDOR: início à meia-noite e fim
// ora exclusivo (meia-noite do dia seguinte: "hoje", "vencidos", "7 dias"), ora
// 23:59:59.999 (período escolhido, PDF). O vencimento do extra é DATE puro.
// Converter para "AAAA-MM-DD" pelos campos locais — e o fim como o último dia
// incluído (fim − 1 ms) — dá o mesmo resultado nos dois casos e nos dois fusos.
// Antes, (fim)::date em UTC tirava o último dia do período (título sumia).
const diaLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function limitesDeData(f: Pick<FiltroPayables, "startToday" | "startDate" | "endDate">) {
  return {
    hoje: diaLocal(f.startToday),
    inicio: f.startDate ? diaLocal(f.startDate) : null,
    ultimoDia: f.endDate ? diaLocal(new Date(f.endDate.getTime() - 1)) : null,
  };
}

const nomePessoa = Prisma.sql`CASE WHEN ep."employeeId" IS NOT NULL THEN CONCAT(e."firstName", ' ', e."lastName") ELSE w."fullName" END`;
const qtdDiarias = Prisma.sql`(SELECT COUNT(*) FROM "ExtraShift" s WHERE s."paymentId" = ep."id" AND s."deletedAt" IS NULL)`;

function statusExpr(hoje: string) {
  return Prisma.sql`
    CASE
      WHEN ep."paymentDate" IS NOT NULL THEN 'PAID'
      WHEN ep."dueDate" < ${hoje}::date THEN 'OVERDUE'
      ELSE 'OPEN'
    END
  `;
}

function filtroWhere(f: FiltroPayables) {
  const { hoje, inicio, ultimoDia } = limitesDeData(f);
  const status = !f.status
    ? Prisma.sql`true`
    : f.status === "OPEN"
      ? Prisma.sql`ep."paymentDate" IS NULL AND ep."dueDate" >= ${hoje}::date`
      : f.status === "PAID" || f.status === "PAID_LATE"
        ? Prisma.sql`ep."paymentDate" IS NOT NULL`
        : f.status === "OVERDUE"
          ? Prisma.sql`ep."paymentDate" IS NULL AND ep."dueDate" < ${hoje}::date`
          : Prisma.sql`false`;
  // Pagamento de extra sempre tem vencimento: o filtro "sem vencimento" não o traz.
  if (f.noDueDate) return Prisma.sql`false`;
  const desde = inicio ? Prisma.sql`ep."dueDate" >= ${inicio}::date` : Prisma.sql`true`;
  const ate = ultimoDia ? Prisma.sql`ep."dueDate" <= ${ultimoDia}::date` : Prisma.sql`true`;
  return Prisma.sql`ep."status" != 'CANCELED' AND ${desde} AND ${ate} AND ${status}`;
}

export function extrasParaPayables(f: FiltroPayables) {
  return prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      ep."id",
      NULL::text AS "purchaseId",
      ep."dueDate",
      ep."paymentDate" AS "paidDate",
      ep."amount"::text AS "amount",
      ep."paidAmount"::text AS "paidAmount",
      NULL::int AS "installment",
      NULL::int AS "totalInstallments",
      NULL::text AS "paymentMethodId",
      NULL::text AS "paymentMethodName",
      ep."paidPaymentMethodId",
      COALESCE(ep."paidPaymentMethodName", ppm."name") AS "paidPaymentMethodName",
      COALESCE(ep."paymentNotes", ep."notes") AS "paymentNotes",
      'EXTRA' AS "sourceType",
      ${statusExpr(limitesDeData(f).hoje)} AS "status",
      NULL::text AS "rawValue",
      NULL::text AS "supplierId",
      ${nomePessoa} AS "supplierName",
      NULL::text AS "purchaseNumber",
      NULL::text AS "invoiceNumber",
      NULL::timestamp AS "purchaseDate",
      CONCAT('Diária extra · ', ep."code", ' · ', ${qtdDiarias}, ' diária(s)') AS "notes",
      'Diária extra' AS "taxDocumentType",
      CONCAT(ep."code", ' · ', ${qtdDiarias}, ' diária(s)') AS "taxDescription",
      ${nomePessoa} AS "taxCompanyName",
      NULL::text AS "taxCnpj",
      (SELECT MIN(s."date") FROM "ExtraShift" s WHERE s."paymentId" = ep."id" AND s."deletedAt" IS NULL) AS "taxCompetenceDate",
      'Extras / Diárias' AS "taxDreCategoryName"
    FROM "ExtraPayment" ep
    LEFT JOIN "Employee" e ON e."id" = ep."employeeId"
    LEFT JOIN "ExtraWorker" w ON w."id" = ep."extraWorkerId"
    LEFT JOIN "PaymentMethod" ppm ON ppm."id" = ep."paidPaymentMethodId"
    WHERE ${filtroWhere(f)}
    ORDER BY ep."dueDate"
    LIMIT 400
  `;
}

export function extrasParaPayablesPdf(f: FiltroPayables) {
  return prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      ep."dueDate",
      ep."paymentDate" AS "paidDate",
      ep."amount"::text AS "amount",
      ep."paidAmount"::text AS "paidAmount",
      NULL::int AS "installment",
      NULL::int AS "totalInstallments",
      COALESCE(ep."paidPaymentMethodName", ppm."name") AS "paymentMethodName",
      COALESCE(ep."paymentNotes", ep."notes") AS "paymentNotes",
      ${statusExpr(limitesDeData(f).hoje)} AS "status",
      CONCAT('Extra — ', ${nomePessoa}) AS "supplierName",
      NULL::text AS "purchaseNumber",
      NULL::text AS "invoiceNumber",
      NULL::timestamp AS "purchaseDate",
      CONCAT(ep."code", ' · ', ${qtdDiarias}, ' diária(s)') AS "notes"
    FROM "ExtraPayment" ep
    LEFT JOIN "Employee" e ON e."id" = ep."employeeId"
    LEFT JOIN "ExtraWorker" w ON w."id" = ep."extraWorkerId"
    LEFT JOIN "PaymentMethod" ppm ON ppm."id" = ep."paidPaymentMethodId"
    WHERE ${filtroWhere(f)}
    LIMIT 1000
  `;
}
