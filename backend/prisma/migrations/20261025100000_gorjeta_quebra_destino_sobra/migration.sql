-- Apuração de gorjeta: % de quebra retido e destino dos pontos não distribuídos.
ALTER TABLE "TipPeriod" ADD COLUMN IF NOT EXISTS "quebraPct" DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "TipPeriod" ADD COLUMN IF NOT EXISTS "destinoSobra" TEXT NOT NULL DEFAULT 'FUNDO';
