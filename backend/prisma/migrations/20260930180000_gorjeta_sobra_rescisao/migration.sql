-- Gorjeta: o que quem saiu deixou de ganhar depois da saída pode ir para o livre
-- em vez de subir o ponto de quem fica. Padrão false = regra que já existia.
ALTER TABLE "TipPeriod" ADD COLUMN "sobraRescisaoParaSaldo" BOOLEAN NOT NULL DEFAULT false;
