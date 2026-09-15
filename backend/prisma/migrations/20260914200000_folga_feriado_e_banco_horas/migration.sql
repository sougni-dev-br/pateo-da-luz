-- Dois tipos novos de folga na escala:
--   FOLGA_FERIADO      (FF) — folga tirada contra o saldo de feriado trabalhado
--   FOLGA_BANCO_HORAS  (BH) — folga tirada contra o banco de horas
--
-- Para o vale-transporte os dois são idênticos a FOLGA: dia não trabalhado, não
-- paga condução. O que muda é o controle — FF debita o saldo de feriado.
ALTER TYPE "ScheduleDayType" ADD VALUE IF NOT EXISTS 'FOLGA_FERIADO';
ALTER TYPE "ScheduleDayType" ADD VALUE IF NOT EXISTS 'FOLGA_BANCO_HORAS';
