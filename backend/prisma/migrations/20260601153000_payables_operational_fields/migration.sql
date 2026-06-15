ALTER TABLE "PaymentInstallment"
  ADD COLUMN IF NOT EXISTS "paidAmount" DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS "paidPaymentMethodId" TEXT,
  ADD COLUMN IF NOT EXISTS "paidPaymentMethodName" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "paidByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "reversedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reversedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "cashFlowCategory" TEXT,
  ADD COLUMN IF NOT EXISTS "dreCategory" TEXT,
  ADD COLUMN IF NOT EXISTS "projectionCategory" TEXT,
  ADD COLUMN IF NOT EXISTS "cmvCategory" TEXT,
  ADD COLUMN IF NOT EXISTS "budgetCategory" TEXT,
  ADD COLUMN IF NOT EXISTS "bankAccount" TEXT,
  ADD COLUMN IF NOT EXISTS "reconciliationStatus" TEXT;

CREATE INDEX IF NOT EXISTS "PaymentInstallment_paidPaymentMethodId_idx" ON "PaymentInstallment"("paidPaymentMethodId");
CREATE INDEX IF NOT EXISTS "PaymentInstallment_reconciliationStatus_idx" ON "PaymentInstallment"("reconciliationStatus");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PaymentInstallment_paidPaymentMethodId_fkey'
  ) THEN
    ALTER TABLE "PaymentInstallment"
      ADD CONSTRAINT "PaymentInstallment_paidPaymentMethodId_fkey"
      FOREIGN KEY ("paidPaymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
