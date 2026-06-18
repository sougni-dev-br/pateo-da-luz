-- CreateEnum
CREATE TYPE "NaturezaGerencial" AS ENUM ('CMV_COMPRA_SEM_NF', 'DESPESA_OPERACIONAL', 'IMPOSTO_TAXA', 'FINANCEIRO_TARIFA', 'INVESTIMENTO_PLANEJAMENTO', 'NAO_ENTRA_DRE');

-- AlterTable
ALTER TABLE "SmallExpenseType" ADD COLUMN "naturezaGerencial" "NaturezaGerencial";

-- CreateIndex
CREATE INDEX "SmallExpenseType_naturezaGerencial_idx" ON "SmallExpenseType"("naturezaGerencial");
