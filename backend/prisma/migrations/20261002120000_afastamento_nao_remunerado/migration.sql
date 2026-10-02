-- Afastamento não remunerado: novo tipo de dia na escala (aditivo).
ALTER TYPE "ScheduleDayType" ADD VALUE IF NOT EXISTS 'AFASTAMENTO';

-- Regra da gorjeta para os dias de afastamento: no período (padrão: desconta, como as férias)
-- e por pessoa (null = segue o período). O salário e o VT descontam sempre.
ALTER TABLE "TipPeriod" ADD COLUMN IF NOT EXISTS "descontaAfastamento" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TipParticipant" ADD COLUMN IF NOT EXISTS "descontaAfastamento" BOOLEAN;