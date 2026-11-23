-- CreateTable
CREATE TABLE "SalaoHistoricoMensal" (
    "id" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "vendasAlmoco" DECIMAL(14,2) NOT NULL,
    "vendasJantar" DECIMAL(14,2) NOT NULL,
    "clientesAlmoco" INTEGER NOT NULL,
    "clientesJantar" INTEGER NOT NULL,
    "servico" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "fonte" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaoHistoricoMensal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "salaohistoricomensal_ano_mes_key" ON "SalaoHistoricoMensal"("ano", "mes");
