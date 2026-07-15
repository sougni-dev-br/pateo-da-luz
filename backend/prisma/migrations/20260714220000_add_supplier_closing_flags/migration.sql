-- CreateEnum
CREATE TYPE "ClosingFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL');

-- AlterTable
ALTER TABLE "Supplier"
    ADD COLUMN "requiredInMonthlyClosing" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "expectedClosingFrequency" "ClosingFrequency" NOT NULL DEFAULT 'MONTHLY',
    ADD COLUMN "closingChecklistGroup" TEXT;

-- CreateIndex
CREATE INDEX "Supplier_requiredInMonthlyClosing_idx" ON "Supplier"("requiredInMonthlyClosing");
