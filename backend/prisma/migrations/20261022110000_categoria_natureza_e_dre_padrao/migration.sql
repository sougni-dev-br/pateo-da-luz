-- Categoria passa a pertencer a uma natureza e a ter uma categoria DRE usual (sugestao, nao regra).
-- Colunas nulas: nenhuma categoria nem produto existente muda; o preenchimento e etapa revisada a parte.
ALTER TABLE "Category" ADD COLUMN     "defaultDreCategoryId" TEXT,
ADD COLUMN     "nature" "ProductNature";

CREATE INDEX "Category_nature_idx" ON "Category"("nature");

CREATE INDEX "Category_defaultDreCategoryId_idx" ON "Category"("defaultDreCategoryId");

ALTER TABLE "Category" ADD CONSTRAINT "Category_defaultDreCategoryId_fkey" FOREIGN KEY ("defaultDreCategoryId") REFERENCES "DRECategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
