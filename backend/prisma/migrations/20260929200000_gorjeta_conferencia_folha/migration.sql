-- Conferência do extrato da contabilidade, etapas do mês e salário combinado.

ALTER TABLE "Employee" ADD COLUMN "salarioCombinado" DECIMAL(12,2);
ALTER TABLE "Employee" ADD COLUMN "salarioCombinadoMotivo" TEXT;

CREATE TABLE "TipExtrato" (
  "id" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "empresa" TEXT NOT NULL,
  "cnpj" TEXT NOT NULL,
  "competenceYear" INTEGER NOT NULL,
  "competenceMonth" INTEGER NOT NULL,
  "arquivo" TEXT NOT NULL,
  "hash" TEXT NOT NULL,
  "linhas" JSONB NOT NULL,
  "importadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "importadoPorId" TEXT NOT NULL,
  "importadoPor" TEXT NOT NULL,
  CONSTRAINT "TipExtrato_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TipExtrato_periodId_cnpj_key" ON "TipExtrato"("periodId", "cnpj");
ALTER TABLE "TipExtrato" ADD CONSTRAINT "TipExtrato_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "TipPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TipConferenciaAceite" (
  "id" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "employeeKey" TEXT NOT NULL,
  "justificativa" TEXT NOT NULL,
  "porId" TEXT NOT NULL,
  "por" TEXT NOT NULL,
  "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TipConferenciaAceite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TipConferenciaAceite_periodId_employeeKey_key" ON "TipConferenciaAceite"("periodId", "employeeKey");
ALTER TABLE "TipConferenciaAceite" ADD CONSTRAINT "TipConferenciaAceite_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "TipPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TipPeriodEtapa" (
  "id" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "etapa" TEXT NOT NULL,
  "acao" TEXT NOT NULL,
  "obs" TEXT,
  "porId" TEXT NOT NULL,
  "por" TEXT NOT NULL,
  "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TipPeriodEtapa_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TipPeriodEtapa_periodId_em_idx" ON "TipPeriodEtapa"("periodId", "em");
ALTER TABLE "TipPeriodEtapa" ADD CONSTRAINT "TipPeriodEtapa_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "TipPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
