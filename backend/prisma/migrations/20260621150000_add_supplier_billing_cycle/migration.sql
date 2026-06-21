-- Etapa 1: Faturamento por Ciclo de Fornecedor
-- Adiciona campos de configuração de ciclo no Supplier
-- Cria SupplierBillingCycle e SupplierBillingCycleItem
-- Não altera dados existentes. billingMode DEFAULT 'DIRECT' garante continuidade para todos os fornecedores atuais.

-- Supplier: novos campos de billing cycle
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "billingMode"        TEXT NOT NULL DEFAULT 'DIRECT';
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "cycleFrequency"     TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "cycleFirstDueDays"  INTEGER;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "cycleSecondDueDays" INTEGER;
CREATE INDEX IF NOT EXISTS "Supplier_billingMode_idx" ON "Supplier"("billingMode");

-- Tabela de ciclos de faturamento por fornecedor
CREATE TABLE "SupplierBillingCycle" (
  "id"                  TEXT          NOT NULL,
  "supplierId"          TEXT          NOT NULL,
  "periodStart"         TIMESTAMP(3)  NOT NULL,
  "periodEnd"           TIMESTAMP(3),
  "status"              TEXT          NOT NULL DEFAULT 'OPEN',
  "totalAmount"         DECIMAL(12,2) NOT NULL DEFAULT 0,
  "notes"               TEXT,
  "createdByUserId"     TEXT,
  "checkedByUserId"     TEXT,
  "closedByUserId"      TEXT,
  "checkedAt"           TIMESTAMP(3),
  "closedAt"            TIMESTAMP(3),
  "generatedPurchaseId" TEXT,
  "createdAt"           TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierBillingCycle_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupplierBillingCycle_supplierId_idx"        ON "SupplierBillingCycle"("supplierId");
CREATE INDEX "SupplierBillingCycle_supplierId_status_idx" ON "SupplierBillingCycle"("supplierId", "status");
CREATE INDEX "SupplierBillingCycle_status_idx"            ON "SupplierBillingCycle"("status");
CREATE INDEX "SupplierBillingCycle_periodStart_idx"       ON "SupplierBillingCycle"("periodStart");
ALTER TABLE "SupplierBillingCycle"
  ADD CONSTRAINT "SupplierBillingCycle_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierBillingCycle"
  ADD CONSTRAINT "SupplierBillingCycle_generatedPurchaseId_fkey"
  FOREIGN KEY ("generatedPurchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

-- Itens do ciclo (uma compra → um item, constraint unique garante isso)
CREATE TABLE "SupplierBillingCycleItem" (
  "id"               TEXT          NOT NULL,
  "cycleId"          TEXT          NOT NULL,
  "purchaseId"       TEXT          NOT NULL,
  "amount"           DECIMAL(12,2) NOT NULL,
  "purchaseDate"     TIMESTAMP(3)  NOT NULL,
  "invoiceNumber"    TEXT,
  "checked"          BOOLEAN       NOT NULL DEFAULT FALSE,
  "hasDivergence"    BOOLEAN       NOT NULL DEFAULT FALSE,
  "divergenceAmount" DECIMAL(12,2),
  "notes"            TEXT,
  "createdAt"        TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierBillingCycleItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupplierBillingCycleItem_purchaseId_key" ON "SupplierBillingCycleItem"("purchaseId");
CREATE        INDEX "SupplierBillingCycleItem_cycleId_idx"    ON "SupplierBillingCycleItem"("cycleId");
CREATE        INDEX "SupplierBillingCycleItem_checked_idx"    ON "SupplierBillingCycleItem"("checked");
ALTER TABLE "SupplierBillingCycleItem"
  ADD CONSTRAINT "SupplierBillingCycleItem_cycleId_fkey"
  FOREIGN KEY ("cycleId") REFERENCES "SupplierBillingCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierBillingCycleItem"
  ADD CONSTRAINT "SupplierBillingCycleItem_purchaseId_fkey"
  FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
