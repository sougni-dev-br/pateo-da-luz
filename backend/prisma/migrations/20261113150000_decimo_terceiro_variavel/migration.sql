-- Variável do mês informada à mão para o 13º (aditiva: tabela nova, nada existente muda).
CREATE TABLE "DecimoTerceiroVariavel" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "motivo" TEXT NOT NULL,
    "criadoPorId" TEXT,
    "atualizadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecimoTerceiroVariavel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DecimoTerceiroVariavel_employeeId_ano_mes_key" ON "DecimoTerceiroVariavel"("employeeId", "ano", "mes");
CREATE INDEX "DecimoTerceiroVariavel_ano_idx" ON "DecimoTerceiroVariavel"("ano");

ALTER TABLE "DecimoTerceiroVariavel" ADD CONSTRAINT "DecimoTerceiroVariavel_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
