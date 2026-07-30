-- Folha da Gorjeta (Fase A) + total de pontos + dados do RH + rastreabilidade do Extrato.
-- Idempotente: roda limpo no Render (banco sem estas tabelas) e é marcada como já
-- aplicada no ambiente local (onde as tabelas já existem, criadas via SQL manual).

-- ── Enums ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE "TipPeriodStatus" AS ENUM ('OPEN','CLOSED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "TipParticipantKind" AS ENUM ('FIXO','PONTOS'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "TipValeType" AS ENUM ('REFEICAO','VALE_CONSUMO','RETIRADA_CAIXA','ADIANTAMENTO','OUTRO'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── Employee: campos de gorjeta ───────────────────────────────────────────────
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "participaGorjeta" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "tipoGorjeta" "TipParticipantKind" NOT NULL DEFAULT 'PONTOS';
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "cotaFixaGorjeta" DECIMAL(14,2);
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "pontosPadrao" INTEGER;
CREATE INDEX IF NOT EXISTS "Employee_companyId_idx" ON "Employee"("companyId");
DO $$ BEGIN
  ALTER TABLE "Employee" ADD CONSTRAINT "Employee_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── TipPeriod ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TipPeriod" (
  "id" TEXT NOT NULL,
  "competenceYear" INTEGER NOT NULL,
  "competenceMonth" INTEGER NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "label" TEXT NOT NULL,
  "grossPool" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "poolSource" TEXT NOT NULL DEFAULT 'REVENUE',
  "deductionPercent" DECIMAL(5,2) NOT NULL DEFAULT 20,
  "netPool" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "pointsTotal" INTEGER NOT NULL DEFAULT 100,
  "pointValue" DECIMAL(14,6) NOT NULL DEFAULT 0,
  "status" "TipPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "closedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TipPeriod_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "TipPeriod" ADD COLUMN IF NOT EXISTS "pointsTotal" INTEGER NOT NULL DEFAULT 100;
CREATE UNIQUE INDEX IF NOT EXISTS "TipPeriod_competenceYear_competenceMonth_key" ON "TipPeriod"("competenceYear","competenceMonth");
CREATE INDEX IF NOT EXISTS "TipPeriod_status_idx" ON "TipPeriod"("status");

-- ── TipParticipant (inclui dados do RH) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TipParticipant" (
  "id" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "kind" "TipParticipantKind" NOT NULL DEFAULT 'PONTOS',
  "points" INTEGER,
  "fixedAmount" DECIMAL(14,2),
  "rateioAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "valesTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "netCommission" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "horaExtra" TEXT,
  "adicionalNoturno" TEXT,
  "faltas" INTEGER,
  "justificada" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TipParticipant_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "TipParticipant" ADD COLUMN IF NOT EXISTS "horaExtra" TEXT;
ALTER TABLE "TipParticipant" ADD COLUMN IF NOT EXISTS "adicionalNoturno" TEXT;
ALTER TABLE "TipParticipant" ADD COLUMN IF NOT EXISTS "faltas" INTEGER;
ALTER TABLE "TipParticipant" ADD COLUMN IF NOT EXISTS "justificada" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS "TipParticipant_periodId_employeeId_key" ON "TipParticipant"("periodId","employeeId");
CREATE INDEX IF NOT EXISTS "TipParticipant_employeeId_idx" ON "TipParticipant"("employeeId");
DO $$ BEGIN
  ALTER TABLE "TipParticipant" ADD CONSTRAINT "TipParticipant_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "TipPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "TipParticipant" ADD CONSTRAINT "TipParticipant_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── TipVale ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TipVale" (
  "id" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "type" "TipValeType" NOT NULL DEFAULT 'OUTRO',
  "amount" DECIMAL(14,2) NOT NULL,
  "date" DATE,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TipVale_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TipVale_participantId_idx" ON "TipVale"("participantId");
DO $$ BEGIN
  ALTER TABLE "TipVale" ADD CONSTRAINT "TipVale_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "TipParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── RhExtract (rastreabilidade do retorno do RH) ──────────────────────────────
CREATE TABLE IF NOT EXISTS "RhExtract" (
  "id" TEXT NOT NULL,
  "competenceYear" INTEGER NOT NULL,
  "competenceMonth" INTEGER NOT NULL,
  "empresa" TEXT NOT NULL,
  "cnpj" TEXT,
  "companyId" TEXT,
  "totalLiquido" DECIMAL(14,2) NOT NULL,
  "headcount" INTEGER NOT NULL,
  "fileName" TEXT NOT NULL,
  "storagePath" TEXT,
  "sha256" TEXT,
  "data" JSONB NOT NULL,
  "importedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RhExtract_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RhExtract_competenceYear_competenceMonth_idx" ON "RhExtract"("competenceYear","competenceMonth");
CREATE INDEX IF NOT EXISTS "RhExtract_companyId_idx" ON "RhExtract"("companyId");
