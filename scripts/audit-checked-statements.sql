-- Auditoria pos-fix OBS-007 (Cards.tsx:517 — botao Conferir da tabela de faturas)
-- Identifica faturas em CHECKED que podem ter sido marcadas incorretamente pelo
-- botao Conferir bugado (PATCH silencioso OPEN <-> CHECKED sem conferencia real
-- item-a-item — comportamento removido neste PR).
--
-- Uso: rodar em psql de producao (READ-ONLY). Nao modifica dados.
--
-- Interpretacao:
-- - pct_checked = 100%  → todos os itens conferidos, provavelmente OK.
-- - pct_checked baixo   → suspeita de falso positivo do bug OBS-007. Decidir
--                         manualmente: reverter para OPEN, deixar como esta,
--                         ou marcar como divergencia auditavel.
-- - total_items = 0     → fatura em CHECKED sem itens. Ordem-de-magnitude
--                         indicativa de bug (ordenada primeiro pela clausula
--                         ORDER BY).
--
-- Schema fonte: backend/prisma/schema.prisma
--   model CreditCardStatement (linha 562) — tabela "CreditCardStatement"
--   model CreditCardStatementItem (linha 587) — tabela "CreditCardStatementItem"

SELECT
  cs.id                                                    AS statement_id,
  cs.status,
  cs."creditCardId",
  cs."competenceYear",
  cs."competenceMonth",
  cs."updatedAt"                                           AS statement_updated_at,
  COUNT(csi.id)                                            AS total_items,
  COUNT(csi.id) FILTER (WHERE csi.checked = true)          AS checked_items,
  COUNT(csi.id) FILTER (WHERE csi.checked = false)         AS unchecked_items,
  ROUND(
    100.0 * COUNT(csi.id) FILTER (WHERE csi.checked = true)
      / NULLIF(COUNT(csi.id), 0),
    1
  )                                                        AS pct_checked
FROM "CreditCardStatement" cs
LEFT JOIN "CreditCardStatementItem" csi ON csi."statementId" = cs.id
WHERE cs.status = 'CHECKED'
GROUP BY cs.id
ORDER BY pct_checked ASC NULLS FIRST, cs."updatedAt" DESC
LIMIT 100;
