-- CreateEnum
CREATE TYPE "PayrollItemType" AS ENUM ('ADIANTAMENTO', 'SALARIO', 'VALE_TRANSPORTE');

-- CreateEnum
CREATE TYPE "PayrollItemStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'CANCELED');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "vtCreditBalance" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PayrollSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "busFare" DECIMAL(8,2) NOT NULL DEFAULT 5.30,
    "metroFare" DECIMAL(8,2) NOT NULL DEFAULT 5.40,
    "integratedFare" DECIMAL(8,2) NOT NULL DEFAULT 9.38,
    "advancePercent" DECIMAL(5,2) NOT NULL DEFAULT 40,
    "advanceDueDay" INTEGER NOT NULL DEFAULT 20,
    "salaryDueDay" INTEGER NOT NULL DEFAULT 5,
    "bufferDays" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollItem" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "PayrollItemType" NOT NULL,
    "competenceYear" INTEGER NOT NULL,
    "competenceMonth" INTEGER NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "periodStart" DATE,
    "periodEnd" DATE,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "workedDays" INTEGER,
    "freeDays" INTEGER,
    "bufferAmount" DECIMAL(12,2),
    "creditApplied" DECIMAL(12,2),
    "details" JSONB,
    "paymentDate" TIMESTAMP(3),
    "paidAmount" DECIMAL(12,2),
    "status" "PayrollItemStatus" NOT NULL DEFAULT 'PENDING',
    "dreCategoryId" TEXT,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'GENERATED',
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollItem_competenceYear_competenceMonth_idx" ON "PayrollItem"("competenceYear", "competenceMonth");

-- CreateIndex
CREATE INDEX "PayrollItem_employeeId_idx" ON "PayrollItem"("employeeId");

-- CreateIndex
CREATE INDEX "PayrollItem_status_idx" ON "PayrollItem"("status");

-- CreateIndex
CREATE INDEX "PayrollItem_dueDate_idx" ON "PayrollItem"("dueDate");

-- CreateIndex
CREATE INDEX "PayrollItem_dreCategoryId_idx" ON "PayrollItem"("dreCategoryId");

-- CreateIndex
CREATE INDEX "PayrollItem_deletedAt_idx" ON "PayrollItem"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollItem_employeeId_type_competenceYear_competenceMonth__key" ON "PayrollItem"("employeeId", "type", "competenceYear", "competenceMonth", "periodLabel");

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_dreCategoryId_fkey" FOREIGN KEY ("dreCategoryId") REFERENCES "DRECategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
