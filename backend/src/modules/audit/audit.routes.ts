import { Prisma } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../../config/database.js";
import { requireAdmin } from "../security/security-utils.js";

export const auditRouter = Router();

function asText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

// AuditLog.createdAt guarda hora real — os 8.369 eventos em produção têm hora
// diferente de 00:00. Com "createdAt <= new Date('2026-09-03')" o limite virava
// 2026-09-03T00:00:00Z e o dia 3 inteiro sumia do resultado: justamente o mais
// recente do intervalo, e numa tela cuja função é servir de rastro forense.
//
// Para data pura o limite passa a ser exclusivo no dia seguinte, que cobre o dia
// todo sem depender da precisão do timestamp. Se vier data com hora, respeitamos
// o instante enviado e seguimos inclusivos.
function limiteFinal(valor: string) {
  const base = new Date(valor);
  if (Number.isNaN(base.getTime())) return null;
  const apenasData = /^\d{4}-\d{2}-\d{2}$/.test(valor);
  return apenasData
    ? { valor: new Date(base.getTime() + 24 * 60 * 60 * 1000), exclusivo: true }
    : { valor: base, exclusivo: false };
}

function sqlAteData(fim: ReturnType<typeof limiteFinal>) {
  if (!fim) return Prisma.sql`true`;
  return fim.exclusivo
    ? Prisma.sql`a."createdAt" < ${fim.valor}`
    : Prisma.sql`a."createdAt" <= ${fim.valor}`;
}

auditRouter.get("/", async (request, response) => {
  const admin = await requireAdmin(request, response);
  if (!admin) return;

  const userId = asText(request.query.userId);
  const entity = asText(request.query.entity);
  const startDate = asText(request.query.startDate);
  const endDate = asText(request.query.endDate);
  const fimDoIntervalo = endDate ? limiteFinal(endDate) : null;
  const page = Math.max(1, Number(request.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(request.query.limit) || 50));
  const offset = (page - 1) * limit;

  const [rows, countResult] = await Promise.all([
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT a.*, u."name" AS "userName", u."email" AS "userEmail"
      FROM "AuditLog" a
      LEFT JOIN "User" u ON u."id" = a."userId"
      WHERE ${userId ? Prisma.sql`a."userId" = ${userId}` : Prisma.sql`true`}
        AND ${entity ? Prisma.sql`a."entity" = ${entity}` : Prisma.sql`true`}
        AND ${startDate ? Prisma.sql`a."createdAt" >= ${new Date(startDate)}` : Prisma.sql`true`}
        AND ${sqlAteData(fimDoIntervalo)}
      ORDER BY a."createdAt" DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*) AS total
      FROM "AuditLog" a
      WHERE ${userId ? Prisma.sql`a."userId" = ${userId}` : Prisma.sql`true`}
        AND ${entity ? Prisma.sql`a."entity" = ${entity}` : Prisma.sql`true`}
        AND ${startDate ? Prisma.sql`a."createdAt" >= ${new Date(startDate)}` : Prisma.sql`true`}
        AND ${sqlAteData(fimDoIntervalo)}
    `,
  ]);

  const total = Number(countResult[0]?.total ?? 0);

  response.json({
    data: rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});
