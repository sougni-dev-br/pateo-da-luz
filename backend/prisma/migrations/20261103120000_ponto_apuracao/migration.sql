-- CreateEnum
CREATE TYPE "PontoOrigem" AS ENUM ('PAPEL', 'RELOGIO');

-- CreateEnum
CREATE TYPE "PontoFechamentoStatus" AS ENUM ('ABERTO', 'FECHADO');

-- CreateTable
CREATE TABLE "PontoDia" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "origem" "PontoOrigem" NOT NULL,
    "marcacoes" TEXT[],
    "editadoManual" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PontoDia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PontoFechamento" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "PontoFechamentoStatus" NOT NULL DEFAULT 'ABERTO',
    "saldoInicialMin" INTEGER NOT NULL DEFAULT 0,
    "saldoFinalMin" INTEGER NOT NULL DEFAULT 0,
    "atrasoMin" INTEGER NOT NULL DEFAULT 0,
    "debitoFolgaMin" INTEGER NOT NULL DEFAULT 0,
    "extraMin" INTEGER NOT NULL DEFAULT 0,
    "abatidoMin" INTEGER NOT NULL DEFAULT 0,
    "extraAPagarMin" INTEGER NOT NULL DEFAULT 0,
    "extraDescansoMin" INTEGER NOT NULL DEFAULT 0,
    "noturnoMin" INTEGER NOT NULL DEFAULT 0,
    "faltas" INTEGER NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PontoFechamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PontoDia_date_idx" ON "PontoDia"("date");

-- CreateIndex
CREATE UNIQUE INDEX "PontoDia_employeeId_date_key" ON "PontoDia"("employeeId", "date");

-- CreateIndex
CREATE INDEX "PontoFechamento_year_month_idx" ON "PontoFechamento"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "PontoFechamento_employeeId_year_month_key" ON "PontoFechamento"("employeeId", "year", "month");

-- AddForeignKey
ALTER TABLE "PontoDia" ADD CONSTRAINT "PontoDia_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PontoFechamento" ADD CONSTRAINT "PontoFechamento_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

