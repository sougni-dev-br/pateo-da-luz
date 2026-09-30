-- Extras por diária: pessoa de fora (cadastro leve) + lançamento da diária.
-- Valor único da diária e da meia diária ficam na configuração da folha.

ALTER TABLE "PayrollSettings"
  ADD COLUMN "diariaValor" DECIMAL(12,2) NOT NULL DEFAULT 100,
  ADD COLUMN "meiaDiariaValor" DECIMAL(12,2) NOT NULL DEFAULT 50;

CREATE TYPE "ExtraShiftDuration" AS ENUM ('INTEIRA', 'MEIA');
CREATE TYPE "ExtraShiftReason" AS ENUM ('COBERTURA_FALTA', 'COBERTURA_FOLGA', 'COBERTURA_FERIAS', 'EVENTO', 'MOVIMENTO', 'OUTRO');
CREATE TYPE "ExtraShiftStatus" AS ENUM ('PREVISTA', 'REALIZADA', 'NAO_COMPARECEU', 'CANCELADA');

CREATE TABLE "ExtraWorker" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "displayName" TEXT,
    "cpf" TEXT,
    "phone" TEXT,
    "pixKeyType" TEXT,
    "pixKey" TEXT,
    "referredBy" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExtraWorker_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExtraShift" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "employeeId" TEXT,
    "extraWorkerId" TEXT,
    "sector" TEXT NOT NULL,
    "role" TEXT,
    "startTime" TEXT,
    "endTime" TEXT,
    "duration" "ExtraShiftDuration" NOT NULL DEFAULT 'INTEIRA',
    "reason" "ExtraShiftReason" NOT NULL,
    "coveredEmployeeId" TEXT,
    "baseAmount" DECIMAL(12,2) NOT NULL,
    "baseAdjustReason" TEXT,
    "transportAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bonusAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "status" "ExtraShiftStatus" NOT NULL DEFAULT 'REALIZADA',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deleteReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExtraShift_pkey" PRIMARY KEY ("id"),
    -- Exatamente uma pessoa: funcionário da casa OU pessoa de fora.
    CONSTRAINT "ExtraShift_uma_pessoa" CHECK (("employeeId" IS NULL) <> ("extraWorkerId" IS NULL)),
    CONSTRAINT "ExtraShift_valores_nao_negativos" CHECK (
      "baseAmount" >= 0 AND "transportAmount" >= 0 AND "bonusAmount" >= 0 AND "discountAmount" >= 0 AND "totalAmount" >= 0
    )
);

-- CPF único só entre cadastros vivos: excluir alguém não pode travar o CPF para
-- sempre. (Parcial: o Prisma não representa, fica só aqui.)
CREATE UNIQUE INDEX "ExtraWorker_cpf_vivo_key" ON "ExtraWorker"("cpf") WHERE "deletedAt" IS NULL AND "cpf" IS NOT NULL;
CREATE INDEX "ExtraWorker_cpf_idx" ON "ExtraWorker"("cpf");
CREATE INDEX "ExtraWorker_fullName_idx" ON "ExtraWorker"("fullName");
CREATE INDEX "ExtraWorker_deletedAt_idx" ON "ExtraWorker"("deletedAt");
CREATE INDEX "ExtraShift_date_idx" ON "ExtraShift"("date");
CREATE INDEX "ExtraShift_employeeId_idx" ON "ExtraShift"("employeeId");
CREATE INDEX "ExtraShift_extraWorkerId_idx" ON "ExtraShift"("extraWorkerId");
CREATE INDEX "ExtraShift_deletedAt_idx" ON "ExtraShift"("deletedAt");

ALTER TABLE "ExtraShift" ADD CONSTRAINT "ExtraShift_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExtraShift" ADD CONSTRAINT "ExtraShift_extraWorkerId_fkey" FOREIGN KEY ("extraWorkerId") REFERENCES "ExtraWorker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExtraShift" ADD CONSTRAINT "ExtraShift_coveredEmployeeId_fkey" FOREIGN KEY ("coveredEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Uma diária ATIVA por pessoa por dia, garantida no banco (a checagem da rota
-- sozinha deixava dois cliques rápidos gravarem duas). Cancelada, "não
-- compareceu" e excluída ficam de fora para permitir relançar.
CREATE UNIQUE INDEX "ExtraShift_ativa_casa_key" ON "ExtraShift"("employeeId", "date")
  WHERE "deletedAt" IS NULL AND "status" IN ('PREVISTA', 'REALIZADA') AND "employeeId" IS NOT NULL;
CREATE UNIQUE INDEX "ExtraShift_ativa_fora_key" ON "ExtraShift"("extraWorkerId", "date")
  WHERE "deletedAt" IS NULL AND "status" IN ('PREVISTA', 'REALIZADA') AND "extraWorkerId" IS NOT NULL;
