-- ============================================================================
-- GRANT ANDERSON PURCHASE ACCESS — ONE-OFF SQL
-- ============================================================================
--
-- Propósito: liberar para o usuário Anderson (role ESTOQUISTA) as permissões
-- mínimas de "view" para conseguir lançar uma compra ponta-a-ponta em
-- /compras/nova (e usar /pedidos-compra), sem depender de alteração no
-- RoleMenuPermission do perfil ESTOQUISTA. Correção CIRÚRGICA — só Anderson.
--
-- Banco alvo: pateo (produção).
-- Usuário alvo: Anderson (id `cc043cc7-52da-4587-9749-18d3204f7f3c`).
--
-- ATENÇÃO — REGRAS ABSOLUTAS:
--   * NÃO executar sem autorização explícita do Eli.
--   * O script contém um GUARD que aborta se current_database() != 'pateo'.
--   * Bloco transacional: se algo estranho no SELECT final, ROLLBACK.
--   * NÃO altera RoleMenuPermission (o perfil ESTOQUISTA segue como está).
--   * NÃO toca em menus onde Anderson já tem override FULL (products,
--     purchases, purchase-orders, inventory, inventory-counting,
--     inventory-movements). Ver seção "REGRESSÃO POTENCIAL" abaixo.
--
-- ----------------------------------------------------------------------------
-- ESTADO ATUAL (levantado em 2026-07-03, Fase 1 da investigação):
-- ----------------------------------------------------------------------------
-- Anderson tem 24 linhas em UserMenuPermission. Estado dos 7 menus da lista:
--
--   suppliers        NONE (canView=false)  ← liberar view
--   master-data      NONE (canView=false)  ← liberar view
--   payment-methods  NONE (canView=false)  ← liberar view
--   cards            NONE (canView=false)  ← liberar view
--   products         FULL (todos true)      ← NÃO TOCAR (regressão)
--   purchases        FULL (todos true)      ← NÃO TOCAR (regressão)
--   purchase-orders  FULL (todos true)      ← NÃO TOCAR (regressão)
--
-- ----------------------------------------------------------------------------
-- REGRESSÃO POTENCIAL — LEIA ANTES DE APROVAR:
-- ----------------------------------------------------------------------------
-- A hipótese original da Fase 2 propunha aplicar:
--   products         → canView=true, restantes false
--   purchases        → canView=true, canCreate=true, canEdit=true, restantes false
--   purchase-orders  → canView=true, canCreate=true, canEdit=true, restantes false
--
-- Se aplicássemos isso via UPSERT, Anderson PERDERIA hoje:
--   * products.canCreate, canEdit, canDelete, canApprove, canAdmin
--   * purchases.canDelete, canApprove, canAdmin
--   * purchase-orders.canDelete, canApprove, canAdmin
--
-- Esses três overrides FULL foram gravados pelo Eli/UI em 2026-07-03 13:11:24
-- e representam o poder operacional atual do Anderson. Este script NÃO os
-- altera. Se o Eli quiser REDUZIR essas permissões, é decisão separada, feita
-- pela UI de gestão de usuários, não neste script.
--
-- ============================================================================

BEGIN;

-- ─── GUARD: aborta se banco não é 'pateo' ────────────────────────────────────
DO $$
BEGIN
  IF current_database() <> 'pateo' THEN
    RAISE EXCEPTION
      'Script bloqueado: banco atual e "%" mas so pateo (producao) e permitido.',
      current_database();
  END IF;
END $$;

-- ─── GUARD: aborta se o usuário Anderson não existe ou não é ESTOQUISTA ─────
DO $$
DECLARE
  target_role text;
  target_active boolean;
BEGIN
  SELECT role::text, "isActive" INTO target_role, target_active
  FROM "User" WHERE id = 'cc043cc7-52da-4587-9749-18d3204f7f3c';

  IF target_role IS NULL THEN
    RAISE EXCEPTION 'Usuario Anderson (id cc043cc7-...) nao encontrado.';
  END IF;
  IF target_role <> 'ESTOQUISTA' THEN
    RAISE EXCEPTION 'Usuario alvo tem role "%" mas esperado ESTOQUISTA. Aborte e revalide.', target_role;
  END IF;
  IF NOT target_active THEN
    RAISE EXCEPTION 'Usuario Anderson esta inativo. Aborte e revalide.';
  END IF;
END $$;

-- ─── UPSERT dos 4 menus que precisam ganhar view ────────────────────────────
-- accessLevel derivado conforme permissionToAccessLevel() do backend:
--   view=true, restantes=false → 'VIEW'
-- Só grava view=true; demais flags explicitamente false por segurança.

INSERT INTO "UserMenuPermission" (
  "id", "userId", "menuId", "accessLevel",
  "canView", "canCreate", "canEdit", "canDelete", "canApprove", "canAdmin",
  "createdAt", "updatedAt"
)
VALUES
  (gen_random_uuid()::text, 'cc043cc7-52da-4587-9749-18d3204f7f3c', 'suppliers',
   'VIEW', true, false, false, false, false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'cc043cc7-52da-4587-9749-18d3204f7f3c', 'master-data',
   'VIEW', true, false, false, false, false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'cc043cc7-52da-4587-9749-18d3204f7f3c', 'payment-methods',
   'VIEW', true, false, false, false, false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'cc043cc7-52da-4587-9749-18d3204f7f3c', 'cards',
   'VIEW', true, false, false, false, false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("userId", "menuId") DO UPDATE
SET
  "accessLevel" = 'VIEW',
  "canView"    = true,
  "canCreate"  = false,
  "canEdit"    = false,
  "canDelete"  = false,
  "canApprove" = false,
  "canAdmin"   = false,
  "updatedAt"  = CURRENT_TIMESTAMP;

-- ─── VERIFICAÇÃO: exibe estado final dos 7 menus da lista ───────────────────
SELECT
  "menuId",
  "accessLevel",
  "canView", "canCreate", "canEdit",
  "canDelete", "canApprove", "canAdmin",
  "updatedAt"
FROM "UserMenuPermission"
WHERE "userId" = 'cc043cc7-52da-4587-9749-18d3204f7f3c'
  AND "menuId" IN ('suppliers','master-data','payment-methods','cards',
                   'products','purchases','purchase-orders')
ORDER BY "menuId";

-- ⚠️ REVISE O SELECT ACIMA ANTES DE DAR COMMIT.
-- Esperado:
--   suppliers/master-data/payment-methods/cards → VIEW (só canView=true)
--   products/purchases/purchase-orders           → FULL (todos true, INTACTO)

COMMIT;
-- Se algo divergir do esperado, substitua o COMMIT acima por ROLLBACK.
