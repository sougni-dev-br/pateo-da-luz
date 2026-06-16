import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../config/database.js";
import type { ModulePermission, PermissionAction } from "./menu-permissions.js";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "GESTAO_COMPLETA" | "ESTOQUISTA" | "VISUALIZACAO";
  mustChangePassword?: boolean;
};

export type UserRole = SessionUser["role"];

const JWT_EXPIRES_IN_SECONDS = 60 * 60 * 12;
export const INACTIVITY_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 horas

function hasPermission(permission: ModulePermission | undefined, action: PermissionAction) {
  if (!permission) return false;
  return action === "view" ? Boolean(permission.view) : Boolean(permission.admin || permission[action]);
}

function jwtSecret() {
  const secret = process.env.JWT_SECRET ?? process.env.SESSION_SECRET;
  if (!secret || secret.trim().length < 16) {
    throw new Error("JWT_SECRET deve ser configurado com pelo menos 16 caracteres.");
  }
  return secret;
}

export function sessionExpiresAt() {
  return new Date(Date.now() + JWT_EXPIRES_IN_SECONDS * 1000);
}

export function hashLegacyPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function hashPassword(password: string) {
  return bcrypt.hashSync(password, 12);
}

function verifyLegacyPassword(password: string, storedHash: string) {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, "hex"));
}

export function verifyPassword(password: string, storedHash: string) {
  if (storedHash.startsWith("$2a$") || storedHash.startsWith("$2b$") || storedHash.startsWith("$2y$")) {
    return bcrypt.compareSync(password, storedHash);
  }
  return verifyLegacyPassword(password, storedHash);
}

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createToken(user: Pick<SessionUser, "id" | "email" | "role">) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role
    },
    jwtSecret(),
    {
      expiresIn: JWT_EXPIRES_IN_SECONDS,
      issuer: "cmv-loja",
      audience: "cmv-loja-web"
    }
  );
}

function verifySessionToken(token: string) {
  try {
    const payload = jwt.verify(token, jwtSecret(), {
      issuer: "cmv-loja",
      audience: "cmv-loja-web"
    });
    return typeof payload === "object" && payload.sub ? String(payload.sub) : null;
  } catch {
    return null;
  }
}

export function requestIp(request: { ip?: string; socket?: { remoteAddress?: string }; headers: Record<string, unknown> }) {
  return String(request.headers["x-forwarded-for"] ?? request.ip ?? request.socket?.remoteAddress ?? "").split(",")[0].trim();
}

export async function auditLog(input: {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  await prisma.$executeRaw`
    INSERT INTO "AuditLog" (
      "id",
      "userId",
      "action",
      "entity",
      "entityId",
      "ipAddress",
      "userAgent",
      "previousValue",
      "newValue"
    )
    VALUES (
      ${crypto.randomUUID()},
      ${input.userId ?? null},
      ${input.action},
      ${input.entity},
      ${input.entityId ?? null},
      ${input.ipAddress ?? null},
      ${input.userAgent ?? null},
      CAST(${JSON.stringify(input.previousValue ?? null)} AS jsonb),
      CAST(${JSON.stringify(input.newValue ?? null)} AS jsonb)
    )
  `;
}

export async function requireAdmin(request: {
  headers: Record<string, unknown>;
  menuAccess?: { action?: PermissionAction; permission?: ModulePermission };
}, response: { status: (code: number) => { json: (body: unknown) => void } }) {
  const user = await getSessionUser(request);
  if (!user) {
    response.status(401).json({ message: "Sessao obrigatoria." });
    return null;
  }

  if (user.role !== "ADMIN" && (!request.menuAccess?.action || !hasPermission(request.menuAccess.permission, request.menuAccess.action))) {
    response.status(403).json({ message: "Usuario sem permissao administrativa para esta acao." });
    return null;
  }

  return user;
}

export async function requireRole(
  request: { headers: Record<string, unknown>; menuAccess?: { action?: PermissionAction; permission?: ModulePermission } },
  response: { status: (code: number) => { json: (body: unknown) => void } },
  allowedRoles: UserRole[],
  message = "Perfil sem permissao para acessar este recurso."
) {
  const user = await getSessionUser(request);
  if (!user) {
    response.status(401).json({ message: "Sessao obrigatoria." });
    return null;
  }

  if (
    !allowedRoles.includes(user.role as UserRole)
    && user.role !== "ADMIN"
    && (!request.menuAccess?.action || !hasPermission(request.menuAccess.permission, request.menuAccess.action))
  ) {
    response.status(403).json({ message });
    return null;
  }

  return user as SessionUser;
}

export async function getSessionUser(request: { headers: Record<string, unknown> }) {
  const authorization = String(request.headers.authorization ?? "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  if (!token) return null;
  const looksLikeJwt = token.split(".").length === 3;
  const userId = looksLikeJwt ? verifySessionToken(token) : null;
  if (looksLikeJwt && !userId) return null;
  if (!looksLikeJwt && !/^[a-f0-9]{64}$/i.test(token)) return null;

  const tokenHash = hashToken(token);
  const [row] = await prisma.$queryRaw<Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    mustChangePassword: boolean;
    lastActivityAt: Date | null;
    sessionCreatedAt: Date;
  }>>`
    SELECT u."id", u."name", u."email", u."role"::text AS "role", u."mustChangePassword",
           s."lastActivityAt", s."createdAt" AS "sessionCreatedAt"
    FROM "UserSession" s
    JOIN "User" u ON u."id" = s."userId"
    WHERE s."tokenHash" = ${tokenHash}
      AND s."expiresAt" > CURRENT_TIMESTAMP
      AND u."isActive" = true
      AND (${userId} IS NULL OR u."id" = ${userId})
    LIMIT 1
  `;

  if (!row) return null;

  // Verificar expiração por inatividade
  const lastActivity = row.lastActivityAt
    ? new Date(row.lastActivityAt).getTime()
    : new Date(row.sessionCreatedAt).getTime();

  if (Date.now() - lastActivity > INACTIVITY_TIMEOUT_MS) {
    prisma.$executeRaw`DELETE FROM "UserSession" WHERE "tokenHash" = ${tokenHash}`.catch(() => undefined);
    auditLog({
      userId: row.id,
      action: "SESSION_EXPIRED_BY_INACTIVITY",
      entity: "UserSession",
      entityId: row.id,
      newValue: { lastActivityAt: row.lastActivityAt, sessionCreatedAt: row.sessionCreatedAt }
    }).catch(() => undefined);
    return null;
  }

  // Atualizar lastActivityAt de forma lazy — no máximo uma vez a cada 5 minutos
  if (Date.now() - lastActivity > 5 * 60 * 1000) {
    prisma.$executeRaw`
      UPDATE "UserSession" SET "lastActivityAt" = CURRENT_TIMESTAMP WHERE "tokenHash" = ${tokenHash}
    `.catch(() => undefined);
  }

  const { lastActivityAt: _last, sessionCreatedAt: _created, ...user } = row;
  return user;
}
