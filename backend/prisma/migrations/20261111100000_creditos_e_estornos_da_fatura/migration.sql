-- Creditos e estornos da fatura do cartao: so cria uma tabela e uma coluna opcional.
CREATE TABLE "CreditCardStatementAdjustment" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "cardFinalId" TEXT,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "adjustmentDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditCardStatementAdjustment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CreditCardStatement" ADD COLUMN "statedTotalAmount" DECIMAL(12,2);

CREATE INDEX "CreditCardStatementAdjustment_statementId_idx" ON "CreditCardStatementAdjustment"("statementId");
CREATE INDEX "CreditCardStatementAdjustment_cardFinalId_idx" ON "CreditCardStatementAdjustment"("cardFinalId");

ALTER TABLE "CreditCardStatementAdjustment" ADD CONSTRAINT "CreditCardStatementAdjustment_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "CreditCardStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditCardStatementAdjustment" ADD CONSTRAINT "CreditCardStatementAdjustment_cardFinalId_fkey" FOREIGN KEY ("cardFinalId") REFERENCES "CreditCardFinal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
