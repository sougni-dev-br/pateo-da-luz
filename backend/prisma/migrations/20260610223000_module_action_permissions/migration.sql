ALTER TABLE "RoleMenuPermission"
  ADD COLUMN IF NOT EXISTS "canView" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "canCreate" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "canEdit" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "canDelete" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "canApprove" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "canAdmin" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "UserMenuPermission"
  ADD COLUMN IF NOT EXISTS "canView" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "canCreate" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "canEdit" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "canDelete" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "canApprove" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "canAdmin" BOOLEAN NOT NULL DEFAULT false;

UPDATE "RoleMenuPermission"
SET
  "canView" = CASE WHEN "accessLevel" IN ('VIEW', 'FULL') THEN true ELSE false END,
  "canCreate" = CASE WHEN "accessLevel" = 'FULL' THEN true ELSE false END,
  "canEdit" = CASE WHEN "accessLevel" = 'FULL' THEN true ELSE false END,
  "canDelete" = CASE WHEN "accessLevel" = 'FULL' THEN true ELSE false END,
  "canApprove" = CASE WHEN "accessLevel" = 'FULL' THEN true ELSE false END,
  "canAdmin" = CASE WHEN "accessLevel" = 'FULL' THEN true ELSE false END
WHERE NOT ("canView" OR "canCreate" OR "canEdit" OR "canDelete" OR "canApprove" OR "canAdmin");

UPDATE "UserMenuPermission"
SET
  "canView" = CASE WHEN "accessLevel" IN ('VIEW', 'FULL') THEN true ELSE false END,
  "canCreate" = CASE WHEN "accessLevel" = 'FULL' THEN true ELSE false END,
  "canEdit" = CASE WHEN "accessLevel" = 'FULL' THEN true ELSE false END,
  "canDelete" = CASE WHEN "accessLevel" = 'FULL' THEN true ELSE false END,
  "canApprove" = CASE WHEN "accessLevel" = 'FULL' THEN true ELSE false END,
  "canAdmin" = CASE WHEN "accessLevel" = 'FULL' THEN true ELSE false END
WHERE NOT ("canView" OR "canCreate" OR "canEdit" OR "canDelete" OR "canApprove" OR "canAdmin");

UPDATE "RoleMenuPermission"
SET
  "canView" = true,
  "canCreate" = true,
  "canEdit" = true,
  "canDelete" = true,
  "canApprove" = true,
  "canAdmin" = true,
  "accessLevel" = 'FULL',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "role" = 'ADMIN';
