-- Sem registro que não participa da gorjeta entra no período só para o salário (lista de pagamento).
ALTER TABLE "TipParticipant" ADD COLUMN "foraDaGorjeta" BOOLEAN NOT NULL DEFAULT false;
