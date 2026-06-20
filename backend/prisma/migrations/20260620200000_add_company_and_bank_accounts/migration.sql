-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('CONTA_CORRENTE', 'POUPANCA', 'CAIXA', 'CARTEIRA', 'CARTAO', 'OUTROS');

-- CreateTable: Company
CREATE TABLE "Company" (
    "id"                    TEXT NOT NULL,
    "code"                  TEXT NOT NULL,
    "tradeName"             TEXT NOT NULL,
    "legalName"             TEXT NOT NULL,
    "cnpj"                  TEXT NOT NULL,
    "stateRegistration"     TEXT,
    "municipalRegistration" TEXT,
    "financialEmail"        TEXT,
    "phone"                 TEXT,
    "zipCode"               TEXT,
    "address"               TEXT,
    "addressNumber"         TEXT,
    "addressComplement"     TEXT,
    "neighborhood"          TEXT,
    "city"                  TEXT,
    "state"                 TEXT,
    "notes"                 TEXT,
    "isActive"              BOOLEAN NOT NULL DEFAULT true,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CompanyBankAccount
CREATE TABLE "CompanyBankAccount" (
    "id"           TEXT NOT NULL,
    "companyId"    TEXT NOT NULL,
    "bankName"     TEXT,
    "agency"       TEXT,
    "account"      TEXT,
    "accountDigit" TEXT,
    "accountType"  "BankAccountType" NOT NULL DEFAULT 'CONTA_CORRENTE',
    "pixKey"       TEXT,
    "name"         TEXT NOT NULL,
    "notes"        TEXT,
    "isActive"     BOOLEAN NOT NULL DEFAULT true,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyBankAccount_pkey" PRIMARY KEY ("id")
);

-- Add companyId to Purchase (nullable, safe for existing data)
ALTER TABLE "Purchase" ADD COLUMN "companyId" TEXT;

-- Add payingCompanyId and companyBankAccountId to PaymentInstallment (nullable)
ALTER TABLE "PaymentInstallment" ADD COLUMN "payingCompanyId" TEXT;
ALTER TABLE "PaymentInstallment" ADD COLUMN "companyBankAccountId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Company_code_key" ON "Company"("code");
CREATE UNIQUE INDEX "Company_cnpj_key" ON "Company"("cnpj");
CREATE INDEX "Company_cnpj_idx" ON "Company"("cnpj");
CREATE INDEX "Company_code_idx" ON "Company"("code");
CREATE INDEX "Company_isActive_idx" ON "Company"("isActive");
CREATE INDEX "CompanyBankAccount_companyId_idx" ON "CompanyBankAccount"("companyId");
CREATE INDEX "CompanyBankAccount_isActive_idx" ON "CompanyBankAccount"("isActive");
CREATE INDEX "Purchase_companyId_idx" ON "Purchase"("companyId");
CREATE INDEX "PaymentInstallment_payingCompanyId_idx" ON "PaymentInstallment"("payingCompanyId");
CREATE INDEX "PaymentInstallment_companyBankAccountId_idx" ON "PaymentInstallment"("companyBankAccountId");

-- AddForeignKey
ALTER TABLE "CompanyBankAccount" ADD CONSTRAINT "CompanyBankAccount_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaymentInstallment" ADD CONSTRAINT "PaymentInstallment_payingCompanyId_fkey"
    FOREIGN KEY ("payingCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaymentInstallment" ADD CONSTRAINT "PaymentInstallment_companyBankAccountId_fkey"
    FOREIGN KEY ("companyBankAccountId") REFERENCES "CompanyBankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
