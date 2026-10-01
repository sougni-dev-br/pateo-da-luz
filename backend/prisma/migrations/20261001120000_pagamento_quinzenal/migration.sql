-- Quem não tem registro e recebe por quinzena: metade do salário base no dia 15 (1ª
-- quinzena) e o acerto no dia 30 pela lista de pagamento, que desconta a 1ª quinzena.
-- Falso = recebe no pagamento (ou adiantamento, se recebeAdiantamento). Aditiva.
ALTER TABLE "Employee" ADD COLUMN "pagamentoQuinzenal" BOOLEAN NOT NULL DEFAULT false;
