-- CreateEnum
CREATE TYPE "EmployeeModality" AS ENUM ('CLT', 'NAO_CLT');

-- CreateEnum
CREATE TYPE "WorkScheduleRegime" AS ENUM ('SEIS_POR_UM', 'CINCO_POR_DOIS');

-- CreateEnum
CREATE TYPE "VtType" AS ENUM ('NENHUM', 'TRANSPORTE_PUBLICO', 'AUXILIO_COMBUSTIVEL');

-- CreateEnum
CREATE TYPE "VtPeriodicity" AS ENUM ('QUINZENAL', 'MENSAL');

-- CreateEnum
CREATE TYPE "VtCommute" AS ENUM ('ONIBUS', 'METRO', 'INTEGRADO', 'ONIBUS_METRO_SEPARADO');

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "rg" TEXT,
    "pis" TEXT,
    "birthDate" TIMESTAMP(3),
    "phone" TEXT,
    "email" TEXT,
    "zipCode" TEXT,
    "address" TEXT,
    "addressNumber" TEXT,
    "addressComplement" TEXT,
    "neighborhood" TEXT,
    "city" TEXT,
    "state" TEXT,
    "bankName" TEXT,
    "bankAgency" TEXT,
    "bankAccount" TEXT,
    "bankAccountDigit" TEXT,
    "bankAccountType" "BankAccountType" NOT NULL DEFAULT 'CONTA_CORRENTE',
    "pixKeyType" TEXT,
    "pixKey" TEXT,
    "sector" TEXT,
    "position" TEXT,
    "baseSalary" DECIMAL(12,2),
    "shiftStart" TEXT,
    "shiftEnd" TEXT,
    "modality" "EmployeeModality" NOT NULL DEFAULT 'CLT',
    "scheduleRegime" "WorkScheduleRegime" NOT NULL DEFAULT 'SEIS_POR_UM',
    "admissionDate" TIMESTAMP(3),
    "vtType" "VtType" NOT NULL DEFAULT 'TRANSPORTE_PUBLICO',
    "vtPeriodicity" "VtPeriodicity" NOT NULL DEFAULT 'QUINZENAL',
    "vtCommute" "VtCommute",
    "vtTripsPerDay" INTEGER DEFAULT 2,
    "vtFixedAmount" DECIMAL(12,2),
    "terminationDate" TIMESTAMP(3),
    "terminationReason" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_cpf_key" ON "Employee"("cpf");

-- CreateIndex
CREATE INDEX "Employee_cpf_idx" ON "Employee"("cpf");

-- CreateIndex
CREATE INDEX "Employee_isActive_idx" ON "Employee"("isActive");

-- CreateIndex
CREATE INDEX "Employee_sector_idx" ON "Employee"("sector");

-- CreateIndex
CREATE INDEX "Employee_lastName_firstName_idx" ON "Employee"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "Employee_terminationDate_idx" ON "Employee"("terminationDate");

-- CreateIndex
CREATE INDEX "Employee_deletedAt_idx" ON "Employee"("deletedAt");
