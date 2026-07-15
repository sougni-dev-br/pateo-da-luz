-- CMV v2 — 2026-07-15: campos de Fechamento Mensal
ALTER TABLE "MonthlyCmv"
    ADD COLUMN "cmvAttributedValue" DECIMAL(14,2),
    ADD COLUMN "attributionBreakdown" JSONB,
    ADD COLUMN "justifications" JSONB;
