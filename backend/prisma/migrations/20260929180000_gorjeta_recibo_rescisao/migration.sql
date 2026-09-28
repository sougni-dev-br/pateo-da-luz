-- Recibo da rescisão (TRCT) que volta da contabilidade: a gorjeta já paga na
-- rescisão, as datas e o SHA-256 do arquivo. Sem CPF, PIS ou outros dados pessoais.
ALTER TABLE "TipParticipant" ADD COLUMN "rescisaoRecibo" JSONB;
