-- Custo de comida por pessoa do buffet, informado por mes (Analise do Salao).
CREATE TABLE "AgileBuffetCusto" (
    "id" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgileBuffetCusto_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agbuffetcusto_mes_key" ON "AgileBuffetCusto"("ano", "mes");
