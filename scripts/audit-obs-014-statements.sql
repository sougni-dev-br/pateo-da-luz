-- Auditoria OBS-014 (proxima fatura de cartao nao abre automaticamente)
-- Lista todos os cartoes com o "yyyymm" da ultima fatura em cada status.
-- Identifica cartoes bloqueados: latest_open ausente + latest_closed presente.
--
-- Uso: rodar em psql de producao (READ-ONLY). Nao modifica dados.
--
-- Schema fonte: backend/prisma/schema.prisma
--   model CreditCard (linha 542) — tabela "CreditCard"
--     - id, name (NOT "nickname"), bankName, last4Digits, closingDay, dueDay, isActive
--   model CreditCardStatement (linha 562) — tabela "CreditCardStatement"
--     - status ∈ ('OPEN','CHECKED','CLOSED','PAID','CANCELLED')
--
-- Como interpretar cada linha:
-- - latest_open_yyyymm NULL + count_closed > 0        → CARTAO BLOQUEADO: sem fatura
--                                                       aberta para receber novas compras.
--                                                       Rafael tera que criar manualmente
--                                                       via UI "+ Nova fatura".
-- - latest_open_yyyymm presente                       → OK: existe fatura aberta.
-- - latest_closed_yyyymm >= latest_open_yyyymm        → suspeito: fatura mais recente e
--                                                       CLOSED. Verificar se falta a proxima.

SELECT
  cc.id                                                                                     AS card_id,
  cc.name                                                                                   AS card_name,
  cc."bankName"                                                                             AS bank,
  cc."last4Digits"                                                                          AS last4,
  cc."closingDay",
  cc."dueDay",
  cc."isActive",
  MAX(CASE WHEN ccs.status = 'OPEN'      THEN ccs."competenceYear" * 100 + ccs."competenceMonth" END) AS latest_open_yyyymm,
  MAX(CASE WHEN ccs.status = 'CHECKED'   THEN ccs."competenceYear" * 100 + ccs."competenceMonth" END) AS latest_checked_yyyymm,
  MAX(CASE WHEN ccs.status = 'CLOSED'    THEN ccs."competenceYear" * 100 + ccs."competenceMonth" END) AS latest_closed_yyyymm,
  MAX(CASE WHEN ccs.status = 'PAID'      THEN ccs."competenceYear" * 100 + ccs."competenceMonth" END) AS latest_paid_yyyymm,
  MAX(CASE WHEN ccs.status = 'CANCELLED' THEN ccs."competenceYear" * 100 + ccs."competenceMonth" END) AS latest_cancelled_yyyymm,
  COUNT(ccs.id) FILTER (WHERE ccs.status = 'OPEN')      AS count_open,
  COUNT(ccs.id) FILTER (WHERE ccs.status = 'CHECKED')   AS count_checked,
  COUNT(ccs.id) FILTER (WHERE ccs.status = 'CLOSED')    AS count_closed,
  COUNT(ccs.id) FILTER (WHERE ccs.status = 'PAID')      AS count_paid,
  COUNT(ccs.id) FILTER (WHERE ccs.status = 'CANCELLED') AS count_cancelled,
  CASE
    WHEN COUNT(ccs.id) FILTER (WHERE ccs.status IN ('OPEN','CHECKED')) = 0
         AND COUNT(ccs.id) FILTER (WHERE ccs.status = 'CLOSED') > 0
    THEN 'BLOQUEADO'
    ELSE 'OK'
  END                                                                                       AS diagnostico
FROM "CreditCard" cc
LEFT JOIN "CreditCardStatement" ccs ON ccs."creditCardId" = cc.id
WHERE cc."isActive" = true
GROUP BY cc.id
ORDER BY diagnostico DESC, cc.name;
