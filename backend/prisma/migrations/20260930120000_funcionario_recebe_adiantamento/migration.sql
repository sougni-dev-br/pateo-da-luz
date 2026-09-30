-- Quem não tem registro e recebe adiantamento salarial no dia do adiantamento
-- (PayrollSettings.advanceDueDay): a lista de pagamento desconta o que já foi pago.
-- Falso = recebe tudo no pagamento. Para CLT é só informativo.
ALTER TABLE "Employee" ADD COLUMN "recebeAdiantamento" BOOLEAN NOT NULL DEFAULT false;
