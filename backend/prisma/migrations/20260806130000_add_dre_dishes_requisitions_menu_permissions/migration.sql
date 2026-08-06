-- Registra no controle de acesso tres modulos que existiam no menu lateral mas
-- nao estavam no menuCatalog (nao apareciam em Usuarios > Permissoes):
--   - dre          (DRE Gerencial)     -> grupo Financeiro
--   - dishes       (Fichas Tecnicas)   -> grupo Cardapio
--   - requisitions (Requisicoes)       -> grupo Estoque  (rotas /inventory/requisitions)
--
-- Defaults de papel escolhidos para PRESERVAR o comportamento atual do sidebar:
--   - dre / dishes: GESTAO_COMPLETA=FULL, VISUALIZACAO=VIEW, ESTOQUISTA=NONE
--                   (espelha "suppliers"; ESTOQUISTA nao via esses itens)
--   - requisitions: GESTAO_COMPLETA=FULL, VISUALIZACAO=VIEW, ESTOQUISTA=FULL
--                   (espelha "inventory-counting"; ESTOQUISTA usa requisicoes)
--
-- id gerado explicitamente (modelo Prisma usa @default(cuid()) app-side; coluna
-- sem default no banco). Idempotente: ON CONFLICT DO NOTHING preserva ajustes manuais.

INSERT INTO "RoleMenuPermission"
  ("id", "role", "menuId", "accessLevel", "canView", "canCreate", "canEdit", "canDelete", "canApprove", "canAdmin", "updatedAt")
VALUES
  -- DRE Gerencial
  (gen_random_uuid()::text, 'ADMIN',           'dre', 'FULL', true,  true,  true,  true,  true,  true,  CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'GESTAO_COMPLETA', 'dre', 'FULL', true,  true,  true,  true,  true,  true,  CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'VISUALIZACAO',    'dre', 'VIEW', true,  false, false, false, false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ESTOQUISTA',      'dre', 'NONE', false, false, false, false, false, false, CURRENT_TIMESTAMP),
  -- Fichas Tecnicas
  (gen_random_uuid()::text, 'ADMIN',           'dishes', 'FULL', true,  true,  true,  true,  true,  true,  CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'GESTAO_COMPLETA', 'dishes', 'FULL', true,  true,  true,  true,  true,  true,  CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'VISUALIZACAO',    'dishes', 'VIEW', true,  false, false, false, false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ESTOQUISTA',      'dishes', 'NONE', false, false, false, false, false, false, CURRENT_TIMESTAMP),
  -- Requisicoes de estoque
  (gen_random_uuid()::text, 'ADMIN',           'requisitions', 'FULL', true,  true,  true,  true,  true,  true,  CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'GESTAO_COMPLETA', 'requisitions', 'FULL', true,  true,  true,  true,  true,  true,  CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'VISUALIZACAO',    'requisitions', 'VIEW', true,  false, false, false, false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ESTOQUISTA',      'requisitions', 'FULL', true,  true,  true,  true,  true,  true,  CURRENT_TIMESTAMP)
ON CONFLICT ("role", "menuId") DO NOTHING;
