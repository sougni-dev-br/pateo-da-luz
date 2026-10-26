-- Impostos e Guias: catálogo de códigos (o código digitado traz a denominação). Começa com os códigos dos
-- documentos conhecidos (DAS e DARF) e aprende os novos ao lançar uma guia.
CREATE TABLE IF NOT EXISTS "TaxCodeCatalog" (
    "id" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxCodeCatalog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TaxCodeCatalog_documentType_code_key" ON "TaxCodeCatalog"("documentType", "code");

INSERT INTO "TaxCodeCatalog" ("id", "documentType", "code", "description") VALUES
  (gen_random_uuid()::text, 'Simples Nacional / DAS', '1001', 'IRPJ - SIMPLES NACIONAL'),
  (gen_random_uuid()::text, 'Simples Nacional / DAS', '1002', 'CSLL - SIMPLES NACIONAL'),
  (gen_random_uuid()::text, 'Simples Nacional / DAS', '1004', 'COFINS - SIMPLES NACIONAL'),
  (gen_random_uuid()::text, 'Simples Nacional / DAS', '1005', 'PIS - SIMPLES NACIONAL'),
  (gen_random_uuid()::text, 'Simples Nacional / DAS', '1006', 'INSS - SIMPLES NACIONAL'),
  (gen_random_uuid()::text, 'Simples Nacional / DAS', '1007', 'ICMS - SIMPLES NACIONAL SP'),
  (gen_random_uuid()::text, 'DARF', '1082', 'CONTR PREV DESCONTA SEGURADO-EMPREGADO/AVULSO'),
  (gen_random_uuid()::text, 'DARF', '1099', 'CP DESCONTADA SEGURADO - CONTRIB INDIVIDUAL'),
  (gen_random_uuid()::text, 'DARF', '0561', 'IRRF - RENDIMENTO DO TRABALHO ASSALARIADO'),
  (gen_random_uuid()::text, 'DARF IR', '0561', 'IRRF - RENDIMENTO DO TRABALHO ASSALARIADO'),
  (gen_random_uuid()::text, 'IRRF', '0561', 'IRRF - RENDIMENTO DO TRABALHO ASSALARIADO')
ON CONFLICT ("documentType", "code") DO NOTHING;
