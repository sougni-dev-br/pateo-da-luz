-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('LOCAL', 'R2');

-- AlterTable: make storagePath nullable, add storageProvider and storageKey
ALTER TABLE "TaxPaymentAttachment"
  ALTER COLUMN "storagePath" DROP NOT NULL,
  ADD COLUMN "storageProvider" "StorageProvider" NOT NULL DEFAULT 'LOCAL',
  ADD COLUMN "storageKey" TEXT;
