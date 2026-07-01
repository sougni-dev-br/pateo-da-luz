-- ============================================================================
-- SCRIPT DE LIMPEZA — USO EXCLUSIVAMENTE LOCAL
-- ============================================================================
--
-- Propósito: remover pedidos RASCUNHO de teste gerados durante as auditorias
-- dos Prompts 5–10 no BANCO DE DESENVOLVIMENTO (cmv_loja), especificamente os
-- pedidos com quantidade > 500 (limite defensivo — a heurística é: nenhum
-- pedido real de um restaurante ultrapassa isso).
--
-- ATENÇÃO — REGRAS ABSOLUTAS:
--   * NUNCA execute este script contra o banco de PRODUÇÃO no Render.
--     A produção usa o banco `pateo` em oregon-postgres.render.com. Este
--     script contém um GUARD que aborta se o current_database() != 'cmv_loja'.
--   * Este NÃO é uma migration — é um one-off SQL para limpar sujeira de teste.
--     Não deve ser adicionado ao pipeline de deploy.
--   * O script está envolvido em BEGIN/COMMIT. Se algo parecer errado no
--     dry-run (SELECT abaixo), execute ROLLBACK em vez de COMMIT.
--
-- Uso (LOCAL SOMENTE):
--   psql "postgresql://cmv:cmv@localhost:5432/cmv_loja" \
--        -f backend/scripts/cleanup-oversized-planning-drafts.sql
--
-- Contexto histórico: durante os Prompts 5–10, injetei quantidade de 999.990
-- em vários testes de fluxo do POST /purchase-orders/from-planning. Isso gerou
-- 11+ pedidos RASCUNHO de ~R$ 40 milhões cada no banco local. A Fase 1 do
-- Prompt 12 adicionou cap server-side (MAX_REQUESTED_QUANTITY = 100_000),
-- então esse tipo de sujeira não se repete — mas o passivo local precisou
-- ser removido para não poluir auditorias/inspeções futuras.
-- ============================================================================

BEGIN;

-- ─── GUARD: só permite executar contra o banco local `cmv_loja` ─────────────
DO $$
BEGIN
  IF current_database() <> 'cmv_loja' THEN
    RAISE EXCEPTION
      'Script bloqueado: banco atual e "%" mas so cmv_loja (dev local) e permitido. '
      'NUNCA execute este script em producao. Aborte imediatamente.',
      current_database();
  END IF;
END $$;

-- ─── DRY-RUN: liste o que sera apagado antes ────────────────────────────────
SELECT
  po.code,
  po."supplierNameSnapshot",
  po."createdAt",
  (SELECT MAX(poi."requestedQuantity") FROM "PurchaseOrderItem" poi WHERE poi."purchaseOrderId" = po.id) AS "maxQty",
  (SELECT SUM(poi."totalEstimated")     FROM "PurchaseOrderItem" poi WHERE poi."purchaseOrderId" = po.id) AS "totalEstimated"
FROM "PurchaseOrder" po
WHERE po.source = 'PLANEJAMENTO_COMPRA'
  AND po.status = 'RASCUNHO'
  AND po."createdAt" >= NOW() - INTERVAL '30 days'
  AND EXISTS (
    SELECT 1 FROM "PurchaseOrderItem" poi
    WHERE poi."purchaseOrderId" = po.id
      AND poi."requestedQuantity" > 500
  )
ORDER BY po.code;

-- ─── DELETE: onDelete Cascade em PurchaseOrderItem apaga os itens junto ─────
-- Filtros combinados:
--   * source = 'PLANEJAMENTO_COMPRA'    — só o novo fluxo (não afeta /from-prelist nem MANUAL)
--   * status = 'RASCUNHO'                — nunca toca pedido aprovado/enviado/recebido
--   * createdAt >= NOW() - 30 dias       — só sujeira recente das rodadas de teste
--   * requestedQuantity > 500 (em algum item) — pedidos legítimos ficam intactos
DELETE FROM "PurchaseOrder"
WHERE source = 'PLANEJAMENTO_COMPRA'
  AND status = 'RASCUNHO'
  AND "createdAt" >= NOW() - INTERVAL '30 days'
  AND id IN (
    SELECT DISTINCT poi."purchaseOrderId"
    FROM "PurchaseOrderItem" poi
    WHERE poi."requestedQuantity" > 500
  );

-- Se o dry-run acima listou algo inesperado, ROLLBACK em vez de COMMIT.
COMMIT;
