-- Gorjeta real digitada no lugar da calculada, por participante do período.
ALTER TABLE "TipParticipant" ADD COLUMN "gorjetaReal" DECIMAL(14,2);
ALTER TABLE "TipParticipant" ADD COLUMN "gorjetaRealMotivo" TEXT;
ALTER TABLE "TipParticipant" ADD COLUMN "gorjetaRealPor" TEXT;
ALTER TABLE "TipParticipant" ADD COLUMN "gorjetaRealEm" TIMESTAMP(3);
