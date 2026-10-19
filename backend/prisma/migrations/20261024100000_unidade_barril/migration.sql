-- Unidade "Barril" (BARRIL): barril de chopp, 1 barril = 50 L.
-- Só acrescenta a unidade; nada do que existe muda.
INSERT INTO "UnitMeasure" ("id", "code", "name", "isActive", "createdAt", "updatedAt")
SELECT 'unit_barril', 'BARRIL', 'Barril', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "UnitMeasure" WHERE "code" = 'BARRIL');
