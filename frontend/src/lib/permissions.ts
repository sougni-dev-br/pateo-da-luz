import type { AppUser, MenuAccessLevel, ModulePermission, PermissionAction } from "../api/client";

export function normalizeModulePermission(permission?: Partial<ModulePermission> | null): ModulePermission {
  const next: ModulePermission = {
    view: Boolean(permission?.view),
    create: Boolean(permission?.create),
    edit: Boolean(permission?.edit),
    delete: Boolean(permission?.delete),
    approve: Boolean(permission?.approve),
    admin: Boolean(permission?.admin)
  };

  if (next.admin) {
    return { view: true, create: true, edit: true, delete: true, approve: true, admin: true };
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

export function accessLevelFromPermission(permission?: Partial<ModulePermission> | null): MenuAccessLevel {
  const normalized = normalizeModulePermission(permission);
  if (normalized.admin || normalized.create || normalized.edit || normalized.delete || normalized.approve) return "FULL";
  if (normalized.view) return "VIEW";
  return "NONE";
}

export function hasPermission(user: AppUser | null | undefined, moduleId: string, action: PermissionAction) {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  const permission = normalizeModulePermission(user.modulePermissions?.[moduleId]);
  return action === "view" ? permission.view : permission.admin || permission[action];
}

export function canAccessModule(user: AppUser | null | undefined, moduleId: string) {
  return hasPermission(user, moduleId, "view");
}
