-- Enforce unique externalCode on Supplier and Product.
-- PostgreSQL treats NULLs as distinct in unique indexes by default,
-- so rows without externalCode remain allowed (multiple NULLs coexist).
-- Only non-NULL values are constrained to be unique.
--
-- Prerequisite: run scripts/check-external-code-duplicates.ts and resolve
-- any duplicates BEFORE applying this migration in production.

DROP INDEX IF EXISTS "Supplier_externalCode_idx";
CREATE UNIQUE INDEX "Supplier_externalCode_key" ON "Supplier"("externalCode");

DROP INDEX IF EXISTS "Product_externalCode_idx";
CREATE UNIQUE INDEX "Product_externalCode_key" ON "Product"("externalCode");
