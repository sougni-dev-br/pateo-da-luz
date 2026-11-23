-- CreateTable
CREATE TABLE "PlanejamentoCenario" (
    "id" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "anoBase" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,
    "premissas" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanejamentoCenario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "planejamentocenario_ano_nome_key" ON "PlanejamentoCenario"("ano", "nome");
