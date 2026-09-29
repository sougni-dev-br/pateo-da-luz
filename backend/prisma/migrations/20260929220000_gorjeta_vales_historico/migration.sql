-- Vales da gorjeta: quem lançou, quem alterou e cancelamento com motivo.
-- Cancelar não apaga o vale: ele continua no histórico e nos relatórios.
ALTER TABLE "TipVale" ADD COLUMN "createdByName" TEXT;
ALTER TABLE "TipVale" ADD COLUMN "updatedById" TEXT;
ALTER TABLE "TipVale" ADD COLUMN "updatedAt" TIMESTAMP(3);
ALTER TABLE "TipVale" ADD COLUMN "canceledAt" TIMESTAMP(3);
ALTER TABLE "TipVale" ADD COLUMN "canceledById" TEXT;
ALTER TABLE "TipVale" ADD COLUMN "canceledByName" TEXT;
ALTER TABLE "TipVale" ADD COLUMN "cancelReason" TEXT;
CREATE INDEX "TipVale_canceledAt_idx" ON "TipVale"("canceledAt");
