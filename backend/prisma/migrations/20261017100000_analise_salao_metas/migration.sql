-- Metas mensais da Analise do Salao: uma linha por mes e indicador.
CREATE TABLE "AgileSalaoMeta" (
    "id" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "indicador" TEXT NOT NULL,
    "valor" DECIMAL(14,4) NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgileSalaoMeta_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agsalaometa_mes_indicador_key" ON "AgileSalaoMeta"("ano", "mes", "indicador");
