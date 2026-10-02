-- Lote de pagamento da folha (aditivo e idempotente): um título por empresa no Contas a
-- Pagar agrupando os SALARIO da competência; a "Folha à parte" junta os retirados.
CREATE TABLE IF NOT EXISTS "FolhaLote" (
  "id" TEXT NOT NULL,
  "competenceYear" INTEGER NOT NULL,
  "competenceMonth" INTEGER NOT NULL,
  "grupo" TEXT NOT NULL,
  "rotulo" TEXT NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ABERTO',
  "paymentDate" TIMESTAMP(3),
  "paidPaymentMethodId" TEXT,
  "paidPaymentMethodName" TEXT,
  "paidByCompanyId" TEXT,
  "companyBankAccountId" TEXT,
  "paymentNotes" TEXT,
  "cancelReason" TEXT,
  "canceledAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "createdByName" TEXT NOT NULL,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FolhaLote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FolhaLote_competenceYear_competenceMonth_idx" ON "FolhaLote"("competenceYear", "competenceMonth");
CREATE INDEX IF NOT EXISTS "FolhaLote_status_idx" ON "FolhaLote"("status");
CREATE INDEX IF NOT EXISTS "FolhaLote_dueDate_idx" ON "FolhaLote"("dueDate");
-- Um só lote em aberto por competência e grupo: liberar duas vezes ao mesmo tempo não duplica.
CREATE UNIQUE INDEX IF NOT EXISTS "FolhaLote_aberto_por_grupo_key"
  ON "FolhaLote"("competenceYear", "competenceMonth", "grupo") WHERE "status" = 'ABERTO';

ALTER TABLE "PayrollItem" ADD COLUMN IF NOT EXISTS "folhaLoteId" TEXT;
ALTER TABLE "PayrollItem" ADD COLUMN IF NOT EXISTS "folhaLoteOrigemId" TEXT;
CREATE INDEX IF NOT EXISTS "PayrollItem_folhaLoteId_idx" ON "PayrollItem"("folhaLoteId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollItem_folhaLoteId_fkey') THEN
    ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_folhaLoteId_fkey"
      FOREIGN KEY ("folhaLoteId") REFERENCES "FolhaLote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
