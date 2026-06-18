-- AddColumn: supplier default payment fields
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "defaultPaymentMethodId" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "defaultInstallmentCount" INTEGER;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "defaultInstallmentDays" JSONB;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "defaultFinancialNotes" TEXT;
