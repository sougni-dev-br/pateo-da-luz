-- Unidade "Peça" (PÇ): o cadastro de produtos não tinha como escolher peça e o uso virava UN.
-- Só acrescenta a unidade; nada do que existe muda.
INSERT INTO "UnitMeasure" ("id", "code", "name", "isActive", "createdAt", "updatedAt")
SELECT 'unit_peca', 'PÇ', 'Peça', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "UnitMeasure" WHERE "code" = 'PÇ');
