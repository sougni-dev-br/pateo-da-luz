-- Desperdicio: lancar em g, ml, kg... e converter para a unidade do estoque (como a ficha tecnica).
-- quantity passa a ter 6 casas (1 g de uma embalagem de 25 kg = 0,00004 UN) e o que foi digitado fica guardado.
ALTER TABLE "WasteEntry" ALTER COLUMN "quantity" TYPE DECIMAL(16,6);
ALTER TABLE "WasteEntry" ADD COLUMN "enteredQuantity" DECIMAL(14,4);
ALTER TABLE "WasteEntry" ADD COLUMN "enteredUnit" TEXT;
ALTER TABLE "WasteEntry" ADD CONSTRAINT "WasteEntry_entered_both_or_none" CHECK (("enteredQuantity" IS NULL) = ("enteredUnit" IS NULL));
