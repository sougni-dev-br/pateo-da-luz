-- Destinatários do resumo diário WhatsApp
CREATE TABLE "WhatsAppRecipient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppRecipient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WhatsAppRecipient_isActive_idx" ON "WhatsAppRecipient"("isActive");
