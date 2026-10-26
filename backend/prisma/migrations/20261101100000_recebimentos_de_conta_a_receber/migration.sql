-- Recebimentos (totais ou parciais) de uma conta a receber, com estorno que preserva o histórico.
-- Só cria tabela e índices: nenhuma linha existente é tocada. Os recebimentos antigos
-- (feitos antes desta tabela) são materializados sob demanda pelo serviço, ao estornar.
CREATE TABLE "ReceivableReceipt" (
    "id" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "receivedDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paymentMethod" TEXT,
    "bankAccountId" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversedByUserId" TEXT,
    "reversalReason" TEXT,

    CONSTRAINT "ReceivableReceipt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReceivableReceipt_receivableId_idx" ON "ReceivableReceipt"("receivableId");
CREATE INDEX "ReceivableReceipt_receivedDate_idx" ON "ReceivableReceipt"("receivedDate");

ALTER TABLE "ReceivableReceipt" ADD CONSTRAINT "ReceivableReceipt_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "Receivable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
