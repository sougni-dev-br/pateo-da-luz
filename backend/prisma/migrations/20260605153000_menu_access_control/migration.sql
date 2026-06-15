DO $$ BEGIN
  CREATE TYPE "MenuAccessLevel" AS ENUM ('NONE', 'VIEW', 'FULL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "RoleMenuPermission" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "role" "UserRole" NOT NULL,
  "menuId" TEXT NOT NULL,
  "accessLevel" "MenuAccessLevel" NOT NULL DEFAULT 'NONE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoleMenuPermission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "UserMenuPermission" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL,
  "menuId" TEXT NOT NULL,
  "accessLevel" "MenuAccessLevel" NOT NULL DEFAULT 'NONE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserMenuPermission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RoleMenuPermission_role_menuId_key" ON "RoleMenuPermission"("role", "menuId");
CREATE INDEX IF NOT EXISTS "RoleMenuPermission_role_idx" ON "RoleMenuPermission"("role");
CREATE INDEX IF NOT EXISTS "RoleMenuPermission_menuId_idx" ON "RoleMenuPermission"("menuId");

CREATE UNIQUE INDEX IF NOT EXISTS "UserMenuPermission_userId_menuId_key" ON "UserMenuPermission"("userId", "menuId");
CREATE INDEX IF NOT EXISTS "UserMenuPermission_userId_idx" ON "UserMenuPermission"("userId");
CREATE INDEX IF NOT EXISTS "UserMenuPermission_menuId_idx" ON "UserMenuPermission"("menuId");

DO $$ BEGIN
  ALTER TABLE "UserMenuPermission"
    ADD CONSTRAINT "UserMenuPermission_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

WITH menus("menuId") AS (
  VALUES
    ('dashboard'),
    ('purchases'),
    ('purchase-orders'),
    ('payables'),
    ('revenue'),
    ('cards'),
    ('cash'),
    ('cmv-real'),
    ('monthly-closing'),
    ('inventory'),
    ('inventory-movements'),
    ('inventory-counting'),
    ('inventory-official'),
    ('inventory-reports'),
    ('products'),
    ('suppliers'),
    ('import'),
    ('catalog-imports'),
    ('payment-methods'),
    ('master-data'),
    ('users'),
    ('audit')
),
role_defaults("role", "menuId", "accessLevel") AS (
  SELECT 'ADMIN'::"UserRole", "menuId", 'FULL'::"MenuAccessLevel" FROM menus
  UNION ALL
  SELECT 'GESTAO_COMPLETA'::"UserRole", "menuId",
    CASE WHEN "menuId" IN ('users', 'audit') THEN 'NONE'::"MenuAccessLevel" ELSE 'FULL'::"MenuAccessLevel" END
  FROM menus
  UNION ALL
  SELECT 'VISUALIZACAO'::"UserRole", "menuId",
    CASE WHEN "menuId" IN ('import', 'catalog-imports', 'cash', 'users', 'audit') THEN 'NONE'::"MenuAccessLevel" ELSE 'VIEW'::"MenuAccessLevel" END
  FROM menus
  UNION ALL
  SELECT 'ESTOQUISTA'::"UserRole", "menuId",
    CASE WHEN "menuId" IN ('inventory', 'inventory-counting') THEN 'FULL'::"MenuAccessLevel" ELSE 'NONE'::"MenuAccessLevel" END
  FROM menus
)
INSERT INTO "RoleMenuPermission" ("role", "menuId", "accessLevel", "updatedAt")
SELECT "role", "menuId", "accessLevel", CURRENT_TIMESTAMP
FROM role_defaults
ON CONFLICT ("role", "menuId") DO NOTHING;

WITH demo_users AS (
  SELECT "id", "name", "email", "role"::text AS "role", "isActive"
  FROM "User"
  WHERE lower("email") IN (
    'admin@pateodaluz.local',
    'admin@cmv.local',
    'demo@pateodaluz.local',
    'teste@pateodaluz.local',
    'gestao@pateodaluz.local',
    'estoque@pateodaluz.local',
    'visualizacao@pateodaluz.local'
  )
  OR (lower("email") LIKE '%@pateodaluz.local' AND "role" <> 'ADMIN')
  OR lower("email") LIKE 'debug.%'
  OR lower("email") LIKE 'teste.%'
  OR "id" IN ('local-admin', 'demo-admin', 'demo-gestao', 'demo-estoque', 'demo-visualizacao')
),
safe_demo_users AS (
  SELECT *
  FROM demo_users
  WHERE "role" <> 'ADMIN'
     OR EXISTS (
       SELECT 1
       FROM "User" admin_user
       WHERE admin_user."role" = 'ADMIN'
         AND admin_user."isActive" = true
         AND admin_user."id" <> demo_users."id"
     )
)
INSERT INTO "AuditLog" ("id", "userId", "action", "entity", "entityId", "previousValue", "newValue", "createdAt")
SELECT
  gen_random_uuid()::text,
  NULL,
  'DEACTIVATE_DEMO_LOGIN',
  'User',
  "id",
  to_jsonb(safe_demo_users),
  jsonb_build_object('isActive', false, 'reason', 'login_de_teste_demo_retirado_do_piloto'),
  CURRENT_TIMESTAMP
FROM safe_demo_users
WHERE "isActive" = true;

UPDATE "User"
SET "isActive" = false,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (
  WITH demo_users AS (
    SELECT "id", "role"::text AS "role"
    FROM "User"
    WHERE lower("email") IN (
      'admin@pateodaluz.local',
      'admin@cmv.local',
      'demo@pateodaluz.local',
      'teste@pateodaluz.local',
      'gestao@pateodaluz.local',
      'estoque@pateodaluz.local',
      'visualizacao@pateodaluz.local'
    )
    OR (lower("email") LIKE '%@pateodaluz.local' AND "role" <> 'ADMIN')
    OR lower("email") LIKE 'debug.%'
    OR lower("email") LIKE 'teste.%'
    OR "id" IN ('local-admin', 'demo-admin', 'demo-gestao', 'demo-estoque', 'demo-visualizacao')
  )
  SELECT "id"
  FROM demo_users
  WHERE "role" <> 'ADMIN'
     OR EXISTS (
       SELECT 1
       FROM "User" admin_user
       WHERE admin_user."role" = 'ADMIN'
         AND admin_user."isActive" = true
         AND admin_user."id" <> demo_users."id"
     )
);
