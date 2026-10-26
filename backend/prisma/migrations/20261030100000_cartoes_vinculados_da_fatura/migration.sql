-- Cartoes vinculados a conta (fisico/virtual): so cria tabelas e uma coluna opcional.
CREATE TABLE "CreditCardFinal" (
    "id" TEXT NOT NULL,
    "creditCardId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "last4Digits" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PHYSICAL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditCardFinal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditCardStatementFinalTotal" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "cardFinalId" TEXT NOT NULL,
    "statedAmount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditCardStatementFinalTotal_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CreditCardStatementItem" ADD COLUMN "cardFinalId" TEXT;

CREATE UNIQUE INDEX "CreditCardFinal_creditCardId_last4Digits_key" ON "CreditCardFinal"("creditCardId", "last4Digits");
CREATE INDEX "CreditCardFinal_creditCardId_idx" ON "CreditCardFinal"("creditCardId");
CREATE UNIQUE INDEX "CreditCardStatementFinalTotal_statementId_cardFinalId_key" ON "CreditCardStatementFinalTotal"("statementId", "cardFinalId");
CREATE INDEX "CreditCardStatementFinalTotal_cardFinalId_idx" ON "CreditCardStatementFinalTotal"("cardFinalId");
CREATE INDEX "CreditCardStatementItem_cardFinalId_idx" ON "CreditCardStatementItem"("cardFinalId");

ALTER TABLE "CreditCardFinal" ADD CONSTRAINT "CreditCardFinal_creditCardId_fkey" FOREIGN KEY ("creditCardId") REFERENCES "CreditCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditCardStatementFinalTotal" ADD CONSTRAINT "CreditCardStatementFinalTotal_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "CreditCardStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditCardStatementFinalTotal" ADD CONSTRAINT "CreditCardStatementFinalTotal_cardFinalId_fkey" FOREIGN KEY ("cardFinalId") REFERENCES "CreditCardFinal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditCardStatementItem" ADD CONSTRAINT "CreditCardStatementItem_cardFinalId_fkey" FOREIGN KEY ("cardFinalId") REFERENCES "CreditCardFinal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
