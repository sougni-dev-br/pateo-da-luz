-- Registra o modulo "Ciclos de fornecedor" (supplier-cycles) no controle de acesso.
--
-- Contexto: o modulo ja existia (pagina /financeiro/ciclos-fornecedor + rotas
-- /supplier-cycles), mas nunca foi adicionado ao menuCatalog nem ao menuFromRequest,
-- entao nao aparecia na tela de Usuarios > Permissoes. Esta migration semeia os
-- defaults de papel espelhando o modulo irmao "suppliers" (mesmo perfil de acesso),
-- preservando o comportamento atual (GESTAO_COMPLETA e VISUALIZACAO ja acessavam o
-- ciclo via requireRole/fallback) e permitindo ajuste fino por usuario na UI.
--
-- Idempotente: ON CONFLICT DO NOTHING preserva qualquer ajuste manual ja existente.

-- id gerado explicitamente: o modelo Prisma usa @default(cuid()) (lado da aplicacao),
-- entao a coluna nao tem default no banco e um INSERT em SQL puro precisa fornece-lo.
INSERT INTO "RoleMenuPermission"
  ("id", "role", "menuId", "accessLevel", "canView", "canCreate", "canEdit", "canDelete", "canApprove", "canAdmin", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'ADMIN',           'supplier-cycles', 'FULL', true,  true,  true,  true,  true,  true,  CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'GESTAO_COMPLETA', 'supplier-cycles', 'FULL', true,  true,  true,  true,  true,  true,  CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'VISUALIZACAO',    'supplier-cycles', 'VIEW', true,  false, false, false, false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ESTOQUISTA',      'supplier-cycles', 'NONE', false, false, false, false, false, false, CURRENT_TIMESTAMP)
ON CONFLICT ("role", "menuId") DO NOTHING;
