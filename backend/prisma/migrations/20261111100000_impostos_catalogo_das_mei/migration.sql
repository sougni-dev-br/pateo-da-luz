-- DAS do MEI: códigos do documento (INSS e ICMS). Os demais (ISS etc.) o sistema aprende ao lançar.
INSERT INTO "TaxCodeCatalog" ("id", "documentType", "code", "description") VALUES
  (gen_random_uuid()::text, 'DAS MEI', '0151', 'INSS - MEI'),
  (gen_random_uuid()::text, 'DAS MEI', '0083', 'ICMS - MEI')
ON CONFLICT ("documentType", "code") DO NOTHING;
