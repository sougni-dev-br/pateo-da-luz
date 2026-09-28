-- Gorjeta: admitido no meio do período recebe proporcional (regra do período) e
-- quem fecha pode decidir, pessoa a pessoa, se cada ocorrência desconta.
ALTER TABLE "TipPeriod" ADD COLUMN "proporcionalEntrada" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TipParticipant" ADD COLUMN "descontaFalta" BOOLEAN;
ALTER TABLE "TipParticipant" ADD COLUMN "descontaAtestado" BOOLEAN;
ALTER TABLE "TipParticipant" ADD COLUMN "descontaFerias" BOOLEAN;
ALTER TABLE "TipParticipant" ADD COLUMN "descontaOutros" BOOLEAN;
ALTER TABLE "TipParticipant" ADD COLUMN "proporcionalEntrada" BOOLEAN;
