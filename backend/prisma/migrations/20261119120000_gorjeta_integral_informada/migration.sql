-- Gorjeta integral do mês digitada à mão, por pessoa e competência (aditiva: tabela nova, nada existente muda).
CREATE TABLE "GorjetaIntegralInformada" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "competencia" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "origem" TEXT NOT NULL DEFAULT 'INFORMADA',
    "criadoPorId" TEXT,
    "atualizadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GorjetaIntegralInformada_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GorjetaIntegralInformada_employeeId_competencia_key" ON "GorjetaIntegralInformada"("employeeId", "competencia");
CREATE INDEX "GorjetaIntegralInformada_competencia_idx" ON "GorjetaIntegralInformada"("competencia");

ALTER TABLE "GorjetaIntegralInformada" ADD CONSTRAINT "GorjetaIntegralInformada_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
