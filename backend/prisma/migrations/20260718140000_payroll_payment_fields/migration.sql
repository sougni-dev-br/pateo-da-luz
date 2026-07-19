-- Campos de baixa da folha para paridade com títulos normais (forma de pagamento,
-- empresa/conta pagadora, diferença e observação da baixa).
ALTER TABLE "PayrollItem"
  ADD COLUMN "paidPaymentMethodId" TEXT,
  ADD COLUMN "paidPaymentMethodName" TEXT,
  ADD COLUMN "paidByCompanyId" TEXT,
  ADD COLUMN "companyBankAccountId" TEXT,
  ADD COLUMN "differenceReason" TEXT,
  ADD COLUMN "paymentNotes" TEXT;
