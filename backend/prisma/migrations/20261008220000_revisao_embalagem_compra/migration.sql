-- Revisao de embalagens: marca a linha de compra conferida (avulso confirmado
-- ou embalagem aplicada) para ela nao voltar a aparecer como suspeita.
ALTER TABLE "PurchaseItem" ADD COLUMN "packagingReviewedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseItem" ADD COLUMN "packagingReviewedByUserId" TEXT;
