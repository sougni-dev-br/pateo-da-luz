ALTER TABLE "PaymentInstallment"
  ADD COLUMN "paymentMethodId" TEXT,
  ADD COLUMN "paymentMethodName" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'OPEN';

ALTER TABLE "PaymentInstallment"
  ADD CONSTRAINT "PaymentInstallment_paymentMethodId_fkey"
  FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "PaymentInstallment_paymentMethodId_idx" ON "PaymentInstallment"("paymentMethodId");
CREATE INDEX "PaymentInstallment_status_idx" ON "PaymentInstallment"("status");
