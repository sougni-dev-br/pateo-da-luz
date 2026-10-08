-- Conferido por item no inventario operacional: quem revisa marca cada alerta
-- com um motivo, e os itens podem ser mandados para recontagem.
ALTER TABLE "OperationalInventoryItem"
  ADD COLUMN "reviewReason" TEXT,
  ADD COLUMN "reviewNote" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedByUserId" TEXT,
  ADD COLUMN "recountSessionId" TEXT;

CREATE INDEX "OperationalInventoryItem_recountSessionId_idx" ON "OperationalInventoryItem"("recountSessionId");
