-- Registro idempotente de envios do resumo diário via WhatsApp.
-- Chave única (date, recipientId) impede duplicação quando o cron dispara
-- várias vezes no mesmo dia (redundância intencional).
CREATE TABLE "DailySummarySent" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "recipientName" TEXT,
    "phone" TEXT NOT NULL,
    "messageId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailySummarySent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailySummarySent_date_recipientId_key"
    ON "DailySummarySent"("date", "recipientId");

CREATE INDEX "DailySummarySent_date_idx"
    ON "DailySummarySent"("date");
