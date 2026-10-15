-- Rotina de conversões do estoquista: produto conferido como "não precisa de conversão" (é contado e comprado na
-- mesma unidade, por exemplo) sai da fila de pendências sem ter conversão cadastrada. Tabela nova, nada muda no que existe.
CREATE TABLE "ProductConversionReview" (
    "productId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NAO_PRECISA',
    "note" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductConversionReview_pkey" PRIMARY KEY ("productId")
);
