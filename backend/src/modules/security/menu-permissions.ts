import type { NextFunction, Request, Response } from "express";
import { prisma } from "../../config/database.js";
import { getSessionUser, type SessionUser, type UserRole } from "./security-utils.js";

export type PermissionAction = "view" | "create" | "edit" | "delete" | "approve" | "admin";
export type ModulePermission = Record<PermissionAction, boolean>;
export type ModulePermissionMap = Record<MenuId, ModulePermission>;
export type MenuAccessLevel = "NONE" | "VIEW" | "FULL";

export const permissionActions: PermissionAction[] = ["view", "create", "edit", "delete", "approve", "admin"];
export const accessLevels: MenuAccessLevel[] = ["NONE", "VIEW", "FULL"];

export const menuCatalog = [
  { id: "dashboard", label: "Dashboard", group: "Visao geral" },
  { id: "purchases", label: "Compras", group: "Operacao" },
  { id: "purchase-orders", label: "Pedidos de compra", group: "Operacao" },
  { id: "payables", label: "Financeiro / Contas a pagar", group: "Financeiro" },
  { id: "revenue", label: "Faturamento diario", group: "Financeiro" },
  { id: "cards", label: "Cartoes", group: "Financeiro" },
  { id: "cash", label: "Caixa", group: "Financeiro" },
  { id: "cmv-real", label: "CMV Real", group: "CMV" },
  { id: "monthly-closing", label: "Fechamento mensal", group: "CMV" },
  { id: "inventory", label: "Estoque", group: "Estoque" },
  { id: "products", label: "Produtos", group: "Estoque" },
  { id: "inventory-movements", label: "Movimentacoes", group: "Estoque" },
  { id: "inventory-counting", label: "Contagem", group: "Estoque" },
  { id: "inventory-official", label: "Inventario", group: "Estoque" },
  { id: "inventory-reports", label: "Relatorios", group: "Estoque" },
  { id: "suppliers", label: "Fornecedores", group: "Cadastros" },
  { id: "import", label: "Importacoes", group: "Dados" },
  { id: "catalog-imports", label: "Importar cadastros", group: "Dados" },
  { id: "payment-methods", label: "Metodos de pagamento", group: "Configuracoes" },
  { id: "master-data", label: "Pequenos gastos e cadastros base", group: "Configuracoes" },
  { id: "users", label: "Usuarios", group: "Configuracoes" },
  { id: "audit", label: "Auditoria", group: "Configuracoes" }
] as const;

export type MenuId = (typeof menuCatalog)[number]["id"];

type PermissionRow = {
  menuId: string;
  accessLevel?: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
  canAdmin: boolean;
};

export type PermissionRequestContext = {
  menuId: MenuId;
  action: PermissionAction;
};

const menuIds = new Set<string>(menuCatalog.map((menu) => menu.id));
const levelWeight: Record<MenuAccessLevel, number> = { NONE: 0, VIEW: 1, FULL: 2 };

function emptyPermission(): ModulePermission {
  return { view: false, create: false, edit: false, delete: false, approve: false, admin: false };
}

function fullPermission(): ModulePermission {
  return { view: true, create: true, edit: true, delete: true, approve: true, admin: true };
}

function normalizeLevel(value: unknown): MenuAccessLevel {
  return accessLevels.includes(value as MenuAccessLevel) ? value as MenuAccessLevel : "NONE";
}

export function normalizePermission(value: Partial<ModulePermission> | null | undefined): ModulePermission {
  const next: ModulePermission = {
    view: Boolean(value?.view),
    create: Boolean(value?.create),
    edit: Boolean(value?.edit),
    delete: Boolean(value?.delete),
    approve: Boolean(value?.approve),
    admin: Boolean(value?.admin)
  };

  if (next.admin) {
    return fullPermission();
  }

  if (next.create || next.edit || next.delete || next.approve) {
    next.view = true;
  }

  if (!next.view) {
    next.create = false;
    next.edit = false;
    next.delete = false;
    next.approve = false;
  }

  return next;
}

function permissionFromLevel(accessLevel: MenuAccessLevel): ModulePermission {
  if (accessLevel === "FULL") return fullPermission();
  if (accessLevel === "VIEW") return { ...emptyPermission(), view: true };
  return emptyPermission();
}

function permissionFromRow(row?: PermissionRow): ModulePermission {
  if (!row) return emptyPermission();
  const fromFlags = normalizePermission({
    view: row.canView,
    create: row.canCreate,
    edit: row.canEdit,
    delete: row.canDelete,
    approve: row.canApprove,
    admin: row.canAdmin
  });

  if (fromFlags.view || fromFlags.create || fromFlags.edit || fromFlags.delete || fromFlags.approve || fromFlags.admin) {
    return fromFlags;
  }

  return permissionFromLevel(normalizeLevel(row.accessLevel));
}

export function permissionToAccessLevel(permission: Partial<ModulePermission> | null | undefined): MenuAccessLevel {
  const normalized = normalizePermission(permission);
  if (normalized.admin || normalized.create || normalized.edit || normalized.delete || normalized.approve) return "FULL";
  if (normalized.view) return "VIEW";
  return "NONE";
}

export function isMenuId(value: string): value is MenuId {
  return menuIds.has(value);
}

export function hasModulePermission(permission: Partial<ModulePermission> | null | undefined, action: PermissionAction) {
  const normalized = normalizePermission(permission);
  return action === "view"
    ? normalized.view
    : normalized.admin || normalized[action];
}

export function canAccessLevel(current: MenuAccessLevel | undefined, required: MenuAccessLevel) {
  return levelWeight[current ?? "NONE"] >= levelWeight[required];
}

async function queryRolePermissionRows(role: UserRole) {
  return prisma.$queryRaw<PermissionRow[]>`
    SELECT
      "menuId",
      "accessLevel"::text AS "accessLevel",
      "canView",
      "canCreate",
      "canEdit",
      "canDelete",
      "canApprove",
      "canAdmin"
    FROM "RoleMenuPermission"
    WHERE "role" = CAST(${role} AS "UserRole")
  `;
}

async function queryUserPermissionRows(userId: string) {
  return prisma.$queryRaw<PermissionRow[]>`
    SELECT
      "menuId",
      "accessLevel"::text AS "accessLevel",
      "canView",
      "canCreate",
      "canEdit",
      "canDelete",
      "canApprove",
      "canAdmin"
    FROM "UserMenuPermission"
    WHERE "userId" = ${userId}
  `;
}

export async function getRoleModulePermissions(role: UserRole) {
  const rows = await queryRolePermissionRows(role);
  return Object.fromEntries(menuCatalog.map((menu) => {
    const row = rows.find((item) => item.menuId === menu.id);
    return [menu.id, permissionFromRow(row)];
  })) as ModulePermissionMap;
}

export async function getRoleMenuPermissions(role: UserRole) {
  const permissions = await getRoleModulePermissions(role);
  return Object.fromEntries(menuCatalog.map((menu) => [
    menu.id,
    permissionToAccessLevel(permissions[menu.id])
  ])) as Record<MenuId, MenuAccessLevel>;
}

export async function getUserModuleOverrides(userId: string) {
  const rows = await queryUserPermissionRows(userId);
  return Object.fromEntries(rows
    .filter((row) => isMenuId(row.menuId))
    .map((row) => [row.menuId, permissionFromRow(row)])) as Partial<ModulePermissionMap>;
}

export async function getUserMenuOverrides(userId: string) {
  const overrides = await getUserModuleOverrides(userId);
  return Object.fromEntries(Object.entries(overrides).map(([menuId, permission]) => [
    menuId,
    permissionToAccessLevel(permission)
  ])) as Partial<Record<MenuId, MenuAccessLevel>>;
}

export async function getEffectiveModulePermissions(user: Pick<SessionUser, "id" | "role">) {
  if (user.role === "ADMIN") {
    return Object.fromEntries(menuCatalog.map((menu) => [menu.id, fullPermission()])) as ModulePermissionMap;
  }

  const [rolePermissions, overrides] = await Promise.all([
    getRoleModulePermissions(user.role),
    getUserModuleOverrides(user.id)
  ]);
  return Object.fromEntries(menuCatalog.map((menu) => [
    menu.id,
    normalizePermission(overrides[menu.id] ?? rolePermissions[menu.id] ?? emptyPermission())
  ])) as ModulePermissionMap;
}

export async function getEffectiveMenuPermissions(user: Pick<SessionUser, "id" | "role">) {
  const permissions = await getEffectiveModulePermissions(user);
  return Object.fromEntries(menuCatalog.map((menu) => [
    menu.id,
    permissionToAccessLevel(permissions[menu.id])
  ])) as Record<MenuId, MenuAccessLevel>;
}

export async function userHasPermission(user: Pick<SessionUser, "id" | "role">, menuId: MenuId, action: PermissionAction) {
  const permissions = await getEffectiveModulePermissions(user);
  return hasModulePermission(permissions[menuId], action);
}

export async function attachMenuPermissions<T extends SessionUser>(user: T) {
  const modulePermissions = await getEffectiveModulePermissions(user);
  return {
    ...user,
    menuPermissions: Object.fromEntries(menuCatalog.map((menu) => [
      menu.id,
      permissionToAccessLevel(modulePermissions[menu.id])
    ])) as Record<MenuId, MenuAccessLevel>,
    modulePermissions
  };
}

async function replacePermissionsTable(
  tableName: "RoleMenuPermission" | "UserMenuPermission",
  ownerKey: "role" | "userId",
  ownerValue: string,
  permissions: Partial<Record<MenuId, Partial<ModulePermission>>>
) {
  await prisma.$transaction(async (tx) => {
    if (tableName === "UserMenuPermission") {
      await tx.$executeRaw`DELETE FROM "UserMenuPermission" WHERE "userId" = ${ownerValue}`;
    } else {
      for (const menu of menuCatalog) {
        const normalized = normalizePermission(permissions[menu.id]);
        const accessLevel = permissionToAccessLevel(normalized);
        await tx.$executeRaw`
          INSERT INTO "RoleMenuPermission" ("role", "menuId", "accessLevel", "canView", "canCreate", "canEdit", "canDelete", "canApprove", "canAdmin", "updatedAt")
          VALUES (
            CAST(${ownerValue} AS "UserRole"),
            ${menu.id},
            CAST(${accessLevel} AS "MenuAccessLevel"),
            ${normalized.view},
            ${normalized.create},
            ${normalized.edit},
            ${normalized.delete},
            ${normalized.approve},
            ${normalized.admin},
            CURRENT_TIMESTAMP
          )
          ON CONFLICT ("role", "menuId")
          DO UPDATE SET
            "accessLevel" = EXCLUDED."accessLevel",
            "canView" = EXCLUDED."canView",
            "canCreate" = EXCLUDED."canCreate",
            "canEdit" = EXCLUDED."canEdit",
            "canDelete" = EXCLUDED."canDelete",
            "canApprove" = EXCLUDED."canApprove",
            "canAdmin" = EXCLUDED."canAdmin",
            "updatedAt" = CURRENT_TIMESTAMP
        `;
      }
      return;
    }

    for (const menu of menuCatalog) {
      const normalized = normalizePermission(permissions[menu.id]);
      const accessLevel = permissionToAccessLevel(normalized);
      await tx.$executeRaw`
        INSERT INTO "UserMenuPermission" ("userId", "menuId", "accessLevel", "canView", "canCreate", "canEdit", "canDelete", "canApprove", "canAdmin", "updatedAt")
        VALUES (
          ${ownerValue},
          ${menu.id},
          CAST(${accessLevel} AS "MenuAccessLevel"),
          ${normalized.view},
          ${normalized.create},
          ${normalized.edit},
          ${normalized.delete},
          ${normalized.approve},
          ${normalized.admin},
          CURRENT_TIMESTAMP
        )
      `;
    }
  });
}

export async function replaceUserModulePermissions(userId: string, permissions: Partial<Record<MenuId, Partial<ModulePermission>>>) {
  await replacePermissionsTable("UserMenuPermission", "userId", userId, permissions);
}

export async function replaceRoleModulePermissions(role: UserRole, permissions: Partial<Record<MenuId, Partial<ModulePermission>>>) {
  await replacePermissionsTable("RoleMenuPermission", "role", role, permissions);
}

export async function replaceUserMenuPermissions(userId: string, permissions: Partial<Record<MenuId, MenuAccessLevel>>) {
  await replaceUserModulePermissions(
    userId,
    Object.fromEntries(Object.entries(permissions).map(([menuId, accessLevel]) => [
      menuId,
      permissionFromLevel(normalizeLevel(accessLevel))
    ]))
  );
}

export async function replaceRoleMenuPermissions(role: UserRole, permissions: Partial<Record<MenuId, MenuAccessLevel>>) {
  await replaceRoleModulePermissions(
    role,
    Object.fromEntries(Object.entries(permissions).map(([menuId, accessLevel]) => [
      menuId,
      permissionFromLevel(normalizeLevel(accessLevel))
    ]))
  );
}

function menuFromRequest(request: Request): MenuId | null {
  const path = request.path;
  const method = request.method.toUpperCase();
  if (path.startsWith("/auth")) return null;
  if (path.startsWith("/users")) return "users";
  if (path.startsWith("/audit")) return "audit";
  if (path.startsWith("/dashboard")) return "dashboard";
  if (path.startsWith("/suppliers")) return "suppliers";
  if (path.startsWith("/products")) return "products";
  if (path.startsWith("/payment-methods")) return "payment-methods";
  if (path.startsWith("/purchase-orders")) return "purchase-orders";
  if (path.startsWith("/purchases/payables")) return "payables";
  if (path.startsWith("/purchases")) return "purchases";
  if (path.startsWith("/cards")) return "cards";
  if (path.startsWith("/imports/suppliers") || path.startsWith("/imports/products") || path.startsWith("/imports/payment-methods") || path.startsWith("/imports/small-expense-types") || path.startsWith("/imports/catalog")) return "catalog-imports";
  if (path.startsWith("/imports") || path.startsWith("/import-conflicts")) return "import";
  if (path.startsWith("/inventory/stocks")) return "inventory";
  if (path.startsWith("/inventory/movements")) return "inventory-movements";
  if (
    path.startsWith("/inventory/count-sessions")
    || path.startsWith("/inventory/counts")
    || path.startsWith("/inventory/stock-count-sessions")
    || path.startsWith("/inventory/agenda")
    || path.startsWith("/inventory/stock-counts")
  ) return "inventory-counting";
  if (path.startsWith("/inventory/operational") || path.startsWith("/inventory/monthly")) return "inventory-official";
  if (path.startsWith("/inventory/reports")) return "inventory-reports";
  if (path.startsWith("/inventory")) return "inventory";
  if (path.startsWith("/monthly/cmv-real")) return "cmv-real";
  if (path.startsWith("/monthly/revenue")) return "revenue";
  if (path.startsWith("/monthly/daily-revenue")) return "cash";
  if (path.startsWith("/monthly")) return "monthly-closing";
  if (path.startsWith("/master-data/sectors") && method === "GET" && String(request.query?.forStockCounting ?? "").toLowerCase() === "true") {
    return "inventory-counting";
  }
  if (path.startsWith("/master-data")) return "master-data";
  return null;
}

function actionFromRequest(request: Request, menuId: MenuId): PermissionAction {
  const path = request.path;
  const method = request.method.toUpperCase();

  if (menuId === "users" && path.includes("/menu-permissions")) return "admin";
  if (menuId === "users" && path.endsWith("/password")) return "admin";
  if (menuId === "users" && method === "POST") return "create";
  if (menuId === "users" && (method === "PUT" || method === "PATCH")) return "edit";

  if (menuId === "purchase-orders" && path.endsWith("/status")) {
    return String(request.body?.action ?? "").trim() === "APPROVE" ? "approve" : "edit";
  }

  if (menuId === "revenue" && path.includes("/import/confirm") && Boolean(request.body?.allowOverwrite)) {
    return "admin";
  }

  if (path.endsWith("/close") || path.endsWith("/approve") || path.endsWith("/confirm")) return "approve";
  if (path.endsWith("/cancel") || method === "DELETE") return "delete";
  if (method === "GET" || method === "HEAD") return "view";
  if (method === "POST") return "create";
  if (method === "PUT" || method === "PATCH") return "edit";
  return "view";
}

export async function resolvePermissionContext(request: Request): Promise<PermissionRequestContext | null> {
  const menuId = menuFromRequest(request);
  if (!menuId) return null;
  return { menuId, action: actionFromRequest(request, menuId) };
}

export async function requireMenuAccess(request: Request, response: Response, next: NextFunction) {
  const context = await resolvePermissionContext(request);
  if (!context) {
    next();
    return;
  }

  const user = await getSessionUser(request);
  if (!user) {
    response.status(401).json({ message: "Sessao obrigatoria." });
    return;
  }

  const sessionUser = user as SessionUser;
  const permissions = await getEffectiveModulePermissions(sessionUser);
  const modulePermission = permissions[context.menuId];
  if (!hasModulePermission(modulePermission, context.action)) {
    response.status(403).json({
      message: context.action === "view"
        ? "Usuario sem permissao para acessar este modulo."
        : "Usuario sem permissao para executar esta acao."
    });
    return;
  }

  (request as Request & {
    menuAccess?: {
      menuId: MenuId;
      accessLevel: MenuAccessLevel;
      permission: ModulePermission;
      action: PermissionAction;
    };
  }).menuAccess = {
    menuId: context.menuId,
    accessLevel: permissionToAccessLevel(modulePermission),
    permission: modulePermission,
    action: context.action
  };
  next();
}
