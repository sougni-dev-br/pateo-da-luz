-- O bolso do display de acrílico mede 9,5 × 9,2 cm (medido com régua em 05/10/2026):
-- a face passa de 9,2 × 7,6 cm (medida da planilha antiga) para 9,4 × 9,0 cm.
ALTER TABLE "BuffetMenuCard" ALTER COLUMN "faceWidthMm" SET DEFAULT 94;
ALTER TABLE "BuffetMenuCard" ALTER COLUMN "faceHeightMm" SET DEFAULT 90;

-- Cardápios montados na medida antiga passam para a do display.
UPDATE "BuffetMenuCard" SET "faceWidthMm" = 94, "faceHeightMm" = 90 WHERE "faceWidthMm" = 92 AND "faceHeightMm" = 76;
