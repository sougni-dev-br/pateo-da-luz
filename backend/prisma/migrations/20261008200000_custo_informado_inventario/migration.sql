-- Custo informado na conferencia do inventario: ultima alternativa quando o
-- sistema nao acha custo nenhum para o item (sem ele o item entra a R$ 0 no CMV).
ALTER TABLE "OperationalInventoryItem" ADD COLUMN "manualUnitCost" DECIMAL(14,4);
ALTER TABLE "OperationalInventoryItem" ADD COLUMN "manualUnitCostByUserId" TEXT;
ALTER TABLE "OperationalInventoryItem" ADD COLUMN "manualUnitCostAt" TIMESTAMP(3);
