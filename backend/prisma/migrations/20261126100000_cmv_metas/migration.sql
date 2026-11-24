-- CreateTable
CREATE TABLE "CmvMeta" (
    "id" TEXT NOT NULL,
    "escopo" TEXT NOT NULL DEFAULT 'GERAL',
    "sectorId" TEXT,
    "alvoPercentual" DECIMAL(6,2) NOT NULL,
    "alertaPercentual" DECIMAL(6,2) NOT NULL,
    "vigenciaInicio" DATE NOT NULL,
    "vigenciaFim" DATE,
    "observacao" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CmvMeta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CmvMeta_escopo_sectorId_vigenciaInicio_idx" ON "CmvMeta"("escopo", "sectorId", "vigenciaInicio");

-- Garante: escopo válido, setor só no escopo SETOR, alerta <= alvo
ALTER TABLE "CmvMeta" ADD CONSTRAINT "CmvMeta_escopo_check" CHECK ("escopo" IN ('GERAL', 'SETOR'));
ALTER TABLE "CmvMeta" ADD CONSTRAINT "CmvMeta_setor_check" CHECK (("escopo" = 'GERAL' AND "sectorId" IS NULL) OR ("escopo" = 'SETOR' AND "sectorId" IS NOT NULL));
ALTER TABLE "CmvMeta" ADD CONSTRAINT "CmvMeta_percentuais_check" CHECK ("alvoPercentual" > 0 AND "alvoPercentual" <= 100 AND "alertaPercentual" > 0 AND "alertaPercentual" <= "alvoPercentual");
