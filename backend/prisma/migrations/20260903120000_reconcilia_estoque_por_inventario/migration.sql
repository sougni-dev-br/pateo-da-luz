-- Reconciliacao do estoque a partir do inventario aprovado (F-05).
--
-- Ate aqui o InventoryStock."currentQuantity" so crescia por compra e so diminuia
-- por movimentacao manual: aprovar inventario nao ajustava nada. O saldo esperado
-- virava ficcao (ALCATRA com 1.682 kg esperados) e a coluna de divergencia deixava
-- de servir como alarme — foi o que escondeu por meses o bug da virgula.
--
-- Duas colunas, ambas anulaveis e aditivas:
--   OperationalInventory."stockReconciledAt" marca que aquele inventario ja
--   ajustou o estoque. A rota de aprovacao aceita reaprovar um inventario ja
--   aprovado, entao sem esta marca o ajuste seria aplicado duas vezes.
--
--   InventoryMovement."sourceOperationalInventoryId" liga o ajuste ao inventario
--   que o originou, do mesmo jeito que sourceStockCountId ja faz para contagem
--   avulsa. Sem isso o ADJUSTMENT apareceria no extrato sem origem rastreavel.

ALTER TABLE "OperationalInventory" ADD COLUMN "stockReconciledAt" TIMESTAMP(3);

ALTER TABLE "InventoryMovement" ADD COLUMN "sourceOperationalInventoryId" TEXT;

CREATE INDEX "InventoryMovement_sourceOperationalInventoryId_idx"
  ON "InventoryMovement"("sourceOperationalInventoryId");
