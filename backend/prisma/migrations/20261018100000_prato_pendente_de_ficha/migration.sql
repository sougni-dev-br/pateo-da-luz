-- Desperdicio: prato criado na hora do lancamento, aguardando a ficha tecnica.
-- O prato nasce inativo (cardapio, preco e mix nao o enxergam) e marcado como preparacao de buffet pendente;
-- quando a ficha fica completa, a marca de pendente sai e os lancamentos sem valor passam a valer.
ALTER TABLE "Dish" ADD COLUMN "fichaDeBuffet" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Dish" ADD COLUMN "fichaPendente" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Dish" ADD COLUMN "pendenteDesde" TIMESTAMP(3);
ALTER TABLE "Dish" ADD COLUMN "pendentePorId" TEXT;
ALTER TABLE "Dish" ADD COLUMN "pendenteObservacao" TEXT;
ALTER TABLE "Dish" ADD COLUMN "fichaConcluidaEm" TIMESTAMP(3);
ALTER TABLE "Dish" ADD CONSTRAINT "Dish_pendente_so_de_buffet" CHECK (NOT "fichaPendente" OR "fichaDeBuffet");
CREATE INDEX "Dish_fichaPendente_idx" ON "Dish"("fichaPendente");
