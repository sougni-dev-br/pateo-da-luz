-- Reembolso a funcionario no modelo do ciclo de fornecedor / fatura de cartao:
-- cada compra paga pela pessoa fica com a loja e a data dela, e o fechamento do
-- reembolso gera um unico titulo a pagar para a pessoa.

ALTER TABLE "Purchase" ADD COLUMN "reimbursementPayeeId" TEXT;
CREATE INDEX "Purchase_reimbursementPayeeId_idx" ON "Purchase"("reimbursementPayeeId");
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_reimbursementPayeeId_fkey"
  FOREIGN KEY ("reimbursementPayeeId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ReimbursementReport" (
    "id" TEXT NOT NULL,
    "payeeSupplierId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdByUserId" TEXT,
    "closedByUserId" TEXT,
    "closedAt" TIMESTAMP(3),
    "generatedPurchaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReimbursementReport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReimbursementReport_payeeSupplierId_status_idx" ON "ReimbursementReport"("payeeSupplierId", "status");
CREATE INDEX "ReimbursementReport_status_idx" ON "ReimbursementReport"("status");
CREATE INDEX "ReimbursementReport_generatedPurchaseId_idx" ON "ReimbursementReport"("generatedPurchaseId");
ALTER TABLE "ReimbursementReport" ADD CONSTRAINT "ReimbursementReport_payeeSupplierId_fkey"
  FOREIGN KEY ("payeeSupplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Um unico relatorio aberto por pessoa: as compras novas sempre caem nele.
CREATE UNIQUE INDEX "ReimbursementReport_one_open_per_payee"
  ON "ReimbursementReport"("payeeSupplierId") WHERE "status" = 'OPEN';

CREATE TABLE "ReimbursementReportItem" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "purchaseDate" TIMESTAMP(3) NOT NULL,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReimbursementReportItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReimbursementReportItem_purchaseId_key" ON "ReimbursementReportItem"("purchaseId");
CREATE INDEX "ReimbursementReportItem_reportId_idx" ON "ReimbursementReportItem"("reportId");
ALTER TABLE "ReimbursementReportItem" ADD CONSTRAINT "ReimbursementReportItem_reportId_fkey"
  FOREIGN KEY ("reportId") REFERENCES "ReimbursementReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReimbursementReportItem" ADD CONSTRAINT "ReimbursementReportItem_purchaseId_fkey"
  FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A forma de pagamento que, escolhida em Compras, pede "quem pagou".
INSERT INTO "PaymentMethod" ("id", "name", "normalizedName", "type", "group", "isActive", "notes", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'REEMBOLSO FUNCIONARIO', 'reembolso funcionario', 'REIMBURSEMENT', 'reembolso', true,
        'Compra paga do bolso de um funcionario. Entra no reembolso da pessoa; o titulo nasce ao fechar o reembolso.',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("normalizedName") DO UPDATE SET "type" = 'REIMBURSEMENT', "isActive" = true;

-- Defaults de papel espelhando "supplier-cycles"; o admin ajusta por usuario na tela de Permissoes.
INSERT INTO "RoleMenuPermission"
  ("id", "role", "menuId", "accessLevel", "canView", "canCreate", "canEdit", "canDelete", "canApprove", "canAdmin", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'ADMIN',           'reimbursements', 'FULL', true,  true,  true,  true,  true,  true,  CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'GESTAO_COMPLETA', 'reimbursements', 'FULL', true,  true,  true,  true,  true,  true,  CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'VISUALIZACAO',    'reimbursements', 'VIEW', true,  false, false, false, false, false, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ESTOQUISTA',      'reimbursements', 'NONE', false, false, false, false, false, false, CURRENT_TIMESTAMP)
ON CONFLICT ("role", "menuId") DO NOTHING;
