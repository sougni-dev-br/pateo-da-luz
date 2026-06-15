-- AlterTable
ALTER TABLE "PaymentMethod" ADD COLUMN "group" TEXT;

-- CreateTable
CREATE TABLE "SmallExpenseType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "group" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmallExpenseType_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN "smallExpenseTypeId" TEXT;

-- CreateIndex
CREATE INDEX "PaymentMethod_group_idx" ON "PaymentMethod"("group");

-- CreateIndex
CREATE UNIQUE INDEX "SmallExpenseType_normalizedName_key" ON "SmallExpenseType"("normalizedName");

-- CreateIndex
CREATE INDEX "SmallExpenseType_name_idx" ON "SmallExpenseType"("name");

-- CreateIndex
CREATE INDEX "SmallExpenseType_group_idx" ON "SmallExpenseType"("group");

-- CreateIndex
CREATE INDEX "SmallExpenseType_isActive_idx" ON "SmallExpenseType"("isActive");

-- CreateIndex
CREATE INDEX "Purchase_smallExpenseTypeId_idx" ON "Purchase"("smallExpenseTypeId");

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_smallExpenseTypeId_fkey" FOREIGN KEY ("smallExpenseTypeId") REFERENCES "SmallExpenseType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed payment methods
INSERT INTO "PaymentMethod" ("id", "name", "normalizedName", "type", "group", "isActive", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'DINHEIRO', 'dinheiro', 'CASH', 'dinheiro', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'PIX', 'pix', 'PIX', 'pix', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'BOLETO', 'boleto', 'BANK_SLIP', 'boleto', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'BOLETO 2X', 'boleto 2x', 'BANK_SLIP', 'boleto', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'BOLETO 3X', 'boleto 3x', 'BANK_SLIP', 'boleto', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'BOLETO 4X', 'boleto 4x', 'BANK_SLIP', 'boleto', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'BOLETO 5X', 'boleto 5x', 'BANK_SLIP', 'boleto', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'BOLETO 6X', 'boleto 6x', 'BANK_SLIP', 'boleto', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'BOLETO 7X', 'boleto 7x', 'BANK_SLIP', 'boleto', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'BOLETO 8X', 'boleto 8x', 'BANK_SLIP', 'boleto', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'CARTAO CREDITO', 'cartao credito', 'CREDIT_CARD', 'cartao', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'FATURADO', 'faturado', 'OTHER', 'faturado', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'CARTAO DEBITO', 'cartao debito', 'DEBIT_CARD', 'cartao', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("normalizedName") DO UPDATE SET
  "name" = EXCLUDED."name",
  "type" = EXCLUDED."type",
  "group" = EXCLUDED."group",
  "updatedAt" = CURRENT_TIMESTAMP;
