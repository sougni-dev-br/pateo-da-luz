import crypto from "node:crypto";
import { Router } from "express";
import { prisma } from "../../config/database.js";
import { INACTIVITY_TIMEOUT_MS, auditLog, createToken, getSessionUser, hashPassword, hashToken, requestIp, requireAdmin, sessionExpiresAt, verifyPassword, type SessionUser } from "./security-utils.js";
import {
  accessLevels,
  attachMenuPermissions,
  getEffectiveMenuPermissions,
  getEffectiveModulePermissions,
  getRoleModulePermissions,
  getRoleMenuPermissions,
  getUserMenuOverrides,
  getUserModuleOverrides,
  hasModulePermission,
  isMenuId,
  menuCatalog,
  normalizePermission,
  permissionActions,
  permissionToAccessLevel,
  replaceRoleModulePermissions,
  replaceRoleMenuPermissions,
  replaceUserModulePermissions,
  replaceUserMenuPermissions,
  userHasPermission,
  type MenuAccessLevel,
  type MenuId,
  type ModulePermission,
  type ModulePermissionMap
} from "./menu-permissions.js";

export const authRouter = Router();
export const userRouter = Router();

type UserRow = SessionUser & {
  passwordHash: string;
  isActive: boolean;
  mustChangePassword: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
};

const allowedRoles = ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA", "VISUALIZACAO"] as const;

function asText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function validatePasswordPolicy(password: string) {
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new Error("A senha deve ter no minimo 8 caracteres, uma letra e um numero.");
  }
}

function parsePermissions(value: unknown) {
  const input = (value ?? {}) as Record<string, unknown>;
  const permissions: Partial<Record<MenuId, ModulePermission>> = {};
  for (const menu of menuCatalog) {
    const current = input[menu.id];
    if (typeof current === "string") {
      const level = accessLevels.includes(current as MenuAccessLevel) ? current as MenuAccessLevel : "NONE";
      permissions[menu.id] = normalizePermission({
        view: level === "VIEW" || level === "FULL",
        create: level === "FULL",
        edit: level === "FULL",
        delete: level === "FULL",
        approve: level === "FULL",
        admin: level === "FULL"
      });
      continue;
    }

    permissions[menu.id] = normalizePermission(current as Partial<ModulePermission>);
  }
  return permissions;
}

function diffPermissions(previous: Partial<Record<MenuId, ModulePermission>>, next: Partial<Record<MenuId, ModulePermission>>) {
  const added: string[] = [];
  const removed: string[] = [];

  for (const menu of menuCatalog) {
    const before = normalizePermission(previous[menu.id]);
    const after = normalizePermission(next[menu.id]);
    for (const action of permissionActions) {
      if (!before[action] && after[action]) added.push(`${menu.id}:${action}`);
      if (before[action] && !after[action]) removed.push(`${menu.id}:${action}`);
    }
  }

  return { added, removed };
}

async function requireUsersAdmin(request: Parameters<typeof getSessionUser>[0], response: { status: (code: number) => { json: (body: unknown) => void } }) {
  const user = await getSessionUser(request);
  if (!user) {
    response.status(401).json({ message: "Sessao obrigatoria." });
    return null;
  }

  if (user.role === "ADMIN" || await userHasPermission(user as SessionUser, "users", "admin")) {
    return user as SessionUser;
  }

  response.status(403).json({ message: "Usuario sem permissao para administrar usuarios." });
  return null;
}

async function requireUsersView(request: Parameters<typeof getSessionUser>[0], response: { status: (code: number) => { json: (body: unknown) => void } }) {
  const user = await getSessionUser(request);
  if (!user) {
    response.status(401).json({ message: "Sessao obrigatoria." });
    return null;
  }

  if (user.role === "ADMIN" || await userHasPermission(user as SessionUser, "users", "view")) {
    return user as SessionUser;
  }

  response.status(403).json({ message: "Usuario sem permissao para visualizar usuarios." });
  return null;
}

async function assertUserAdministrationTarget(actor: SessionUser, targetUserId: string, response: { status: (code: number) => { json: (body: unknown) => void } }) {
  const [target] = await prisma.$queryRaw<Array<{ id: string; role: SessionUser["role"] }>>`
    SELECT "id", "role"::text AS "role"
    FROM "User"
    WHERE "id" = ${targetUserId}
  `;

  if (!target) {
    response.status(404).json({ message: "Usuario nao encontrado." });
    return null;
  }

  if (actor.role !== "ADMIN" && target.role === "ADMIN") {
    response.status(403).json({ message: "Somente o Admin Geral pode alterar outro usuario ADMIN." });
    return null;
  }

  return target;
}

async function assertDelegablePermissions(actor: SessionUser, permissions: Partial<Record<MenuId, ModulePermission>>, response: { status: (code: number) => { json: (body: unknown) => void } }) {
  if (actor.role === "ADMIN") return true;

  const actorPermissions = await getEffectiveModulePermissions(actor);
  for (const menu of menuCatalog) {
    const requested = normalizePermission(permissions[menu.id]);
    for (const action of permissionActions) {
      if (requested[action] && !hasModulePermission(actorPermissions[menu.id], action)) {
        response.status(403).json({
          message: `Voce nao pode delegar ${menu.label} / ${action} porque nao possui essa permissao.`
        });
        return false;
      }
    }
  }

  return true;
}

authRouter.post("/login", async (request, response) => {
  const email = asText(request.body.email)?.toLowerCase();
  const password = String(request.body.password ?? "");

  if (!email || !password) {
    response.status(400).json({ message: "Email e senha sao obrigatorios." });
    return;
  }

  const [user] = await prisma.$queryRaw<UserRow[]>`
    SELECT
      "id",
      "name",
      "email",
      "passwordHash",
      "role"::text AS "role",
      "isActive",
      "mustChangePassword",
      "failedLoginAttempts",
      "lockedUntil"
    FROM "User"
    WHERE lower("email") = ${email}
    LIMIT 1
  `;

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    await auditLog({
      userId: user.id,
      action: "LOGIN_BLOCKED",
      entity: "User",
      entityId: user.id,
      newValue: { email, lockedUntil: user.lockedUntil },
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "")
    });
    response.status(423).json({ message: "Usuario bloqueado temporariamente. Tente novamente mais tarde." });
    return;
  }

  if (!user) {
    await auditLog({
      userId: null,
      action: "LOGIN_INVALID",
      entity: "Auth",
      entityId: null,
      newValue: { email, reason: "user_not_found" },
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "")
    });
    response.status(401).json({ message: "Credenciais invalidas." });
    return;
  }

  if (!user.isActive) {
    await auditLog({
      userId: user.id,
      action: "LOGIN_INVALID",
      entity: "Auth",
      entityId: user.id,
      newValue: { email, reason: "user_inactive" },
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "")
    });
    response.status(401).json({ message: "Credenciais invalidas." });
    return;
  }

  if (!verifyPassword(password, user.passwordHash)) {
    const attempts = Number(user.failedLoginAttempts ?? 0) + 1;
    const lockedUntil = attempts >= 5 ? new Date(Date.now() + 1000 * 60 * 15) : null;
    await prisma.$executeRaw`
      UPDATE "User"
      SET "failedLoginAttempts" = ${attempts},
          "lockedUntil" = ${lockedUntil}
      WHERE "id" = ${user.id}
    `;
    await auditLog({
      userId: user.id,
      action: "LOGIN_INVALID",
      entity: "Auth",
      entityId: user.id,
      newValue: { email, reason: "invalid_password" },
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "")
    });
    response.status(401).json({ message: "Credenciais invalidas." });
    return;
  }

  // Verificar se já existe sessão ativa para este usuário
  const [existingSession] = await prisma.$queryRaw<Array<{
    id: string;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: Date;
    lastActivityAt: Date | null;
  }>>`
    SELECT "id", "ipAddress", "userAgent", "createdAt", "lastActivityAt"
    FROM "UserSession"
    WHERE "userId" = ${user.id}
      AND "expiresAt" > CURRENT_TIMESTAMP
    ORDER BY "createdAt" DESC
    LIMIT 1
  `;

  const force = Boolean(request.body.force);

  if (existingSession) {
    // Checar se a sessão existente está expirada por inatividade
    const lastActivity = existingSession.lastActivityAt
      ? new Date(existingSession.lastActivityAt).getTime()
      : new Date(existingSession.createdAt).getTime();
    const isStale = Date.now() - lastActivity > INACTIVITY_TIMEOUT_MS;

    if (isStale) {
      // Sessão expirada por inatividade: encerrar e liberar novo login automaticamente
      await prisma.$executeRaw`DELETE FROM "UserSession" WHERE "id" = ${existingSession.id}`;
      await auditLog({
        userId: user.id,
        action: "LOGIN_AFTER_INACTIVITY_EXPIRY",
        entity: "UserSession",
        entityId: user.id,
        newValue: {
          staleSessionIp: existingSession.ipAddress,
          lastActivityAt: existingSession.lastActivityAt,
          newLoginIp: requestIp(request)
        },
        ipAddress: requestIp(request),
        userAgent: String(request.headers["user-agent"] ?? "")
      });
    } else if (user.role !== "ADMIN" || !force) {
      // Sessão ativa e válida: bloquear novo login
      await auditLog({
        userId: user.id,
        action: "LOGIN_BLOCKED_SESSION_CONFLICT",
        entity: "Auth",
        entityId: user.id,
        newValue: {
          existingSessionIp: existingSession.ipAddress,
          existingSessionUserAgent: existingSession.userAgent,
          blockedIp: requestIp(request),
          blockedUserAgent: String(request.headers["user-agent"] ?? "")
        },
        ipAddress: requestIp(request),
        userAgent: String(request.headers["user-agent"] ?? "")
      });
      response.status(409).json({
        message: "Este usuario ja esta conectado em outro dispositivo. Peca para sair no outro aparelho ou solicite ao administrador para encerrar a sessao.",
        code: "SESSION_CONFLICT",
        canForce: user.role === "ADMIN"
      });
      return;
    } else {
      // ADMIN com force=true: encerrar sessão anterior deliberadamente
      await prisma.$executeRaw`DELETE FROM "UserSession" WHERE "userId" = ${user.id}`;
      await auditLog({
        userId: user.id,
        action: "SESSION_FORCE_REPLACED",
        entity: "UserSession",
        entityId: user.id,
        newValue: {
          replacedSessionIp: existingSession.ipAddress,
          newIp: requestIp(request),
          newUserAgent: String(request.headers["user-agent"] ?? "")
        },
        ipAddress: requestIp(request),
        userAgent: String(request.headers["user-agent"] ?? "")
      });
    }
  }

  let token: string;
  try {
    token = createToken(user);
  } catch (error) {
    await auditLog({
      userId: user.id,
      action: "LOGIN_SESSION_CONFIGURATION_ERROR",
      entity: "Auth",
      entityId: user.id,
      newValue: { message: error instanceof Error ? error.message : "jwt_config_error" },
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "")
    }).catch(() => undefined);
    response.status(500).json({ message: "Configuracao de sessao invalida. Informe o administrador do sistema." });
    return;
  }
  const expiresAt = sessionExpiresAt();
  await prisma.$executeRaw`
    INSERT INTO "UserSession" ("id", "userId", "tokenHash", "ipAddress", "userAgent", "expiresAt")
    VALUES (
      ${crypto.randomUUID()},
      ${user.id},
      ${hashToken(token)},
      ${requestIp(request)},
      ${String(request.headers["user-agent"] ?? "")},
      ${expiresAt}
    )
  `;
  await prisma.$executeRaw`
    UPDATE "User"
    SET "lastLoginAt" = CURRENT_TIMESTAMP,
        "failedLoginAttempts" = 0,
        "lockedUntil" = NULL
    WHERE "id" = ${user.id}
  `;
  await auditLog({
    userId: user.id,
    action: "LOGIN",
    entity: "User",
    entityId: user.id,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.json({
    token,
    user: await attachMenuPermissions({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      mustChangePassword: user.mustChangePassword
    })
  });
});

// ADMIN: listar todas as sessões ativas
authRouter.get("/sessions", async (request, response) => {
  const admin = await requireAdmin(request, response);
  if (!admin) return;

  const sessions = await prisma.$queryRaw<Array<{
    sessionId: string;
    userId: string;
    userName: string;
    userEmail: string;
    userRole: string;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: Date;
    expiresAt: Date;
    lastActivityAt: Date | null;
  }>>`
    SELECT
      s."id"             AS "sessionId",
      s."userId",
      u."name"           AS "userName",
      u."email"          AS "userEmail",
      u."role"::text     AS "userRole",
      s."ipAddress",
      s."userAgent",
      s."createdAt",
      s."expiresAt",
      s."lastActivityAt"
    FROM "UserSession" s
    JOIN "User" u ON u."id" = s."userId"
    WHERE s."expiresAt" > CURRENT_TIMESTAMP
    ORDER BY s."createdAt" DESC
  `;

  response.json(sessions);
});

authRouter.post("/logout", async (request, response) => {
  const authorization = String(request.headers.authorization ?? "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";

  if (token) {
    const tokenHash = hashToken(token);
    const [session] = await prisma.$queryRaw<Array<{ userId: string }>>`
      SELECT "userId" FROM "UserSession" WHERE "tokenHash" = ${tokenHash} LIMIT 1
    `;
    if (session) {
      await prisma.$executeRaw`DELETE FROM "UserSession" WHERE "tokenHash" = ${tokenHash}`;
      await auditLog({
        userId: session.userId,
        action: "LOGOUT",
        entity: "Auth",
        entityId: session.userId,
        ipAddress: requestIp(request),
        userAgent: String(request.headers["user-agent"] ?? "")
      });
    }
  }

  response.json({ ok: true });
});

// ADMIN: encerrar sessão ativa de outro usuário
authRouter.delete("/sessions/:userId", async (request, response) => {
  const admin = await requireAdmin(request, response);
  if (!admin) return;

  const targetUserId = request.params.userId;
  const [target] = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
    SELECT "id", "name" FROM "User" WHERE "id" = ${targetUserId} LIMIT 1
  `;
  if (!target) {
    response.status(404).json({ message: "Usuario nao encontrado." });
    return;
  }

  await prisma.$executeRaw`DELETE FROM "UserSession" WHERE "userId" = ${targetUserId}`;
  await auditLog({
    userId: admin.id,
    action: "KILL_USER_SESSIONS",
    entity: "UserSession",
    entityId: targetUserId,
    newValue: { targetUserId, targetName: target.name },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });

  response.json({ ok: true });
});

// GET /auth/menu-favorites — favoritos do usuário autenticado
authRouter.get("/menu-favorites", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) {
    response.status(401).json({ message: "Sessao obrigatoria." });
    return;
  }

  const favorites = await prisma.$queryRaw<Array<{ menuKey: string; sortOrder: number }>>`
    SELECT "menuKey", "sortOrder"
    FROM "UserMenuFavorite"
    WHERE "userId" = ${user.id}
    ORDER BY "sortOrder" ASC, "createdAt" ASC
  `;

  response.json(favorites.map((f) => f.menuKey));
});

// POST /auth/menu-favorites/:menuKey — adicionar favorito
authRouter.post("/menu-favorites/:menuKey", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) {
    response.status(401).json({ message: "Sessao obrigatoria." });
    return;
  }

  const menuKey = request.params.menuKey;
  if (!isMenuId(menuKey)) {
    response.status(400).json({ message: "Menu invalido." });
    return;
  }

  const permissions = await getEffectiveModulePermissions(user as SessionUser);
  if (!hasModulePermission(permissions[menuKey], "view")) {
    response.status(403).json({ message: "Sem acesso a este menu." });
    return;
  }

  const [maxRow] = await prisma.$queryRaw<Array<{ maxOrder: number | null }>>`
    SELECT MAX("sortOrder") AS "maxOrder" FROM "UserMenuFavorite" WHERE "userId" = ${user.id}
  `;
  const nextOrder = (Number(maxRow?.maxOrder ?? -1)) + 1;

  await prisma.$executeRaw`
    INSERT INTO "UserMenuFavorite" ("id", "userId", "menuKey", "sortOrder", "updatedAt")
    VALUES (${crypto.randomUUID()}, ${user.id}, ${menuKey}, ${nextOrder}, CURRENT_TIMESTAMP)
    ON CONFLICT ("userId", "menuKey") DO NOTHING
  `;

  response.json({ ok: true });
});

// DELETE /auth/menu-favorites/:menuKey — remover favorito
authRouter.delete("/menu-favorites/:menuKey", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) {
    response.status(401).json({ message: "Sessao obrigatoria." });
    return;
  }

  await prisma.$executeRaw`
    DELETE FROM "UserMenuFavorite"
    WHERE "userId" = ${user.id} AND "menuKey" = ${request.params.menuKey}
  `;

  response.json({ ok: true });
});

// PATCH /auth/menu-favorites/order — reordenar favoritos
authRouter.patch("/menu-favorites/order", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) {
    response.status(401).json({ message: "Sessao obrigatoria." });
    return;
  }

  const menuKeys = request.body.menuKeys;
  if (!Array.isArray(menuKeys)) {
    response.status(400).json({ message: "menuKeys deve ser um array." });
    return;
  }

  for (let i = 0; i < menuKeys.length; i++) {
    const key = String(menuKeys[i] ?? "");
    if (key) {
      await prisma.$executeRaw`
        UPDATE "UserMenuFavorite"
        SET "sortOrder" = ${i}, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "userId" = ${user.id} AND "menuKey" = ${key}
      `;
    }
  }

  response.json({ ok: true });
});

authRouter.get("/me", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) {
    response.status(401).json({ message: "Sessao invalida." });
    return;
  }
  response.json(await attachMenuPermissions(user as SessionUser));
});

userRouter.get("/", async (request, response) => {
  const viewer = await requireUsersView(request, response);
  if (!viewer) return;

  const users = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      "id",
      "name",
      "email",
      "role"::text AS "role",
      "isActive",
      "mustChangePassword",
      "passwordChangedAt",
      "failedLoginAttempts",
      "lockedUntil",
      "lastLoginAt",
      "createdAt",
      "updatedAt"
    FROM "User"
    ORDER BY "name"
  `;
  const usersWithPermissions = await Promise.all(users.map(async (user) => ({
    ...user,
    menuPermissions: await getEffectiveMenuPermissions({
      id: String(user.id),
      role: user.role as SessionUser["role"]
    }),
    modulePermissions: await getEffectiveModulePermissions({
      id: String(user.id),
      role: user.role as SessionUser["role"]
    }),
    menuPermissionOverrides: await getUserMenuOverrides(String(user.id)),
    modulePermissionOverrides: await getUserModuleOverrides(String(user.id))
  })));
  response.json(usersWithPermissions);
});

userRouter.get("/menu-permissions", async (request, response) => {
  const viewer = await requireUsersView(request, response);
  if (!viewer) return;

  const roles = ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA", "VISUALIZACAO"] as const;
  const rolePermissions = Object.fromEntries(await Promise.all(roles.map(async (role) => [role, await getRoleMenuPermissions(role)])));
  const roleModulePermissions = Object.fromEntries(await Promise.all(roles.map(async (role) => [role, await getRoleModulePermissions(role)])));
  response.json({ menus: menuCatalog, accessLevels, actions: permissionActions, rolePermissions, roleModulePermissions });
});

userRouter.post("/", async (request, response) => {
  const admin = await requireUsersAdmin(request, response);
  if (!admin) return;

  const name = asText(request.body.name);
  const email = asText(request.body.email)?.toLowerCase();
  const password = String(request.body.password ?? "");
  const role = asText(request.body.role) ?? "VISUALIZACAO";

  if (!name || !email || !password) {
    response.status(400).json({ message: "Nome, email e senha sao obrigatorios." });
    return;
  }
  if (!(allowedRoles as readonly string[]).includes(role)) {
    response.status(400).json({ message: "Perfil de usuario invalido." });
    return;
  }
  if (admin.role !== "ADMIN" && role === "ADMIN") {
    response.status(403).json({ message: "Somente o Admin Geral pode criar outro usuario ADMIN." });
    return;
  }
  try {
    validatePasswordPolicy(password);
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Senha invalida." });
    return;
  }

  const id = crypto.randomUUID();
  try {
    await prisma.$executeRaw`
      INSERT INTO "User" ("id", "name", "email", "passwordHash", "role", "passwordChangedAt", "isActive", "updatedAt")
      VALUES (${id}, ${name}, ${email}, ${hashPassword(password)}, CAST(${role} AS "UserRole"), CURRENT_TIMESTAMP, ${request.body.isActive ?? true}, CURRENT_TIMESTAMP)
    `;
  } catch (error) {
    await auditLog({
      userId: admin.id,
      action: "CREATE_USER_FAILED",
      entity: "User",
      newValue: { name, email, role, message: error instanceof Error ? error.message : "unknown" },
      ipAddress: requestIp(request),
      userAgent: String(request.headers["user-agent"] ?? "")
    }).catch(() => undefined);
    const message = error instanceof Error && error.message.includes("unique")
      ? "Ja existe usuario cadastrado com este email."
      : "Nao foi possivel criar o usuario. Verifique os dados informados.";
    response.status(400).json({ message });
    return;
  }
  await auditLog({
    userId: admin.id,
    action: "CREATE_USER",
    entity: "User",
    entityId: id,
    newValue: { name, email, role },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });
  response.status(201).json(await attachMenuPermissions({ id, name, email, role: role as SessionUser["role"], isActive: true } as SessionUser & { isActive: boolean }));
});

userRouter.patch("/:id/status", async (request, response) => {
  const admin = await requireUsersAdmin(request, response);
  if (!admin) return;

  const isActive = Boolean(request.body.isActive);
  const [previous] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT "id", "name", "email", "role"::text AS "role", "isActive" FROM "User" WHERE "id" = ${request.params.id}
  `;
  if (!previous) {
    response.status(404).json({ message: "Usuario nao encontrado." });
    return;
  }
  if (admin.role !== "ADMIN" && previous.role === "ADMIN") {
    response.status(403).json({ message: "Somente o Admin Geral pode alterar um usuario ADMIN." });
    return;
  }
  if (!isActive && previous.role === "ADMIN") {
    const [activeAdminCount] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "User"
      WHERE "role" = 'ADMIN'
        AND "isActive" = true
        AND "id" <> ${request.params.id}
    `;
    if (Number(activeAdminCount?.count ?? 0) === 0) {
      response.status(400).json({ message: "Nao e permitido inativar o unico Administrador ativo." });
      return;
    }
  }
  await prisma.$executeRaw`
    UPDATE "User" SET "isActive" = ${isActive}, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${request.params.id}
  `;
  await auditLog({
    action: isActive ? "REACTIVATE" : "INACTIVATE",
    entity: "User",
    entityId: request.params.id,
    previousValue: previous,
    newValue: { isActive },
    userId: admin.id,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });
  response.json({ id: request.params.id, isActive });
});

userRouter.put("/:id", async (request, response) => {
  const admin = await requireUsersAdmin(request, response);
  if (!admin) return;

  const name = asText(request.body.name);
  const email = asText(request.body.email)?.toLowerCase();
  const role = asText(request.body.role) ?? "VISUALIZACAO";
  const mustChangePassword = Boolean(request.body.mustChangePassword);
  const isActive = typeof request.body.isActive === "boolean" ? request.body.isActive : undefined;

  if (!name || !email) {
    response.status(400).json({ message: "Nome e email sao obrigatorios." });
    return;
  }
  if (!(allowedRoles as readonly string[]).includes(role)) {
    response.status(400).json({ message: "Perfil de usuario invalido." });
    return;
  }
  if (admin.role !== "ADMIN" && role === "ADMIN") {
    response.status(403).json({ message: "Somente o Admin Geral pode promover usuarios para ADMIN." });
    return;
  }
  const [previous] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT "id", "name", "email", "role"::text AS "role", "mustChangePassword" FROM "User" WHERE "id" = ${request.params.id}
  `;
  if (!previous) {
    response.status(404).json({ message: "Usuario nao encontrado." });
    return;
  }
  if (admin.role !== "ADMIN" && previous.role === "ADMIN") {
    response.status(403).json({ message: "Somente o Admin Geral pode alterar um usuario ADMIN." });
    return;
  }
  if (admin.role !== "ADMIN" && request.params.id === admin.id && role !== previous.role) {
    response.status(403).json({ message: "Voce nao pode alterar o proprio perfil base." });
    return;
  }
  if (email !== String(previous.email).toLowerCase()) {
    const [existingUser] = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "User"
      WHERE lower("email") = ${email}
        AND "id" <> ${request.params.id}
      LIMIT 1
    `;
    if (existingUser) {
      response.status(400).json({ message: "Ja existe usuario cadastrado com este email." });
      return;
    }
  }
  if (isActive === false && previous.role === "ADMIN") {
    const [activeAdminCount] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "User"
      WHERE "role" = 'ADMIN'
        AND "isActive" = true
        AND "id" <> ${request.params.id}
    `;
    if (Number(activeAdminCount?.count ?? 0) === 0) {
      response.status(400).json({ message: "Nao e permitido inativar o unico Administrador ativo." });
      return;
    }
  }

  await prisma.$executeRaw`
    UPDATE "User"
    SET "name" = ${name},
        "email" = ${email},
        "role" = CAST(${role} AS "UserRole"),
        "isActive" = COALESCE(${isActive}, "isActive"),
        "mustChangePassword" = ${mustChangePassword},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${request.params.id}
  `;
  await auditLog({
    userId: admin.id,
    action: "UPDATE_USER",
    entity: "User",
    entityId: request.params.id,
    previousValue: previous,
    newValue: { name, email, role, isActive, mustChangePassword },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });
  response.json({ id: request.params.id, name, email, role, isActive, mustChangePassword });
});

userRouter.put("/:id/menu-permissions", async (request, response) => {
  const admin = await requireUsersAdmin(request, response);
  if (!admin) return;

  const [target] = await prisma.$queryRaw<Array<{ id: string; name: string; email: string; role: SessionUser["role"] }>>`
    SELECT "id", "name", "email", "role"::text AS "role"
    FROM "User"
    WHERE "id" = ${request.params.id}
  `;
  if (!target) {
    response.status(404).json({ message: "Usuario nao encontrado." });
    return;
  }
  if (admin.role !== "ADMIN" && target.role === "ADMIN") {
    response.status(403).json({ message: "Somente o Admin Geral pode alterar permissoes de um usuario ADMIN." });
    return;
  }
  if (admin.role !== "ADMIN" && request.params.id === admin.id) {
    response.status(403).json({ message: "Voce nao pode alterar as proprias permissoes." });
    return;
  }

  const previous = await getUserModuleOverrides(request.params.id);
  const permissions = target.role === "ADMIN"
    ? Object.fromEntries(menuCatalog.map((menu) => [menu.id, normalizePermission({ admin: true })])) as Partial<Record<MenuId, ModulePermission>>
    : parsePermissions(request.body.permissions);
  if (!(await assertDelegablePermissions(admin, permissions, response))) return;
  await replaceUserModulePermissions(request.params.id, permissions);
  const effectivePermissions = await getEffectiveMenuPermissions(target);
  const effectiveModulePermissions = await getEffectiveModulePermissions(target);
  const changes = diffPermissions(previous, permissions);
  await auditLog({
    userId: admin.id,
    action: "UPDATE_USER_MENU_PERMISSIONS",
    entity: "UserMenuPermission",
    entityId: request.params.id,
    previousValue: previous,
    newValue: { userId: request.params.id, permissions, changes },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });
  response.json({
    id: request.params.id,
    menuPermissions: effectivePermissions,
    modulePermissions: effectiveModulePermissions,
    menuPermissionOverrides: await getUserMenuOverrides(request.params.id),
    modulePermissionOverrides: await getUserModuleOverrides(request.params.id)
  });
});

userRouter.put("/roles/:role/menu-permissions", async (request, response) => {
  const admin = await requireAdmin(request, response);
  if (!admin) return;

  const role = asText(request.params.role) as SessionUser["role"] | null;
  const allowedRoles = ["ADMIN", "GESTAO_COMPLETA", "ESTOQUISTA", "VISUALIZACAO"];
  if (!role || !allowedRoles.includes(role)) {
    response.status(400).json({ message: "Perfil de usuario invalido." });
    return;
  }

  const previous = await getRoleModulePermissions(role);
  const permissions = role === "ADMIN"
    ? Object.fromEntries(menuCatalog.map((menu) => [menu.id, normalizePermission({ admin: true })])) as Partial<Record<MenuId, ModulePermission>>
    : parsePermissions(request.body.permissions);
  await replaceRoleModulePermissions(role, permissions);
  const changes = diffPermissions(previous, permissions);
  await auditLog({
    userId: admin.id,
    action: "UPDATE_ROLE_MENU_PERMISSIONS",
    entity: "RoleMenuPermission",
    entityId: role,
    previousValue: previous,
    newValue: { role, permissions, changes },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });
  response.json({ role, menuPermissions: await getRoleMenuPermissions(role), modulePermissions: await getRoleModulePermissions(role) });
});

userRouter.patch("/:id/password", async (request, response) => {
  const admin = await requireUsersAdmin(request, response);
  if (!admin) return;
  const target = await assertUserAdministrationTarget(admin, request.params.id, response);
  if (!target) return;

  const password = String(request.body.password ?? "");
  const mustChangePassword = Boolean(request.body.mustChangePassword);
  try {
    validatePasswordPolicy(password);
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Senha invalida." });
    return;
  }

  await prisma.$executeRaw`
    UPDATE "User"
    SET "passwordHash" = ${hashPassword(password)},
        "mustChangePassword" = ${mustChangePassword},
        "passwordChangedAt" = CURRENT_TIMESTAMP,
        "failedLoginAttempts" = 0,
        "lockedUntil" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${request.params.id}
  `;
  await prisma.$executeRaw`DELETE FROM "UserSession" WHERE "userId" = ${request.params.id}`;
  await auditLog({
    userId: admin.id,
    action: mustChangePassword ? "APPLY_TEMPORARY_PASSWORD" : "RESET_PASSWORD",
    entity: "User",
    entityId: request.params.id,
    newValue: { mustChangePassword },
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });
  response.json({ id: request.params.id, mustChangePassword });
});

authRouter.post("/change-password", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) {
    response.status(401).json({ message: "Sessao invalida." });
    return;
  }

  const currentPassword = String(request.body.currentPassword ?? "");
  const newPassword = String(request.body.newPassword ?? "");
  try {
    validatePasswordPolicy(newPassword);
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Senha invalida." });
    return;
  }

  const [row] = await prisma.$queryRaw<Array<{ passwordHash: string }>>`
    SELECT "passwordHash" FROM "User" WHERE "id" = ${user.id}
  `;
  if (!row || !verifyPassword(currentPassword, row.passwordHash)) {
    response.status(400).json({ message: "Senha atual invalida." });
    return;
  }

  await prisma.$executeRaw`
    UPDATE "User"
    SET "passwordHash" = ${hashPassword(newPassword)},
        "mustChangePassword" = false,
        "passwordChangedAt" = CURRENT_TIMESTAMP,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${user.id}
  `;
  await auditLog({
    userId: user.id,
    action: "CHANGE_PASSWORD",
    entity: "User",
    entityId: user.id,
    ipAddress: requestIp(request),
    userAgent: String(request.headers["user-agent"] ?? "")
  });
  response.json({ ok: true });
});
