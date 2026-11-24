-- CreateTable
CREATE TABLE "BrindeCampanha" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "observacao" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrindeCampanha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrindeEntrega" (
    "id" TEXT NOT NULL,
    "campanhaId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "entregueEm" DATE NOT NULL,
    "observacao" TEXT,
    "registradoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrindeEntrega_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrindeCampanha_nome_ano_key" ON "BrindeCampanha"("nome", "ano");

-- CreateIndex
CREATE INDEX "BrindeEntrega_employeeId_idx" ON "BrindeEntrega"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "BrindeEntrega_campanhaId_employeeId_key" ON "BrindeEntrega"("campanhaId", "employeeId");

-- AddForeignKey
ALTER TABLE "BrindeEntrega" ADD CONSTRAINT "BrindeEntrega_campanhaId_fkey" FOREIGN KEY ("campanhaId") REFERENCES "BrindeCampanha"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrindeEntrega" ADD CONSTRAINT "BrindeEntrega_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
