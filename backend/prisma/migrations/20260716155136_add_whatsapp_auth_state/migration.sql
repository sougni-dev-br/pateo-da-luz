-- Tabela para persistir o estado de auth do Baileys (creds + signal keys)
-- Sem isso, o backend exige re-escaneio de QR a cada restart/deploy.
CREATE TABLE "WhatsAppAuthState" (
    "id" TEXT NOT NULL,
    "sessionName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppAuthState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppAuthState_sessionName_category_key_key"
    ON "WhatsAppAuthState"("sessionName", "category", "key");

CREATE INDEX "WhatsAppAuthState_sessionName_idx"
    ON "WhatsAppAuthState"("sessionName");
