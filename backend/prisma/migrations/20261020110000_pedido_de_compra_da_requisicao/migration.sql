-- Pedido de compra gerado a partir de uma requisição de insumos: guarda de qual requisição veio,
-- para a tela mostrar "pedido já gerado" e não duplicar. Coluna opcional: os pedidos existentes não mudam.
ALTER TABLE "PurchaseOrder" ADD COLUMN "sourceRequisitionId" TEXT;

CREATE INDEX "PurchaseOrder_sourceRequisitionId_idx" ON "PurchaseOrder"("sourceRequisitionId");
