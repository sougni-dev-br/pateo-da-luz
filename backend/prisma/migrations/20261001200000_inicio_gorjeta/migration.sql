-- Entrada na gorjeta (regra do Eli, 01/10/2026): quem é contratado começa em teste; se
-- fica, o dono decide quando entra no cálculo da gorjeta. Vazio = ainda não entrou.
-- Aditiva.
ALTER TABLE "Employee" ADD COLUMN "inicioGorjeta" DATE;

-- Backfill: quem já participa da gorjeta entra desde a admissão, para que nada mude no
-- cálculo de quem já está. Sem admissão fica vazio (aparece "em teste" até preencher).
UPDATE "Employee"
SET "inicioGorjeta" = "admissionDate"::date
WHERE "participaGorjeta" = true
  AND "inicioGorjeta" IS NULL
  AND "admissionDate" IS NOT NULL;
