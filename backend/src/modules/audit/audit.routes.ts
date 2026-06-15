import { Prisma } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../../config/database.js";
import { requireAdmin } from "../security/security-utils.js";

export const auditRouter = Router();

function asText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

auditRouter.get("/", async (request, response) => {
  const admin = await requireAdmin(request, response);
  if (!admin) return;

  const userId = asText(request.query.userId);
  const entity = asText(request.query.entity);
  const startDate = asText(request.query.startDate);
  const endDate = asText(request.query.endDate);

  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT a.*, u."name" AS "userName", u."email" AS "userEmail"
    FROM "AuditLog" a
    LEFT JOIN "User" u ON u."id" = a."userId"
    WHERE ${userId ? Prisma.sql`a."userId" = ${userId}` : Prisma.sql`true`}
      AND ${entity ? Prisma.sql`a."entity" = ${entity}` : Prisma.sql`true`}
      AND ${startDate ? Prisma.sql`a."createdAt" >= ${new Date(startDate)}` : Prisma.sql`true`}
      AND ${endDate ? Prisma.sql`a."createdAt" <= ${new Date(endDate)}` : Prisma.sql`true`}
    ORDER BY a."createdAt" DESC
    LIMIT 300
  `;

  response.json(rows);
});
