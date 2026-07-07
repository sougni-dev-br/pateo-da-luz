-- Adiciona coluna peopleServed em RevenueEntry para acumular o total de
-- pessoas atendidas por dia (soma de qtd_pessoas das vendas RECEBIDAS
-- vindas do Agile PDV).
--
-- Nullable porque:
--   - lançamentos manuais existentes (import Excel) não têm essa info
--   - dias importados do Agile ANTES desta migração ficam null até o
--     próximo backfill preencher

ALTER TABLE "RevenueEntry" ADD COLUMN "peopleServed" INTEGER;
