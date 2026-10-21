-- Impostos e Guias: discriminação da guia (código, denominação, principal, multa, juros) e número do documento.
ALTER TABLE "TaxPayment" ADD COLUMN IF NOT EXISTS "documentNumber" TEXT;
CREATE INDEX IF NOT EXISTS "TaxPayment_documentNumber_idx" ON "TaxPayment"("documentNumber");

CREATE TABLE IF NOT EXISTS "TaxPaymentItem" (
    "id" TEXT NOT NULL,
    "taxPaymentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "code" TEXT,
    "description" TEXT NOT NULL,
    "principal" DECIMAL(12,2) NOT NULL,
    "fine" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "interest" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxPaymentItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TaxPaymentItem_taxPaymentId_fkey" FOREIGN KEY ("taxPaymentId") REFERENCES "TaxPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "TaxPaymentItem_taxPaymentId_idx" ON "TaxPaymentItem"("taxPaymentId");
