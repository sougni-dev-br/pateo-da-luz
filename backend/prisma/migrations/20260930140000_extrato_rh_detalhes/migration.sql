-- Armazenamento completo do "Extrato Mensal" da contabilidade (aditiva).
-- O PDF passa a morar no banco (o disco do Render some a cada deploy), junto do texto
-- extraído e, por pessoa, do holerite inteiro: cabeçalho, rubricas e rodapé. Sem CPF
-- nas tabelas novas — o vínculo com o cadastro é o employeeId.
-- Registros antigos ficam calculo = 'MENSAL'; reimportar o mesmo PDF completa o registro.

-- AlterTable
ALTER TABLE "RhExtract" ADD COLUMN     "arquivo" BYTEA,
ADD COLUMN     "calculo" TEXT NOT NULL DEFAULT 'MENSAL',
ADD COLUMN     "emissao" DATE,
ADD COLUMN     "texto" TEXT,
ADD COLUMN     "totalDescontos" DECIMAL(14,2),
ADD COLUMN     "totalProventos" DECIMAL(14,2),
ADD COLUMN     "updatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RhExtractPessoa" (
    "id" TEXT NOT NULL,
    "rhExtractId" TEXT NOT NULL,
    "employeeId" TEXT,
    "matricula" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "situacao" TEXT,
    "vinculo" TEXT,
    "horasMes" DECIMAL(8,2),
    "cargoCodigo" TEXT,
    "cargo" TEXT,
    "cbo" TEXT,
    "salarioBase" DECIMAL(12,2),
    "admissao" DATE,
    "demissao" DATE,
    "demissaoMotivo" TEXT,
    "proventos" DECIMAL(12,2) NOT NULL,
    "descontos" DECIMAL(12,2) NOT NULL,
    "liquido" DECIMAL(12,2) NOT NULL,
    "baseInss" DECIMAL(12,2),
    "baseFgts" DECIMAL(12,2),
    "baseIrrf" DECIMAL(12,2),
    "valorFgts" DECIMAL(12,2),
    "liquidoRescisao" DECIMAL(12,2),
    "conferido" BOOLEAN NOT NULL DEFAULT false,
    "texto" TEXT NOT NULL,

    CONSTRAINT "RhExtractPessoa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RhExtractRubrica" (
    "id" TEXT NOT NULL,
    "pessoaId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "referencia" DECIMAL(12,2),
    "valor" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "RhExtractRubrica_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RhExtractPessoa_rhExtractId_idx" ON "RhExtractPessoa"("rhExtractId");

-- CreateIndex
CREATE INDEX "RhExtractPessoa_employeeId_idx" ON "RhExtractPessoa"("employeeId");

-- CreateIndex
CREATE INDEX "RhExtractRubrica_pessoaId_idx" ON "RhExtractRubrica"("pessoaId");

-- CreateIndex
CREATE INDEX "RhExtractRubrica_codigo_idx" ON "RhExtractRubrica"("codigo");

-- CreateIndex
CREATE INDEX "RhExtract_sha256_idx" ON "RhExtract"("sha256");

-- AddForeignKey
ALTER TABLE "RhExtractPessoa" ADD CONSTRAINT "RhExtractPessoa_rhExtractId_fkey" FOREIGN KEY ("rhExtractId") REFERENCES "RhExtract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RhExtractPessoa" ADD CONSTRAINT "RhExtractPessoa_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RhExtractRubrica" ADD CONSTRAINT "RhExtractRubrica_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "RhExtractPessoa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

