-- Cancelamento de item: quem cancelou o item e o motivo (colunas novas, nullable).
-- So acrescenta colunas; nao altera dado existente.
-- AlterTable
ALTER TABLE "AgileSaleItem" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledBy" TEXT;

