-- Vínculo entre o item do pedido de compra e a nota (compra) que o atendeu. Só acrescenta a tabela:
-- nenhum pedido nem compra existente muda. O recebido do pedido passa a ser a soma destes vínculos.
CREATE TABLE "PurchaseOrderItemLink" (
    "id" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderItemLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseOrderItemLink_purchaseOrderItemId_purchaseId_key" ON "PurchaseOrderItemLink"("purchaseOrderItemId", "purchaseId");
CREATE INDEX "PurchaseOrderItemLink_purchaseId_idx" ON "PurchaseOrderItemLink"("purchaseId");

ALTER TABLE "PurchaseOrderItemLink" ADD CONSTRAINT "PurchaseOrderItemLink_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderItemLink" ADD CONSTRAINT "PurchaseOrderItemLink_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- O recebido do pedido passa a ser a parte registrada à mão mais a soma dos vínculos com notas. O que já foi
-- recebido à mão até hoje (ainda não existe nenhum vínculo) vira a parte manual, para nenhuma nota apagá-lo.
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "receivedManualQuantity" DECIMAL(14,3);
UPDATE "PurchaseOrderItem" SET "receivedManualQuantity" = "receivedQuantity" WHERE "receivedQuantity" IS NOT NULL;
