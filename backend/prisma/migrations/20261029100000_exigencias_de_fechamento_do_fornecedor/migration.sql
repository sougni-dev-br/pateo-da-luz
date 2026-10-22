-- Exigências mensais de um fornecedor obrigatório no Fechamento Mensal.
--
-- Cada exigência é um lançamento que o fornecedor precisa ter em todo mês,
-- reconhecido pelo PRODUTO dos itens da compra (ex.: o condomínio do shopping tem
-- "Condomínio do mês" e "Parcelamento de dívida"). `settledAt` encerra a cobrança
-- quando o acordo é quitado, sem apagar o histórico.
-- Só cria a tabela: nenhuma tabela existente é alterada.

CREATE TABLE "SupplierClosingRequirement" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "settledAt" TIMESTAMP(3),
    "settledByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierClosingRequirement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplierClosingRequirement_supplierId_idx" ON "SupplierClosingRequirement"("supplierId");

-- Dois lançamentos com o mesmo produto seriam indistinguíveis: um produto por exigência.
CREATE UNIQUE INDEX "SupplierClosingRequirement_supplierId_productId_key" ON "SupplierClosingRequirement"("supplierId", "productId");

ALTER TABLE "SupplierClosingRequirement" ADD CONSTRAINT "SupplierClosingRequirement_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplierClosingRequirement" ADD CONSTRAINT "SupplierClosingRequirement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
