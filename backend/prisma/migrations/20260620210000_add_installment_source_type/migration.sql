-- Add sourceType to PaymentInstallment for traceability
-- DIRECT: installment created from a normal purchase
-- CARD_STATEMENT: installment created when closing a credit card statement
-- LEGACY_CREDIT_CARD: pre-existing installments created with CREDIT_CARD method before the statement flow was enforced

ALTER TABLE "PaymentInstallment"
  ADD COLUMN IF NOT EXISTS "sourceType" TEXT NOT NULL DEFAULT 'DIRECT';

CREATE INDEX IF NOT EXISTS "PaymentInstallment_sourceType_idx"
  ON "PaymentInstallment"("sourceType");
