-- CreateEnum
CREATE TYPE "FichaCadastralTipo" AS ENUM ('ADMISSAO', 'ATUALIZACAO');

-- CreateEnum
CREATE TYPE "FichaCadastralStatus" AS ENUM ('ENVIADA', 'PREENCHENDO', 'FINALIZADA', 'CONCLUIDA', 'CANCELADA');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "nomeConjuge" TEXT,
ADD COLUMN     "rgUf" TEXT;

-- AlterTable
ALTER TABLE "EmployeeDependente" ADD COLUMN     "cpf" TEXT;

-- CreateTable
CREATE TABLE "FichaCadastral" (
    "id" TEXT NOT NULL,
    "tipo" "FichaCadastralTipo" NOT NULL,
    "status" "FichaCadastralStatus" NOT NULL DEFAULT 'ENVIADA',
    "tokenHash" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "nomeReferencia" TEXT NOT NULL,
    "employeeId" TEXT,
    "dados" JSONB NOT NULL DEFAULT '{}',
    "dadosEmpresa" JSONB NOT NULL DEFAULT '{}',
    "tentativasErradas" INTEGER NOT NULL DEFAULT 0,
    "bloqueadoAte" TIMESTAMP(3),
    "motivoDevolucao" TEXT,
    "primeiroAcessoEm" TIMESTAMP(3),
    "finalizadaEm" TIMESTAMP(3),
    "concluidaEm" TIMESTAMP(3),
    "canceladaEm" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "concluidaPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FichaCadastral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FichaCadastralArquivo" (
    "id" TEXT NOT NULL,
    "fichaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "nomeOriginal" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "conteudo" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FichaCadastralArquivo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FichaCadastral_tokenHash_key" ON "FichaCadastral"("tokenHash");

-- CreateIndex
CREATE INDEX "FichaCadastral_status_idx" ON "FichaCadastral"("status");

-- CreateIndex
CREATE INDEX "FichaCadastral_employeeId_idx" ON "FichaCadastral"("employeeId");

-- CreateIndex
CREATE INDEX "FichaCadastralArquivo_fichaId_idx" ON "FichaCadastralArquivo"("fichaId");

-- AddForeignKey
ALTER TABLE "FichaCadastral" ADD CONSTRAINT "FichaCadastral_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FichaCadastralArquivo" ADD CONSTRAINT "FichaCadastralArquivo_fichaId_fkey" FOREIGN KEY ("fichaId") REFERENCES "FichaCadastral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

