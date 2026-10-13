-- Desconto da venda: subtotal, valor e tipo (colunas novas, nullable: NULL = sem dado).
-- So acrescenta colunas; nao altera dado existente.
-- AlterTable
ALTER TABLE "AgileSale" ADD COLUMN     "discountAmount" DECIMAL(14,2),
ADD COLUMN     "discountLabel" TEXT,
ADD COLUMN     "subtotalAmount" DECIMAL(14,2);

