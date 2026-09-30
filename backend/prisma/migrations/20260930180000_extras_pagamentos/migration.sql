-- Extras, Fase 2: pagamento (título no Contas a Pagar) agrupando diárias de uma
-- pessoa, e a categoria do DRE onde o custo das diárias entra por competência.

CREATE TYPE "ExtraPaymentStatus" AS ENUM ('PENDING', 'PAID', 'CANCELED');

CREATE TABLE "ExtraPayment" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "employeeId" TEXT,
    "extraWorkerId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "ExtraPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentDate" TIMESTAMP(3),
    "paidAmount" DECIMAL(12,2),
    "paidPaymentMethodId" TEXT,
    "paidPaymentMethodName" TEXT,
    "paidByCompanyId" TEXT,
    "companyBankAccountId" TEXT,
    "differenceReason" TEXT,
    "paymentNotes" TEXT,
    "notes" TEXT,
    "cancelReason" TEXT,
    "canceledAt" TIMESTAMP(3),
    "canceledById" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExtraPayment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ExtraPayment_uma_pessoa" CHECK (("employeeId" IS NULL) <> ("extraWorkerId" IS NULL)),
    CONSTRAINT "ExtraPayment_valor_positivo" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "ExtraPayment_code_key" ON "ExtraPayment"("code");
CREATE INDEX "ExtraPayment_dueDate_idx" ON "ExtraPayment"("dueDate");
CREATE INDEX "ExtraPayment_status_idx" ON "ExtraPayment"("status");
CREATE INDEX "ExtraPayment_employeeId_idx" ON "ExtraPayment"("employeeId");
CREATE INDEX "ExtraPayment_extraWorkerId_idx" ON "ExtraPayment"("extraWorkerId");
ALTER TABLE "ExtraPayment" ADD CONSTRAINT "ExtraPayment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExtraPayment" ADD CONSTRAINT "ExtraPayment_extraWorkerId_fkey" FOREIGN KEY ("extraWorkerId") REFERENCES "ExtraWorker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExtraShift" ADD COLUMN "paymentId" TEXT;
CREATE INDEX "ExtraShift_paymentId_idx" ON "ExtraShift"("paymentId");
ALTER TABLE "ExtraShift" ADD CONSTRAINT "ExtraShift_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "ExtraPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Categoria do DRE (grupo Pessoal). Idempotente: não duplica se alguém já a
-- criou à mão pela tela de categorias. O id não tem default no banco.
INSERT INTO "DRECategory" ("id", "name", "dreGroup", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'Extras / Diárias', 'PESSOAL', 20, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "DRECategory" WHERE "name" = 'Extras / Diárias');
