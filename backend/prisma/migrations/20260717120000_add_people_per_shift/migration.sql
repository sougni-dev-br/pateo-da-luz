-- Pessoas atendidas por turno. O CSV de vendas do Agile ja traz qtd_pessoas e
-- turno em cada linha; ate agora so o total do dia era persistido, entao o
-- almoco e o jantar nao podiam ser comparados por pessoa (so por mesa).
-- Nullable: dias importados antes desta migration nao tem o dado e devem
-- exibir "—" em vez de zero, que seria uma afirmacao falsa.
ALTER TABLE "RevenueEntry" ADD COLUMN IF NOT EXISTS "peopleFirstShift" INTEGER;
ALTER TABLE "RevenueEntry" ADD COLUMN IF NOT EXISTS "peopleSecondShift" INTEGER;
