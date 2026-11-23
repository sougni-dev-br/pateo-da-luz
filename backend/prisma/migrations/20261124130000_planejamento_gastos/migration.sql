-- AlterTable
ALTER TABLE "PlanejamentoCenario" ADD COLUMN "servicoPercentual" DECIMAL(6,4);

-- CreateTable
CREATE TABLE "PlanejamentoGastoLinha" (
    "id" TEXT NOT NULL,
    "cenarioId" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "modo" TEXT NOT NULL,
    "valores" JSONB NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanejamentoGastoLinha_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanejamentoGastoLinha_cenarioId_idx" ON "PlanejamentoGastoLinha"("cenarioId");

-- CreateIndex
CREATE UNIQUE INDEX "planejamentogastolinha_cenario_nome_key" ON "PlanejamentoGastoLinha"("cenarioId", "nome");

-- AddForeignKey
ALTER TABLE "PlanejamentoGastoLinha" ADD CONSTRAINT "PlanejamentoGastoLinha_cenarioId_fkey" FOREIGN KEY ("cenarioId") REFERENCES "PlanejamentoCenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
