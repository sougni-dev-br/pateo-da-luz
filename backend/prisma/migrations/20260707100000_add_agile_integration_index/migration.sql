-- Índice composto para upsert idempotente do agente de sync do Agile PDV.
-- Cada dia (date + channel + sourcePlatform) tem no máximo um RevenueEntry
-- vindo do PDV, e o agente reimporta várias vezes o mesmo dia até fechar.
-- Sem esse índice, cada sync faria N seq-scans em RevenueEntry.
--
-- Partial index: só cobre linhas que vieram do Agile, para não conflitar
-- com faturamento já cadastrado manualmente ou por outros canais.

CREATE INDEX IF NOT EXISTS "RevenueEntry_agile_lookup_idx"
  ON "RevenueEntry" ("date", "channel", "sourcePlatform")
  WHERE "sourcePlatform" = 'AGILE_PDV';
