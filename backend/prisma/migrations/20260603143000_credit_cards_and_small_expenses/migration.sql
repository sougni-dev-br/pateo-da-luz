CREATE TYPE "CreditCardStatementStatus" AS ENUM ('OPEN', 'CHECKED', 'CLOSED', 'PAID', 'CANCELLED');

ALTER TABLE "Purchase"
ADD COLUMN "noInvoiceReason" TEXT,
ADD COLUMN "creditCardId" TEXT,
ADD COLUMN "smallExpenseResponsibleName" TEXT,
ADD COLUMN "smallExpenseAuthorizedBy" TEXT,
ADD COLUMN "smallExpenseMoneyOrigin" TEXT,
ADD COLUMN "smallExpenseNotes" TEXT;

CREATE TABLE "CreditCard" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "bankName" TEXT NOT NULL,
  "last4Digits" TEXT NOT NULL,
  "closingDay" INTEGER NOT NULL,
  "dueDay" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreditCard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditCardStatement" (
  "id" TEXT NOT NULL,
  "creditCardId" TEXT NOT NULL,
  "name" TEXT,
  "competenceYear" INTEGER NOT NULL,
  "competenceMonth" INTEGER NOT NULL,
  "closingDate" TIMESTAMP(3) NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "status" "CreditCardStatementStatus" NOT NULL DEFAULT 'OPEN',
  "notes" TEXT,
  "generatedPurchaseId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreditCardStatement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditCardStatementItem" (
  "id" TEXT NOT NULL,
  "statementId" TEXT NOT NULL,
  "purchaseId" TEXT,
  "purchaseItemId" TEXT,
  "itemDate" TIMESTAMP(3),
  "description" TEXT NOT NULL,
  "supplierName" TEXT,
  "value" DECIMAL(12,2) NOT NULL,
  "installment" INTEGER,
  "totalInstallments" INTEGER,
  "categoryName" TEXT,
  "smallExpenseTypeId" TEXT,
  "responsibleName" TEXT,
  "checked" BOOLEAN NOT NULL DEFAULT FALSE,
  "hasDivergence" BOOLEAN NOT NULL DEFAULT FALSE,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreditCardStatementItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CreditCard_name_idx" ON "CreditCard"("name");
CREATE INDEX "CreditCard_bankName_idx" ON "CreditCard"("bankName");
CREATE INDEX "CreditCard_last4Digits_idx" ON "CreditCard"("last4Digits");
CREATE INDEX "CreditCard_isActive_idx" ON "CreditCard"("isActive");

CREATE INDEX "CreditCardStatement_creditCardId_idx" ON "CreditCardStatement"("creditCardId");
CREATE INDEX "CreditCardStatement_competenceYear_competenceMonth_idx" ON "CreditCardStatement"("competenceYear", "competenceMonth");
CREATE INDEX "CreditCardStatement_status_idx" ON "CreditCardStatement"("status");
CREATE INDEX "CreditCardStatement_closingDate_idx" ON "CreditCardStatement"("closingDate");
CREATE INDEX "CreditCardStatement_dueDate_idx" ON "CreditCardStatement"("dueDate");
CREATE UNIQUE INDEX "CreditCardStatement_creditCardId_competenceYear_competenceMonth_key" ON "CreditCardStatement"("creditCardId", "competenceYear", "competenceMonth");

CREATE INDEX "CreditCardStatementItem_statementId_idx" ON "CreditCardStatementItem"("statementId");
CREATE INDEX "CreditCardStatementItem_purchaseId_idx" ON "CreditCardStatementItem"("purchaseId");
CREATE INDEX "CreditCardStatementItem_purchaseItemId_idx" ON "CreditCardStatementItem"("purchaseItemId");
CREATE INDEX "CreditCardStatementItem_smallExpenseTypeId_idx" ON "CreditCardStatementItem"("smallExpenseTypeId");
CREATE INDEX "CreditCardStatementItem_checked_idx" ON "CreditCardStatementItem"("checked");
CREATE INDEX "CreditCardStatementItem_hasDivergence_idx" ON "CreditCardStatementItem"("hasDivergence");
CREATE UNIQUE INDEX "CreditCardStatementItem_purchaseId_key" ON "CreditCardStatementItem"("purchaseId");

ALTER TABLE "Purchase"
ADD CONSTRAINT "Purchase_creditCardId_fkey"
FOREIGN KEY ("creditCardId") REFERENCES "CreditCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CreditCardStatement"
ADD CONSTRAINT "CreditCardStatement_creditCardId_fkey"
FOREIGN KEY ("creditCardId") REFERENCES "CreditCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreditCardStatementItem"
ADD CONSTRAINT "CreditCardStatementItem_statementId_fkey"
FOREIGN KEY ("statementId") REFERENCES "CreditCardStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "CreditCardStatementItem_purchaseId_fkey"
FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "CreditCardStatementItem_purchaseItemId_fkey"
FOREIGN KEY ("purchaseItemId") REFERENCES "PurchaseItem"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "CreditCardStatementItem_smallExpenseTypeId_fkey"
FOREIGN KEY ("smallExpenseTypeId") REFERENCES "SmallExpenseType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Purchase_creditCardId_idx" ON "Purchase"("creditCardId");
CREATE INDEX "Purchase_smallExpenseMoneyOrigin_idx" ON "Purchase"("smallExpenseMoneyOrigin");
