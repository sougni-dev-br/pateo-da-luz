-- Percentual de comissão contratual pro 99 Food (ex: 18.00 = 18%).
-- DiDi não expõe comissão real via callback — usamos essa taxa pra
-- estimar noventaNoveFeeAmount de cada pedido.
ALTER TABLE "NoventaNoveCredential" ADD COLUMN "commissionPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;
